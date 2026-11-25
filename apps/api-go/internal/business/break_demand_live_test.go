// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
)

func TestGenerateBreakPlan_ReportsTheCoverageCost(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	// pin the demo day: other tests reset settings
	putSetting(t, "demo.today", "2026-09-13")
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000311", access.RolePlanner)
	_, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)

	plan, err := GenerateBreakPlan(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)
	if plan.CoverageCost == nil || plan.CoverageCost.MaxShare != defaultBreakShare {
		t.Fatalf("got %+v, want a coverage cost with the default share", plan.CoverageCost)
	}
	if plan.CoverageCost.ExpectedCases < 0 || plan.CoverageCost.PeakShareAway > 1 {
		t.Fatalf("got %+v, want a sane cost", plan.CoverageCost)
	}
	empty, err := GetBreakPlan(ctx, conn, rc, fx.zoneID, "2026-09-20")
	check(t, err)
	if empty.CoverageCost != nil {
		t.Fatalf("got %+v, want no cost without a roster", empty.CoverageCost)
	}
}
