// SPDX-License-Identifier: AGPL-3.0-only

package sim

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds"
)

// Riyadh is the fixtures' clock (+03:00).
var Riyadh = time.FixedZone("AST", 3*3600)

const day = 24 * time.Hour

// The customer's simulated dispatch delay bounds.
const (
	CustomerMinDelay = 5 * time.Second
	CustomerMaxDelay = 5 * time.Minute
)

// PingEvery is the en-route location interval.
const PingEvery = 30 * time.Second

// Template is one fixture case to stream again.
type Template struct {
	Base        feeds.CasePayload
	TimeOfDay   time.Duration
	AssignAfter time.Duration
	ArriveAfter time.Duration
	CloseAfter  time.Duration
	AgentCode   string
}

// CustomerDelay is the template's delay, clamped.
func (t *Template) CustomerDelay() time.Duration {
	return min(max(t.AssignAfter, CustomerMinDelay), CustomerMaxDelay)
}

// LoadTemplates reads the day in time-of-day order.
func LoadTemplates(fixtures string) ([]Template, map[string]string, error) {
	d, err := loadFixtureDay(fixtures)
	if err != nil {
		return nil, nil, err
	}
	var out []Template
	for _, c := range d.cases {
		if c.AssignedAt == nil || c.AgentID == nil {
			continue
		}
		reg := ts(c.RegisteredAt).In(Riyadh)
		mid := time.Date(reg.Year(), reg.Month(), reg.Day(), 0, 0, 0, 0, Riyadh)
		assigned := ts(*c.AssignedAt)
		t := Template{Base: d.payload(c), TimeOfDay: reg.Sub(mid), AssignAfter: assigned.Sub(reg),
			ArriveAfter: 10 * time.Minute, AgentCode: d.agents[*c.AgentID]}
		if c.ArrivedAt != nil {
			t.ArriveAfter = max(ts(*c.ArrivedAt).Sub(assigned), time.Minute)
		}
		t.CloseAfter = t.ArriveAfter + 30*time.Minute
		if c.ClosedAt != nil {
			t.CloseAfter = max(ts(*c.ClosedAt).Sub(assigned), t.ArriveAfter+time.Minute)
		}
		out = append(out, t)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].TimeOfDay < out[j].TimeOfDay })
	return out, d.agents, nil
}

// Pace maps wall time onto the synthetic day.
type Pace struct {
	Start time.Time
	Speed float64
}

func (p Pace) speed() float64 {
	if p.Speed <= 0 {
		return 1
	}
	return p.Speed
}

func (p Pace) origin() time.Duration {
	s := p.Start.In(Riyadh)
	return s.Sub(time.Date(s.Year(), s.Month(), s.Day(), 0, 0, 0, 0, Riyadh))
}

// Virtual is the day offset (may pass 24h) at t.
func (p Pace) Virtual(t time.Time) time.Duration {
	return p.origin() + time.Duration(float64(t.Sub(p.Start))*p.speed())
}

// Wall is the wall time of a day offset.
func (p Pace) Wall(v time.Duration) time.Time {
	return p.Start.Add(time.Duration(float64(v-p.origin()) / p.speed()))
}

// Arrival is a template due at a wall time.
type Arrival struct {
	Template *Template
	At       time.Time
}

// Due lists the arrivals in (from, to].
func Due(ts []Template, p Pace, from, to time.Time) []Arrival {
	a, b := p.Virtual(from), p.Virtual(to)
	var out []Arrival
	for loop := a / day; loop*day < b; loop++ {
		for i := range ts {
			v := loop*day + ts[i].TimeOfDay
			if v > a && v <= b {
				out = append(out, Arrival{Template: &ts[i], At: p.Wall(v)})
			}
		}
	}
	return out
}

// Decision is what the board shows for a case.
type Decision struct {
	State, Source, AgentCode string
	Recommended              bool
}

// Stats counts what the stream did.
type Stats struct {
	Arrived, CustomerAssigned, Echoed, Closed int
	// AtCustomer: board state when the customer assigned.
	AtCustomer map[string]int
	// RecommendedAtCustomer: had a recommendation then.
	RecommendedAtCustomer int
}

