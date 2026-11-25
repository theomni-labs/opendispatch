// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

// ForecastModels: the registered models.
var ForecastModels = []string{"ensemble-6", "ensemble-5", "ensemble-4", "ensemble-3", "ensemble-2", "seasonal-profile-1", "lightgbm-1", "ets-1", "sarima-1", "prophet-1", "mlp-1"}

var gateBaselines = []string{"segment", "naive"}

// ForecastModelSettings: the contract type.
type ForecastModelSettings struct {
	ChampionModel   string   `json:"champion_model"`
	ChallengerModel *string  `json:"challenger_model"`
	GateBaseline    string   `json:"gate_baseline"`
	Models          []string `json:"models"`
	// HorizonDays: forecast.horizon_days, 7 to 30.
	HorizonDays int `json:"horizon_days"`
	// AutoRetrain: forecast.auto_retrain.
	AutoRetrain bool `json:"auto_retrain"`
}

func forecastModelSettings(ctx context.Context, tenant string) ForecastModelSettings {
	out := ForecastModelSettings{ChampionModel: championModel(ctx, tenant), GateBaseline: gateBaseline(ctx, tenant), Models: append([]string(nil), ForecastModels...),
		HorizonDays: forecastHorizonDays(ctx, tenant), AutoRetrain: autoRetrain(ctx, tenant)}
	if ch := challengerModel(ctx, tenant); ch != "" {
		out.ChallengerModel = &ch
	}
	return out
}

// GetForecastModelSettings reads them.
func GetForecastModelSettings(rc reqctx.RequestContext) (ForecastModelSettings, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminForecastModel, access.AccessView); err != nil {
		return ForecastModelSettings{}, err
	}
	return forecastModelSettings(context.Background(), rc.CustomerID), nil
}

// parseChallenger: "" is none.
func parseChallenger(ctx context.Context, tenant string, v any) (string, error) {
	if v == nil {
		return "", nil
	}
	s, ok := v.(string)
	if !ok {
		return "", dataerr.Invalid("Input: challenger_model must be a model name or null.")
	}
	for _, m := range ForecastModels {
		if m == s {
			if s == championModel(ctx, tenant) {
				return "", dataerr.Invalid("Input: challenger_model cannot be the champion.")
			}
			return s, nil
		}
	}
	return "", dataerr.Invalid("Input: challenger_model must be one of " + strings.Join(ForecastModels, ", ") + ".")
}

// makeChampion: the forecaster runs this version.
func makeChampion(ctx context.Context, tenant, version string) (string, error) {
	known := false
	for _, m := range ForecastModels {
		known = known || m == version
	}
	if !known {
		return championModel(ctx, tenant), nil
	}
	kvs := []settingsstore.KV{{Key: KeyChampionModel, Value: version}}
	if challengerModel(ctx, tenant) == version {
		kvs = append(kvs, settingsstore.KV{Key: KeyChallengerModel, Value: ""})
	}
	if err := settingsstore.PutMany(ctx, tenant, kvs...); err != nil {
		return "", err
	}
	return version, nil
}

func onOff(b bool) string {
	if b {
		return "on"
	}
	return "off"
}

func orNone(s string) string {
	if s == "" {
		return "none"
	}
	return s
}

// UpdateForecastModelSettings writes both.
func UpdateForecastModelSettings(rc reqctx.RequestContext, body any) (ForecastModelSettings, error) {
	type out = auditlog.AuditedWrite[ForecastModelSettings]
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, auditlog.WriteMeta{Action: "forecast.model_settings_changed", EntityType: "setting", EntityID: strPtr("forecast_models")}, func(ctx context.Context) (out, error) {
		input, err := datactx.Object(body, "Forecast model settings", []string{"challenger_model", "gate_baseline", "horizon_days", "auto_retrain"})
		if err != nil {
			return out{}, err
		}
		if len(input) == 0 {
			return out{}, dataerr.Invalid("Forecast model settings: nothing to change.")
		}
		tenant := rc.CustomerID
		var kvs []settingsstore.KV
		var lines []string
		detail := map[string]any{}
		if datactx.Has(input, "challenger_model") {
			next, err := parseChallenger(ctx, tenant, input["challenger_model"])
			if err != nil {
				return out{}, err
			}
			before := challengerModel(ctx, tenant)
			kvs = append(kvs, settingsstore.KV{Key: KeyChallengerModel, Value: next})
			lines = append(lines, fmt.Sprintf("Challenger changed from %s to %s.", orNone(before), orNone(next)))
			detail["challenger_model"] = map[string]any{"from": orNone(before), "to": orNone(next)}
		}
		if datactx.Has(input, "gate_baseline") {
			next, err := datactx.EnumOf(input, "gate_baseline", gateBaselines)
			if err != nil {
				return out{}, err
			}
			if err := forecastcal.ValidateSetting(forecastcal.KeyGateBaseline, next); err != nil {
				return out{}, dataerr.Invalid(err.Error())
			}
			before := gateBaseline(ctx, tenant)
			kvs = append(kvs, settingsstore.KV{Key: forecastcal.KeyGateBaseline, Value: next})
			lines = append(lines, fmt.Sprintf("Backtest gate baseline changed from %s to %s.", before, next))
			detail["gate_baseline"] = map[string]any{"from": before, "to": next}
		}
		if datactx.Has(input, "horizon_days") {
			next, err := datactx.Int(input, "horizon_days", datactx.NumOpts{Min: forecastcal.MinHorizonDays, HasMin: true, Max: forecastcal.MaxHorizonDays, HasMax: true})
			if err != nil {
				return out{}, err
			}
			before := forecastHorizonDays(ctx, tenant)
			kvs = append(kvs, settingsstore.KV{Key: forecastcal.KeyHorizonDays, Value: next})
			lines = append(lines, fmt.Sprintf("Forecast horizon changed from %d to %d days.", before, next))
			detail["horizon_days"] = map[string]any{"from": before, "to": next}
		}
		if datactx.Has(input, "auto_retrain") {
			next, ok := input["auto_retrain"].(bool)
			if !ok {
				return out{}, dataerr.Invalid("Input: auto_retrain must be true or false.")
			}
			before := autoRetrain(ctx, tenant)
			kvs = append(kvs, settingsstore.KV{Key: KeyAutoRetrain, Value: next})
			lines = append(lines, fmt.Sprintf("Retrain on degradation changed from %s to %s.", onOff(before), onOff(next)))
			detail["auto_retrain"] = map[string]any{"from": before, "to": next}
		}
		if err := settingsstore.PutMany(ctx, tenant, kvs...); err != nil {
			return out{}, err
		}
		return out{Result: forecastModelSettings(ctx, tenant), SummaryEn: strings.Join(lines, " "), Detail: detail}, nil
	})
}
