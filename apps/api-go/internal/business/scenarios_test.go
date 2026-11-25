// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors scenarios.test.ts's CRUD part (not
// runScenario yet). Pure: only touches the
// in-memory Scenario store and demoZoneIDs.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func resetScenarioDeps() {
	ResetScenariosForTest()
	ResetFieldShareForTest()
	ResetSimZonesForTest()
}

func seedScenarioZones(ids []string) {
	SeedFieldShareZonesForTest(ids)
	rows := make([]simZoneRow, 0, len(ids))
	for _, id := range ids {
		rows = append(rows, simZoneRow{ID: id, NameEn: id})
	}
	SeedSimZonesForTest(rows)
}

func TestCreateScenario_ValidatesZonesAndHeadcount(t *testing.T) {
	resetScenarioDeps()
	seedScenarioZones([]string{"00000000-0000-4000-8000-000000000201", "00000000-0000-4000-8000-000000000202"})
	planner := roleCtx("t1", "u1", access.RolePlanner)
	ctx := context.Background()

	created, err := CreateScenario(ctx, nil, planner, map[string]any{
		"name": "Busy Friday", "base_date": "2026-09-18", "zone_ids": []any{"00000000-0000-4000-8000-000000000201"},
		"adjustments": map[string]any{"headcount_delta": []any{map[string]any{"zone_id": "00000000-0000-4000-8000-000000000201", "field_agents": 2.0}}},
	})
	check(t, err)
	if created.Status != "draft" || len(created.Adjustments.HeadcountDelta) != 1 {
		t.Fatalf("got %+v, want a draft scenario with one headcount entry", created)
	}

	// A headcount entry outside the scenario is refused.
	_, err = CreateScenario(ctx, nil, planner, map[string]any{
		"name": "Bad", "base_date": "2026-09-18", "zone_ids": []any{"00000000-0000-4000-8000-000000000201"},
		"adjustments": map[string]any{"headcount_delta": []any{map[string]any{"zone_id": "00000000-0000-4000-8000-000000000202", "field_agents": 1.0}}},
	})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid (zone not in scenario)", err)
	}

	// An unknown zone is refused.
	_, err = CreateScenario(ctx, nil, planner, map[string]any{"name": "Bad", "base_date": "2026-09-18", "zone_ids": []any{"00000000-0000-4000-8000-000000000299"}})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid (unknown zone)", err)
	}

	// No zones at all is refused.
	_, err = CreateScenario(ctx, nil, planner, map[string]any{"name": "Bad", "base_date": "2026-09-18", "zone_ids": []any{}})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid (no zones)", err)
	}
}

func TestScenario_UpdateResetsToDraftAndDelete(t *testing.T) {
	resetScenarioDeps()
	seedScenarioZones([]string{"00000000-0000-4000-8000-000000000201"})
	planner := roleCtx("t1", "u1", access.RolePlanner)
	ctx := context.Background()

	created, err := CreateScenario(ctx, nil, planner, map[string]any{"name": "A", "base_date": "2026-09-18", "zone_ids": []any{"00000000-0000-4000-8000-000000000201"}})
	check(t, err)
	completed := created
	completed.Status = "completed"
	upsertScenarioRowMemory(completed)

	updated, err := UpdateScenario(ctx, nil, planner, created.ID, map[string]any{"name": "A renamed", "base_date": "2026-09-19", "zone_ids": []any{"00000000-0000-4000-8000-000000000201"}})
	check(t, err)
	if updated.Status != "draft" || updated.Name != "A renamed" {
		t.Fatalf("got %+v, want draft and renamed (a change resets the run)", updated)
	}

	if err := DeleteScenario(planner, created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := GetScenario(planner, created.ID); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("got %v, want NotFound after delete", err)
	}
}

func TestListScenarios_VisibleOnlyWhenEveryZoneInScope(t *testing.T) {
	resetScenarioDeps()
	seedScenarioZones([]string{"00000000-0000-4000-8000-000000000201", "00000000-0000-4000-8000-000000000202"})
	planner := roleCtx("t1", "u1", access.RolePlanner)
	ctx := context.Background()
	_, err := CreateScenario(ctx, nil, planner, map[string]any{"name": "Both zones", "base_date": "2026-09-18", "zone_ids": []any{"00000000-0000-4000-8000-000000000201", "00000000-0000-4000-8000-000000000202"}})
	check(t, err)

	scoped := roleCtx("t1", "u2", access.RolePlanner)
	scoped.ZoneScope = access.ZoneScope{Kind: access.ScopeAssignedZones, ZoneIDs: []string{"00000000-0000-4000-8000-000000000201"}}
	page, err := ListScenarios(scoped, datactx.PageQuery{})
	check(t, err)
	if len(page.Items) != 0 {
		t.Fatalf("got %d, want 0 (only one of the two zones is in scope)", len(page.Items))
	}

	page, err = ListScenarios(planner, datactx.PageQuery{})
	check(t, err)
	if len(page.Items) != 1 {
		t.Fatalf("got %d, want 1 for the whole-install planner", len(page.Items))
	}
}

func TestScenario_AdministratorOnlyForWrites(t *testing.T) {
	resetScenarioDeps()
	seedScenarioZones([]string{"00000000-0000-4000-8000-000000000201"})
	ctx := context.Background()
	approver := roleCtx("t1", "u1", access.RoleChangeApprover)
	if _, err := CreateScenario(ctx, nil, approver, map[string]any{"name": "X", "base_date": "2026-09-18", "zone_ids": []any{"00000000-0000-4000-8000-000000000201"}}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden (change_approver has no scenario-lab access)", err)
	}
}
