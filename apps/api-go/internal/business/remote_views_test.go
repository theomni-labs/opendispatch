// SPDX-License-Identifier: AGPL-3.0-only

// Pure tests: remote roster, capacity, productivity sums.
package business

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

const viewsDay = "2026-09-20"

func viewsLine(t *testing.T, code, shift string, fromH, toH float64, brk []float64, leave bool) remoteLine {
	t.Helper()
	day, err := startOfDayMs(viewsDay)
	check(t, err)
	at := func(h float64) int64 { return day + int64(h*3_600_000) }
	l := remoteLine{RemoteRosterLine: RemoteRosterLine{AgentID: code, Code: code, ShiftCode: strOrNil(shift), OnLeave: leave}, startMs: at(fromH), endMs: at(toH)}
	if brk != nil {
		l.breakStartMs, l.breakEndMs = at(brk[0]), at(brk[1])
	}
	return l
}

// flatRemoteDemand: n expected cases per interval at m minutes.
func flatRemoteDemand(n, m float64) remoteDemand {
	var d remoteDemand
	for i := 0; i < Intervals; i++ {
		d.expected[i], d.minutes[i] = n, n*m
	}
	return d
}

func TestRemoteLine_HoursLessBreak(t *testing.T) {
	l := viewsLine(t, "A", "MORNING", 7, 15, []float64{11, 12}, false)
	if got := l.hours(); got != 7 {
		t.Fatalf("got %v hours, want 7 (8 h shift less a 1 h break)", got)
	}
	day, _ := startOfDayMs(viewsDay)
	if l.workingAt(day + 11*3_600_000) {
		t.Fatalf("got working during the break, want not working")
	}
	if !l.workingAt(day + 10*3_600_000) {
		t.Fatalf("got not working at 10:00, want working")
	}
}

func TestRemoteIntervals_OnShiftAndRequiredFromMinutes(t *testing.T) {
	day, _ := startOfDayMs(viewsDay)
	lines := []remoteLine{
		viewsLine(t, "A", "MORNING", 7, 15, nil, false),
		viewsLine(t, "B", "MORNING", 7, 15, nil, false),
		viewsLine(t, "C", "MORNING", 7, 15, nil, true),
	}
	got := remoteIntervals(day, lines, flatRemoteDemand(1, 30), 0.5)
	at8 := got[32]
	if at8.OnShift == nil || *at8.OnShift != 2 {
		t.Fatalf("got on_shift %v at 08:00, want 2 (the one on leave is not counted)", at8.OnShift)
	}
	if at8.PlannedReviewers != 1 || at8.RequiredReviewers != 2 || at8.Delta != -1 {
		t.Fatalf("got planned %v required %v delta %v, want 1, 2, -1", at8.PlannedReviewers, at8.RequiredReviewers, at8.Delta)
	}
	if *got[0].OnShift != 0 {
		t.Fatalf("got %d on shift at 00:00, want 0", *got[0].OnShift)
	}
}

func TestRemoteDayLoad_ShiftSumsAndOutside(t *testing.T) {
	day, _ := startOfDayMs(viewsDay)
	lines := []remoteLine{
		viewsLine(t, "A", "MORNING", 7, 15, []float64{11, 12}, false),
		viewsLine(t, "B", "MORNING", 7, 15, nil, false),
		viewsLine(t, "C", "EVENING", 15, 23, nil, false),
		viewsLine(t, "D", "EVENING", 15, 23, nil, true),
	}
	// 1 case per 15 min at 15 min each: 0.25 h of demand per interval.
	load := remoteDayLoad(viewsDay, "roster", lines, flatRemoteDemand(1, 15), day, 0.5, 5, 1)
	if load.Scheduled != 3 || load.OnLeave != 1 || load.Off != 1 {
		t.Fatalf("got scheduled %d on_leave %d off %d, want 3, 1, 1", load.Scheduled, load.OnLeave, load.Off)
	}
	if load.AvailableHours != 23 || load.CapacityHours != 11.5 || load.DemandHours != 24 || load.GapHours != -12.5 {
		t.Fatalf("got %+v, want available 23, capacity 11.5, demand 24, gap -12.5", load)
	}
	if load.Utilization == nil || *load.Utilization != round4(24.0/23) {
		t.Fatalf("got utilization %v, want demand / available", load.Utilization)
	}
	if len(load.Shifts) != 3 {
		t.Fatalf("got %d shift rows, want MORNING, EVENING and the outside row", len(load.Shifts))
	}
	m, e, o := load.Shifts[0], load.Shifts[1], load.Shifts[2]
	if *m.ShiftCode != "MORNING" || m.Scheduled != 2 || m.AvailableHours != 15 || m.DemandHours != 8 || m.CapacityHours != 7.5 {
		t.Fatalf("got morning %+v", m)
	}
	if *e.ShiftCode != "EVENING" || e.Scheduled != 1 || e.OnLeave != 1 || e.AvailableHours != 8 || e.DemandHours != 8 {
		t.Fatalf("got evening %+v", e)
	}
	if o.ShiftCode != nil || o.Scheduled != 0 || o.DemandHours != 8 || o.GapHours != -8 || o.Utilization != nil {
		t.Fatalf("got outside %+v, want 8 h of demand nobody covers", o)
	}
}

