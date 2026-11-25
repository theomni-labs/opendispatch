// SPDX-License-Identifier: AGPL-3.0-only

// One travel model for every engine.
package business

import (
	"context"
	"math"
)

const (
	travelSpeedKey       = "travel_model.average_speed_kmh"
	travelDetourKey      = "travel_model.detour_factor"
	defaultTravelSpeed   = 40.0
	defaultTravelDetour  = 1.3
	maxTravelSpeedKmh    = 200.0
	maxTravelDetour      = 3.0
	minTravelDetour      = 1.0
	travelSecondsPerHour = 3600.0
)

// travelModel mirrors the engines' travel_model.
type travelModel struct {
	AverageSpeedKmh float64 `json:"average_speed_kmh"`
	DetourFactor    float64 `json:"detour_factor"`
}

// getTravelModel: the settings, defaults when invalid.
func getTravelModel(ctx context.Context, tenant string) travelModel {
	speed := readSetting(ctx, tenant, travelSpeedKey, defaultTravelSpeed)
	if math.IsNaN(speed) || speed <= 0 || speed > maxTravelSpeedKmh {
		speed = defaultTravelSpeed
	}
	detour := readSetting(ctx, tenant, travelDetourKey, defaultTravelDetour)
	if math.IsNaN(detour) || detour < minTravelDetour || detour > maxTravelDetour {
		detour = defaultTravelDetour
	}
	return travelModel{AverageSpeedKmh: speed, DetourFactor: detour}
}

// reachMetres: straight-line metres within seconds.
func (m travelModel) reachMetres(seconds int) float64 {
	return m.AverageSpeedKmh * 1000 / travelSecondsPerHour * float64(seconds) / m.DetourFactor
}

// minutesFor: travel minutes for straight metres.
func (m travelModel) minutesFor(metres float64) float64 {
	return metres * m.DetourFactor / (m.AverageSpeedKmh * 1000 / travelSecondsPerHour) / 60
}

// travelPtr: the tenant's model, for a request.
func travelPtr(ctx context.Context, tenant string) *travelModel {
	m := getTravelModel(ctx, tenant)
	return &m
}
