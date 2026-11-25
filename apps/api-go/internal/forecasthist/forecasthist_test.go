// SPDX-License-Identifier: AGPL-3.0-only

package forecasthist

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func day(s string) time.Time {
	t, _ := time.ParseInLocation("2006-01-02", s, riyadh)
	return t
}

func TestWindowsAndDefaults(t *testing.T) {
	s := Settings{DetailWeeks: 99, Years: 9, AggMinutes: 7}.Normalized()
	if s != Defaults() || (Settings{}).Normalized().Years != 0 {
		t.Fatalf("defaults %+v", s)
	}
	agg, det := Defaults().Windows(day("2026-09-14").Add(5 * time.Hour))
	if det.Format("2006-01-02") != "2026-06-22" || agg.Format("2006-01-02") != "2023-09-14" {
		t.Fatalf("windows %s %s", agg, det)
	}
	agg, det = Settings{DetailWeeks: 12, Years: 0, AggMinutes: 60}.Windows(day("2026-09-14"))
	if !agg.Equal(det) {
		t.Fatal("no years: no totals window")
	}
}

func TestValidateSetting(t *testing.T) {
	ok := map[string]any{KeyDetailWeeks: 12.0, KeyYears: 0, KeyAggMinutes: 60.0}
	for k, v := range ok {
		if err := ValidateSetting(k, v); err != nil {
			t.Fatal(k, err)
		}
	}
	bad := map[string]any{KeyDetailWeeks: 0.0, KeyYears: 6.0, KeyAggMinutes: 30.0}
	for k, v := range bad {
		if ValidateSetting(k, v) == nil {
			t.Fatal(k, "accepted")
		}
	}
	if ValidateSetting(KeyDetailWeeks, "12") == nil || ValidateSetting("other.key", "x") != nil {
		t.Fatal("type or unrelated key")
	}
}

func TestAggregatorSumsByRiyadhDayAndHour(t *testing.T) {
	utc := time.Date(2026, 1, 1, 21, 15, 0, 0, time.UTC)
	for _, minutes := range []int{1440, 60} {
		a := NewAggregator(Settings{AggMinutes: minutes})
		a.Add("s2", utc, 2, 1)
		a.Add("s1", utc.Add(15*time.Minute), 3, 0)
		a.Add("s1", utc.Add(30*time.Minute), 1, 1)
		r := a.Result()
		if len(r) != 2 || r[0].SubZoneID != "s1" || r[0].CasesTotal != 4 || r[0].CasesField != 1 || r[0].PeriodMinutes != minutes {
			t.Fatalf("%d: %+v", minutes, r)
		}
		if r[0].PeriodStart != "2026-01-02T00:00:00+03:00" {
			t.Fatalf("%d: %s", minutes, r[0].PeriodStart)
		}
	}
}

func history(aggDays, detDays int) History {
	var h History
	start := day("2026-01-01")
	for d := 0; d < aggDays; d++ {
		h.Aggregated = append(h.Aggregated, NewAggregate("s1", start.AddDate(0, 0, d), 1440, 50+d%7, 20))
	}
	for d := 0; d < detDays; d++ {
		for q := 0; q < 96; q++ {
			h.Records = append(h.Records, NewRecord("s1", start.AddDate(0, 0, aggDays+d).Add(time.Duration(q)*15*time.Minute), q%3, 0))
		}
	}
	return h
}

func TestFitDropsOldestTotalsFirst(t *testing.T) {
	h := history(300, 10)
	marshal := func(x History) ([]byte, error) { return json.Marshal(map[string]any{"history": x}) }
	full, _, err := Fit(h, Limits{Wire: 1 << 30, Raw: 1 << 30, Records: 1 << 20}, marshal)
	if err != nil {
		t.Fatal(err)
	}
	body, kept, err := Fit(history(300, 10), Limits{Wire: 1 << 30, Raw: len(full) - 2000, Records: 1 << 20}, marshal)
	if err != nil || len(body) > len(full)-2000 {
		t.Fatalf("%v %d", err, len(body))
	}
	if len(kept.Records) != len(h.Records) || len(kept.Aggregated) >= 300 || len(kept.Aggregated) < 250 {
		t.Fatalf("kept %d records, %d totals", len(kept.Records), len(kept.Aggregated))
	}
	if kept.First() != kept.Aggregated[0].PeriodStart[:10] || kept.First() == "2026-01-01" {
		t.Fatalf("first %s", kept.First())
	}
	d, a := kept.Days()
	if d != 10 || a != len(kept.Aggregated) {
		t.Fatalf("days %d %d", d, a)
	}
	_, kept, err = Fit(history(300, 1), Limits{Wire: 1 << 30, Raw: 1 << 30, Records: 200}, marshal)
	if err != nil || len(kept.Aggregated) != 200 || len(kept.Records) != 96 {
		t.Fatalf("record cap: %v %d %d", err, len(kept.Aggregated), len(kept.Records))
	}
	if _, _, err := Fit(history(3, 2), Limits{Wire: 1 << 30, Raw: 50, Records: 1 << 20}, marshal); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("want ErrTooLarge, got %v", err)
	}
}
