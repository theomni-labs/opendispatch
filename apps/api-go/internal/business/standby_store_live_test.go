// SPDX-License-Identifier: AGPL-3.0-only

// Live: standby coverage and moves over Postgres rosters.
package business

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

type standbyWorld struct {
	tenant, zone, pointA, pointB, roster string
	lines                                []string
}

func newStandbyWorld(t *testing.T, owner *pgxpool.Pool) standbyWorld {
	t.Helper()
	ctx := context.Background()
	w := standbyWorld{tenant: freshTenant()}
	w.zone, _ = newZoneOf(t, owner, w.tenant)
	point := func(name string) string {
		var id string
		err := owner.QueryRow(ctx, `INSERT INTO standby_points (tenant_id, data_source, zone_id, name_en, latitude, longitude, coverage_radius_m) VALUES ($1, 'SYNTHETIC', $2, $3, 24.7, 46.7, 3000) RETURNING id::text`, w.tenant, w.zone, name).Scan(&id)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	w.pointA, w.pointB = point("A"), point("B")
	if err := owner.QueryRow(ctx, `INSERT INTO rosters (tenant_id, data_source, zone_id, roster_date, status, planning_level) VALUES ($1, 'SYNTHETIC', $2, '2026-10-05', 'draft', 'standard') RETURNING id::text`, w.tenant, w.zone).Scan(&w.roster); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		var agent, line string
		if err := owner.QueryRow(ctx, `INSERT INTO agents (tenant_id, data_source, code, name_en, kind, home_zone_id) VALUES ($1, 'SYNTHETIC', 'S-'||gen_random_uuid()::text, 'S', 'field', $2) RETURNING id::text`, w.tenant, w.zone).Scan(&agent); err != nil {
			t.Fatal(err)
		}
		if err := owner.QueryRow(ctx, `INSERT INTO roster_assignments (tenant_id, data_source, roster_id, agent_id, zone_id, roster_date, start_at, end_at, standby_point_id)
			VALUES ($1, 'SYNTHETIC', $2, $3, $4, '2026-10-05', '2026-10-05T06:00:00+03:00', '2026-10-05T14:00:00+03:00', $5) RETURNING id::text`, w.tenant, w.roster, agent, w.zone, w.pointA).Scan(&line); err != nil {
			t.Fatal(err)
		}
		w.lines = append(w.lines, line)
	}
	return w
}

func TestPostgresStandbyMovesSurviveARestartAndStayPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	owner := ownerPool(t)
	UsePostgresStandby(conn)
	t.Cleanup(UseMemoryStandby)
	w := newStandbyWorld(t, owner)
	rc := plannerCtx(w.tenant, datactx.NewID(), []string{w.zone})

	before, err := GetCoverage(rc, CoverageQuery{ZoneID: &w.zone, Date: strp("2026-10-05")})
	check(t, err)
	staff := map[string]int{}
	for _, a := range before.Areas {
		staff[a.StandbyPointID] = a.RecommendedAgents
	}
	if before.RosterID == nil || *before.RosterID != w.roster || staff[w.pointA] != 3 || staff[w.pointB] != 0 {
		t.Fatalf("before the move: %+v", before)
	}
	after, err := ApplyStandbyMove(rc, map[string]any{"zone_id": w.zone, "roster_date": "2026-10-05", "from_standby_point_id": w.pointA, "to_standby_point_id": w.pointB, "agents": 2.0})
	check(t, err)
	for _, a := range after.Areas {
		staff[a.StandbyPointID] = a.RecommendedAgents
	}
	if staff[w.pointA] != 1 || staff[w.pointB] != 2 {
		t.Fatalf("after the move: %v", staff)
	}

	UseMemoryStandby()
	UsePostgresStandby(conn)
	again, err := GetCoverage(rc, CoverageQuery{ZoneID: &w.zone, Date: strp("2026-10-05")})
	check(t, err)
	for _, a := range again.Areas {
		staff[a.StandbyPointID] = a.RecommendedAgents
	}
	if staff[w.pointA] != 1 || staff[w.pointB] != 2 {
		t.Fatalf("after a restart: %v", staff)
	}

	other := plannerCtx(freshTenant(), datactx.NewID(), []string{w.zone})
	if _, err := GetCoverage(other, CoverageQuery{ZoneID: &w.zone, Date: strp("2026-10-05")}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("another customer must not see the zone: %v", err)
	}
}

func TestPostgresStandbyMoveIsAllOrNothing(t *testing.T) {
	conn := settingsConn(t)
	owner := ownerPool(t)
	UsePostgresStandby(conn)
	t.Cleanup(UseMemoryStandby)
	w := newStandbyWorld(t, owner)
	if _, err := owner.Exec(context.Background(), `UPDATE roster_assignments SET standby_point_id = $2 WHERE id = $1`, w.lines[1], w.pointB); err != nil {
		t.Fatal(err)
	}
	err := standbyBackendInUse.move(context.Background(), w.tenant, []string{w.lines[0], w.lines[1]}, w.pointA, w.pointB, "2026-10-05T07:00:00+03:00")
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("a line that left the point must give a conflict: %v", err)
	}
	d, err := loadStandby(context.Background(), w.tenant, w.zone)
	check(t, err)
	for _, a := range d.assignments {
		if a.ID == w.lines[0] && *a.StandbyPointID != w.pointA {
			t.Fatal("the first line moved although the batch failed")
		}
	}
}
