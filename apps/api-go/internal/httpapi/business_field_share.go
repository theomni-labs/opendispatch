// SPDX-License-Identifier: AGPL-3.0-only

// Field share HTTP route (not in the contract).
// Serves the TS internal getFieldShare caller.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterFieldShareRoutes: the field share per zone.
func RegisterFieldShareRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /field-share", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.GetFieldShare(rc, business.FieldShareOptions{
			Date: q.Get("date"), RuleVersionID: q.Get("rule_version_id"), ZoneID: q.Get("zone_id"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
