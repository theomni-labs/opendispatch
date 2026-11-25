// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestLoadForecastAggregatesGroupsPerGrainAndTenant(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	other, _ := adminCtx(t)
	ctx := context.Background()
	add := func(tenant, zone, sub string, at string, handling string) {
		_, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			_, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, id, data_source, case_number, registered_at, zone_id, sub_zone_id, handling)
				VALUES ($1,$2,'SYNTHETIC',$3,$4,$5,$6,$7)`, tenant, datactx.NewID(), datactx.NewID()[:12], at, zone, sub, handling)
			return struct{}{}, err
		})
		check(t, err)
	}
	seed := func(rcTenant string) (string, string) {
		r := rc
		r.CustomerID = rcTenant
		city, err := CreateCity(ctx, conn, r, map[string]any{"case_code": "RY", "name_en": "Riyadh"})
		check(t, err)
		zone, err := CreateZone(ctx, conn, r, map[string]any{"city_id": city.ID, "name_en": "Central"})
		check(t, err)
		sub, err := CreateSubZone(ctx, conn, r, map[string]any{"zone_id": zone.ID, "name_en": "S1", "latitude": 24.7, "longitude": 46.7})
		check(t, err)
		return zone.ID, sub.ID
	}
	zone, sub := seed(tenantID)
	for _, at := range []string{"2024-03-15T00:10:00+03:00", "2024-03-15T00:40:00+03:00", "2024-03-15T23:50:00+03:00"} {
		add(tenantID, zone, sub, at, "field")
	}
	add(tenantID, zone, sub, "2024-03-14T23:59:00+03:00", "remote_inferred")
	add(tenantID, zone, sub, "2026-01-01T10:00:00+03:00", "field")
	oz, os := seed(other.CustomerID)
	add(other.CustomerID, oz, os, "2024-03-15T00:10:00+03:00", "field")
	from := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	rows, src, err := loadForecastAggregates(ctx, conn, tenantID, []string{zone, oz}, from, to, 1440)
	check(t, err)
	if len(rows) != 2 || rows[1].Total != 3 || rows[1].Field != 3 || rows[1].Minutes != 1440 || datactx.ToRiyadhISO(rows[1].IntervalStart) != "2024-03-15T00:00:00+03:00" {
		t.Fatalf("daily %+v", rows)
	}
	if rows[0].Total != 1 || rows[0].Field != 0 || len(src) != 1 || src[0] != "SYNTHETIC" {
		t.Fatalf("daily %+v %v", rows[0], src)
	}
	rows, _, err = loadForecastAggregates(ctx, conn, tenantID, []string{zone}, from, to, 60)
	check(t, err)
	if len(rows) != 3 || rows[1].Total != 2 || datactx.ToRiyadhISO(rows[1].IntervalStart) != "2024-03-15T00:00:00+03:00" || rows[1].Minutes != 60 {
		t.Fatalf("hourly %+v", rows)
	}
}
