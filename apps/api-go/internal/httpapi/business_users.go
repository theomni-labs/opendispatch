// SPDX-License-Identifier: AGPL-3.0-only

// Users, roles and effective access.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterUsersRoutes: roles, users, access, resets.
func RegisterUsersRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	handle := func(method, pattern string, status int, withBody bool, run func(r *http.Request, rc reqctx.RequestContext, body any) (any, error)) {
		mux.HandleFunc(method+" "+pattern, func(w http.ResponseWriter, r *http.Request) {
			rc, ok := requireContext(w, r, conn)
			if !ok {
				return
			}
			var body any
			if withBody {
				if body, ok = decodeAnyBody(w, r); !ok {
					return
				}
			}
			result, err := run(r, rc, body)
			if err != nil {
				writeBusinessError(w, err)
				return
			}
			writeJSON(w, status, result)
		})
	}
	handle("GET", "/roles", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		q := r.URL.Query()
		return business.ListRoles(rc, business.ListRolesQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")})
	})
	handle("GET", "/users", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		q := r.URL.Query()
		return business.ListUsers(rc, business.ListUsersQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), Q: q.Get("q"), Status: q.Get("status"), AssignedRole: access.Role(q.Get("assigned_role")),
		})
	})
	handle("POST", "/users", http.StatusCreated, true, func(r *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.CreateUser(r.Context(), conn, rc, body)
	})
	handle("GET", "/users/display-names", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		ids := []string{}
		if raw := r.URL.Query().Get("ids"); raw != "" {
			ids = strings.Split(raw, ",")
		}
		return business.ListUserDisplayNames(rc, ids)
	})
	handle("GET", "/users/{id}", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetUser(rc, r.PathValue("id"))
	})
	handle("PUT", "/users/{id}", http.StatusOK, true, func(r *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.UpdateUser(r.Context(), conn, rc, r.PathValue("id"), body)
	})
	handle("POST", "/users/{id}/disable", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.DisableUser(rc, r.PathValue("id"))
	})
	handle("POST", "/users/{id}/enable", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.EnableUser(rc, r.PathValue("id"))
	})
	handle("GET", "/users/{id}/effective-access", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetEffectiveAccess(rc, r.PathValue("id"))
	})
	// Not in the contract: the Add User dialog's preview.
	handle("POST", "/users/effective-access/preview", http.StatusOK, true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.PreviewEffectiveAccess(rc, body)
	})
	handle("POST", "/users/{id}/emergency-admin/reset-password", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.ResetEmergencyAdminPassword(rc, r.PathValue("id"))
	})
	handle("POST", "/users/{id}/emergency-admin/reset-mfa", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.ResetEmergencyAdminMfa(rc, r.PathValue("id"))
	})
}
