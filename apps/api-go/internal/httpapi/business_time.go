// SPDX-License-Identifier: AGPL-3.0-only

// platform.records / admin.leave_policy_calendar routes for
// Hijri months and prayer times. Matches openapi.yaml.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterTimeRoutes: Hijri months, prayer times.
func RegisterTimeRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /hijri-months", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListHijriMonths(rc, business.HijriMonthQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), DateFrom: q.Get("date_from"), DateTo: q.Get("date_to")})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /prayer-times", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListPrayerTimes(r.Context(), conn, rc, business.PrayerTimeQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), CityID: q.Get("city_id"), DateFrom: q.Get("date_from"), DateTo: q.Get("date_to")})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /prayer-times/recompute", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.RecomputePrayerTimes(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
