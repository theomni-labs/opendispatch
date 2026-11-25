// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"fmt"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// EngineStatusItem is one engine status row.
type EngineStatusItem struct {
	Engine       string  `json:"engine"`
	Mode         string  `json:"mode"`
	BreakerState string  `json:"breaker_state"`
	Calls        uint64  `json:"calls"`
	Failures     uint64  `json:"failures"`
	Timeouts     uint64  `json:"timeouts"`
	BreakerOpens uint64  `json:"breaker_opens"`
	Rejected     uint64  `json:"rejected"`
	Fallbacks    int     `json:"fallbacks"`
	ModelVersion *string `json:"model_version"`
	LastFailure  *string `json:"last_failure_at"`
}

// EngineStatusDoc mirrors the contract type.
type EngineStatusDoc struct {
	AsOf  string             `json:"as_of"`
	Items []EngineStatusItem `json:"items"`
}

// enginesBreakerTripped: a breaker is open or half-open.
func enginesBreakerTripped(tenant string) bool {
	for _, st := range EngineStatuses(tenant) {
		if st.Mode == engines.ModeEngine && (st.Stats.State == engines.Open || st.Stats.State == engines.HalfOpen) {
			return true
		}
	}
	return false
}

// GetEngineStatuses lists the engines' counters.
func GetEngineStatuses(ctx reqctx.RequestContext) (EngineStatusDoc, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminSystemHealth, access.AccessView); err != nil {
		return EngineStatusDoc{}, err
	}
	items := []EngineStatusItem{}
	for _, st := range EngineStatuses(ctx.CustomerID) {
		it := EngineStatusItem{
			Engine: string(st.Name), Mode: string(st.Mode), BreakerState: string(engines.Closed), Calls: st.Stats.Calls, Failures: st.Stats.Failures,
			Timeouts: st.Stats.Timeouts, BreakerOpens: st.Stats.BreakerOpens, Rejected: st.Stats.Rejected, Fallbacks: st.Fallbacks,
		}
		if st.Stats.State != "" {
			it.BreakerState = string(st.Stats.State)
		}
		if st.Model != "" {
			m := st.Model
			it.ModelVersion = &m
		}
		if !st.Stats.LastFailure.IsZero() {
			f := datactx.ToRiyadhISO(st.Stats.LastFailure)
			it.LastFailure = &f
		}
		items = append(items, it)
	}
	return EngineStatusDoc{AsOf: datactx.NowISO(), Items: items}, nil
}

// enginesComponent: the System Health tile's status and detail.
func enginesComponent(tenant string) (string, string) {
	all := EngineStatuses(tenant)
	on := 0
	for _, st := range all {
		if st.Mode == engines.ModeEngine {
			on++
		}
	}
	detail := "Fixture models"
	if on > 0 {
		detail = fmt.Sprintf("%d of %d engines on", on, len(all))
	}
	if enginesBreakerTripped(tenant) {
		return "degraded", detail + "; an engine breaker is open or half-open, " + customerEn() + " dispatch covers"
	}
	return "ok", detail
}
