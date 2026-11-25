// SPDX-License-Identifier: AGPL-3.0-only

// Temporary header auth; mirrors tenant-context.ts.
package httpapi

import "net/http"

// TenantHeader mirrors TENANT_HEADER.
const TenantHeader = "x-opendispatch-tenant-id"

type tenantIDKey struct{}

// TenantContext mirrors tenantContext.
func TenantContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenantID := r.Header.Get(TenantHeader)
		if tenantID == "" {
			writeJSONError(w, http.StatusBadRequest, TenantHeader+" header is required")
			return
		}
		ctx := setTenantID(r.Context(), tenantID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
