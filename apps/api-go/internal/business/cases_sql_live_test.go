// SPDX-License-Identifier: AGPL-3.0-only

// Live: SQL case paths match the Go filters.
package business

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

type sqlCaseFixture struct {
	zoneA, zoneB, subA, cityID, typeID string
	caseIDs                            []string
}

// seedSQLCases: ties within a second, null zones.
func seedSQLCases(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) sqlCaseFixture {
	t.Helper()
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RY", "name_en": "Riyadh"})
	check(t, err)
	zoneA, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central"})
	check(t, err)
	zoneB, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "North"})
	check(t, err)
	sub, err := CreateSubZone(ctx, conn, rc, map[string]any{"zone_id": zoneA.ID, "name_en": "Olaya", "latitude": 24.7, "longitude": 46.7})
	check(t, err)
	fx := sqlCaseFixture{zoneA: zoneA.ID, zoneB: zoneB.ID, subA: sub.ID, cityID: city.ID, typeID: datactx.NewID()}
	base := time.Date(2026, 9, 12, 20, 30, 0, 0, time.UTC)
	_, err = tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		if _, err := tx.Exec(ctx, `INSERT INTO case_types (tenant_id, id, data_source, name_en) VALUES ($1,$2,'SYNTHETIC','Collision')`, rc.CustomerID, fx.typeID); err != nil {
			return struct{}{}, err
		}
		for i := 0; i < 60; i++ {
			id := datactx.NewID()
			fx.caseIDs = append(fx.caseIDs, id)
			at := base.Add(time.Duration(i/4) * 37 * time.Minute).Add(time.Duration(i%4) * 150 * time.Millisecond)
			var zone, subZone any
			switch i % 5 {
			case 0, 1:
				zone = zoneA.ID
				if i%2 == 0 {
					subZone = sub.ID
				}
			case 2, 3:
				zone = zoneB.ID
			}
			handling := []string{"field", "remote_inferred"}[i%2]
			source := []string{"SYNTHETIC", "IMPORTED", "SYNTHETIC"}[i%3]
			if _, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, id, data_source, case_number, registered_at, city_id, zone_id, sub_zone_id, case_type_id, handling, external_id)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
				rc.CustomerID, id, source, fmt.Sprintf("RD-%03d", i), at, city.ID, zone, subZone, fx.typeID, handling, fmt.Sprintf("Ext-%d", i*7)); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	check(t, err)
	return fx
}

func caseFilters(fx sqlCaseFixture) []CaseFilter {
	return []CaseFilter{
		{},
		{ZoneID: fx.zoneA},
		{ZoneID: fx.zoneB, Handling: "field"},
		{SubZoneID: fx.subA},
		{CityID: fx.cityID, DataSource: "IMPORTED"},
		{CaseTypeID: fx.typeID, Handling: "remote_inferred"},
		{DateFrom: "2026-09-13", DateTo: "2026-09-13"},
		{DateFrom: "2026-09-14"},
		{DateTo: "2026-09-13"},
		{Q: " ext-1"},
		{Q: "rd-00"},
		{ZoneID: "not-a-uuid"},
		{ZoneID: "ABCDEF00-0000-4000-8000-000000000000"},
		{DateFrom: "13-09-2026"},
		{Q: "رقم"},
	}
}

// walkPages: up to max pages at a limit.
func walkPages(t *testing.T, list func(CaseFilter) (datactx.PageResult[Case], error), f CaseFilter, limit, max int) []datactx.PageResult[Case] {
	t.Helper()
	var out []datactx.PageResult[Case]
	f.Limit, f.Cursor = limit, ""
	for i := 0; i < max; i++ {
		page, err := list(f)
		if err != nil {
			t.Fatalf("list %+v: %v", f, err)
		}
		out = append(out, page)
		if page.Page.NextCursor == nil {
			return out
		}
		f.Cursor = *page.Page.NextCursor
	}
	return out
}

func compareCaseLists(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, filters []CaseFilter, limits []int, maxPages int, all bool) {
	t.Helper()
	for _, f := range filters {
		for _, limit := range limits {
			got := walkPages(t, func(f CaseFilter) (datactx.PageResult[Case], error) { return ListCases(ctx, conn, rc, f) }, f, limit, maxPages)
			want := walkPages(t, func(f CaseFilter) (datactx.PageResult[Case], error) { return listCasesInGo(ctx, conn, rc, f) }, f, limit, maxPages)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("ListCases %+v limit %d: SQL and Go pages differ", f, limit)
			}
		}
		if !all {
			continue
		}
		got, err := ListAllCases(ctx, conn, rc, f)
		check(t, err)
		want, err := listAllCasesInGo(ctx, conn, rc, f)
		check(t, err)
		if len(got) != len(want) || (len(got) > 0 && !reflect.DeepEqual(got, want)) {
			t.Fatalf("ListAllCases %+v: SQL %d rows, Go %d rows", f, len(got), len(want))
		}
	}
}

func TestListCasesSQL_MatchesGoFilter(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	fx := seedSQLCases(t, ctx, conn, rc)
	compareCaseLists(t, ctx, conn, rc, caseFilters(fx), []int{0, 1, 3, 7, 200}, 100, true)
	scoped := plannerCtx(rc.CustomerID, rc.UserID, []string{fx.zoneA})
	compareCaseLists(t, ctx, conn, scoped, caseFilters(fx), []int{4}, 100, true)
	none := plannerCtx(rc.CustomerID, rc.UserID, nil)
	compareCaseLists(t, ctx, conn, none, caseFilters(fx)[:2], []int{5}, 100, true)
	page, err := ListCases(ctx, conn, rc, CaseFilter{Limit: 1})
	check(t, err)
	if page.Page.Total != len(fx.caseIDs) || len(page.Items) != 1 {
		t.Fatalf("total %d, items %d; want %d, 1", page.Page.Total, len(page.Items), len(fx.caseIDs))
	}
	if _, err := ListCases(ctx, conn, rc, CaseFilter{Limit: 201}); err == nil {
		t.Fatal("limit 201 was accepted")
	}
	if _, err := ListCases(ctx, conn, rc, CaseFilter{Cursor: "bad"}); err == nil {
		t.Fatal("a bad cursor was accepted")
	}
}

// Optional: compare on an already seeded tenant.
func TestListCasesSQL_MatchesGoOnSeededTenant(t *testing.T) {
	tenant := os.Getenv("OPENDISPATCH_TEST_SEEDED_TENANT")
	if tenant == "" {
		t.Skip("OPENDISPATCH_TEST_SEEDED_TENANT not set")
	}
	conn := openConn(t)
	ctx := context.Background()
	rc := reqctx.RequestContext{CustomerID: tenant, UserID: datactx.NewID(), Role: access.RoleAdministrator,
		ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}, InstallMode: access.InstallPrivate}
	sample, err := listAllCasesInGo(ctx, conn, rc, CaseFilter{DateFrom: "2026-09-12", DateTo: "2026-09-12"})
	check(t, err)
	if len(sample) == 0 {
		t.Fatal("the seeded tenant has no cases on 12 Sept 2026")
	}
	c := sample[0]
	filters := []CaseFilter{
		{}, {DateFrom: "2026-09-12", DateTo: "2026-09-12"}, {Handling: "remote_inferred", DateFrom: "2026-09-12", DateTo: "2026-09-12"},
		{ZoneID: c.ZoneID}, {Q: c.CaseNumber},
	}
	compareCaseLists(t, ctx, conn, rc, filters, []int{1, 50}, 3, false)
	compareCaseLists(t, ctx, conn, rc, filters[1:3], []int{50}, 1, true)
}