// Live streams cases as the customer's feeds would.
type Live struct {
	Templates []Template
	Pace      Pace
	RunID     string
	Positions map[string][2]float64
	Stats     Stats
	Logf      func(format string, args ...any)
	last      time.Time
	open      []*liveCase
	seq       int
	// Idle: codes that send a heartbeat ping.
	Idle     map[string]bool
	nextBeat time.Time
	beats    int
}

type liveCase struct {
	t                                       *Template
	p                                       feeds.CasePayload
	key, code                               string
	customerAt, arriveAt, closeAt, nextPing time.Time
	assigned, arrived                       bool
	from                                    [2]float64
	pings                                   int
}

// Waiting counts cases the customer has not assigned.
func (l *Live) Waiting() int {
	n := 0
	for _, c := range l.open {
		if !c.assigned {
			n++
		}
	}
	return n
}

func (l *Live) logf(format string, args ...any) {
	if l.Logf != nil {
		l.Logf(format, args...)
	}
}

func casePrefix(number string) string {
	if i := strings.IndexByte(number, '-'); i > 0 {
		return number[:i]
	}
	return "RD"
}

// Tick returns the events due by now.
func (l *Live) Tick(now time.Time, board map[string]Decision, echo bool) ([]feeds.CaseEvent, []feeds.StatusEvent) {
	if l.Stats.AtCustomer == nil {
		l.Stats.AtCustomer = map[string]int{}
	}
	if l.Positions == nil {
		l.Positions = map[string][2]float64{}
	}
	if l.last.IsZero() {
		l.last = l.Pace.Start
	}
	var cs []feeds.CaseEvent
	var ss []feeds.StatusEvent
	emit := func(c *liveCase, version string, at time.Time) {
		c.p.UpdatedAt = at
		cs = append(cs, feeds.CaseEvent{Event: feeds.Event{IdempotencyKey: c.key + ":" + version, OccurredAt: at}, Case: c.p})
	}
	status := func(c *liveCase, kind, st string, at time.Time, pos [2]float64) {
		lat, lon := pos[0], pos[1]
		ss = append(ss, feeds.StatusEvent{Event: feeds.Event{IdempotencyKey: c.key + ":" + kind, OccurredAt: at},
			AgentCode: c.code, Status: st, Latitude: &lat, Longitude: &lon})
	}
	for _, a := range Due(l.Templates, l.Pace, l.last, now) {
		l.seq++
		at := a.At.Truncate(time.Second)
		c := &liveCase{t: a.Template, p: a.Template.Base, key: fmt.Sprintf("live:%s:%d", l.RunID, l.seq)}
		c.p.ExternalID = fmt.Sprintf("live-%s-%d", l.RunID, l.seq)
		c.p.CaseNumber = fmt.Sprintf("%s-LIVE-%s-%04d", casePrefix(a.Template.Base.CaseNumber), l.RunID, l.seq)
		c.p.RegisteredAt = at
		c.customerAt = at.Add(a.Template.CustomerDelay())
		emit(c, "new", at)
		l.open = append(l.open, c)
		l.Stats.Arrived++
		l.logf("case %s new (zone %s), Customer assigns in %s unless OpenDispatch is accepted", c.p.CaseNumber, c.p.ZoneExternalID, a.Template.CustomerDelay())
	}
	l.last = now
	speed := l.Pace.speed()
	assign := func(c *liveCase, at time.Time, code string) {
		c.assigned, c.code = true, code
		c.p.AssignedAt, c.p.AgentCode = &at, &code
		emit(c, "assigned", at)
		dest := c.dest()
		from, ok := l.Positions[code]
		if !ok {
			from = [2]float64{dest[0] + 0.02, dest[1] + 0.02}
		}
		c.from = from
		status(c, "en_route", "en_route", at, from)
		c.arriveAt = at.Add(time.Duration(float64(c.t.ArriveAfter) / speed)).Truncate(time.Second)
		c.closeAt = at.Add(time.Duration(float64(c.t.CloseAfter) / speed)).Truncate(time.Second)
		c.nextPing = at.Add(PingEvery)
	}
	keep := l.open[:0]
	for _, c := range l.open {
		if !c.assigned {
			d, seen := board[c.p.CaseNumber]
			switch {
			case echo && seen && d.AgentCode != "" && (d.Source == "OPENDISPATCH" || d.Source == "MANUAL"):
				assign(c, now.Truncate(time.Second), d.AgentCode)
				l.Stats.Echoed++
				l.logf("case %s: Customer takes the OpenDispatch assignment (%s, %s)", c.p.CaseNumber, d.Source, d.AgentCode)
			case !now.Before(c.customerAt):
				state := "waiting"
				if seen {
					state = d.State
				}
				l.Stats.AtCustomer[state]++
				if seen && d.Recommended {
					l.Stats.RecommendedAtCustomer++
				}
				assign(c, c.customerAt, c.t.AgentCode)
				l.Stats.CustomerAssigned++
				l.logf("case %s: Customer assigns %s after %s (board: %s, recommendation %t)", c.p.CaseNumber, c.code, c.t.CustomerDelay(), state, seen && d.Recommended)
			}
		}
		if c.assigned && !c.arrived {
			for c.nextPing.Before(c.arriveAt) && !c.nextPing.After(now) {
				f := float64(c.nextPing.Sub(*c.p.AssignedAt)) / float64(c.arriveAt.Sub(*c.p.AssignedAt))
				dest := c.dest()
				c.pings++
				status(c, fmt.Sprintf("ping:%d", c.pings), "en_route", c.nextPing,
					[2]float64{c.from[0] + (dest[0]-c.from[0])*f, c.from[1] + (dest[1]-c.from[1])*f})
				c.nextPing = c.nextPing.Add(PingEvery)
			}
			if !now.Before(c.arriveAt) {
				at := c.arriveAt
				c.arrived, c.p.ArrivedAt = true, &at
				emit(c, "arrived", at)
				status(c, "on_scene", "on_scene", at, c.dest())
				l.Positions[c.code] = c.dest()
			}
		}
		if c.arrived && !now.Before(c.closeAt) {
			at := c.closeAt
			c.p.ClosedAt = &at
			emit(c, "closed", at)
			status(c, "available", "available", at, c.dest())
			l.Stats.Closed++
			continue
		}
		keep = append(keep, c)
	}
	l.open = keep
	if hb, ok := l.heartbeat(now); ok {
		ss = append(ss, hb)
	}
	return cs, ss
}

