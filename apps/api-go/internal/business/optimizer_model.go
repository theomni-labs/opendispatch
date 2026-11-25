// SPDX-License-Identifier: AGPL-3.0-only

// The optimizer model setting.
package business

import (
	"context"
	"fmt"
	"math"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

const (
	optimizerModelKey       = "planning.optimizer_model"
	defaultOptimizerModel   = "cpsat-1"
	optimizerSecondsKey     = "planning.optimizer_max_run_seconds"
	defaultOptimizerSeconds = 10
	maxOptimizerSeconds     = 600
)

// OptimizerModels: what the engine accepts.
var OptimizerModels = []string{defaultOptimizerModel, "greedy-ls-0.3", "greedy-ls-0.2", "greedy-ls-0.1"}

func validOptimizerModel(v any) bool {
	s, ok := v.(string)
	return ok && containsStr(OptimizerModels, s)
}

// getOptimizerModel: stored, else default.
func getOptimizerModel(ctx context.Context, tenant string) string {
	v := readSetting(ctx, tenant, optimizerModelKey, defaultOptimizerModel)
	if !validOptimizerModel(v) {
		return defaultOptimizerModel
	}
	return v
}

// optimizerSeconds: a whole number in range.
func optimizerSeconds(v any) (int, bool) {
	n, ok := v.(float64)
	if i, isInt := v.(int); isInt {
		n, ok = float64(i), true
	}
	if !ok || n != math.Trunc(n) || n < 1 || n > maxOptimizerSeconds {
		return 0, false
	}
	return int(n), true
}

// getOptimizerSeconds: time limit per request.
func getOptimizerSeconds(ctx context.Context, tenant string) int {
	if n, ok := optimizerSeconds(readSetting[any](ctx, tenant, optimizerSecondsKey, nil)); ok {
		return n
	}
	return defaultOptimizerSeconds
}

// validOptimizerSetting: raw writes of the key.
func validOptimizerSetting(key string, value any) error {
	if key == optimizerModelKey && !validOptimizerModel(value) {
		return fmt.Errorf("%s must be one of %v", key, OptimizerModels)
	}
	if _, ok := optimizerSeconds(value); key == optimizerSecondsKey && !ok {
		return fmt.Errorf("%s must be a whole number from 1 to %d", key, maxOptimizerSeconds)
	}
	return nil
}

// UpdateOptimizerModel sets the model, audited.
func UpdateOptimizerModel(rc reqctx.RequestContext, body any) (SettingsSnapshot, error) {
	type out = auditlog.AuditedWrite[SettingsSnapshot]
	meta := auditlog.WriteMeta{Action: "settings.optimizer_model_changed", EntityType: "setting", EntityID: strPtr(optimizerModelKey)}
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, meta, func(ctx context.Context) (out, error) {
		input, err := datactx.Object(body, "Optimizer model", []string{"optimizer_model"})
		if err != nil {
			return out{}, err
		}
		next, err := datactx.EnumOf(input, "optimizer_model", OptimizerModels)
		if err != nil {
			return out{}, err
		}
		before := getOptimizerModel(ctx, rc.CustomerID)
		if err := settingsstore.Put(ctx, rc.CustomerID, optimizerModelKey, next); err != nil {
			return out{}, err
		}
		snap, err := settingsSnapshot(ctx, rc)
		if err != nil {
			return out{}, err
		}
		return out{
			Result: snap, SummaryEn: fmt.Sprintf("Optimizer model changed from %s to %s.", before, next),
			Detail: sumDetail(map[string]any{"from": before, "to": next}, map[string]any{"from": before, "to": next}),
		}, nil
	})
}
