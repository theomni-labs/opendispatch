// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors locations.live.test.ts (live Postgres).
package business

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const noLiveDBReason = "OPENDISPATCH_TEST_DATABASE_URL not set: skipped, not faked."

// liveDBURL: the owner url (migrations; BYPASSRLS).
func liveDBURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("OPENDISPATCH_TEST_DATABASE_URL")
	if url == "" {
		t.Skip(noLiveDBReason)
	}
	return url
}

// liveAppDBURL: the app-role url; RLS is enforced.
// Business logic must run as this role, never owner.
func liveAppDBURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("OPENDISPATCH_TEST_APP_DATABASE_URL")
	if url == "" {
		t.Skip("OPENDISPATCH_TEST_APP_DATABASE_URL not set: skipped, not faked.")
	}
	return url
}

func migrationsDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("..", "..", "migrations"))
	if err != nil {
		t.Fatalf("resolve migrations dir: %v", err)
	}
	return dir
}

// openConn: migrate as owner, call as app.
func openConn(t *testing.T) *tenancy.Connection {
	t.Helper()
	ownerURL := liveDBURL(t)
	appURL := liveAppDBURL(t)
	ownerPool, err := pgxpool.New(context.Background(), ownerURL)
	if err != nil {
		t.Fatalf("open owner pool: %v", err)
	}
	defer ownerPool.Close()
	if _, err := tenancy.ApplyMigrations(context.Background(), tenancy.ApplyMigrationsOptions{Pool: ownerPool, Dir: migrationsDir(t)}); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	appPool, err := pgxpool.New(context.Background(), appURL)
	if err != nil {
		t.Fatalf("open app pool: %v", err)
	}
	t.Cleanup(appPool.Close)
	return &tenancy.Connection{Pool: appPool}
}

// adminCtx: a fresh tenant, whole-install admin.
func adminCtx(t *testing.T) (reqctx.RequestContext, string) {
	t.Helper()
	tenantID := datactx.NewID()
	return reqctx.RequestContext{
		CustomerID:  tenantID,
		UserID:      datactx.NewID(),
		Role:        access.RoleAdministrator,
		ZoneScope:   access.ZoneScope{Kind: access.ScopeWholeInstall},
		InstallMode: access.InstallPrivate,
	}, tenantID
}

func plannerCtx(tenantID, userID string, zoneIDs []string) reqctx.RequestContext {
	return reqctx.RequestContext{
		CustomerID:  tenantID,
		UserID:      userID,
		Role:        access.RolePlanner,
		ZoneScope:   access.ZoneScope{Kind: access.ScopeAssignedZones, ZoneIDs: zoneIDs},
		InstallMode: access.InstallPrivate,
	}
}

// check: fails the test on a setup error.
func check(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
}

func errCode(err error) dataerr.Code {
	de, ok := err.(*dataerr.DataError)
	if !ok {
		return ""
	}
	return de.Code
}

func TestCity_CreateUpdateConflict(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RD", "name_en": "Riyadh"})
	if err != nil {
		t.Fatalf("create city: %v", err)
	}
	if city.CaseCode != "RD" || city.NameEn != "Riyadh" || !city.IsActive {
		t.Fatalf("unexpected city: %+v", city)
	}

	updated, err := UpdateCity(ctx, conn, rc, city.ID, map[string]any{"case_code": "RD", "name_en": "Riyadh City"})
	if err != nil {
		t.Fatalf("update city: %v", err)
	}
	if updated.NameEn != "Riyadh City" || updated.ID != city.ID || updated.CreatedAt != city.CreatedAt {
		t.Fatalf("unexpected update: %+v", updated)
	}

	if _, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RD", "name_en": "Another"}); err == nil {
		t.Fatal("expected a conflict for a duplicate case_code")
	} else if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("expected conflict, got %v", err)
	}

	if _, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "rd", "name_en": "Bad"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("expected invalid case_code to be rejected, got %v", err)
	}
}

