// SPDX-License-Identifier: AGPL-3.0-only

// Live: the forecast functions over the Postgres stores.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
)

func TestPostgresForecastThroughTheBusinessFunctions(t *testing.T) {
	conn := openConn(t)
	ctx := context.Background()
	resetModelDeps()
	ReloadFieldShareZonesForTest()
	t.Cleanup(ResetFieldShareForTest)
	UsePostgresForecast(conn)
	t.Cleanup(UseMemoryForecast)
	rc, _ := adminCtx(t)
	tenant, err := fixtures.TenantID()
	check(t, err)
	rc.CustomerID = tenant
	run, err := CreateForecastRun(ctx, conn, rc, map[string]any{"horizon_start_date": "2026-09-14", "horizon_days": 1.0})
	check(t, err)
	UseMemoryForecast()
	UsePostgresForecast(conn)
	got, err := GetForecastRun(rc, run.ID)
	check(t, err)
	if got.ID != run.ID || got.Status != "succeeded" {
		t.Fatalf("after a restart: %+v", got)
	}
	page, err := ListForecastRuns(rc, ForecastRunQuery{Limit: 50})
	check(t, err)
	if len(page.Items) == 0 {
		t.Fatal("the list reads no runs")
	}
	values, err := ListForecastValues(rc, ForecastValueQuery{Limit: 200, RunID: run.ID, Date: "2026-09-14"})
	check(t, err)
	if len(values.Items) == 0 {
		t.Fatal("values are derived from the reference run, got none")
	}
}