func TestRemoteDayLoad_NoLinesHasNoUtilization(t *testing.T) {
	day, _ := startOfDayMs(viewsDay)
	load := remoteDayLoad(viewsDay, "none", nil, remoteDemand{}, day, 0.34, 0, 0)
	if load.Utilization != nil || load.AvailableHours != 0 || len(load.Shifts) != 0 {
		t.Fatalf("got %+v, want an empty day", load)
	}
}

func TestRemoteWeeks_RunsOfSevenFromTheFirstDate(t *testing.T) {
	var days []RemoteDayLoad
	for i := 0; i < 9; i++ {
		days = append(days, RemoteDayLoad{Date: shiftDateBy(viewsDay, i), Scheduled: 2, AvailableHours: 10, CapacityHours: 4, DemandHours: 5})
	}
	weeks := remoteWeeks(days)
	if len(weeks) != 2 || weeks[0].Days != 7 || weeks[1].Days != 2 || weeks[1].WeekStart != shiftDateBy(viewsDay, 7) {
		t.Fatalf("got %+v, want a 7-day and a 2-day run", weeks)
	}
	if weeks[0].ScheduledShifts != 14 || weeks[0].DemandHours != 35 || weeks[0].GapHours != -7 || *weeks[0].Utilization != 0.5 {
		t.Fatalf("got %+v", weeks[0])
	}
}

func TestRemoteRange_OneTo31Dates(t *testing.T) {
	if d, err := remoteRange(viewsDay, viewsDay); err != nil || len(d) != 1 {
		t.Fatalf("got %v %v, want one date", d, err)
	}
	if d, err := remoteRange("2026-09-01", "2026-10-01"); err != nil || len(d) != 31 {
		t.Fatalf("got %d %v, want 31 dates", len(d), err)
	}
	for _, bad := range [][2]string{{"2026-09-01", "2026-10-02"}, {"2026-09-02", "2026-09-01"}, {"2026-9-1", "2026-09-02"}} {
		if _, err := remoteRange(bad[0], bad[1]); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("got %v for %v, want Invalid", err, bad)
		}
	}
}

func TestHomeWindow_CrossesMidnight(t *testing.T) {
	day, _ := startOfDayMs(viewsDay)
	s, e := "22:00", "06:00"
	start, end, ok := homeWindow(ShiftHours{Applies: true, StartTime: &s, EndTime: &e}, day)
	if !ok || start != day+22*3_600_000 || end != day+30*3_600_000 {
		t.Fatalf("got %d %d %v, want 22:00 to 06:00 next day", start-day, end-day, ok)
	}
	if _, _, ok := homeWindow(ShiftHours{Applies: false}, day); ok {
		t.Fatalf("got a window for a pattern that does not apply")
	}
}

func TestHandlingFrom_ZoneThenScopeThenFixed(t *testing.T) {
	measured := map[string]zoneCompletion{
		"z1": {cases: 40, seconds: 40 * 20 * 60},
		"z2": {cases: 10, seconds: 10 * 50 * 60},
	}
	h := handlingFrom("measured", 31.5, measured, []string{"z1", "z2"})
	if h.Source != "measured" || h.Cases != 50 || h.Minutes != 26 {
		t.Fatalf("got %+v, want the scope mean 26 min over 50 cases", h)
	}
	if h.minutesFor("z1") != 20 || h.Zones[0].Source != "measured" {
		t.Fatalf("got z1 %v, want its own mean 20 (40 cases)", h.minutesFor("z1"))
	}
	if h.minutesFor("z2") != 26 {
		t.Fatalf("got z2 %v, want the scope mean (10 cases is too few)", h.minutesFor("z2"))
	}
	few := handlingFrom("measured", 31.5, map[string]zoneCompletion{"z1": {cases: 5, seconds: 5 * 600}}, []string{"z1"})
	if few.Source != "fixed" || few.Minutes != 31.5 || few.minutesFor("z1") != 31.5 {
		t.Fatalf("got %+v, want the fixed minutes with too few cases", few)
	}
	fixed := handlingFrom("fixed", 40, measured, []string{"z1", "z2"})
	if fixed.Source != "fixed" || fixed.Minutes != 40 || fixed.minutesFor("z1") != 40 || fixed.Setting != "fixed" {
		t.Fatalf("got %+v, want the fixed setting to win", fixed)
	}
	if fixed.minutesFor("unknown") != 40 {
		t.Fatalf("got %v for an unknown zone, want the scope minutes", fixed.minutesFor("unknown"))
	}
}

