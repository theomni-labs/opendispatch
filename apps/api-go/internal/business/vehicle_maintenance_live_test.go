// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestVehicleMaintenance_AddListRemoveAudited(t *testing.T) {
	conn := usePgAudit(t)
	rc, tenant := adminCtx(t)
	ctx := context.Background()
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "MT", "name_en": "Maint City"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Maint Zone"})
	check(t, err)
	vehicle, err := CreateVehicle(ctx, conn, rc, map[string]any{"code": "VEH-MNT", "plate_number": "SYN 0900", "zone_id": zone.ID})
	check(t, err)

	body := map[string]any{"vehicle_id": vehicle.ID, "starts_at": "2026-09-14T08:00:00+03:00", "ends_at": "2026-09-15T08:00:00+03:00", "reason": "Brake service"}
	created, err := CreateVehicleMaintenance(ctx, conn, rc, body)
	check(t, err)
	if created.VehicleID != vehicle.ID || created.StartsAt != "2026-09-14T08:00:00+03:00" || created.Reason != "Brake service" {
		t.Fatalf("got %+v", created)
	}

	overlap := map[string]any{"vehicle_id": vehicle.ID, "starts_at": "2026-09-15T07:00:00+03:00", "ends_at": "2026-09-15T09:00:00+03:00", "reason": "Tyres"}
	if _, err := CreateVehicleMaintenance(ctx, conn, rc, overlap); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("overlap: got %v, want Conflict", err)
	}
	backwards := map[string]any{"vehicle_id": vehicle.ID, "starts_at": "2026-09-20T09:00:00+03:00", "ends_at": "2026-09-20T08:00:00+03:00", "reason": "Tyres"}
	if _, err := CreateVehicleMaintenance(ctx, conn, rc, backwards); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("backwards: got %v, want Invalid", err)
	}
	planner := roleCtx(tenant, "00000000-0000-4000-8000-000000000321", access.RolePlanner)
	if _, err := CreateVehicleMaintenance(ctx, conn, planner, map[string]any{"vehicle_id": vehicle.ID, "starts_at": "2026-09-21T08:00:00+03:00", "ends_at": "2026-09-21T09:00:00+03:00", "reason": "x"}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner: got %v, want Forbidden", err)
	}
	if _, err := ListVehicleMaintenance(ctx, conn, planner, VehicleMaintenanceQuery{}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner list: got %v, want Forbidden", err)
	}

	on, err := ListVehicleMaintenance(ctx, conn, rc, VehicleMaintenanceQuery{ActiveOn: "2026-09-15"})
	check(t, err)
	off, err := ListVehicleMaintenance(ctx, conn, rc, VehicleMaintenanceQuery{ActiveOn: "2026-09-16"})
	check(t, err)
	mine, err := ListVehicleMaintenance(ctx, conn, rc, VehicleMaintenanceQuery{VehicleID: vehicle.ID})
	check(t, err)
	if len(on.Items) != 1 || len(off.Items) != 0 || len(mine.Items) != 1 {
		t.Fatalf("active on 15th %d, 16th %d, of the vehicle %d; want 1, 0, 1", len(on.Items), len(off.Items), len(mine.Items))
	}

	other, _ := adminCtx(t)
	if seen, err := ListVehicleMaintenance(ctx, conn, other, VehicleMaintenanceQuery{}); err != nil || len(seen.Items) != 0 {
		t.Fatalf("another tenant saw %v (%v), want none", seen.Items, err)
	}
	if err := DeleteVehicleMaintenance(ctx, conn, other, created.ID); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("another tenant's delete: got %v, want NotFound", err)
	}

	check(t, DeleteVehicleMaintenance(ctx, conn, rc, created.ID))
	if left, _ := ListVehicleMaintenance(ctx, conn, rc, VehicleMaintenanceQuery{VehicleID: vehicle.ID}); len(left.Items) != 0 {
		t.Fatalf("got %d after delete, want 0", len(left.Items))
	}

	events, err := auditlog.EventsOf(ctx, tenant)
	check(t, err)
	actions := map[string]int{}
	for _, e := range events {
		actions[e.Action]++
	}
	if actions["vehicle.maintenance_added"] < 2 || actions["vehicle.maintenance_removed"] != 1 {
		t.Fatalf("got audit actions %v, want the add (with the denied one) and the removal", actions)
	}
}

func TestVehicleMaintenance_TakesTheVehicleOutOfTheOptimizerRequest(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	plan, err := loadPlan(ctx, conn, rc)
	check(t, err)
	var vehicleID string
	for _, v := range plan.Vehicles {
		if v.ZoneID != nil && *v.ZoneID == fx.zoneID {
			vehicleID = v.ID
		}
	}
	if vehicleID == "" {
		t.Skip("the roster fixture has no vehicle in the zone")
	}
	_, err = CreateVehicleMaintenance(ctx, conn, rc, map[string]any{"vehicle_id": vehicleID, "starts_at": "2026-09-14T00:00:00+03:00", "ends_at": "2026-09-15T00:00:00+03:00", "reason": "Service"})
	check(t, err)
	plan, err = loadPlan(ctx, conn, rc)
	check(t, err)
	if down := vehiclesDownOn(plan.Maintenance, "2026-09-14"); !down[vehicleID] {
		t.Fatalf("got %v, want the vehicle down on the 14th", down)
	}
	lines, err := projectLines(rc, plan, fx.zoneID, "2026-09-14")
	check(t, err)
	for _, l := range lines {
		if l.VehicleID != nil && *l.VehicleID == vehicleID {
			t.Fatalf("a projected line kept the vehicle in maintenance: %+v", l)
		}
	}
}
