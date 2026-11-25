// SPDX-License-Identifier: AGPL-3.0-only

// ops.service_level_simulator HTTP routes.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterSimulationRoutes: runs, results, history.
func RegisterSimulationRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("POST /simulations", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.RunSimulation(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, result)
	})
	mux.HandleFunc("GET /simulations", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListSimulationRuns(r.Context(), conn, rc, business.SimulationRunQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), Date: q.Get("date"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	// Not in the contract: days of case history; body is null with none.
	mux.HandleFunc("GET /simulations/history-range", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetSimulationHistoryRange(rc)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /simulations/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetSimulationRun(r.Context(), conn, rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /simulations/{id}/results", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListSimulationResults(r.Context(), conn, rc, r.PathValue("id"), business.SimulationResultQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), ZoneID: q.Get("zone_id"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