func TestValidRemoteHandlingSetting(t *testing.T) {
	for _, ok := range []struct {
		k string
		v any
	}{{remoteHandlingSourceKey, "fixed"}, {remoteHandlingFixedKey, 30.0}, {remoteHandlingFixedKey, 5}, {"other", "x"}} {
		if err := validRemoteHandlingSetting(ok.k, ok.v); err != nil {
			t.Fatalf("got %v for %v, want valid", err, ok)
		}
	}
	for _, bad := range []struct {
		k string
		v any
	}{{remoteHandlingSourceKey, "auto"}, {remoteHandlingFixedKey, 4.9}, {remoteHandlingFixedKey, 241.0}, {remoteHandlingFixedKey, "30"}} {
		if err := validRemoteHandlingSetting(bad.k, bad.v); err == nil {
			t.Fatalf("got valid for %v, want an error", bad)
		}
	}
}

func TestRemoteMedian(t *testing.T) {
	if remoteMedian(nil) != nil {
		t.Fatalf("got a median of nothing")
	}
	if m := remoteMedian([]float64{3, 1, 2}); *m != 2 {
		t.Fatalf("got %v, want 2", *m)
	}
	if m := remoteMedian([]float64{4, 1, 3, 2}); *m != 2.5 {
		t.Fatalf("got %v, want 2.5", *m)
	}
}

func TestRemoteProductivityOf_SumsAndGroups(t *testing.T) {
	day, _ := startOfDayMs(viewsDay)
	at := func(h, m int) *int64 { v := day + int64(h)*3_600_000 + int64(m)*60_000; return &v }
	typeA, rev := "type-a", "rev-1"
	cases := []remoteCase{
		// 08:00 in, review 08:10, closed 08:40.
		{id: "1", dataSource: "SYNTHETIC", caseType: &typeA, reviewer: &rev, reg: *at(8, 0), start: at(8, 10), end: at(8, 40)},
		// 08:30 in, review 09:00, closed 10:00.
		{id: "2", dataSource: "SYNTHETIC", caseType: &typeA, reg: *at(8, 30), start: at(9, 0), end: at(10, 0)},
		// 09:00 in, never reviewed.
		{id: "3", dataSource: "IMPORTED", reg: *at(9, 0)},
	}
	got := remoteProductivityOf(cases, map[string]float64{"rev-1": 8, "rev-2": 2})
	if got.Overall.Cases != 3 || got.Handled != 2 || got.UnattributedCases != 2 {
		t.Fatalf("got %+v", got)
	}
	if *got.Overall.MedianWaitSeconds != 20*60 || *got.Overall.MedianCompleteSeconds != 45*60 || *got.Overall.MedianReceiptToCloseSeconds != 65*60 {
		t.Fatalf("got overall %+v, want wait 20 min, complete 45 min, receipt to close 65 min", got.Overall)
	}
	if got.Overall.MedianPostCloseAdminSeconds != nil {
		t.Fatalf("got a post-close admin time, want null until Customer supplies it")
	}
	if got.AvailableHours != 10 || got.HandlingHours != 1.5 || *got.Utilization != 0.15 || *got.CasesPerAvailableHour != 0.2 {
		t.Fatalf("got available %v handling %v utilization %v per hour %v", got.AvailableHours, got.HandlingHours, *got.Utilization, *got.CasesPerAvailableHour)
	}
	if len(got.Hours) != 24 || got.Hours[8].Received != 2 || got.Hours[9].Received != 1 || got.Hours[8].Handled != 1 || got.Hours[10].Handled != 1 {
		t.Fatalf("got hours %+v", got.Hours[8:11])
	}
	if *got.Hours[8].MedianWaitSeconds != 600 || *got.Hours[9].MedianWaitSeconds != 1800 || got.Hours[7].MedianWaitSeconds != nil {
		t.Fatalf("got wait by review-start hour %v %v", got.Hours[8].MedianWaitSeconds, got.Hours[9].MedianWaitSeconds)
	}
	if len(got.CaseTypes) != 2 || *got.CaseTypes[0].CaseTypeID != "type-a" || got.CaseTypes[0].Cases != 2 || *got.CaseTypes[0].MeanCompleteMinutes != 45 {
		t.Fatalf("got case types %+v", got.CaseTypes)
	}
	if got.CaseTypes[1].CaseTypeID != nil || got.CaseTypes[1].MeanCompleteMinutes != nil {
		t.Fatalf("got %+v, want the untyped group with no completion", got.CaseTypes[1])
	}
	if len(got.Reviewers) != 1 {
		t.Fatalf("got %d reviewers, want only the recorded one", len(got.Reviewers))
	}
	r := got.Reviewers[0]
	if r.AgentID != "rev-1" || r.AvailableHours != 8 || r.HandlingHours != 0.5 || *r.CasesPerHour != 0.125 || *r.Utilization != 0.0625 {
		t.Fatalf("got reviewer %+v", r)
	}
	if len(got.DataSources) != 2 || got.DataSources[0] != "IMPORTED" {
		t.Fatalf("got data sources %v", got.DataSources)
	}
}
