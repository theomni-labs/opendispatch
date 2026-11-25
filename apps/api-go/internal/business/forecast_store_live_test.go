// SPDX-License-Identifier: AGPL-3.0-only

// Live: forecast runs and values kept in Postgres.
package business

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func newZoneOf(t *testing.T, owner *pgxpool.Pool, tenant string) (zone, sub string) {
	t.Helper()
	ctx := context.Background()
	var city string
	if err := owner.QueryRow(ctx, `INSERT INTO cities (tenant_id, data_source, name_en) VALUES ($1, 'SYNTHETIC', 'C') RETURNING id::text`, tenant).Scan(&city); err != nil {
		t.Fatal(err)
	}
	if err := owner.QueryRow(ctx, `INSERT INTO zones (tenant_id, data_source, city_id, name_en) VALUES ($1, 'SYNTHETIC', $2, 'Z') RETURNING id::text`, tenant, city).Scan(&zone); err != nil {
		t.Fatal(err)
	}
	if err := owner.QueryRow(ctx, `INSERT INTO sub_zones (tenant_id, data_source, zone_id, name_en) VALUES ($1, 'SYNTHETIC', $2, 'S') RETURNING id::text`, tenant, zone).Scan(&sub); err != nil {
		t.Fatal(err)
	}
	return zone, sub
}

func testRun(tenant string) ForecastRun {
	at := datactx.ToRiyadhISO(time.Now())
	eng := "0.1.0"
	return ForecastRun{
		BaseRecord:   datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenant, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
		ModelVersion: "none", EngineVersion: &eng, Status: "succeeded", HorizonStartDate: "2026-10-02", HorizonDays: 1, RangeCoverage: 0.8,
		Illustrative: true, InputDataSources: []string{"SYNTHETIC"}, StartedAt: &at, FinishedAt: &at,
	}
}

func TestPostgresForecastRunsSurviveARestartAndStayPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresForecast(conn)
	t.Cleanup(UseMemoryForecast)
	a, b := freshTenant(), freshTenant()
	run := testRun(a)
	if err := forecastRunBackendInUse.save(context.Background(), a, run); err != nil {
		t.Fatal(err)
	}
	run.Status = "failed"
	if err := forecastRunBackendInUse.save(context.Background(), a, run); err != nil {
		t.Fatal(err)
	}
	UseMemoryForecast()
	UsePostgresForecast(conn)
	got, err := loadForecastRun(context.Background(), a, run.ID, true)
	if err != nil || got == nil || got.Status != "failed" || got.HorizonStartDate != "2026-10-02" || got.RangeCoverage != 0.8 || len(got.InputDataSources) != 1 || got.StartedAt == nil {
		t.Fatalf("after a restart: %+v %v", got, err)
	}
	if latest, _ := loadLatestForecastRun(context.Background(), a, true); latest != nil {
		t.Fatalf("a failed run is not the latest succeeded run: %+v", latest)
	}
	if rows, err := loadForecastRuns(context.Background(), b, true); err != nil || len(rows) != 0 {
		t.Fatalf("another customer sees %d runs (%v)", len(rows), err)
	}
}

func TestPostgresForecastValuesReadByRunZoneAndDay(t *testing.T) {
	conn := settingsConn(t)
	owner := ownerPool(t)
	UsePostgresForecast(conn)
	t.Cleanup(UseMemoryForecast)
	a, b := freshTenant(), freshTenant()
	zone, sub := newZoneOf(t, owner, a)
	run := testRun(a)
	if err := forecastRunBackendInUse.save(context.Background(), a, run); err != nil {
		t.Fatal(err)
	}
	var rows []ForecastValue
	for day, date := range []string{"2026-10-02", "2026-10-03"} {
		for i := 0; i < 96; i++ {
			at := intervalStartOf(date, i)
			rows = append(rows, ForecastValue{
				BaseRecord:    datactx.BaseRecord{ID: datactx.NewID(), TenantID: a, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
				ForecastRunID: run.ID, ZoneID: zone, SubZoneID: sub, IntervalStart: at, IntervalIndex: i, Low: 1, Expected: float64(i) + 0.5 + float64(day), High: 9, FieldExpected: 1.25, RemoteInferredExpected: 0.25,
			})
		}
	}
	if err := insertForecastValues(context.Background(), &tenancy.Connection{Pool: owner}, a, rows); err != nil {
		t.Fatal(err)
	}
	index, err := indexStored(context.Background(), a)
	if err != nil {
		t.Fatal(err)
	}
	got, err := index.Rows(run.ID, zone, "2026-10-03")
	if err != nil || len(got) != 96 || got[5].IntervalIndex != 5 || got[5].Expected != 6.5 || got[5].SubZoneID != sub || got[5].IntervalStart != "2026-10-03T01:15:00+03:00" {
		t.Fatalf("one day of one zone: %d rows, %v, %+v", len(got), err, got)
	}
	dates, err := index.datesByRun()
	if err != nil || len(dates[run.ID]) != 2 || dates[run.ID][0] != "2026-10-02" {
		t.Fatalf("dates %v %v", dates, err)
	}
	if none, _ := index.Rows(run.ID, zone, "2026-10-04"); len(none) != 0 {
		t.Fatal("a day with no values must be empty")
	}
	other, err := indexStored(context.Background(), b)
	if err != nil {
		t.Fatal(err)
	}
	if rows, _ := other.Rows(run.ID, zone, "2026-10-03"); len(rows) != 0 {
		t.Fatalf("another customer sees %d values", len(rows))
	}
}

func TestPostgresForecastValuesAreAllOrNothing(t *testing.T) {
	conn := settingsConn(t)
	owner := ownerPool(t)
	UsePostgresForecast(conn)
	t.Cleanup(UseMemoryForecast)
	a := freshTenant()
	zone, sub := newZoneOf(t, owner, a)
	run := testRun(a)
	if err := forecastRunBackendInUse.save(context.Background(), a, run); err != nil {
		t.Fatal(err)
	}
	at := intervalStartOf("2026-10-02", 0)
	good := ForecastValue{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: a, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"}, ForecastRunID: run.ID, ZoneID: zone, SubZoneID: sub, IntervalStart: at}
	bad := good
	bad.ID, bad.ZoneID = datactx.NewID(), datactx.NewID()
	if err := insertForecastValues(context.Background(), &tenancy.Connection{Pool: owner}, a, []ForecastValue{good, bad}); err == nil {
		t.Fatal("a row pointing at no zone must fail")
	}
	index, _ := indexStored(context.Background(), a)
	if rows, _ := index.Rows(run.ID, zone, "2026-10-02"); len(rows) != 0 {
		t.Fatalf("a failed batch left %d rows", len(rows))
	}
}

func TestReseedForecastPutsTheFixturesBack(t *testing.T) {
	conn := settingsConn(t)
	owner := ownerPool(t)
	UsePostgresForecast(conn)
	t.Cleanup(UseMemoryForecast)
	if err := ReseedForecastForTest(context.Background(), &tenancy.Connection{Pool: owner}); err != nil {
		t.Fatal(err)
	}
	want, err := fixtures.Records[ForecastValue]("ForecastValue")
	if err != nil || len(want) == 0 {
		t.Fatalf("fixture forecast values: %d (%v)", len(want), err)
	}
	var n int
	if err := owner.QueryRow(context.Background(), `SELECT count(*) FROM forecast_values`).Scan(&n); err != nil || n < len(want) {
		t.Fatalf("forecast_values holds %d rows, want at least the %d fixture rows (%v)", n, len(want), err)
	}
}
