// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"math"
	"math/rand"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/synthetic"
)

func testWorkforce(t *testing.T) synthetic.WorkforceCal {
	t.Helper()
	w, err := synthetic.Workforce()
	if err != nil {
		t.Fatal(err)
	}
	return w
}

func TestParseShiftAndDuty(t *testing.T) {
	night, ok := parseShift(`{"applies": true, "start_time": "22:00", "end_time": "06:00", "crosses_midnight": true}`)
	if !ok || night.Start != 1320 || night.End != 1800 {
		t.Fatalf("night %+v", night)
	}
	if _, ok := parseShift(`{"applies": false}`); ok {
		t.Fatal("a pattern that does not apply has no hours")
	}
	shifts := map[string]shiftHours{"NIGHT": night}
	p := person{ID: "s1", Zone: "z1", Shift: "NIGHT", DaysOff: map[time.Weekday]bool{time.Friday: true}}
	sat := time.Date(2026, 9, 12, 0, 0, 0, 0, riyadh)
	from, to, ok := p.duty(sat, shifts, nil)
	if !ok || from.Hour() != 22 || to.Sub(from) != 8*time.Hour {
		t.Fatalf("saturday night %v %v %v", from, to, ok)
	}
	if _, _, ok := p.duty(sat.AddDate(0, 0, -1), shifts, nil); ok {
		t.Fatal("friday is a day off")
	}
	if _, _, ok := p.duty(sat, shifts, map[string][]leaveSpan{"s1": {{From: "2026-09-10", To: "2026-09-13"}}}); ok {
		t.Fatal("approved leave: no duty")
	}
}

func TestPoissonMean(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	for _, mean := range []float64{0.5, 8, 90} {
		total := 0
		for i := 0; i < 4000; i++ {
			total += poisson(r, mean)
		}
		if got := float64(total) / 4000; math.Abs(got-mean) > 0.06*mean+0.05 {
			t.Fatalf("mean %v: got %v", mean, got)
		}
	}
	if poisson(r, 0) != 0 {
		t.Fatal("zero mean")
	}
}

func TestSickMonthsAndAttendanceFollowTheCalibration(t *testing.T) {
	w := testWorkforce(t)
	if len(w.SickMonthFactor) != 12 || w.SickDaysPerYear != 5 || w.AttendanceDays < 7 {
		t.Fatalf("calibration %+v", w)
	}
	shifts := map[string]shiftHours{"DAY-A": {Start: 360, End: 840}}
	var people []person
	for i := 0; i < 200; i++ {
		people = append(people, person{ID: string(rune('A'+i%26)) + time.Duration(i).String(), Zone: "z1", Shift: "DAY-A", DaysOff: map[time.Weekday]bool{}})
	}
	r := rand.New(rand.NewSource(5))
	factors := map[string]float64{"z1": 1}
	from := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	months := sickMonths("t", people, factors, w, from, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), r)
	if len(months) != 24 {
		t.Fatalf("two years of one zone: %d rows", len(months))
	}
	total := 0.0
	for _, m := range months {
		if m[0] != "t" || m[1] != "SYNTHETIC" || m[4] != 200 {
			t.Fatalf("row %v", m)
		}
		total += m[5].(float64)
	}
	if perYear := total / 2 / 200; math.Abs(perYear-5) > 0.6 {
		t.Fatalf("about 5 sick days a person a year: %.2f", perYear)
	}
	today := time.Date(2026, 9, 13, 0, 0, 0, 0, riyadh)
	spans := attendanceSpans("t", people, shifts, nil, factors, w, today, r)
	planned := 200 * w.AttendanceDays
	absent := 1 - float64(len(spans))/float64(planned)
	want := sickShare(w, time.August, 1)
	if absent < 0 || math.Abs(absent-want) > 0.015 {
		t.Fatalf("absent share %.4f, about %.4f", absent, want)
	}
	late := 0
	for _, s := range spans {
		from := s[4].(time.Time)
		if from.Hour() != 6 || from.Minute() != 0 {
			late++
		}
		if !s[5].(time.Time).After(from) {
			t.Fatalf("span %v", s)
		}
	}
	if share := float64(late) / float64(len(spans)); math.Abs(share-w.LateShare) > 0.02 {
		t.Fatalf("late share %.3f, about %.3f", share, w.LateShare)
	}
}

func TestTimeCasesPicksAAgentOnDuty(t *testing.T) {
	w := testWorkforce(t)
	times, err := synthetic.NewCaseTimes()
	if err != nil {
		t.Fatal(err)
	}
	shifts := map[string]shiftHours{"DAY-A": {Start: 360, End: 840}, "NIGHT": {Start: 1320, End: 1800}}
	people := []person{
		{ID: "day", Zone: "z1", Shift: "DAY-A", DaysOff: map[time.Weekday]bool{}},
		{ID: "night", Zone: "z1", Shift: "NIGHT", DaysOff: map[time.Weekday]bool{}},
	}
	cases := []historyCase{
		{ID: "c-morning", Zone: "z1", Registered: time.Date(2026, 8, 10, 9, 0, 0, 0, riyadh)},
		{ID: "c-small-hours", Zone: "z1", Registered: time.Date(2026, 8, 10, 2, 0, 0, 0, riyadh)},
		{ID: "c-other-zone", Zone: "z2", Registered: time.Date(2026, 8, 10, 9, 0, 0, 0, riyadh)},
	}
	rows := timeCases(cases, people, shifts, nil, w, times, rand.New(rand.NewSource(3)))
	if len(rows) != 2 {
		t.Fatalf("a zone with nobody on duty stays untimed: %d rows", len(rows))
	}
	if rows[0][1] != "day" || rows[1][1] != "night" {
		t.Fatalf("on duty: %v %v", rows[0][1], rows[1][1])
	}
	for _, row := range rows {
		asg, arr, done, closed := row[2].(time.Time), row[3].(time.Time), row[4].(time.Time), row[5].(time.Time)
		if arr.Before(asg) || done.Before(arr) || closed.Before(done) {
			t.Fatalf("times out of order: %v", row)
		}
	}
}
