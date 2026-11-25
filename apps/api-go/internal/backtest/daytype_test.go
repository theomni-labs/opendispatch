// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"math"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

// school to 5 Mar, from 29 Mar, then summer
func dayTypeCal() forecastcal.Config {
	return forecastcal.Config{SchoolTerms: []forecastcal.Range{
		{Start: "2026-01-04", End: "2026-03-05", Name: "Term 2"},
		{Start: "2026-03-29", End: "2026-06-25", Name: "Term 3"},
		{Start: "2026-08-30", End: "2026-12-31", Name: "Term 1"},
	}}
}

func TestDayTypesLabelRamadanEidAndNationalDays(t *testing.T) {
	base := func(d string) string { return "base " + d }
	seg := DayTypes(base, dayTypeCal())
	for d, want := range map[string]string{
		"2026-03-01": "RamadanSchool-Weekdays",
		"2026-03-06": "RamadanBreak-Friday",
		"2026-03-20": "Eid-Day1",
		"2026-03-21": "Eid-Day2",
		"2026-03-23": "base 2026-03-23",
		"2026-05-26": "Eid-Arafah",
		"2026-05-27": "Eid-Day1",
		"2026-05-30": "Eid-Day2",
		"2026-09-23": "National-Weekdays",
		"2026-09-24": "base 2026-09-24",
		"2026-07-07": "base 2026-07-07",
	} {
		if got := seg(d); got != want {
			t.Errorf("%s: %q, want %q", d, got, want)
		}
	}
	// no school terms: Ramadan alone
	if got := DayTypes(base, forecastcal.Config{})("2026-03-01"); got != "Ramadan-Weekdays" {
		t.Errorf("unknown school: %q", got)
	}
	for l, want := range map[string]bool{"Eid-Day1": true, "RamadanBreak-Friday": true, "National-Thursday": true,
		"Weekdays-Semester2": false, "Thursday-Ramadan": false} {
		if IsDayType(l) != want {
			t.Errorf("IsDayType(%q) = %v", l, !want)
		}
	}
}

func TestSharesFollowTheSchoolStatusOfTheEnginesWindow(t *testing.T) {
	cal := dayTypeCal()
	b := DefaultBlend()
	origin := mustDay(t, "2026-09-10")
	share := b.Shares(cal, DayTypes(SegmentFromCalendar(cal), cal), origin)
	// 84 days back: 19 school days, 65 off
	near(t, "school day", share(origin), 0.5*19/42)
	near(t, "national day", share(mustDay(t, "2026-09-23")), 0)
	// in summer: 29 school days back, 55 off
	summer := b.Shares(cal, SegmentFromCalendar(cal), mustDay(t, "2026-08-20"))
	near(t, "day off", summer(mustDay(t, "2026-08-20")), 0.5)
	near(t, "first school day", summer(mustDay(t, "2026-08-30")), 0.5*29/42)
	// school status unknown: the plain share
	open := b.Shares(forecastcal.Config{}, SegmentFromCalendar(forecastcal.Config{}), origin)
	near(t, "unknown", open(origin), 0.5)
	b.DayTypes = false
	near(t, "off", b.Shares(cal, SegmentFromCalendar(cal), origin)(mustDay(t, "2026-09-23")), 0.5)
}

func TestBlendDaysTakesTheSegmentShapeAloneAtShareZero(t *testing.T) {
	req, eng, seg := blendDay(t)
	out := BlendDays(eng, SegmentDaysOf(seg), SmallZones(req, DefaultSmallZone), func(day time.Time) float64 { return 0 })
	at9 := func(v ForecastValue) bool { return v.Start.In(loc).Hour() == 9 && v.Start.In(loc).Minute() == 0 }
	near(t, "day total", sumOf(out, func(ForecastValue) bool { return true }), 96)
	near(t, "09:00", sumOf(out, at9), 96)
	if math.Abs(sumOf(out, func(v ForecastValue) bool { return v.Start.In(loc).Hour() == 3 })) > 1e-9 {
		t.Fatal("03:00 should be empty")
	}
}
