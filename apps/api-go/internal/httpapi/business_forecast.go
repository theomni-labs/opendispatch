// SPDX-License-Identifier: AGPL-3.0-only

// ops.forecast_explorer and admin.forecast_model routes.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func forecastGet[T any](conn *tenancy.Connection, call func(r *http.Request, rc reqctx.RequestContext) (T, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := call(r, rc)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func forecastWrite[T any](conn *tenancy.Connection, status int, call func(r *http.Request, rc reqctx.RequestContext, body any) (T, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := call(r, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, status, result)
	}
}

// RegisterForecastRoutes: runs, values, timeline, split, models.
func RegisterForecastRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /forecasts/runs", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (datactx.PageResult[business.ForecastRun], error) {
		q := r.URL.Query()
		return business.ListForecastRuns(rc, business.ForecastRunQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), Status: q.Get("status")})
	}))
	mux.HandleFunc("POST /forecasts/runs", forecastWrite(conn, http.StatusAccepted, func(r *http.Request, rc reqctx.RequestContext, body any) (business.ForecastRun, error) {
		return business.CreateForecastRun(r.Context(), conn, rc, body)
	}))
	mux.HandleFunc("GET /forecasts/runs/{id}", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (business.ForecastRun, error) {
		return business.GetForecastRun(rc, r.PathValue("id"))
	}))
	mux.HandleFunc("GET /forecasts/values", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (datactx.PageResult[business.ForecastValue], error) {
		q := r.URL.Query()
		return business.ListForecastValues(rc, business.ForecastValueQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), RunID: q.Get("run_id"),
			ZoneID: q.Get("zone_id"), SubZoneID: q.Get("sub_zone_id"), Date: q.Get("date"), IntervalStart: q.Get("interval_start"),
		})
	}))
	mux.HandleFunc("GET /forecasts/timeline", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (business.ForecastTimeline, error) {
		q := r.URL.Query()
		return business.GetForecastTimeline(rc, business.ForecastTimelineQuery{ZoneID: q.Get("zone_id"), Date: q.Get("date"), RunID: q.Get("run_id")})
	}))
	mux.HandleFunc("GET /forecasts/split", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (business.ForecastSplit, error) {
		q := r.URL.Query()
		return business.GetForecastSplit(rc, business.ForecastSplitQuery{ZoneID: q.Get("zone_id"), Date: q.Get("date"), RuleVersionID: q.Get("rule_version_id")})
	}))

	mux.HandleFunc("GET /models", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (datactx.PageResult[business.ModelVersion], error) {
		q := r.URL.Query()
		return business.ListModelVersions(rc, datactx.PageQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")})
	}))
	mux.HandleFunc("GET /models/state", forecastGet(conn, func(_ *http.Request, rc reqctx.RequestContext) (business.ModelState, error) {
		return business.GetModelState(rc)
	}))
	mux.HandleFunc("GET /models/assumptions", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (business.WorkingAssumptions, error) {
		return business.GetWorkingAssumptions(r.Context(), conn, rc)
	}))
	mux.HandleFunc("POST /models/{id}/activate", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.ModelState, error) {
		return business.SwitchModelVersion(rc, r.PathValue("id"), body)
	}))
	mux.HandleFunc("POST /models/pause", forecastWrite(conn, http.StatusOK, func(_ *http.Request, rc reqctx.RequestContext, body any) (business.ModelState, error) {
		return business.PauseModel(rc, body)
	}))
	mux.HandleFunc("POST /models/resume", forecastWrite(conn, http.StatusOK, func(_ *http.Request, rc reqctx.RequestContext, body any) (business.ModelState, error) {
		return business.ResumeModel(rc, body)
	}))
	mux.HandleFunc("GET /models/settings", forecastGet(conn, func(_ *http.Request, rc reqctx.RequestContext) (business.ForecastModelSettings, error) {
		return business.GetForecastModelSettings(rc)
	}))
	mux.HandleFunc("PUT /models/settings", forecastWrite(conn, http.StatusOK, func(_ *http.Request, rc reqctx.RequestContext, body any) (business.ForecastModelSettings, error) {
		return business.UpdateForecastModelSettings(rc, body)
	}))
	mux.HandleFunc("PUT /models/retraining-schedule", forecastWrite(conn, http.StatusOK, func(_ *http.Request, rc reqctx.RequestContext, body any) (business.ModelState, error) {
		return business.UpdateRetrainingSchedule(rc, body)
	}))
}