func TestZone_RequiresExistingCity(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	if _, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": datactx.NewID(), "name_en": "Nowhere"}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("expected not-found for a missing city, got %v", err)
	}

	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "JD", "name_en": "Jeddah"})
	if err != nil {
		t.Fatalf("create city: %v", err)
	}
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Jeddah North"})
	if err != nil {
		t.Fatalf("create zone: %v", err)
	}
	if zone.CityID != city.ID || zone.Latitude != nil {
		t.Fatalf("unexpected zone: %+v", zone)
	}

	withCoords, err := UpdateZone(ctx, conn, rc, zone.ID, map[string]any{"city_id": city.ID, "name_en": "Jeddah North", "latitude": 21.5, "longitude": 39.2})
	if err != nil {
		t.Fatalf("update zone with coords: %v", err)
	}
	if withCoords.Latitude == nil || *withCoords.Latitude != 21.5 {
		t.Fatalf("expected latitude 21.5, got %+v", withCoords.Latitude)
	}

	if _, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Bad", "latitude": 999.0, "longitude": 0.0}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("expected invalid latitude to be rejected, got %v", err)
	}
}

func TestSubZone_RequiresExistingZone(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	if _, err := CreateSubZone(ctx, conn, rc, map[string]any{"zone_id": datactx.NewID(), "name_en": "X", "latitude": 1.0, "longitude": 1.0}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("expected not-found for a missing zone, got %v", err)
	}

	city, err0 := CreateCity(ctx, conn, rc, map[string]any{"case_code": "DM", "name_en": "Dammam"})
	check(t, err0)
	zone, err1 := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Dammam Central"})
	check(t, err1)
	sub, err := CreateSubZone(ctx, conn, rc, map[string]any{"zone_id": zone.ID, "name_en": "Sector 1", "latitude": 26.4, "longitude": 50.1})
	if err != nil {
		t.Fatalf("create sub-zone: %v", err)
	}
	if sub.ZoneID != zone.ID {
		t.Fatalf("unexpected sub-zone: %+v", sub)
	}
}

func TestStandbyPoint_SubZoneMustBeInZone(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	city, err0 := CreateCity(ctx, conn, rc, map[string]any{"case_code": "MK", "name_en": "Makkah"})
	check(t, err0)
	zoneA, err1 := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Zone A"})
	check(t, err1)
	zoneB, err2 := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Zone B"})
	check(t, err2)
	subOfA, err3 := CreateSubZone(ctx, conn, rc, map[string]any{"zone_id": zoneA.ID, "name_en": "Sub of A", "latitude": 1.0, "longitude": 1.0})
	check(t, err3)

	if _, err := CreateStandbyPoint(ctx, conn, rc, map[string]any{"zone_id": zoneB.ID, "sub_zone_id": subOfA.ID, "name_en": "Bad", "latitude": 1.0, "longitude": 1.0, "coverage_radius_m": 500.0}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("expected invalid: sub-zone not in zone, got %v", err)
	}

	point, err := CreateStandbyPoint(ctx, conn, rc, map[string]any{"zone_id": zoneA.ID, "sub_zone_id": subOfA.ID, "name_en": "Good", "latitude": 1.0, "longitude": 1.0, "coverage_radius_m": 500.0})
	if err != nil {
		t.Fatalf("create standby point: %v", err)
	}

	if err := DeleteStandbyPoint(ctx, conn, rc, point.ID); err != nil {
		t.Fatalf("delete standby point: %v", err)
	}
	if _, err := UpdateStandbyPoint(ctx, conn, rc, point.ID, map[string]any{"zone_id": zoneA.ID, "name_en": "Gone", "latitude": 1.0, "longitude": 1.0, "coverage_radius_m": 500.0}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("expected not-found after delete, got %v", err)
	}
}

