// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func share(v float64) *float64 { return &v }
func intp(v int) *int          { return &v }

func TestListDashboardRollups_WholeInstallSeesStoredRows(t *testing.T) {
	ResetDashboardsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	UpsertDashboardRollupForTest(DashboardRollup{
		BaseRecord: bd("r1", "t1"), Level: "kingdom", PeriodStart: "2026-09-13", PeriodEnd: "2026-09-13",
		CasesTotal: 10, FromAssignment: ServiceLevelReading{WithinCount: 8, CaseCount: 10, Share: share(0.8)},
		FromRegistration: ServiceLevelReading{WithinCount: 9, CaseCount: 10, Share: share(0.9)},
	})
	UpsertDashboardRollupForTest(DashboardRollup{
		BaseRecord: bd("r2", "t1"), Level: "kingdom", PeriodStart: "2026-09-14", PeriodEnd: "2026-09-14",
		CasesTotal: 20,
	})

	page, err := ListDashboardRollups(nil, nil, admin, DashboardRollupQuery{Level: "kingdom"})
	check(t, err)
	if len(page.Items) != 2 {
		t.Fatalf("got %d rows, want 2", len(page.Items))
	}
	if page.Items[0].ID != "r2" || page.Items[1].ID != "r1" {
		t.Fatalf("order = %v, want r2 then r1 (newest first)", page.Items)
	}
	if page.Items[0].PrimaryClockStart != "assignment" {
		t.Fatalf("primary_clock_start = %q, want assignment (default)", page.Items[0].PrimaryClockStart)
	}
}

func TestListDashboardRollups_RefusesBadLevelAndWrongRole(t *testing.T) {
	ResetDashboardsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	_, err := ListDashboardRollups(nil, nil, admin, DashboardRollupQuery{Level: "planet"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad level: got %v, want Invalid", err)
	}

	dispatcher := roleCtx("t1", "u2", access.RoleDispatcher)
	_, err = ListDashboardRollups(nil, nil, dispatcher, DashboardRollupQuery{Level: "kingdom"})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("dispatcher: got %v, want Forbidden", err)
	}
}

func TestListProductivityRollups_DefaultGroupByAndFilters(t *testing.T) {
	ResetDashboardsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	UpsertProductivityRollupForTest(ProductivityRollup{BaseRecord: bd("p1", "t1"), GroupBy: "zone", ZoneID: strp("z1"), PeriodStart: "2026-09-13", PeriodEnd: "2026-09-13", CasesHandled: 5})
	UpsertProductivityRollupForTest(ProductivityRollup{BaseRecord: bd("p2", "t1"), GroupBy: "agent", AgentID: strp("s1"), PeriodStart: "2026-09-13", PeriodEnd: "2026-09-13", CasesHandled: 3})

	byZone, err := ListProductivityRollups(nil, nil, admin, ProductivityRollupQuery{})
	check(t, err)
	if len(byZone.Items) != 1 || byZone.Items[0].ID != "p1" {
		t.Fatalf("default group_by=zone: got %+v, want [p1]", byZone.Items)
	}

	byAgent, err := ListProductivityRollups(nil, nil, admin, ProductivityRollupQuery{GroupBy: "agent"})
	check(t, err)
	if len(byAgent.Items) != 1 || byAgent.Items[0].ID != "p2" {
		t.Fatalf("group_by=agent: got %+v, want [p2]", byAgent.Items)
	}

	_, err = ListProductivityRollups(nil, nil, admin, ProductivityRollupQuery{GroupBy: "nonsense"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad group_by: got %v, want Invalid", err)
	}
}

func bd(id, tenant string) datactx.BaseRecord {
	return datactx.BaseRecord{ID: id, TenantID: tenant, CreatedAt: "2026-09-13T00:00:00+03:00", UpdatedAt: "2026-09-13T00:00:00+03:00", DataSource: "SYNTHETIC"}
}

func strp(s string) *string { return &s }
