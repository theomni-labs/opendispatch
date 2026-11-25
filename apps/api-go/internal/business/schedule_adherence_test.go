// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"testing"
	"time"
)

func riyadhAt(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestAdherenceTally_OnTimeLateAbsentAndNight(t *testing.T) {
	day := riyadhAt(t, "2026-09-12T00:00:00+03:00")
	from, to := riyadhAt(t, "2026-09-12T06:00:00+03:00"), riyadhAt(t, "2026-09-12T14:00:00+03:00")
	var a adherenceTally
	a.tallyLine(day, from, to, []dutySpan{{From: from, To: to}})
	a.tallyLine(day, from, to, []dutySpan{{From: from.Add(40 * time.Minute), To: to}})
	a.tallyLine(day, from, to, nil)
	nightFrom, nightTo := riyadhAt(t, "2026-09-12T22:00:00+03:00"), riyadhAt(t, "2026-09-13T06:00:00+03:00")
	a.tallyLine(day, nightFrom, nightTo, []dutySpan{{From: nightFrom, To: nightTo.Add(-time.Hour)}})
	a.actualsSeen = true
	if a.shifts != 4 || a.absent != 1 || a.late != 1 {
		t.Fatalf("shifts %d absent %d late %d", a.shifts, a.absent, a.late)
	}
	// 3 day lines x 32 quarters + one night line of 32
	if a.plannedQ != 128 || a.actualQ != 32+29+28 {
		t.Fatalf("planned %d actual %d", a.plannedQ, a.actualQ)
	}
	if a.planned[24] != 3 || a.actual[24] != 1 || a.actual[27] != 2 {
		t.Fatalf("06:00 planned %d actual %d, 06:45 actual %d", a.planned[24], a.actual[24], a.actual[27])
	}
	if a.planned[0] != 1 || a.planned[88] != 1 || a.actual[23] != 0 {
		t.Fatalf("night wraps to the morning: 00:00 %d, 22:00 %d, 05:45 actual %d", a.planned[0], a.planned[88], a.actual[23])
	}
	z := a.zone("z1")
	if z.PlannedHours != 32 || *z.ActualHours != 22.25 || *z.Share != 0.6953 || *z.AbsentShifts != 1 || *z.LateStarts != 1 || !z.HasActuals {
		t.Fatalf("zone %+v", z)
	}
}

func TestAdherenceTally_NoActualsSaysSo(t *testing.T) {
	day := riyadhAt(t, "2026-09-12T00:00:00+03:00")
	var a adherenceTally
	a.tallyLine(day, riyadhAt(t, "2026-09-12T06:00:00+03:00"), riyadhAt(t, "2026-09-12T14:00:00+03:00"), nil)
	z := a.zone("z1")
	if z.PlannedHours != 8 || z.ActualHours != nil || z.Share != nil || z.AbsentShifts != nil || z.HasActuals {
		t.Fatalf("no attendance: no actual figures, %+v", z)
	}
	var empty adherenceTally
	empty.tallyLine(day, riyadhAt(t, "2026-09-14T06:00:00+03:00"), riyadhAt(t, "2026-09-14T14:00:00+03:00"), nil)
	if empty.shifts != 0 {
		t.Fatal("a line outside the two days is not counted")
	}
}

func TestOverCapacityZone_CountsGaps(t *testing.T) {
	var z OverCapacityZone
	z.countGaps([]GapCell{{Kind: "gap", Delta: -2}, {Kind: "gap", Delta: -1}, {Kind: "surplus", Delta: 3}, {Kind: "balanced"}})
	if z.GapIntervals != 2 || z.ShortAgentHours != 0.75 {
		t.Fatalf("gaps %+v", z)
	}
}
