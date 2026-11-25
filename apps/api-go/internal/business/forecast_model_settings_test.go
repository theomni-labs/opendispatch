// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

func TestForecastModelSettings_DefaultsAndWrites(t *testing.T) {
	resetModelDeps()
	auditlog.ResetForTest()
	rc, _ := adminCtx(t)
	setForecastSetting(t, rc.CustomerID, KeyChampionModel, DefaultChampionModel, DefaultChampionModel)
	setForecastSetting(t, rc.CustomerID, KeyChallengerModel, "", "")
	setForecastSetting(t, rc.CustomerID, forecastcal.KeyGateBaseline, "", "")

	got, err := GetForecastModelSettings(rc)
	check(t, err)
	if got.ChampionModel != "ensemble-4" || got.ChallengerModel != nil || got.GateBaseline != "segment" || len(got.Models) != 11 {
		t.Fatalf("defaults: got %+v", got)
	}

	got, err = UpdateForecastModelSettings(rc, map[string]any{"challenger_model": "sarima-1"})
	check(t, err)
	if got.ChallengerModel == nil || *got.ChallengerModel != "sarima-1" || challengerModel(context.Background(), rc.CustomerID) != "sarima-1" {
		t.Fatalf("challenger: got %+v", got)
	}
	got, err = UpdateForecastModelSettings(rc, map[string]any{"gate_baseline": "naive"})
	check(t, err)
	if got.GateBaseline != "naive" || gateBaseline(context.Background(), rc.CustomerID) != "naive" || got.ChallengerModel == nil {
		t.Fatalf("baseline: got %+v", got)
	}
	got, err = UpdateForecastModelSettings(rc, map[string]any{"challenger_model": nil})
	check(t, err)
	if got.ChallengerModel != nil || challengerModel(context.Background(), rc.CustomerID) != "" {
		t.Fatalf("none: got %+v", got)
	}

	events := auditlog.AllEvents()
	if len(events) != 3 || events[0].Action != "forecast.model_settings_changed" {
		t.Fatalf("want three audited writes, got %+v", events)
	}
}

func TestForecastModelSettings_Refusals(t *testing.T) {
	resetModelDeps()
	rc, _ := adminCtx(t)
	setForecastSetting(t, rc.CustomerID, KeyChampionModel, DefaultChampionModel, DefaultChampionModel)
	for _, body := range []any{
		map[string]any{},
		map[string]any{"challenger_model": "ensemble-4"},
		map[string]any{"challenger_model": "gpt-9"},
		map[string]any{"gate_baseline": "best"},
		map[string]any{"champion_model": "ensemble-3"},
	} {
		if _, err := UpdateForecastModelSettings(rc, body); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("%v: got %v, want Invalid", body, err)
		}
	}
	viewer := roleCtx(rc.CustomerID, "u2", access.RoleViewerAuditor)
	if _, err := UpdateForecastModelSettings(viewer, map[string]any{"gate_baseline": "naive"}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden for a viewer", err)
	}
}
