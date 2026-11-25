// SPDX-License-Identifier: AGPL-3.0-only

// Dashboard and productivity roll-up HTTP routes.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterDashboardsRoutes: both roll-up lists, read only.
func RegisterDashboardsRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /dashboards/rollups", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListDashboardRollups(r.Context(), conn, rc, business.DashboardRollupQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"),
			Level: q.Get("level"), ScopeID: q.Get("scope_id"),
			DateFrom: q.Get("date_from"), DateTo: q.Get("date_to"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /metrics/productivity", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListProductivityRollups(r.Context(), conn, rc, business.ProductivityRollupQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"),
			ZoneID: q.Get("zone_id"), AgentID: q.Get("agent_id"),
			DateFrom: q.Get("date_from"), DateTo: q.Get("date_to"),
			GroupBy: q.Get("group_by"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /metrics/over-capacity", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetOverCapacity(r.Context(), conn, rc, periodQuery(r))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /metrics/override-rate", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetOverrideRate(r.Context(), conn, rc, periodQuery(r))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /metrics/utilization", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetUtilization(r.Context(), conn, rc, periodQuery(r))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /metrics/schedule-adherence", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetScheduleAdherence(r.Context(), conn, rc, periodQuery(r))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /metrics/productivity/durations", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.GetProductivityDurations(r.Context(), conn, rc, business.ProductivityDurationsQuery{
			DateFrom: q.Get("date_from"), DateTo: q.Get("date_to"), AgentID: q.Get("agent_id"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}

// periodQuery: date_from, date_to, zone_id.
func periodQuery(r *http.Request) business.PeriodQuery {
	q := r.URL.Query()
	return business.PeriodQuery{DateFrom: q.Get("date_from"), DateTo: q.Get("date_to"), ZoneID: q.Get("zone_id")}
}
