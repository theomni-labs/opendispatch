// SPDX-License-Identifier: AGPL-3.0-only

package sim_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds/sim"
)

var fixturesDir = filepath.Join("..", "..", "..", "..", "..", "fixtures")

func at(h, m int) time.Time { return time.Date(2026, 10, 2, h, m, 0, 0, sim.Riyadh) }

func TestTemplatesFollowTheDayAndGiveOpenDispatchTime(t *testing.T) {
	ts, agents, err := sim.LoadTemplates(fixturesDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(ts) != 839 || len(agents) == 0 {
		t.Fatalf("%d templates, %d agents", len(ts), len(agents))
	}
	slow := 0
	for i, x := range ts {
		if i > 0 && x.TimeOfDay < ts[i-1].TimeOfDay {
			t.Fatal("templates are not in time-of-day order")
		}
		if d := x.CustomerDelay(); d < sim.CustomerMinDelay || d > sim.CustomerMaxDelay {
			t.Fatalf("Customer delay %s out of bounds", d)
		}
		if x.CustomerDelay() >= 15*time.Second {
			slow++
		}
		if x.AgentCode == "" || x.Base.ZoneExternalID == "" || x.CloseAfter <= x.ArriveAfter {
			t.Fatalf("a template is incomplete: %+v", x)
		}
	}
	if slow*10 < len(ts)*8 {
		t.Fatalf("only %d of %d cases leave OpenDispatch 15 s", slow, len(ts))
	}
}

func countBetween(ts []sim.Template, from, to time.Duration) int {
	n := 0
	for _, x := range ts {
		if x.TimeOfDay > from && x.TimeOfDay <= to {
			n++
		}
	}
	return n
}

func TestDueKeepsThePaceAndCompressesIt(t *testing.T) {
	ts, _, err := sim.LoadTemplates(fixturesDir)
	if err != nil {
		t.Fatal(err)
	}
	want := countBetween(ts, 19*time.Hour, 20*time.Hour)
	real := sim.Pace{Start: at(19, 0), Speed: 1}
	if got := len(sim.Due(ts, real, at(19, 0), at(20, 0))); got != want || want == 0 {
		t.Fatalf("an hour at speed 1: %d cases, want %d", got, want)
	}
	fast := sim.Pace{Start: at(19, 0), Speed: 60}
	got := sim.Due(ts, fast, at(19, 0), at(19, 1))
	if len(got) != want {
		t.Fatalf("a minute at speed 60: %d cases, want %d", len(got), want)
	}
	for _, a := range got {
		if a.At.Before(at(19, 0)) || a.At.After(at(19, 1)) {
			t.Fatalf("an arrival at %s is outside the minute", a.At)
		}
	}
	night := sim.Pace{Start: at(23, 30), Speed: 1}
	wrap := len(sim.Due(ts, night, at(23, 30), at(23, 30).Add(time.Hour)))
	if want := countBetween(ts, 23*time.Hour+30*time.Minute, 24*time.Hour) + countBetween(ts, -1, 30*time.Minute); wrap != want {
		t.Fatalf("across midnight: %d cases, want %d", wrap, want)
	}
}

func oneTemplate(start time.Time) *sim.Live {
	lat, lon := 24.7, 46.7
	tpl := sim.Template{Base: feeds.CasePayload{ExternalID: "x", CaseNumber: "RD-1", ZoneExternalID: "2001", CaseTypeExternalID: "1",
		Latitude: &lat, Longitude: &lon, Handling: "field"},
		TimeOfDay: 19*time.Hour + 10*time.Second, AssignAfter: 90 * time.Second, ArriveAfter: 5 * time.Minute,
		CloseAfter: 20 * time.Minute, AgentCode: "SVR-CUSTOMER"}
	return &sim.Live{Templates: []sim.Template{tpl}, Pace: sim.Pace{Start: start, Speed: 1}, RunID: "t",
		Positions: map[string][2]float64{"SVR-CUSTOMER": {24.75, 46.75}}}
}

func TestAnIdleAgentSendsAHeartbeatEveryPing(t *testing.T) {
	start := at(19, 0)
	l := oneTemplate(start)
	l.Idle = map[string]bool{"SVR-IDLE": true, "SVR-NOPOS": true}
	l.Positions["SVR-IDLE"] = [2]float64{24.7, 46.7}
	beats := func(ss []feeds.StatusEvent) int {
		n := 0
		for _, e := range ss {
			if strings.Contains(e.IdempotencyKey, ":beat:") {
				if e.AgentCode != "SVR-IDLE" || e.Status != "available" || e.Validate() != "" {
					t.Fatalf("heartbeat: %+v", e)
				}
				n++
			}
		}
		return n
	}
	_, ss := l.Tick(start.Add(time.Second), nil, true)
	_, ss2 := l.Tick(start.Add(20*time.Second), nil, true)
	_, ss3 := l.Tick(start.Add(32*time.Second), nil, true)
	if beats(ss) != 1 || beats(ss2) != 0 || beats(ss3) != 1 {
		t.Fatalf("want one heartbeat per %s: %d %d %d", sim.PingEvery, beats(ss), beats(ss2), beats(ss3))
	}
}

func TestACaseArrivesNewThenCustomerAssignsIt(t *testing.T) {
	start := at(19, 0)
	l := oneTemplate(start)
	cs, ss := l.Tick(start.Add(11*time.Second), nil, true)
	if len(cs) != 1 || len(ss) != 0 {
		t.Fatalf("arrival: %d case events, %d statuses", len(cs), len(ss))
	}
	c := cs[0]
	if c.Case.AssignedAt != nil || c.Case.AgentCode != nil || !strings.Contains(c.Case.CaseNumber, "-LIVE-") ||
		!c.Case.RegisteredAt.Equal(start.Add(10*time.Second)) || c.Validate() != "" {
		t.Fatalf("the first version must be new and unassigned: %+v", c.Case)
	}
	if cs, _ := l.Tick(start.Add(time.Minute), map[string]sim.Decision{c.Case.CaseNumber: {State: "recommended", Recommended: true}}, true); len(cs) != 0 {
		t.Fatal("Customer assigned before its delay")
	}
	board := map[string]sim.Decision{c.Case.CaseNumber: {State: "recommended", Recommended: true}}
	cs, ss = l.Tick(start.Add(101*time.Second), board, true)
	if len(cs) != 1 || cs[0].Case.AgentCode == nil || *cs[0].Case.AgentCode != "SVR-CUSTOMER" || !cs[0].Case.AssignedAt.Equal(start.Add(100*time.Second)) {
		t.Fatalf("Customer's version: %+v", cs)
	}
	if len(ss) != 1 || ss[0].Status != "en_route" || *ss[0].Latitude != 24.75 {
		t.Fatalf("en route from the agent's last position: %+v", ss)
	}
	if l.Stats.AtCustomer["recommended"] != 1 || l.Stats.RecommendedAtCustomer != 1 || l.Stats.CustomerAssigned != 1 {
		t.Fatalf("stats: %+v", l.Stats)
	}
	cs, ss = l.Tick(start.Add(7*time.Minute), nil, true)
	if len(cs) != 1 || cs[0].Case.ArrivedAt == nil || len(ss) < 5 || ss[len(ss)-1].Status != "on_scene" {
		t.Fatalf("arrival: %d case events, %d statuses", len(cs), len(ss))
	}
	cs, ss = l.Tick(start.Add(30*time.Minute), nil, true)
	if len(cs) != 1 || cs[0].Case.ClosedAt == nil || len(ss) != 1 || ss[0].Status != "available" || l.Stats.Closed != 1 {
		t.Fatalf("close: %+v %+v", cs, ss)
	}
	for _, e := range ss {
		if e.Validate() != "" {
			t.Fatal(e.Validate())
		}
	}
}

func TestCustomerTakesAnAcceptedOpenDispatchAssignmentAtOnce(t *testing.T) {
	start := at(19, 0)
	l := oneTemplate(start)
	cs, _ := l.Tick(start.Add(11*time.Second), nil, true)
	number := cs[0].Case.CaseNumber
	board := map[string]sim.Decision{number: {State: "assigned", Source: "OPENDISPATCH", AgentCode: "SVR-OpenDispatch"}}
	if cs, _ := l.Tick(start.Add(15*time.Second), board, false); len(cs) != 0 {
		t.Fatal("with the link down Customer must not take the OpenDispatch assignment")
	}
	cs, _ = l.Tick(start.Add(20*time.Second), board, true)
	if len(cs) != 1 || *cs[0].Case.AgentCode != "SVR-OpenDispatch" || l.Stats.Echoed != 1 || l.Stats.CustomerAssigned != 0 {
		t.Fatalf("Customer must report OpenDispatch's agent: %+v, %+v", cs, l.Stats)
	}
	if cs, _ := l.Tick(start.Add(3*time.Minute), board, true); len(cs) != 0 {
		t.Fatal("a second assignment was sent")
	}
}

type posts struct {
	at   []time.Time
	keys []string
	fail bool
	now  time.Time
}

func (p *posts) post(_ context.Context, _ string, events []json.RawMessage) error {
	if p.fail {
		return errors.New("down")
	}
	for _, e := range events {
		var ev feeds.Event
		_ = json.Unmarshal(e, &ev)
		p.at, p.keys = append(p.at, p.now), append(p.keys, ev.IdempotencyKey)
	}
	return nil
}

func everyTwentySeconds(start time.Time) *sim.Live {
	var ts []sim.Template
	for i := 1; i <= 30; i++ {
		lat, lon := 24.7, 46.7
		ts = append(ts, sim.Template{Base: feeds.CasePayload{CaseNumber: "RD-1", ZoneExternalID: "2001", Latitude: &lat, Longitude: &lon, Handling: "field"},
			TimeOfDay: 19*time.Hour + time.Duration(i)*20*time.Second, AssignAfter: time.Minute, ArriveAfter: 5 * time.Minute,
			CloseAfter: 20 * time.Minute, AgentCode: "S"})
	}
	return &sim.Live{Templates: ts, Pace: sim.Pace{Start: start, Speed: 1}, RunID: "r"}
}

func TestAPlannedOutageSilencesTheFeedsThenDeliversTheBacklog(t *testing.T) {
	start := at(19, 0)
	p := &posts{}
	w, err := sim.ParseOutage("1m:2m", start)
	if err != nil || w == nil {
		t.Fatal(err)
	}
	r := &sim.Runner{Live: everyTwentySeconds(start), Post: p.post, Outages: []sim.Window{*w}}
	for s := 0; s <= 240; s++ {
		p.now = start.Add(time.Duration(s) * time.Second)
		r.Step(context.Background(), p.now)
	}
	newDuring := 0
	for i, a := range p.at {
		if !a.Before(w.From) && a.Before(w.To) {
			t.Fatalf("an event was sent during the outage at %s", a)
		}
		if a.Equal(w.To) && strings.HasSuffix(p.keys[i], ":new") {
			newDuring++
		}
	}
	if newDuring != 7 || r.Queued() != 0 {
		t.Fatalf("after the outage: %d new cases delivered at once (want 7), %d queued", newDuring, r.Queued())
	}
}

func TestTheControlFileStartsAnOutageAndTheSenderKeepsEventsWhileTheApiIsDown(t *testing.T) {
	start := at(19, 0)
	control := filepath.Join(t.TempDir(), "outage")
	p := &posts{fail: true}
	r := &sim.Runner{Live: everyTwentySeconds(start), Post: p.post, Control: control}
	step := func(s int) {
		p.now = start.Add(time.Duration(s) * time.Second)
		r.Step(context.Background(), p.now)
	}
	for s := 0; s <= 30; s++ {
		step(s)
	}
	if r.Queued() == 0 || len(p.at) != 0 {
		t.Fatal("events must wait while the api is down")
	}
	p.fail = false
	step(31)
	if r.Queued() != 0 || len(p.at) == 0 {
		t.Fatal("the backlog was not sent once the api answered")
	}
	if err := os.WriteFile(control, []byte("0.5\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	step(32)
	if _, err := os.Stat(control); !os.IsNotExist(err) {
		t.Fatal("the control file must be consumed")
	}
	if !r.Silent(start.Add(61*time.Second)) || r.Silent(start.Add(63*time.Second)) {
		t.Fatal("the requested outage must last 30 s")
	}
}

func TestAZeroInTheControlFileEndsTheOutageNow(t *testing.T) {
	start := at(19, 0)
	control := filepath.Join(t.TempDir(), "outage")
	p := &posts{}
	r := &sim.Runner{Live: everyTwentySeconds(start), Post: p.post, Control: control}
	write := func(v string) {
		if err := os.WriteFile(control, []byte(v), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("1440\n")
	r.Step(context.Background(), start)
	if !r.Silent(start.Add(time.Hour)) {
		t.Fatal("1440 minutes must silence the feeds")
	}
	write("0\n")
	r.Step(context.Background(), start.Add(time.Minute))
	if r.Silent(start.Add(time.Minute)) || r.Silent(start.Add(time.Hour)) {
		t.Fatal("0 must end the outage")
	}
}

func TestOutageSettings(t *testing.T) {
	start := at(19, 0)
	for _, off := range []string{"", "off", "0"} {
		if w, err := sim.ParseOutage(off, start); w != nil || err != nil {
			t.Fatalf("%q must mean off", off)
		}
	}
	for _, bad := range []string{"10m", "x:3m", "10m:0s", "10m:-1m"} {
		if _, err := sim.ParseOutage(bad, start); err == nil {
			t.Fatalf("%q must be refused", bad)
		}
	}
	if d, err := sim.ParseMinutes(""); err != nil || d != sim.DefaultOutage {
		t.Fatal("an empty control file means the default")
	}
	if _, err := sim.ParseMinutes("-2"); err == nil {
		t.Fatal("negative minutes must be refused")
	}
}
