// SPDX-License-Identifier: AGPL-3.0-only

// Distance limit from the home dispatch center.
package business

import (
	"context"
	"fmt"
	"math"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

const (
	maxDeployDistanceKey   = "planning.max_deploy_distance_km"
	defaultMaxDeployDistKm = 15.0
	maxDeployDistCapKm     = 500.0
)

// getMaxDeployDistanceKm: the limit, default when invalid.
func getMaxDeployDistanceKm(ctx context.Context, tenant string) float64 {
	v := readSetting(ctx, tenant, maxDeployDistanceKey, defaultMaxDeployDistKm)
	if math.IsNaN(v) || v <= 0 || v > maxDeployDistCapKm {
		return defaultMaxDeployDistKm
	}
	return v
}

// optHome: dispatch_centres in the request.
type optHome struct {
	ZoneID string  `json:"zone_id"`
	Lat    float64 `json:"latitude"`
	Lon    float64 `json:"longitude"`
}

// dispatchCentresOf: the zone's home point, if known.
func dispatchCentresOf(s optimizerSource) []optHome {
	if s.Home == nil || s.Home.ID != s.ZoneID || s.Home.Latitude == nil || s.Home.Longitude == nil || s.DeployLimitKm <= 0 {
		return nil
	}
	return []optHome{{ZoneID: s.ZoneID, Lat: *s.Home.Latitude, Lon: *s.Home.Longitude}}
}

// homeDistanceKm: a point's distance from the zone home.
func homeDistanceKm(z standbyZone, lat, lon float64) (float64, bool) {
	if z.Latitude == nil || z.Longitude == nil {
		return 0, false
	}
	return distanceMeters(*z.Latitude, *z.Longitude, lat, lon) / 1000, true
}

// beyondDeployLimit: true when the point cannot host.
func beyondDeployLimit(z standbyZone, p standbyPoint, limitKm float64) bool {
	km, ok := homeDistanceKm(z, p.Latitude, p.Longitude)
	return ok && km > limitKm
}

// markDeployDistance adds distances to a coverage view.
func markDeployDistance(view *Coverage, d standbyData, z standbyZone, limitKm float64) {
	view.MaxDeployDistanceKm = &limitKm
	byID := map[string]standbyPoint{}
	for _, p := range d.activePoints(z.ID) {
		byID[p.ID] = p
	}
	for i := range view.Areas {
		p, ok := byID[view.Areas[i].StandbyPointID]
		if !ok {
			continue
		}
		if km, ok := homeDistanceKm(z, p.Latitude, p.Longitude); ok {
			rounded := math.Round(km*10) / 10
			beyond := km > limitKm
			view.Areas[i].HomeDistanceKm, view.Areas[i].BeyondDeployLimit = &rounded, &beyond
		}
	}
}

// deployLimitErr: why a point cannot host the zone.
func deployLimitErr(z standbyZone, p standbyPoint, limitKm float64) error {
	km, _ := homeDistanceKm(z, p.Latitude, p.Longitude)
	return dataerr.Invalid(fmt.Sprintf("Standby move: %s is %.1f km from the dispatch centre of %s, beyond the %g km limit.", p.NameEn, km, z.NameEn, limitKm))
}
