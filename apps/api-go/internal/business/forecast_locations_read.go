// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"strconv"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// ForecastLocationsParams: the raw query.
type ForecastLocationsParams struct {
	SubZoneID     string
	Hour          string
	DayGroup      string
	Date          string
	ForecastRunID string
}

// GetForecastLocations: getForecastLocations.
func GetForecastLocations(rc reqctx.RequestContext, p ForecastLocationsParams) (ForecastLocationDistribution, error) {
	hour, err := strconv.Atoi(p.Hour)
	if err != nil {
		return ForecastLocationDistribution{}, dataerr.Invalid("hour must be 0 to 23")
	}
	group := p.DayGroup
	if p.Date != "" {
		g, err := DayGroupOf(p.Date)
		if err != nil {
			return ForecastLocationDistribution{}, err
		}
		if group != "" && group != g {
			return ForecastLocationDistribution{}, dataerr.Invalid("day_group and date disagree")
		}
		group = g
	}
	if group == "" {
		return ForecastLocationDistribution{}, dataerr.Invalid("day_group or date is required")
	}
	return GetForecastLocationDistribution(rc, ForecastLocationQuery{ForecastRunID: p.ForecastRunID, SubZoneID: p.SubZoneID, Hour: hour, DayGroup: group})
}
