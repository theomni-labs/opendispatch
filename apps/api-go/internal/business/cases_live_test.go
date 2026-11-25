// SPDX-License-Identifier: AGPL-3.0-only

// Live-Postgres tests for cases.go.
package business

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

type caseFixture struct {
	zoneID     string
	caseTypeID string
	case1ID    string
	case2ID    string
}

func seedCaseFixture(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) caseFixture {
	t.Helper()
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RY", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central"})
	check(t, err)

	caseTypeID := datactx.NewID()
	case1ID := datactx.NewID()
	case2ID := datactx.NewID()
	_, err = tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		if _, err := tx.Exec(ctx, `INSERT INTO case_types (tenant_id, id, data_source, name_en) VALUES ($1,$2,'SYNTHETIC','Collision')`, rc.CustomerID, caseTypeID); err != nil {
			return struct{}{}, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, id, data_source, case_number, registered_at, city_id, zone_id, case_type_id, handling, external_id)
			VALUES ($1,$2,'SYNTHETIC',$3,'2026-09-14T10:00:00+03:00',$4,$5,$6,'field',$7)`,
			rc.CustomerID, case1ID, "RD-1", city.ID, zone.ID, caseTypeID, "EXT-1"); err != nil {
			return struct{}{}, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, id, data_source, case_number, registered_at, city_id, zone_id, case_type_id, handling, external_id)
			VALUES ($1,$2,'SYNTHETIC',$3,'2026-09-13T09:00:00+03:00',$4,$5,$6,'remote_inferred',$7)`,
			rc.CustomerID, case2ID, "RD-2", city.ID, zone.ID, caseTypeID, "EXT-2"); err != nil {
			return struct{}{}, err
		}
		return struct{}{}, nil
	})
	check(t, err)
	return caseFixture{zoneID: zone.ID, caseTypeID: caseTypeID, case1ID: case1ID, case2ID: case2ID}
}

func TestListCases_SortsNewestFirstAndFilters(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	fx := seedCaseFixture(t, ctx, conn, rc)

	page, err := ListCases(ctx, conn, rc, CaseFilter{ZoneID: fx.zoneID})
	check(t, err)
	if len(page.Items) != 2 || page.Items[0].ID != fx.case1ID || page.Items[1].ID != fx.case2ID {
		t.Fatalf("got %+v, want case1 (14 Sep) before case2 (13 Sep)", page.Items)
	}

	filtered, err := ListCases(ctx, conn, rc, CaseFilter{Handling: "remote_inferred"})
	check(t, err)
	if len(filtered.Items) != 1 || filtered.Items[0].ID != fx.case2ID {
		t.Fatalf("got %+v, want only case2 (remote_inferred)", filtered.Items)
	}
}

func TestGetCase_FoundAndNotFound(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	fx := seedCaseFixture(t, ctx, conn, rc)

	got, err := GetCase(ctx, conn, rc, fx.case1ID)
	check(t, err)
	if got.CaseNumber != "RD-1" || got.CaseTypeID != fx.caseTypeID {
		t.Fatalf("got %+v, want RD-1 with the seeded case type", got)
	}

	_, err = GetCase(ctx, conn, rc, datactx.NewID())
	if errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("got %v, want NotFound for an unknown case", err)
	}
}

func TestGetCase_OutOfZoneScopeIsNotFound(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	fx := seedCaseFixture(t, ctx, conn, rc)

	outsider := plannerCtx(tenantID, "00000000-0000-4000-8000-000000000601", []string{"00000000-0000-4000-8000-000000000999"})
	_, err := GetCase(ctx, conn, outsider, fx.case1ID)
	if errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("got %v, want NotFound when the case's zone is out of scope", err)
	}
}

func TestListCaseTypes_ReturnsSeededRow(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	fx := seedCaseFixture(t, ctx, conn, rc)

	page, err := ListCaseTypes(ctx, conn, rc, datactx.PageQuery{})
	check(t, err)
	found := false
	for _, ct := range page.Items {
		if ct.ID == fx.caseTypeID && ct.NameEn == "Collision" {
			found = true
		}
	}
	if !found {
		t.Fatalf("got %+v, want the seeded case type", page.Items)
	}
}

func TestListCases_RequirePlatformBlocksChangeApprover(t *testing.T) {
	conn := openConn(t)
	_, tenantID := adminCtx(t)
	ctx := context.Background()
	approver := roleCtx(tenantID, "00000000-0000-4000-8000-000000000602", access.RoleChangeApprover)
	if _, err := ListCases(ctx, conn, approver, CaseFilter{}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden for a Change Approver (platform.records)", err)
	}
}
