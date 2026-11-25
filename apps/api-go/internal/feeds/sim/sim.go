// SPDX-License-Identifier: AGPL-3.0-only

// Package sim replays a synthetic day into the feeds.
package sim

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds"
)

// Stream is the events of a day, both feeds.
type Stream struct {
	Cases    []feeds.CaseEvent
	Statuses []feeds.StatusEvent
	Cases759 int
}

type fixtureCase struct {
	ExternalID   string         `json:"external_id"`
	CaseNumber   string         `json:"case_number"`
	RegisteredAt string         `json:"registered_at"`
	UpdatedAt    string         `json:"updated_at"`
	ZoneID       string         `json:"zone_id"`
	CaseTypeID   string         `json:"case_type_id"`
	Latitude     *float64       `json:"latitude"`
	Longitude    *float64       `json:"longitude"`
	Parties      *int           `json:"parties_involved"`
	AssignedAt   *string        `json:"assigned_at"`
	ArrivedAt    *string        `json:"arrived_at"`
	ClosedAt     *string        `json:"closed_at"`
	AgentID      *string        `json:"agent_id"`
	Severity     *string        `json:"severity"`
	Injury       *bool          `json:"injury_present"`
	Handling     string         `json:"handling"`
	Damage       *float64       `json:"estimated_damage_sar"`
	Extra        map[string]any `json:"extra"`
}

// LeaveHandlingOut: the api's rules classify.
var LeaveHandlingOut bool

func readJSON(path string, into any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, into)
}

func ts(s string) time.Time { t, _ := time.Parse(time.RFC3339, s); return t }

func tsp(s *string) *time.Time {
	if s == nil {
		return nil
	}
	t := ts(*s)
	return &t
}

// fixtureDay is the replay day with its id maps.
type fixtureDay struct {
	cases                []fixtureCase
	zones, types, agents map[string]string
}

func loadFixtureDay(fixtures string) (*fixtureDay, error) {
	d := &fixtureDay{zones: map[string]string{}, types: map[string]string{}, agents: map[string]string{}}
	if err := readJSON(filepath.Join(fixtures, "replay", "cases.json"), &d.cases); err != nil {
		return nil, err
	}
	for _, f := range []struct {
		file, key string
		into      map[string]string
	}{{"locations/zones.json", "external_id", d.zones}, {"reference/case_types.json", "external_id", d.types}, {"people/agents.json", "code", d.agents}} {
		var rows []map[string]any
		if err := readJSON(filepath.Join(fixtures, f.file), &rows); err != nil {
			return nil, err
		}
		for _, r := range rows {
			f.into[fmt.Sprint(r["id"])] = fmt.Sprint(r[f.key])
		}
	}
	return d, nil
}

func (d *fixtureDay) payload(c fixtureCase) feeds.CasePayload {
	p := feeds.CasePayload{
		ExternalID: c.ExternalID, CaseNumber: c.CaseNumber, RegisteredAt: ts(c.RegisteredAt), ZoneExternalID: d.zones[c.ZoneID],
		CaseTypeExternalID: d.types[c.CaseTypeID], Latitude: c.Latitude, Longitude: c.Longitude, PartiesInvolved: c.Parties,
		Severity: c.Severity, InjuryPresent: c.Injury, Handling: c.Handling, EstimatedDamageSar: c.Damage,
	}
	if LeaveHandlingOut {
		p.Handling = ""
	}
	str := func(k string) *string {
		if v, ok := c.Extra[k].(string); ok {
			return &v
		}
		return nil
	}
	p.DamageAssessment, p.LocationType, p.CustomerPreference = str("damage_assessment_method"), str("location_type"), str("customer_preference")
	if v, ok := c.Extra["claim_value_sar"].(float64); ok {
		p.ClaimValueSar = &v
	}
	return p
}

// LoadDay turns fixtures/replay/cases.json into the events a real source would send.
func LoadDay(fixtures string) (*Stream, error) {
	d, err := loadFixtureDay(fixtures)
	if err != nil {
		return nil, err
	}
	cases, agents := d.cases, d.agents
	s := &Stream{Cases759: len(cases)}
	for _, c := range cases {
		base := d.payload(c)
		var code *string
		if c.AgentID != nil {
			v := agents[*c.AgentID]
			code = &v
		}
		add := func(version string, at time.Time, p feeds.CasePayload) {
			p.UpdatedAt = at
			copyTime := func(t *time.Time) *time.Time {
				if t == nil {
					return nil
				}
				v := *t
				return &v
			}
			p.AssignedAt, p.ArrivedAt, p.ClosedAt = copyTime(p.AssignedAt), copyTime(p.ArrivedAt), copyTime(p.ClosedAt)
			s.Cases = append(s.Cases, feeds.CaseEvent{Event: feeds.Event{IdempotencyKey: "case:" + c.ExternalID + ":" + version, OccurredAt: at}, Case: p})
		}
		add("registered", base.RegisteredAt, base)
		if c.AssignedAt != nil && code != nil {
			a := base
			a.AssignedAt, a.AgentCode = tsp(c.AssignedAt), code
			add("assigned", *a.AssignedAt, a)
			if c.ArrivedAt != nil {
				a.ArrivedAt = tsp(c.ArrivedAt)
			}
			if c.ClosedAt != nil {
				a.ClosedAt = tsp(c.ClosedAt)
			}
			if a.ArrivedAt != nil || a.ClosedAt != nil {
				add("final", ts(c.UpdatedAt), a)
			}
			status := func(kind, st string, at *time.Time) {
				if at != nil {
					s.Statuses = append(s.Statuses, feeds.StatusEvent{Event: feeds.Event{IdempotencyKey: "status:" + c.ExternalID + ":" + kind, OccurredAt: *at},
						AgentCode: *code, Status: st, Latitude: c.Latitude, Longitude: c.Longitude})
				}
			}
			status("en_route", "en_route", a.AssignedAt)
			status("on_scene", "on_scene", a.ArrivedAt)
			status("available", "available", a.ClosedAt)
		}
	}
	return s, nil
}

