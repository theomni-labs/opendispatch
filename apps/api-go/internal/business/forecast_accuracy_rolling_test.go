// SPDX-License-Identifier: AGPL-3.0-only

package business

import "testing"

func TestRollingFiguresLeaveZeroActualsOutOfMAPE(t *testing.T) {
	var s accSums
	s.add(12, 10)
	s.add(8, 10)
	s.add(2, 0)
	f := figuresFrom(s, 0.15)
	if f.Days != 3 || f.Forecast != 22 || f.Actual != 20 {
		t.Fatalf("totals %+v", f)
	}
	// MAPE over 2 days; WAPE (2+2+2)/20
	if *f.MAPE != 0.2 || *f.WAPE != 0.3 || *f.TargetStatus != "above" {
		t.Fatalf("mape %v wape %v status %v", *f.MAPE, *f.WAPE, *f.TargetStatus)
	}
	if g := figuresFrom(s, 0.2); *g.TargetStatus != "at_or_below" {
		t.Fatalf("at the target: %v", *g.TargetStatus)
	}

	var zero accSums
	zero.add(1, 0)
	z := figuresFrom(zero, 0.15)
	if z.MAPE != nil || z.WAPE != nil || z.TargetStatus != nil {
		t.Fatalf("no cases: %+v", z)
	}

	a, b := accSums{Days: 3, Actual: 5, APESum: 1, APECount: 2}, accSums{Days: 2, Actual: 4, APESum: 0.5, APECount: 1}
	a.merge(b)
	if a.Days != 3 || a.Actual != 9 || a.APECount != 3 {
		t.Fatalf("merge %+v", a)
	}
}

func TestCompanyHoursScoreTheSummedZones(t *testing.T) {
	// zone errors cancel in the company total
	var zoneA, zoneB, perZone accSums
	zoneA.add(3, 1)
	zoneB.add(1, 3)
	perZone.merge(zoneA)
	perZone.merge(zoneB)
	if m := *figuresFrom(perZone, 0.15).MAPE; m != 1.3333 {
		t.Fatalf("per zone hour MAPE %v", m)
	}
	var c companyHours
	var f [24]float64
	var a [24]int
	f[9], a[9] = 3+1, 1+3
	c.addDay(f, a)
	got := figuresFrom(c.hours[9], 0.15)
	if got.Days != 1 || got.Actual != 4 || *got.MAPE != 0 || *got.WAPE != 0 {
		t.Fatalf("company hour 9: %+v", got)
	}
	if empty := figuresFrom(c.hours[3], 0.15); empty.Days != 1 || empty.MAPE != nil {
		t.Fatalf("hour 3 with no cases: %+v", empty)
	}
}
