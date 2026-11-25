// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"strings"
	"testing"
)

func mw(vehicleID, from, to string) VehicleMaintenance {
	return VehicleMaintenance{VehicleID: vehicleID, StartsAt: from, EndsAt: to}
}

func TestVehiclesDownOn_OverlapWithTheDay(t *testing.T) {
	windows := []VehicleMaintenance{
		mw("v1", "2026-09-14T08:00:00+03:00", "2026-09-14T10:00:00+03:00"),
		mw("v2", "2026-09-13T08:00:00+03:00", "2026-09-14T00:00:00+03:00"),
		mw("v3", "2026-09-10T00:00:00+03:00", "2026-09-20T00:00:00+03:00"),
	}
	down := vehiclesDownOn(windows, "2026-09-14")
	if !down["v1"] || down["v2"] || !down["v3"] {
		t.Fatalf("got %v, want v1 and v3 (v2 ends at midnight)", down)
	}
}

func TestOptimizerRequest_MarksAVehicleInMaintenanceUnavailable(t *testing.T) {
	s := testOptimizerSource()
	s.Down = map[string]bool{tVeh: true}
	raw, err := buildOptimizerRequest(s)
	check(t, err)
	checkRequest(t, "optimizer", raw)
	if !strings.Contains(string(raw), `{"vehicle_id":"`+tVeh+`","zone_id":"`+tZone+`","available":false}`) {
		t.Fatalf("want the vehicle unavailable in %s", raw)
	}
}

func TestCoverageSeriesAvail_DropsTheVehicleOnlyWhileDown(t *testing.T) {
	day := "2026-09-14"
	veh := "v1"
	lines := []RosterAssignment{{VehicleID: &veh, StartAt: day + "T06:00:00+03:00", EndAt: day + "T14:00:00+03:00"}}
	windows := []VehicleMaintenance{mw("v1", day+"T08:00:00+03:00", day+"T09:00:00+03:00")}
	got := coverageSeriesAvail(lines, day, windows)
	if got.OnDuty[33] != 1 || got.WithVehicle[33] != 0 {
		t.Fatalf("08:15: got on duty %d with vehicle %d, want 1 and 0", got.OnDuty[33], got.WithVehicle[33])
	}
	if got.WithVehicle[24] != 1 || got.WithVehicle[36] != 1 {
		t.Fatalf("06:00 and 09:00: want the vehicle counted, got %d and %d", got.WithVehicle[24], got.WithVehicle[36])
	}
	cells := gapCells("z", day, got, func() []int { r := make([]int, 96); r[33] = 1; return r }(), GeographyInput{}, 1)
	if cells[33].Cause == nil || *cells[33].Cause != "vehicles" {
		t.Fatalf("08:15: got %+v, want a vehicles gap", cells[33])
	}
}
