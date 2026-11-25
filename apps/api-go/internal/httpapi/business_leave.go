// SPDX-License-Identifier: AGPL-3.0-only

// ops.leave_planner HTTP routes.
// Matches openapi.yaml; calls internal/business. The batch coverage-
// effects endpoint isn't in the contract (same as TS's own
// getLeaveCoverageEffects): a custom route avoids the N+1 CONTRIBUTING.md
// flags (one loadPlan shared across every row, not one per row).
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterLeaveRoutes: leave requests, coverage effect, decide, windows.
func RegisterLeaveRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /leave-requests", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListLeaveRequests(r.Context(), conn, rc, business.LeaveRequestQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), ZoneID: q.Get("zone_id"),
			DateFrom: q.Get("date_from"), DateTo: q.Get("date_to"), Status: q.Get("status"), AgentID: q.Get("agent_id"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /leave-requests", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.CreateLeaveRequest(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("GET /leave-requests/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetLeaveRequest(r.Context(), conn, rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /leave-requests/{id}/coverage-effect", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetLeaveCoverageEffect(r.Context(), conn, rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /leave-requests/coverage-effects", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeBody(w, r)
		if !ok {
			return
		}
		rawIDs, _ := body["ids"].([]any)
		ids := make([]string, len(rawIDs))
		for i, raw := range rawIDs {
			s, ok := raw.(string)
			if !ok {
				writeBusinessError(w, dataerr.Invalid("ids must be a list of strings."))
				return
			}
			ids[i] = s
		}
		result, err := business.GetLeaveCoverageEffects(r.Context(), conn, rc, ids)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /leave-requests/{id}/approve", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.ApproveLeaveRequest(r.Context(), conn, rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /leave-requests/{id}/decline", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.DeclineLeaveRequest(r.Context(), conn, rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("GET /leave/outlook", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.GetLeaveOutlook(r.Context(), conn, rc, business.LeaveOutlookQuery{ZoneID: q.Get("zone_id"), Weeks: q.Get("weeks")})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("GET /leave/windows", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListLeaveWindows(r.Context(), conn, rc, business.LeaveWindowQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), ZoneID: q.Get("zone_id"), DateFrom: q.Get("date_from"), DateTo: q.Get("date_to"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