// Options are the faults to inject.
type Options struct {
	Seed          int64
	DuplicateRate float64
	ReorderWindow int
	BatchSize     int
	// Down says whether the network is down for a batch number.
	Down func(batch int) bool
}

// Report is what the sender saw.
type Report struct {
	Sent, Duplicates, Accepted, Retries, Maintenance int
}

// Sender signs and posts.
type Sender struct {
	URL    string
	Key    feeds.Key
	Client *http.Client
	Sleep  func(time.Duration)
}

var errDown = errors.New("sim: network down")

func (s *Sender) post(ctx context.Context, path string, body []byte, down bool) (*http.Response, error) {
	if down {
		return nil, errDown
	}
	stamp, sig := feeds.SignWith(s.Key, time.Now(), body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.URL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Feed-Key-Id", s.Key.ID)
	req.Header.Set("X-Feed-Timestamp", stamp)
	req.Header.Set("X-Feed-Signature", sig)
	req.Header.Set("Content-Type", "application/json")
	c := s.Client
	if c == nil {
		c = http.DefaultClient
	}
	return c.Do(req)
}

// Replay sends events in batches, reordered and duplicated, and retries what fails.
func (s *Sender) Replay(ctx context.Context, path string, events []json.RawMessage, o Options, afterBatch func(batch int)) (Report, error) {
	rnd := rand.New(rand.NewSource(o.Seed))
	var rep Report
	out := append([]json.RawMessage(nil), events...)
	for i := 0; i < len(out) && o.DuplicateRate > 0; i++ {
		if rnd.Float64() < o.DuplicateRate {
			out = append(out, out[i])
			rep.Duplicates++
		}
	}
	// Shuffle inside a sliding window, so events arrive late but not wildly so.
	for i := range out {
		if o.ReorderWindow > 1 {
			j := i + rnd.Intn(min(o.ReorderWindow, len(out)-i))
			out[i], out[j] = out[j], out[i]
		}
	}
	size := o.BatchSize
	if size <= 0 {
		size = 100
	}
	for b, at := 0, 0; at < len(out); b, at = b+1, at+size {
		end := min(at+size, len(out))
		body, _ := json.Marshal(map[string]any{"events": out[at:end]})
		for attempt := 0; ; attempt++ {
			if attempt > 50 {
				return rep, errors.New("sim: a batch never got through")
			}
			down := o.Down != nil && o.Down(b) && attempt < 3
			resp, err := s.post(ctx, path, body, down)
			if err != nil {
				rep.Retries++
				s.sleep(0)
				continue
			}
			code := resp.StatusCode
			var res feeds.Result
			_ = json.NewDecoder(resp.Body).Decode(&res)
			resp.Body.Close()
			if code == http.StatusServiceUnavailable {
				rep.Maintenance++
				rep.Retries++
				s.sleep(0)
				continue
			}
			if code != http.StatusAccepted {
				return rep, fmt.Errorf("sim: the feed answered %d", code)
			}
			rep.Sent += end - at
			rep.Accepted += res.Accepted
			break
		}
		if afterBatch != nil {
			afterBatch(b)
		}
	}
	return rep, nil
}

// Send posts one batch once; any answer but 202 is an error.
func (s *Sender) Send(ctx context.Context, path string, events []json.RawMessage) error {
	body, _ := json.Marshal(map[string]any{"events": events})
	resp, err := s.post(ctx, path, body, false)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("sim: the feed answered %d", resp.StatusCode)
	}
	return nil
}

func (s *Sender) sleep(d time.Duration) {
	if s.Sleep != nil {
		s.Sleep(d)
	}
}

// Raw marshals events for Replay.
func Raw[T any](events []T) []json.RawMessage {
	out := make([]json.RawMessage, len(events))
	for i, e := range events {
		out[i], _ = json.Marshal(e)
	}
	return out
}

// ByTime puts events in the order they happened.
func ByTime(s *Stream) {
	sort.SliceStable(s.Cases, func(i, j int) bool { return s.Cases[i].OccurredAt.Before(s.Cases[j].OccurredAt) })
	sort.SliceStable(s.Statuses, func(i, j int) bool { return s.Statuses[i].OccurredAt.Before(s.Statuses[j].OccurredAt) })
}

// ShiftToEnd moves every time so the last event falls at end, for a board that reads "now".
func (s *Stream) ShiftToEnd(end time.Time) {
	var last time.Time
	for _, e := range s.Cases {
		if e.OccurredAt.After(last) {
			last = e.OccurredAt
		}
	}
	for _, e := range s.Statuses {
		if e.OccurredAt.After(last) {
			last = e.OccurredAt
		}
	}
	d := end.Sub(last)
	move := func(t *time.Time) {
		if t != nil {
			*t = t.Add(d)
		}
	}
	for i := range s.Cases {
		c := &s.Cases[i]
		c.OccurredAt = c.OccurredAt.Add(d)
		c.Case.RegisteredAt, c.Case.UpdatedAt = c.Case.RegisteredAt.Add(d), c.Case.UpdatedAt.Add(d)
		move(c.Case.AssignedAt)
		move(c.Case.ArrivedAt)
		move(c.Case.ClosedAt)
	}
	for i := range s.Statuses {
		s.Statuses[i].OccurredAt = s.Statuses[i].OccurredAt.Add(d)
	}
}
