// SPDX-License-Identifier: AGPL-3.0-only

// Live: Make active sets what the forecaster runs.
package business

import (
	"context"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

func TestMakeActiveSetsTheModelTheNextForecastRuns(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	setForecastSetting(t, w.tenantID, KeyChampionModel, DefaultChampionModel, DefaultChampionModel)
	setForecastSetting(t, w.tenantID, KeyChallengerModel, "ensemble-3", "")
	prev := ModelVersion{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: w.tenantID, DataSource: "SYNTHETIC", CreatedAt: datactx.NowISO(), UpdatedAt: datactx.NowISO()}, Version: "ensemble-3", Status: "retired"}
	SeedModelVersionsForTest(prev)
	admin := adminOf(w.tenantID)

	state, err := SwitchModelVersion(admin, prev.ID, map[string]any{"reason": "back to the previous version"})
	check(t, err)
	if state.ActiveVersion != "ensemble-3" {
		t.Fatalf("registry: %+v", state)
	}
	settings, err := GetForecastModelSettings(admin)
	check(t, err)
	if settings.ChampionModel != "ensemble-3" || settings.ChallengerModel != nil {
		t.Fatalf("settings %+v: want champion ensemble-3 and no challenger", settings)
	}
	if got := auditSummaries(t, w, "model.version_switched"); len(got) != 1 || !strings.Contains(got[0], "ensemble-3 made active") {
		t.Fatalf("audit %v", got)
	}

	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: answerAs(w.forecasterAnswer(), "ensemble-3")})
	_, err = CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	reqs := w.srv.Requests()
	if len(reqs) == 0 || !strings.Contains(reqs[0].Body, `"model_version":"ensemble-3"`) {
		t.Fatalf("%d requests; want the forecaster asked for ensemble-3", len(reqs))
	}
}
