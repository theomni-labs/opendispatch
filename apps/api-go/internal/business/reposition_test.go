// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"math"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/geocell"
)

func TestIdleFromFeeds_OnlyFreeFieldOnShiftWithAPosition(t *testing.T) {
	now := time.Date(2026, 9, 13, 9, 0, 0, 0, time.UTC)
	zone := "z1"
	end := now.Add(4 * time.Hour)
	base := liveAgent{Kind: "field", Status: "available", ZoneID: &zone, Lat: f64(24.7), Lon: f64(46.7), At: now.Add(-time.Minute), ShiftEnd: &end}
	mk := func(id string, edit func(*liveAgent)) liveAgent {
		s := base
		s.ID = id
		if edit != nil {
			edit(&s)
		}
		return s
	}
	states := []liveAgent{
		mk("free", nil),
		mk("remote", func(s *liveAgent) { s.Kind = "remote" }),
		mk("busy", func(s *liveAgent) { s.Status = "en_route" }),
		mk("break", func(s *liveAgent) { s.Status = "on_break" }),
		mk("open", func(s *liveAgent) { s.Open = &openCase{AssignedAt: now} }),
		mk("offshift", func(s *liveAgent) { s.ShiftEnd = nil }),
		mk("stale", func(s *liveAgent) { s.At = now.Add(-3 * time.Hour) }),
		mk("nopos", func(s *liveAgent) { s.Lat = nil }),
		mk("nozone", func(s *liveAgent) { s.ZoneID = nil }),
	}
	got := idleFromFeeds(states, now.UnixMilli())
	if len(got) != 1 || got[0].ID != "free" || got[0].ZoneID != "z1" {
		t.Fatalf("idle = %+v, want only free", got)
	}
	// No roster covers now: the feed decides.
	for i := range states {
		states[i].ShiftEnd = nil
	}
	got = idleFromFeeds(states, now.UnixMilli())
	if len(got) != 2 {
		t.Fatalf("idle without rosters = %+v, want free and offshift", got)
	}
}

func TestRepositionForecastDay(t *testing.T) {
	vals := []EngineValue{{IntervalStart: "2026-09-13T00:00:00+03:00"}, {IntervalStart: "2026-09-14T00:00:00+03:00"}, {IntervalStart: "bad"}}
	day, ok := repositionForecastDay(vals, time.Date(2026, 9, 14, 7, 0, 0, 0, riyadhZone))
	if !ok || day != "2026-09-14" {
		t.Fatalf("today in horizon: %s %v", day, ok)
	}
	// 2026-10-04 is a Sunday, as is 2026-09-13.
	if day, _ = repositionForecastDay(vals, time.Date(2026, 10, 4, 7, 0, 0, 0, riyadhZone)); day != "2026-09-13" {
		t.Fatalf("same weekday: %s", day)
	}
	if day, _ = repositionForecastDay(vals, time.Date(2026, 10, 7, 7, 0, 0, 0, riyadhZone)); day != "2026-09-13" {
		t.Fatalf("first day: %s", day)
	}
	if _, ok = repositionForecastDay(nil, time.Now()); ok {
		t.Fatal("no values: want none")
	}
}

func TestRepositionDemand_SpreadsOverMicroCellsInTheLookAhead(t *testing.T) {
	cellA, cellB := geocell.Encode(24.70, 46.70, 6), geocell.Encode(24.75, 46.75, 6)
	doc := &ForecasterEngineOutput{Values: []EngineValue{
		{ZoneID: "z1", SubZoneID: "s1", IntervalStart: "2026-09-13T09:00:00+03:00", FieldExpected: 2},
		{ZoneID: "z1", SubZoneID: "s1", IntervalStart: "2026-09-13T09:45:00+03:00", FieldExpected: 2},
		{ZoneID: "z1", SubZoneID: "s1", IntervalStart: "2026-09-13T10:00:00+03:00", FieldExpected: 50},
		{ZoneID: "z1", SubZoneID: "s1", IntervalStart: "2026-09-13T08:45:00+03:00", FieldExpected: 50},
		{ZoneID: "z2", SubZoneID: "s2", IntervalStart: "2026-09-13T09:15:00+03:00", FieldExpected: 3},
		{ZoneID: "z2", SubZoneID: "s3", IntervalStart: "2026-09-13T09:15:00+03:00", FieldExpected: 0},
	}}
	kept := &keptLocations{SubZones: map[string]keptSubZoneMap{
		"s1": {ZoneID: "z1", Cells: []string{cellA, cellB}, Groups: map[string][]float64{groupKey(9, "weekday"): {0.75, 0.25}}},
	}}
	sub := SubZone{Latitude: 21.5, Longitude: 39.2}
	sub.ID = "s2"
	subs := map[string]SubZone{"s2": sub}
	got := repositionDemand(doc, kept, subs, time.Date(2026, 9, 13, 9, 0, 0, 0, riyadhZone), 1)
	if len(got["z1"]) != 2 || len(got["z2"]) != 1 {
		t.Fatalf("cells = %+v", got)
	}
	total := 0.0
	for _, c := range got["z1"] {
		total += c.Expected
	}
	if math.Abs(total-4) > 1e-6 || math.Abs(got["z1"][0].Expected-3) > 1e-6 {
		t.Fatalf("z1 = %+v, want 3 and 1 (window 09:00 to 10:00 only)", got["z1"])
	}
	if c := got["z2"][0]; c.Lat != 21.5 || c.Lon != 39.2 || c.Expected != 3 {
		t.Fatalf("no shares: the sub-zone centre, got %+v", c)
	}
}

func TestRepositionRunStale(t *testing.T) {
	var none *repositionRun
	if !none.stale(0, time.Minute, 5) {
		t.Fatal("never run: stale")
	}
	r := &repositionRun{clockMs: 1_000_000, maxKm: 5}
	period := 30 * time.Minute
	if r.stale(1_000_000+period.Milliseconds()-1, period, 5) {
		t.Fatal("inside the period: fresh")
	}
	if !r.stale(1_000_000+period.Milliseconds(), period, 5) || !r.stale(999_999, period, 5) || !r.stale(1_000_001, period, 3) {
		t.Fatal("period passed, clock rewound or cap changed: stale")
	}
}
