// SPDX-License-Identifier: AGPL-3.0-only

// ops.standby_coverage HTTP routes.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func coverageQueryOf(r *http.Request) business.CoverageQuery {
	q := r.URL.Query()
	var out business.CoverageQuery
	if q.Has("zone_id") {
		v := q.Get("zone_id")
		out.ZoneID = &v
	}
	if q.Has("date") {
		v := q.Get("date")
		out.Date = &v
	}
	return out
}

// RegisterStandbyRoutes: coverage, moves.
func RegisterStandbyRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /coverage", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetCoverage(rc, coverageQueryOf(r))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	// Not in the contract: suggested standby moves.
	mux.HandleFunc("GET /coverage/recommendations", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.RecommendStandbyMoves(rc, coverageQueryOf(r))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	// Not in the contract: apply one move to a draft roster.
	mux.HandleFunc("POST /coverage/moves", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.ApplyStandbyMove(rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
