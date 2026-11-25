// SPDX-License-Identifier: AGPL-3.0-only

// Verifies time.go against real scripts/synthetic
// (gen/time.ts) output, captured via tsx.
package synthetic

import "testing"

func TestTime_MatchesTS(t *testing.T) {
	if got, _ := dayStart("2026-09-06"); got != 1788642000 {
		t.Fatalf("dayStart1: got %d, want 1788642000", got)
	}
	if got, _ := dayStart("2026-01-01"); got != 1767214800 {
		t.Fatalf("dayStart2: got %d, want 1767214800", got)
	}
	if got := localDate(1757041200); got != "2025-09-05" {
		t.Fatalf("localDate1: got %s, want 2025-09-05", got)
	}
	if got := secondsOfDay(1757041200 + 3600*7 + 61); got != 46861 {
		t.Fatalf("secondsOfDay1: got %d, want 46861", got)
	}
	if got := isoAt(1757041200); got != "2025-09-05T06:00:00+03:00" {
		t.Fatalf("iso1: got %s, want 2025-09-05T06:00:00+03:00", got)
	}
	if got := isoAt(1757041200 + 3600*7 + 61); got != "2025-09-05T13:01:01+03:00" {
		t.Fatalf("iso2: got %s, want 2025-09-05T13:01:01+03:00", got)
	}
	if got, _ := parseIso("2026-09-06T07:12:45+03:00"); got != 1788667965 {
		t.Fatalf("parseIso1: got %d, want 1788667965", got)
	}
	if got, _ := parseClock("07:12"); got != 25920 {
		t.Fatalf("parseClock1: got %d, want 25920", got)
	}
	if got, _ := parseClock("24:00"); got != 86400 {
		t.Fatalf("parseClock2: got %d, want 86400", got)
	}
	if got, _ := parseClock("07:12:33"); got != 25953 {
		t.Fatalf("parseClock3: got %d, want 25953", got)
	}
	if got, _ := addDays("2026-09-06", 1); got != "2026-09-07" {
		t.Fatalf("addDays1: got %s, want 2026-09-07", got)
	}
	if got, _ := addDays("2026-02-27", 3); got != "2026-03-02" {
		t.Fatalf("addDays2: got %s, want 2026-03-02", got)
	}
	want := []string{"2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"}
	got, _ := dateRange("2026-09-06", "2026-09-10")
	if len(got) != len(want) {
		t.Fatalf("dateRange1: got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("dateRange1[%d]: got %s, want %s", i, got[i], want[i])
		}
	}
	if got, _ := weekdayOf("2026-09-06"); got != "Sunday" {
		t.Fatalf("weekdayOf1: got %s, want Sunday", got)
	}
	if got, _ := weekdayOf("2026-09-13"); got != "Sunday" {
		t.Fatalf("weekdayOf2: got %s, want Sunday", got)
	}
	if got := yymmdd("2026-09-06"); got != "260906" {
		t.Fatalf("yymmdd1: got %s, want 260906", got)
	}
}
