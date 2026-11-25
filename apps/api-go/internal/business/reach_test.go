// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
)

const (
	rZone    = "11111111-1111-4111-8111-111111111111"
	rPoint   = "22222222-2222-4222-8222-222222222222"
	rFar     = "44444444-4444-4444-8444-444444444444"
	metreDeg = 1.0 / 111195.0
)

// reachWorld: one point, sub-zones 0, 4 and 6 km north.
func reachWorld() ([]standbySubZone, standbyPoint) {
	subs := []standbySubZone{
		{ID: "sz-0", ZoneID: rZone, IsActive: true, Latitude: 24.71, Longitude: 46.68, NameEn: "A"},
		{ID: "sz-4", ZoneID: rZone, IsActive: true, Latitude: 24.71 + 4000*metreDeg, Longitude: 46.68, NameEn: "B"},
		{ID: "sz-6", ZoneID: rZone, IsActive: true, Latitude: 24.71 + 6000*metreDeg, Longitude: 46.68, NameEn: "C"},
	}
	return subs, standbyPoint{ID: rPoint, ZoneID: rZone, IsActive: true, Latitude: 24.71, Longitude: 46.68, CoverageRadiusM: 4500, NameEn: "P"}
}

func TestReachShareKnownGeometry(t *testing.T) {
	subs, p := reachWorld()
	radius := travelModel{40, 1.3}.reachMetres(600)
	if got := reachShare(subs, []standbyPoint{p}, nil, radius); got == nil || *got != 0.6667 {
		t.Fatalf("equal weights: got %v, want 0.6667", got)
	}
	w := map[string]float64{"sz-0": 1, "sz-4": 1, "sz-6": 2}
	if got := reachShare(subs, []standbyPoint{p}, w, radius); got == nil || *got != 0.5 {
		t.Fatalf("weighted: got %v, want 0.5", got)
	}
	slow := travelModel{20, 1.3}.reachMetres(600)
	if got := reachShare(subs, []standbyPoint{p}, w, slow); got == nil || *got != 0.25 {
		t.Fatalf("20 km/h: got %v, want 0.25", got)
	}
	if got := reachShare(subs, nil, w, radius); got == nil || *got != 0 {
		t.Fatalf("nobody staffed: got %v, want 0", got)
	}
	if reachShare(nil, []standbyPoint{p}, w, radius) != nil {
		t.Fatal("no sub-zones: want nil")
	}
}

func TestQuarterStepAndStaffedByQuarter(t *testing.T) {
	if got := quarterStep(map[int]bool{0: true, 4: true, 8: true}); got != 4 {
		t.Fatalf("hourly: got %d", got)
	}
	if got := quarterStep(map[int]bool{5: true}); got != 1 {
		t.Fatalf("one row: got %d", got)
	}
	day := "2026-09-14"
	bs, be := day+"T08:00:00+03:00", day+"T08:30:00+03:00"
	lines := []RosterAssignment{{StandbyPointID: strp(rPoint), StartAt: day + "T06:00:00+03:00", EndAt: day + "T10:00:00+03:00", BreakStartAt: &bs, BreakEndAt: &be}}
	on := staffedByQuarter(lines, day)
	for q, want := range map[int]bool{23: false, 24: true, 31: true, 32: false, 33: false, 34: true, 39: true, 40: false} {
		if on[q][rPoint] != want {
			t.Errorf("quarter %d: got %v, want %v", q, on[q][rPoint], want)
		}
	}
}

func TestCoverageCarriesReachShareAndMinutes(t *testing.T) {
	ResetStandbyForTest()
	t.Cleanup(ReloadStandbyForTest)
	subs, p := reachWorld()
	UpsertZoneForTest(standbyZone{ID: rZone, NameEn: "Zone One"})
	for _, s := range subs {
		UpsertSubZoneForTest(s)
	}
	UpsertStandbyPointForTest(p)
	UpsertStandbyPointForTest(standbyPoint{ID: rFar, ZoneID: rZone, IsActive: true, Latitude: 24.71 + 6000*metreDeg, Longitude: 46.68, CoverageRadiusM: 3000, NameEn: "Q"})
	UpsertAgentForTest(standbyAgent{ID: "s1", HomeZoneID: rZone, Kind: "field", IsActive: true, DefaultStandbyPointID: strp(rPoint)})
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	cov, err := GetCoverage(admin, CoverageQuery{ZoneID: strp(rZone), Date: strp("2026-09-14")})
	check(t, err)
	if cov.ReachShare == nil || *cov.ReachShare != 0.6667 {
		t.Fatalf("reach share: got %v, want 0.6667 (Q unstaffed)", cov.ReachShare)
	}
	want := map[string]float64{rPoint: 8.8, rFar: 5.9}
	for _, a := range cov.Areas {
		if a.ReachMinutes == nil || *a.ReachMinutes != want[a.StandbyPointID] {
			t.Errorf("%s: got %v, want %v min", a.StandbyPointID, a.ReachMinutes, want[a.StandbyPointID])
		}
	}
}

func TestAddReachPerInterval(t *testing.T) {
	ResetStandbyForTest()
	t.Cleanup(ReloadStandbyForTest)
	subs, p := reachWorld()
	UpsertZoneForTest(standbyZone{ID: rZone, NameEn: "Zone One"})
	for _, s := range subs {
		UpsertSubZoneForTest(s)
	}
	UpsertStandbyPointForTest(p)
	day := "2026-09-14"
	lines := []RosterAssignment{{StandbyPointID: strp(rPoint), StartAt: day + "T06:00:00+03:00", EndAt: day + "T07:00:00+03:00"}}
	cells := []GapCell{{ZoneID: rZone, IntervalIndex: 23}, {ZoneID: rZone, IntervalIndex: 24}}
	in := &reachInputs{tenant: "t1", model: travelModel{40, 1.3}, threshold: 600}
	cells = addReach(context.Background(), in, cells, rZone, day, lines)
	if cells[0].ReachShare == nil || *cells[0].ReachShare != 0 {
		t.Fatalf("before the shift: got %v, want 0", cells[0].ReachShare)
	}
	if cells[1].ReachShare == nil || *cells[1].ReachShare != 0.6667 {
		t.Fatalf("on shift: got %v, want 0.6667", cells[1].ReachShare)
	}
}
