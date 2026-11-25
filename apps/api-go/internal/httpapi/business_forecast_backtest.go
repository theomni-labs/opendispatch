// SPDX-License-Identifier: AGPL-3.0-only

// Forecast backtest and forecast-against-actual routes.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterForecastBacktestRoutes: backtest, accuracy.
func RegisterForecastBacktestRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /models/backtest", forecastGet(conn, func(_ *http.Request, rc reqctx.RequestContext) (business.BacktestState, error) {
		return business.GetForecastBacktest(rc)
	}))
	mux.HandleFunc("POST /models/backtest", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		state, err := business.StartForecastBacktest(r.Context(), conn, rc)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, state)
	})
	mux.HandleFunc("GET /models/experiments", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (datactx.PageResult[business.ForecastExperiment], error) {
		q := r.URL.Query()
		return business.ListForecastExperiments(rc, datactx.PageQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")})
	}))
	mux.HandleFunc("POST /models/retrain", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		e, err := business.RetrainForecastModel(r.Context(), conn, rc)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, e)
	})
	mux.HandleFunc("GET /forecasts/accuracy", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (business.ForecastAccuracy, error) {
		q := r.URL.Query()
		return business.GetForecastAccuracy(r.Context(), conn, rc, business.ForecastAccuracyQuery{ZoneID: q.Get("zone_id"), Date: q.Get("date")})
	}))
}
