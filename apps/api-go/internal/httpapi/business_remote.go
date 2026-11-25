// SPDX-License-Identifier: AGPL-3.0-only

// ops.remote_queue HTTP routes.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterRemoteRoutes: queue, staffing, roster, capacity, productivity.
func RegisterRemoteRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /remote/queue", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListRemoteQueue(rc, business.RemoteQueueQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"),
			ZoneID: q.Get("zone_id"), Status: q.Get("status"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	// Not in the contract: the queue's "as of" moment; body is null with no queue.
	mux.HandleFunc("GET /remote/clock", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetRemoteQueueClock(rc)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /remote/staffing", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetRemoteStaffing(r.Context(), conn, rc, r.URL.Query().Get("date"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /remote/roster", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetRemoteRoster(r.Context(), conn, rc, r.URL.Query().Get("date"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /remote/capacity", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.GetRemoteCapacity(r.Context(), conn, rc, q.Get("date_from"), q.Get("date_to"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /remote/productivity", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.GetRemoteProductivity(r.Context(), conn, rc, q.Get("date_from"), q.Get("date_to"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /remote/queue/{id}/assign", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.AssignRemoteReviewer(r.Context(), conn, rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
