// SPDX-License-Identifier: AGPL-3.0-only

// Live: dashboard and productivity roll-ups kept in Postgres.
package business

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestPostgresRollupsMatchTheMemoryStoreAndStayPerCustomer(t *testing.T) {
	conn := openConn(t)
	owner := ownerPool(t)
	ctx := context.Background()
	ReloadDashboardsForTest()
	ReloadFieldShareZonesForTest()
	rc, _ := adminCtx(t)
	tenant, err := fixtures.TenantID()
	check(t, err)
	rc.CustomerID = tenant

	wantDash, err := ListDashboardRollups(ctx, conn, rc, DashboardRollupQuery{Level: "zone", Limit: 200})
	check(t, err)
	wantProd, err := ListProductivityRollups(ctx, conn, rc, ProductivityRollupQuery{Limit: 200})
	check(t, err)
	wantKingdom, err := ListDashboardRollups(ctx, conn, rc, DashboardRollupQuery{Level: "zone", Limit: 5, DateFrom: "2026-09-08", DateTo: "2026-09-09"})
	check(t, err)
	if len(wantDash.Items) == 0 || len(wantProd.Items) == 0 || len(wantKingdom.Items) == 0 {
		t.Fatal("the memory store holds no roll-ups")
	}

	UsePostgresRollups(conn)
	t.Cleanup(UseMemoryRollups)
	check(t, ReseedRollupsForTest(ctx, &tenancy.Connection{Pool: owner}))
	gotDash, err := ListDashboardRollups(ctx, conn, rc, DashboardRollupQuery{Level: "zone", Limit: 200})
	check(t, err)
	gotProd, err := ListProductivityRollups(ctx, conn, rc, ProductivityRollupQuery{Limit: 200})
	check(t, err)
	gotKingdom, err := ListDashboardRollups(ctx, conn, rc, DashboardRollupQuery{Level: "zone", Limit: 5, DateFrom: "2026-09-08", DateTo: "2026-09-09"})
	check(t, err)
	for name, pair := range map[string][2]any{"dashboard": {wantDash, gotDash}, "productivity": {wantProd, gotProd}, "dates": {wantKingdom, gotKingdom}} {
		a, _ := json.Marshal(pair[0])
		b, _ := json.Marshal(pair[1])
		if string(a) != string(b) {
			i := 0
			for i < len(a) && i < len(b) && a[i] == b[i] {
				i++
			}
			t.Fatalf("%s: Postgres differs from the memory store at byte %d\nmemory:   %.200s\npostgres: %.200s", name, i, a[max(0, i-100):], b[max(0, i-100):])
		}
	}

	other, _ := adminCtx(t)
	none, err := ListDashboardRollups(ctx, conn, other, DashboardRollupQuery{Level: "zone", Limit: 200})
	if err != nil || len(none.Items) != 0 {
		t.Fatalf("another customer sees %d roll-ups (%v)", len(none.Items), err)
	}
}

func TestPostgresRollupsSurviveARestart(t *testing.T) {
	conn := settingsConn(t)
	owner := &tenancy.Connection{Pool: ownerPool(t)}
	UsePostgresRollups(conn)
	t.Cleanup(UseMemoryRollups)
	a := freshTenant()
	zone, _ := newZoneOf(t, owner.Pool, a)
	at := datactx.NowISO()
	gaps := 3
	d := DashboardRollup{
		BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: a, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
		Level:      "zone", ScopeID: &zone, PeriodStart: "2026-10-01", PeriodEnd: "2026-10-01", CasesTotal: 10, PrimaryClockStart: "assignment", GapIntervals: &gaps, Illustrative: true,
		FromAssignment: ServiceLevelReading{WithinCount: 4, CaseCount: 8},
	}
	if err := insertRollups(context.Background(), owner, a, []DashboardRollup{d}, nil); err != nil {
		t.Fatal(err)
	}
	UseMemoryRollups()
	UsePostgresRollups(conn)
	rows, err := loadDashboardRollups(context.Background(), a, "2026-10-01", "2026-10-01")
	if err != nil || len(rows) != 1 || rows[0].GapIntervals == nil || *rows[0].GapIntervals != 3 || rows[0].FromAssignment.WithinCount != 4 || rows[0].PeriodStart != "2026-10-01" || rows[0].SurplusIntervals != nil {
		t.Fatalf("after a restart: %+v %v", rows, err)
	}
	if rows, _ := loadDashboardRollups(context.Background(), freshTenant(), "", ""); len(rows) != 0 {
		t.Fatal("another customer sees roll-ups")
	}
}

func TestPostgresRollupsAreAllOrNothing(t *testing.T) {
	conn := settingsConn(t)
	owner := &tenancy.Connection{Pool: ownerPool(t)}
	UsePostgresRollups(conn)
	t.Cleanup(UseMemoryRollups)
	a := freshTenant()
	at := datactx.NowISO()
	mk := func(zone string) ProductivityRollup {
		return ProductivityRollup{
			BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: a, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
			GroupBy:    "zone", ZoneID: &zone, PeriodStart: "2026-10-01", PeriodEnd: "2026-10-07", CasesHandled: 5, Illustrative: true,
		}
	}
	zone, _ := newZoneOf(t, owner.Pool, a)
	missing := datactx.NewID()
	if err := insertRollups(context.Background(), owner, a, nil, []ProductivityRollup{mk(zone), mk(missing)}); err == nil {
		t.Fatal("a roll-up of no zone must fail")
	}
	if rows, _ := loadProductivityRollups(context.Background(), a, "zone", "", ""); len(rows) != 0 {
		t.Fatalf("a failed batch left %d rows", len(rows))
	}
}
