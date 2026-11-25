// SPDX-License-Identifier: AGPL-3.0-only

// Live-Postgres tests for dispatch.go's
// ListAgentStatuses/ListAgentPositions, now
// that internal/synthetic is real. Agent ids are
// sourced from the real generator itself (they must
// match its own deterministic world), not invented.
package business

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/synthetic"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func seedRealAgentRow(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id, zoneID string) {
	t.Helper()
	_, err := tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO agents (tenant_id, id, data_source, code, name_en, kind, home_zone_id, is_active, extra)
			VALUES ($1,$2,'SYNTHETIC',$3,'Real Generator Agent','field',$4,true,'{}')`,
			rc.CustomerID, id, "GEN-"+id[:8], zoneID)
		return struct{}{}, err
	})
	check(t, err)
}

func TestListAgentStatuses_ReflectsTheRealGeneratorState(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetDispatchDeps()

	seed, err := fixtures.Seed()
	check(t, err)
	states, err := synthetic.AllAgentStatesAt(seed, "2026-09-13T09:00:00+03:00")
	check(t, err)
	if len(states) == 0 {
		t.Fatal("got no states from the real generator")
	}
	sample := states[0]

	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RY", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central"})
	check(t, err)
	seedRealAgentRow(t, ctx, conn, rc, sample.AgentID, zone.ID)

	dispatcher := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000831", access.RoleDispatchSupervisor)
	_, err = ControlReplay(dispatcher, map[string]any{"action": "seek", "replay_at": "2026-09-13T09:00:00+03:00"})
	check(t, err)

	page, err := ListAgentStatuses(ctx, conn, rc, AgentStatusQuery{})
	check(t, err)
	found := false
	for _, s := range page.Items {
		if s.AgentID == sample.AgentID {
			found = true
			if s.Status != sample.Status || s.Latitude != sample.Latitude || s.Longitude != sample.Longitude {
				t.Fatalf("got %+v, want it to match the generator's own state %+v", s, sample)
			}
		}
	}
	if !found {
		t.Fatalf("got %+v, want the seeded agent's status", page.Items)
	}
}

func TestListAgentPositions_GeneratesAHistorySeries(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetDispatchDeps()

	seed, err := fixtures.Seed()
	check(t, err)
	states, err := synthetic.AllAgentStatesAt(seed, "2026-09-13T09:00:00+03:00")
	check(t, err)
	if len(states) == 0 {
		t.Fatal("got no states from the real generator")
	}
	sample := states[0]

	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RY", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central"})
	check(t, err)
	seedRealAgentRow(t, ctx, conn, rc, sample.AgentID, zone.ID)

	dispatcher := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000832", access.RoleDispatchSupervisor)
	_, err = ControlReplay(dispatcher, map[string]any{"action": "seek", "replay_at": "2026-09-13T09:00:00+03:00"})
	check(t, err)

	page, err := ListAgentPositions(ctx, conn, rc, sample.AgentID, AgentPositionQuery{From: "2026-09-13T08:50:00+03:00", To: "2026-09-13T09:00:00+03:00"})
	check(t, err)
	if len(page.Items) == 0 {
		t.Fatalf("got no positions, want a one-per-minute history series")
	}
	for _, p := range page.Items {
		if p.AgentID != sample.AgentID {
			t.Fatalf("got %+v, want every row for the requested agent", p)
		}
	}
}

func TestListAgentPositions_RejectsFromAfterTo(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetDispatchDeps()

	seed, err := fixtures.Seed()
	check(t, err)
	states, err := synthetic.AllAgentStatesAt(seed, "2026-09-13T09:00:00+03:00")
	check(t, err)
	sample := states[0]
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RY", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central"})
	check(t, err)
	seedRealAgentRow(t, ctx, conn, rc, sample.AgentID, zone.ID)

	_, err = ListAgentPositions(ctx, conn, rc, sample.AgentID, AgentPositionQuery{From: "2026-09-13T09:10:00+03:00", To: "2026-09-13T09:00:00+03:00"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid when from is after to", err)
	}
}
