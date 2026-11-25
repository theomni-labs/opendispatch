// SPDX-License-Identifier: AGPL-3.0-only

// admin.audit_log HTTP routes: the events Go keeps in Postgres.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterAuditRoutes: reads only (append only log).
func RegisterAuditRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /audit-events", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListAuditEvents(rc, business.AuditFilter{
			Limit:        parseLimit(q.Get("limit")),
			Cursor:       q.Get("cursor"),
			From:         q.Get("from"),
			To:           q.Get("to"),
			DataSource:   q.Get("data_source"),
			Action:       q.Get("action"),
			EntityType:   q.Get("entity_type"),
			EntityID:     q.Get("entity_id"),
			ActorUserID:  q.Get("actor_user_id"),
			Outcome:      q.Get("outcome"),
			ActionPrefix: q.Get("action_prefix"),
			Q:            q.Get("q"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /audit-events/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetAuditEvent(rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
