// SPDX-License-Identifier: AGPL-3.0-only

// admin.leave_policy_calendar / platform.records HTTP routes.
// Matches openapi.yaml; calls internal/business. Holidays and the
// leave policy only; Hijri and prayer routes: business_time.go.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterLeaveCalendarRoutes: holidays, the leave policy.
func RegisterLeaveCalendarRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	business.UseCalendarZones(conn)
	mux.HandleFunc("GET /holidays", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListHolidays(r.Context(), conn, rc, business.HolidayQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), DateFrom: q.Get("date_from"), DateTo: q.Get("date_to")})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /holidays", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.CreateHoliday(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("PUT /holidays/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.UpdateHoliday(r.Context(), conn, rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("DELETE /holidays/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		if err := business.DeleteHoliday(r.Context(), conn, rc, r.PathValue("id")); err != nil {
			writeBusinessError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("GET /calendar-events", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListCalendarEvents(rc, q.Get("from"), q.Get("to"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /calendar-events", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.CreateCalendarEvent(rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("PUT /calendar-events/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.UpdateCalendarEvent(rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("DELETE /calendar-events/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		if err := business.DeleteCalendarEvent(rc, r.PathValue("id")); err != nil {
			writeBusinessError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("PUT /settings/payday-day", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.UpdatePaydayDay(rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("GET /leave-policy", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetLeavePolicy(rc)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("PUT /leave-policy", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.UpdateLeavePolicy(rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
