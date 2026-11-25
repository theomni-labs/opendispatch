// SPDX-License-Identifier: AGPL-3.0-only

// Forecast Explorer: why a forecast, and where.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterForecastInsightRoutes: why, where.
func RegisterForecastInsightRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /forecasts/explanation", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (business.ForecastExplanation, error) {
		q := r.URL.Query()
		return business.GetForecastExplanation(rc, business.ForecastExplanationQuery{ZoneID: q.Get("zone_id"), Date: q.Get("date"), RunID: q.Get("run_id")})
	}))
	mux.HandleFunc("GET /forecasts/locations", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (business.ForecastLocationDistribution, error) {
		q := r.URL.Query()
		return business.GetForecastLocations(rc, business.ForecastLocationsParams{SubZoneID: q.Get("sub_zone_id"), Hour: q.Get("hour"),
			DayGroup: q.Get("day_group"), Date: q.Get("date"), ForecastRunID: q.Get("forecast_run_id")})
	}))
}
