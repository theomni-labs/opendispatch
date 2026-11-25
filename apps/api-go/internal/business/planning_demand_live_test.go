// SPDX-License-Identifier: AGPL-3.0-only

// Live: case durations from stored cases.
package business

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestCaseDurations_MeansByZoneAndOverall(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "PD", "name_en": "Demand"})
	check(t, err)
	zoneA, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Demand A"})
	check(t, err)
	zoneB, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Demand B"})
	check(t, err)
	base := time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC)
	type c struct {
		zone, handling        string
		travel, scene, offset int
	}
	rows := []c{
		{zoneA.ID, "field", 10, 20, 0}, {zoneA.ID, "field", 20, 40, 1},
		{zoneB.ID, "field", 30, 10, 2},
		{zoneB.ID, "remote_inferred", 99, 99, 3},
		{zoneA.ID, "field", 99, 99, -200},
	}
	_, err = tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for i, r := range rows {
			reg := base.AddDate(0, 0, r.offset)
			asg := reg.Add(time.Minute)
			arr := asg.Add(time.Duration(r.travel) * time.Minute)
			done := arr.Add(time.Duration(r.scene) * time.Minute)
			if _, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, id, data_source, case_number, registered_at, zone_id, handling, assigned_at, arrived_at, on_scene_completed_at, external_id)
				VALUES ($1,$2,'SYNTHETIC',$3,$4,$5,$6,$7,$8,$9,$10)`, rc.CustomerID, datactx.NewID(), fmt.Sprintf("PD-%d", i), reg, r.zone, r.handling, asg, arr, done, fmt.Sprintf("PD-%d", i)); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	check(t, err)
	byZone, all, err := caseDurations(ctx, conn, rc.CustomerID, "2026-09-13")
	check(t, err)
	if a := byZone[zoneA.ID]; a.Travel != 15 || a.OnScene != 30 || a.Cases != 2 || !a.FromHistory {
		t.Fatalf("zone A %+v", a)
	}
	if b := byZone[zoneB.ID]; b.Travel != 30 || b.OnScene != 10 || b.Cases != 1 {
		t.Fatalf("zone B %+v", b)
	}
	if all.Travel != 20 || all.OnScene != round1(70.0/3) || all.Cases != 3 {
		t.Fatalf("overall %+v", all)
	}
	empty, fallback, err := caseDurations(ctx, conn, rc.CustomerID, "2025-01-01")
	check(t, err)
	if len(empty) != 0 || fallback.Travel != fallbackTravelMin || fallback.FromHistory {
		t.Fatalf("no history: %v %+v", empty, fallback)
	}
}