func TestZoneScopedReads_OnlySeeAssignedZones(t *testing.T) {
	conn := openConn(t)
	admin, tenantID := adminCtx(t)
	ctx := context.Background()

	city, err0 := CreateCity(ctx, conn, admin, map[string]any{"case_code": "TB", "name_en": "Tabuk"})
	check(t, err0)
	zoneA, err1 := CreateZone(ctx, conn, admin, map[string]any{"city_id": city.ID, "name_en": "Zone A"})
	check(t, err1)
	zoneB, err2 := CreateZone(ctx, conn, admin, map[string]any{"city_id": city.ID, "name_en": "Zone B"})
	check(t, err2)

	planner := plannerCtx(tenantID, datactx.NewID(), []string{zoneA.ID})
	zones, err := ListZones(ctx, conn, planner, ZoneQuery{})
	if err != nil {
		t.Fatalf("list zones: %v", err)
	}
	if len(zones.Items) != 1 || zones.Items[0].ID != zoneA.ID {
		t.Fatalf("expected only zone A, got %+v", zones.Items)
	}

	if _, err := GetZone(ctx, conn, planner, zoneB.ID); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("expected not-found for an out-of-scope zone, got %v", err)
	}

	cities, err := ListCities(ctx, conn, planner, CityQuery{})
	if err != nil {
		t.Fatalf("list cities: %v", err)
	}
	if len(cities.Items) != 1 || cities.Items[0].ID != city.ID {
		t.Fatalf("expected the one city reachable via zone A, got %+v", cities.Items)
	}
}

func TestImportLocations_HappyPath(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	existingCity, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "AB", "name_en": "Already there"})
	if err != nil {
		t.Fatalf("seed city: %v", err)
	}

	csv := strings.Join([]string{
		"kind,code,name_en,parent_code,name_ar,latitude,longitude,coverage_radius_m,sub_zone_code",
		"city,QS,Qassim,,,,,,",
		"zone,Q-1,Qassim North,QS,,26.3,43.9,,",
		"zone,AB-1,Already North," + existingCity.CaseCode + ",,24.6,46.7,,",
		"sub_zone,Q-1-S1,Sector 1,Q-1,,26.31,43.91,,",
		"standby_point,SP-1,Point 1,Q-1,,26.32,43.92,750,Q-1-S1",
	}, "\n")

	result, err := ImportLocations(ctx, conn, rc, map[string]any{"file": csv})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.Cities != 1 || result.Zones != 2 || result.SubZones != 1 || result.StandbyPoints != 1 || result.Total != 5 {
		t.Fatalf("unexpected result: %+v", result)
	}

	zones, err := ListZones(ctx, conn, rc, ZoneQuery{})
	if err != nil {
		t.Fatalf("list zones: %v", err)
	}
	if len(zones.Items) != 2 {
		t.Fatalf("expected 2 zones after import, got %d", len(zones.Items))
	}
}

func TestImportLocations_ValidationFailures(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	cases := []struct {
		name string
		csv  string
	}{
		{
			name: "duplicate code in file",
			csv: strings.Join([]string{
				"kind,code,name_en,parent_code",
				"city,QS,Qassim,",
				"city,QS,Qassim Again,",
			}, "\n"),
		},
		{
			name: "unknown parent_code",
			csv: strings.Join([]string{
				"kind,code,name_en,parent_code,latitude,longitude",
				"zone,Z-1,A Zone,NOPE,24.0,46.0",
			}, "\n"),
		},
		{
			name: "sub-zone not in referenced zone",
			csv: strings.Join([]string{
				"kind,code,name_en,parent_code,latitude,longitude,sub_zone_code",
				"city,HL,Hail,,,,",
				"zone,H-1,Zone One,HL,26.0,41.0,",
				"zone,H-2,Zone Two,HL,26.1,41.1,",
				"sub_zone,H-1-S1,Sub One,H-1,26.01,41.01,",
				"standby_point,SPX,Point X,H-2,26.11,41.11,",
			}, "\n"),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			csv := tc.csv
			if tc.name == "sub-zone not in referenced zone" {
				csv = strings.Replace(csv, "standby_point,SPX,Point X,H-2,26.11,41.11,",
					"standby_point,SPX,Point X,H-2,26.11,41.11,500,H-1-S1", 1)
				csv = strings.Replace(csv, "kind,code,name_en,parent_code,latitude,longitude,sub_zone_code",
					"kind,code,name_en,parent_code,latitude,longitude,coverage_radius_m,sub_zone_code", 1)
			}
			if _, err := ImportLocations(ctx, conn, rc, map[string]any{"file": csv}); errCode(err) != dataerr.CodeInvalid {
				t.Fatalf("expected invalid, got %v", err)
			}
		})
	}
}
