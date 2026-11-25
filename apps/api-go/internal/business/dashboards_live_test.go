// SPDX-License-Identifier: AGPL-3.0-only

// Live: dashboards.go's zone-to-city mapping.
package business

import (
	"context"
	"testing"
)

func TestListDashboardRollups_ZoneScopedAggregatesIntoCity(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	ResetDashboardsForTest()

	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RD", "name_en": "Riyadh"})
	check(t, err)
	zoneA, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Riyadh Central"})
	check(t, err)
	zoneB, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Riyadh North"})
	check(t, err)

	UpsertDashboardRollupForTest(DashboardRollup{
		BaseRecord: bd("dr-a", tenantID), Level: "zone", ScopeID: strp(zoneA.ID),
		PeriodStart: "2026-09-13", PeriodEnd: "2026-09-13", CasesTotal: 10,
		AgentsOnDuty: intp(4), FromAssignment: ServiceLevelReading{WithinCount: 8, CaseCount: 10, Share: share(0.8)},
	})
	UpsertDashboardRollupForTest(DashboardRollup{
		BaseRecord: bd("dr-b", tenantID), Level: "zone", ScopeID: strp(zoneB.ID),
		PeriodStart: "2026-09-13", PeriodEnd: "2026-09-13", CasesTotal: 15,
		AgentsOnDuty: intp(6), FromAssignment: ServiceLevelReading{WithinCount: 9, CaseCount: 15, Share: share(0.6)},
	})

	planner := plannerCtx(tenantID, "u1", []string{zoneA.ID, zoneB.ID})
	page, err := ListDashboardRollups(ctx, conn, planner, DashboardRollupQuery{Level: "city"})
	check(t, err)
	if len(page.Items) != 1 {
		t.Fatalf("got %d city rows, want 1 (both zones same city)", len(page.Items))
	}
	row := page.Items[0]
	if row.CasesTotal != 25 {
		t.Fatalf("cases_total = %d, want 25 (10+15)", row.CasesTotal)
	}
	if row.AgentsOnDuty == nil || *row.AgentsOnDuty != 10 {
		t.Fatalf("agents_on_duty = %v, want 10 (4+6)", row.AgentsOnDuty)
	}
	if row.FromAssignment.WithinCount != 17 || row.FromAssignment.CaseCount != 25 {
		t.Fatalf("from_assignment = %+v, want within=17 case=25", row.FromAssignment)
	}
	if row.ScopeID == nil || *row.ScopeID != city.ID {
		t.Fatalf("scope_id = %v, want city id %s", row.ScopeID, city.ID)
	}

	// Scoped to zoneA only: zoneB's cases never appear.
	narrow := plannerCtx(tenantID, "u2", []string{zoneA.ID})
	page2, err := ListDashboardRollups(ctx, conn, narrow, DashboardRollupQuery{Level: "city"})
	check(t, err)
	if len(page2.Items) != 1 || page2.Items[0].CasesTotal != 10 {
		t.Fatalf("zoneA-only planner: got %+v, want cases_total=10", page2.Items)
	}
}
