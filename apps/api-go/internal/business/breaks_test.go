// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors the pure-function tests around breaks.ts.
package business

import "testing"

func TestMinutesOf_And_IsoAtMinute_RoundTrip(t *testing.T) {
	date := "2026-09-14"
	for _, minute := range []int{0, 15, 360, 1439, 1440, 1560} {
		iso, err := IsoAtMinute(date, minute)
		if err != nil {
			t.Fatalf("IsoAtMinute(%d): %v", minute, err)
		}
		got, err := MinutesOf(date, iso)
		if err != nil {
			t.Fatalf("MinutesOf(%q): %v", iso, err)
		}
		if got != minute {
			t.Fatalf("round trip of %d minutes gave %q -> %d", minute, iso, got)
		}
	}
}

func TestIsoAtMinute_SixAM(t *testing.T) {
	iso, err := IsoAtMinute("2026-09-14", 360)
	if err != nil {
		t.Fatalf("IsoAtMinute: %v", err)
	}
	if iso != "2026-09-14T06:00:00+03:00" {
		t.Fatalf("got %q, want 2026-09-14T06:00:00+03:00", iso)
	}
}

func TestIsoAtMinute_RollsIntoNextDay(t *testing.T) {
	iso, err := IsoAtMinute("2026-09-14", 1560) // 26:00 -> next day 02:00
	if err != nil {
		t.Fatalf("IsoAtMinute: %v", err)
	}
	if iso != "2026-09-15T02:00:00+03:00" {
		t.Fatalf("got %q, want 2026-09-15T02:00:00+03:00", iso)
	}
}

func fajr(minute int) PrayerMinute  { return PrayerMinute{Name: PrayerFajr, Minute: minute} }
func dhuhr(minute int) PrayerMinute { return PrayerMinute{Name: PrayerDhuhr, Minute: minute} }

var (
	clearPol   = PrayerPolicy{Mode: PolicyClear, Window: 30}
	linedUpPol = PrayerPolicy{Mode: PolicyLinedUp, Window: 30}
)

func TestPrayerConflictOf_ClearOfPrayer(t *testing.T) {
	prayers := []PrayerMinute{dhuhr(720)} // 12:00, 30 min: 720..750
	for _, b := range [][2]int{{710, 730}, {720, 750}, {700, 760}, {745, 775}} {
		if got := PrayerConflictOf(b[0], b[1], prayers, clearPol); got == nil || *got != PrayerDhuhr {
			t.Fatalf("%v: got %v, want a dhuhr conflict (any overlap)", b, got)
		}
	}
	if got := PrayerConflictOf(750, 780, prayers, clearPol); got != nil {
		t.Fatalf("got %v, want none right after the window", *got)
	}
}

func TestPrayerConflictOf_LinedUpWithPrayer(t *testing.T) {
	prayers := []PrayerMinute{dhuhr(720)}
	if got := PrayerConflictOf(710, 730, prayers, linedUpPol); got == nil {
		t.Fatal("want a conflict for a break that cuts the prayer")
	}
	for _, b := range [][2]int{{720, 750}, {705, 765}, {0, 30}} {
		if got := PrayerConflictOf(b[0], b[1], prayers, linedUpPol); got != nil {
			t.Fatalf("%v: got %v, want none", b, *got)
		}
	}
	wide := PrayerPolicy{Mode: PolicyLinedUp, Window: 45}
	if got := PrayerConflictOf(730, 760, prayers, wide); got != nil || !linesUpWithPrayer(730, 760, prayers, wide) {
		t.Fatal("a 30-minute break inside a 45-minute window lines up")
	}
	if linesUpWithPrayer(720, 750, prayers, clearPol) {
		t.Fatal("nothing lines up under clear_of_prayer")
	}
}

func TestPlaceBreaks_ClearKeepsOffThePrayer(t *testing.T) {
	prayers := []PrayerMinute{dhuhr(660)}
	inputs := []BreakInput{{Key: "a", StartMin: 360, EndMin: 900, BreakMinutes: 30, AfterHours: 5}}
	placed := PlaceBreaks(inputs, prayers, clearPol)
	if len(placed) != 1 || placed[0].PrayerConflict != nil || placed[0].StartMin < 690 {
		t.Fatalf("got %+v, want the first slot after the window", placed)
	}
}

func TestPlaceBreaks_LinedUpStartsAtAnOffGridAdhan(t *testing.T) {
	prayers := []PrayerMinute{dhuhr(712)}
	inputs := []BreakInput{{Key: "a", StartMin: 360, EndMin: 900, BreakMinutes: 30, AfterHours: 5}}
	if p := PlaceBreaks(inputs, prayers, linedUpPol); len(p) != 1 || p[0].StartMin != 712 || p[0].PrayerConflict != nil {
		t.Fatalf("got %+v, want the break from the adhan at 11:52", p)
	}
	if p := PlaceBreaks(inputs, prayers, clearPol); len(p) != 1 || p[0].StartMin%15 != 0 || p[0].PrayerConflict != nil {
		t.Fatalf("got %+v, want a grid slot clear of the prayer", p)
	}
}

func TestPlaceBreaks_LinedUpCoversThePrayer(t *testing.T) {
	prayers := []PrayerMinute{dhuhr(720)}
	inputs := []BreakInput{{Key: "a", StartMin: 360, EndMin: 900, BreakMinutes: 30, AfterHours: 5}}
	placed := PlaceBreaks(inputs, prayers, linedUpPol)
	if len(placed) != 1 {
		t.Fatalf("got %d placements, want 1", len(placed))
	}
	p := placed[0]
	if p.StartMin != 720 || p.EndMin != 750 || p.PrayerConflict != nil {
		t.Fatalf("got %+v, want the break on the dhuhr window", p)
	}
}

func TestPlaceBreaks_SpreadsLoadAcrossAgents(t *testing.T) {
	// No nearby prayers: breaks spread instead of
	// stacking in one slot.
	inputs := []BreakInput{
		{Key: "a", StartMin: 0, EndMin: 480, BreakMinutes: 30, AfterHours: 5},
		{Key: "b", StartMin: 0, EndMin: 480, BreakMinutes: 30, AfterHours: 5},
		{Key: "c", StartMin: 0, EndMin: 480, BreakMinutes: 30, AfterHours: 5},
	}
	placed := PlaceBreaks(inputs, nil, clearPol)
	if len(placed) != 3 {
		t.Fatalf("got %d placements, want 3", len(placed))
	}
	starts := map[int]bool{}
	for _, p := range placed {
		starts[p.StartMin] = true
	}
	if len(starts) != 3 {
		t.Fatalf("got starts %v, want 3 distinct slots (load spreads them)", placed)
	}
}

func TestPlaceBreaks_TooShortShiftGetsNoPlacement(t *testing.T) {
	// A 4-hour shift has no room for a 5h-rule break.
	inputs := []BreakInput{{Key: "a", StartMin: 0, EndMin: 240, BreakMinutes: 30, AfterHours: 5}}
	placed := PlaceBreaks(inputs, nil, clearPol)
	if len(placed) != 0 {
		t.Fatalf("got %+v, want no placement for a too-short shift", placed)
	}
}

func TestPlaceBreaks_StartsOnTheQuarterHourGrid(t *testing.T) {
	inputs := []BreakInput{{Key: "a", StartMin: 7, EndMin: 300, BreakMinutes: 30, AfterHours: 1}}
	placed := PlaceBreaks(inputs, nil, clearPol)
	if len(placed) != 1 || placed[0].StartMin%15 != 0 {
		t.Fatalf("got %+v, want a start on the 15-minute grid", placed)
	}
}
