// SPDX-License-Identifier: AGPL-3.0-only

// platform.records HTTP routes for Case/CaseType.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func caseFilterOf(q url.Values) business.CaseFilter {
	var ids []string
	if q.Has("ids") {
		ids = strings.Split(q.Get("ids"), ",")
	}
	return business.CaseFilter{
		IDs:   ids,
		Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"),
		ZoneID: q.Get("zone_id"), SubZoneID: q.Get("sub_zone_id"), CityID: q.Get("city_id"),
		DateFrom: q.Get("date_from"), DateTo: q.Get("date_to"), DataSource: q.Get("data_source"),
		Q: q.Get("q"), Handling: q.Get("handling"), CaseTypeID: q.Get("case_type_id"),
	}
}

// RegisterCasesRoutes: cases and case types, read only.
func RegisterCasesRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /cases", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.ListCases(r.Context(), conn, rc, caseFilterOf(r.URL.Query()))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	// Not in the contract: every matching case, unpaginated (mirrors listAllCases,
	// which callers that would otherwise page listCases in a loop use instead).
	mux.HandleFunc("GET /cases/all", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.ListAllCases(r.Context(), conn, rc, caseFilterOf(r.URL.Query()))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /cases/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetCase(r.Context(), conn, rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /case-types", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListCaseTypes(r.Context(), conn, rc, datactx.PageQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