// heartbeat: an idle agent's app still reports.
func (l *Live) heartbeat(now time.Time) (feeds.StatusEvent, bool) {
	if now.Before(l.nextBeat) || len(l.Idle) == 0 {
		return feeds.StatusEvent{}, false
	}
	l.nextBeat = now.Add(PingEvery)
	busy := map[string]bool{}
	for _, c := range l.open {
		busy[c.code] = true
	}
	codes := make([]string, 0, len(l.Idle))
	for code := range l.Idle {
		if pos, ok := l.Positions[code]; ok && !busy[code] && pos != ([2]float64{}) {
			codes = append(codes, code)
		}
	}
	if len(codes) == 0 {
		return feeds.StatusEvent{}, false
	}
	sort.Strings(codes)
	l.beats++
	code := codes[l.beats%len(codes)]
	pos := l.Positions[code]
	at := now.Truncate(time.Second)
	return feeds.StatusEvent{Event: feeds.Event{IdempotencyKey: fmt.Sprintf("live:%s:beat:%d", l.RunID, l.beats), OccurredAt: at},
		AgentCode: code, Status: "available", Latitude: &pos[0], Longitude: &pos[1]}, true
}

// IdleAgents: those last seen available.
func IdleAgents(s *Stream) map[string]bool {
	last := map[string]feeds.StatusEvent{}
	for _, e := range s.Statuses {
		if prev, ok := last[e.AgentCode]; !ok || !e.OccurredAt.Before(prev.OccurredAt) {
			last[e.AgentCode] = e
		}
	}
	out := map[string]bool{}
	for code, e := range last {
		if e.Status == "available" {
			out[code] = true
		}
	}
	return out
}

func (c *liveCase) dest() [2]float64 {
	if c.p.Latitude == nil || c.p.Longitude == nil {
		return c.from
	}
	return [2]float64{*c.p.Latitude, *c.p.Longitude}
}

// LastPositions is each agent's newest position.
func LastPositions(s *Stream) map[string][2]float64 {
	out := map[string][2]float64{}
	at := map[string]time.Time{}
	for _, e := range s.Statuses {
		if e.Latitude == nil || e.Longitude == nil || e.OccurredAt.Before(at[e.AgentCode]) {
			continue
		}
		at[e.AgentCode] = e.OccurredAt
		out[e.AgentCode] = [2]float64{*e.Latitude, *e.Longitude}
	}
	return out
}
