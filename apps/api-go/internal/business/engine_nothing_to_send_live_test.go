// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
	"time"
)

// end-to-end test: no engine.failed at start
func TestWorkerOnAFreshInstallAsksNoEngineAndAuditsNothing(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	srv := useMockEngines(t, time.Second)
	w := engineWorld{conn: conn, tenantID: tenantID, actors: NewWorkerActors(tenantID), srv: srv}

	cycle := func(stage string) {
		t.Helper()
		report, err := RunWorkerCycle(ctx, conn, w.actors)
		check(t, err)
		if !report.ForecastNoInput || report.ForecastStale || report.ForecastCreated || report.RostersBuilt != 0 || len(report.RostersFailed) != 0 {
			t.Fatalf("%s: got %+v, want the forecast skipped for no input", stage, report)
		}
		if n := len(srv.Requests()); n != 0 {
			t.Fatalf("%s: %d engine calls, want none", stage, n)
		}
		if fails := engineFailures(t, w); len(fails) != 0 {
			t.Fatalf("%s: got engine audit rows %v, want none", stage, fails)
		}
	}
	cycle("empty database")

	fx := seedRosterFixture(t, ctx, conn, rc)
	_, err := CreateSubZone(ctx, conn, rc, map[string]any{"zone_id": fx.zoneID, "name_en": "Sub A", "latitude": 24.7, "longitude": 46.7})
	check(t, err)
	cycle("a zone with no cases")
}
