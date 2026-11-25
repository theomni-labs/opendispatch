// SPDX-License-Identifier: AGPL-3.0-only

// Service-level target.
package business

import (
	"context"
	"math"
)

const (
	serviceLevelTargetShareKey     = "service_level.target_share"
	defaultServiceLevelTargetShare = 0.95
)

// getServiceLevelTargetShare: the share of field cases to reach in time.
func getServiceLevelTargetShare(ctx context.Context, tenant string) float64 {
	v := readSetting(ctx, tenant, serviceLevelTargetShareKey, defaultServiceLevelTargetShare)
	if math.IsNaN(v) || v <= 0 || v > 1 {
		return defaultServiceLevelTargetShare
	}
	return v
}
