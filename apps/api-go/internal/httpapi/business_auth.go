// SPDX-License-Identifier: AGPL-3.0-only

// Session auth for the business layer.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// requireContext: the session, in both modes.
func requireContext(w http.ResponseWriter, r *http.Request, conn *tenancy.Connection) (reqctx.RequestContext, bool) {
	if oidcMode() {
		return contextFromSession(w, r, conn)
	}
	return contextFromDemoSession(w, r, conn)
}

// contextFromDemoSession: demo sign-in only.
func contextFromDemoSession(w http.ResponseWriter, r *http.Request, conn *tenancy.Connection) (reqctx.RequestContext, bool) {
	cookie, err := r.Cookie(SessionCookie)
	if err != nil || auth == nil || auth.Sessions == nil {
		writeJSONError(w, http.StatusUnauthorized, "No signed-in session.")
		return reqctx.RequestContext{}, false
	}
	sess, err := auth.Sessions.Lookup(r.Context(), cookie.Value)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return reqctx.RequestContext{}, false
	}
	tenantID, err := fixtures.TenantID()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return reqctx.RequestContext{}, false
	}
	if sess == nil || sess.Demo == nil || sess.TenantID != tenantID {
		writeJSONError(w, http.StatusUnauthorized, "No signed-in session.")
		return reqctx.RequestContext{}, false
	}
	if err := business.SeedUsersFromFixtures(); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return reqctx.RequestContext{}, false
	}
	rc, err := business.ContextForDemoSession(r.Context(), conn, sess.TenantID, sess.UserID, access.InstallMode(sess.Demo.InstallMode), sess.Demo.ZoneIDs)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return reqctx.RequestContext{}, false
	}
	if rc == nil {
		// Rule 22: no role, no access.
		_ = auth.Sessions.Revoke(r.Context(), cookie.Value)
		writeJSONError(w, http.StatusUnauthorized, "No signed-in session.")
		return reqctx.RequestContext{}, false
	}
	return *rc, true
}

// contextFromSession: in oidc mode the only way in is a session made by a real sign-in. The demo cookie is not looked at.
func contextFromSession(w http.ResponseWriter, r *http.Request, conn *tenancy.Connection) (reqctx.RequestContext, bool) {
	cookie, err := r.Cookie(SessionCookie)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "No signed-in session.")
		return reqctx.RequestContext{}, false
	}
	sess, err := auth.Sessions.Lookup(r.Context(), cookie.Value)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return reqctx.RequestContext{}, false
	}
	if sess == nil {
		writeJSONError(w, http.StatusUnauthorized, "No signed-in session.")
		return reqctx.RequestContext{}, false
	}
	tenant, ok := auth.Registry.ByTenantID(sess.TenantID)
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "No signed-in session.")
		return reqctx.RequestContext{}, false
	}
	rc, err := business.ContextForUser(r.Context(), conn, sess.TenantID, sess.UserID, access.InstallMode(tenant.InstallMode))
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return reqctx.RequestContext{}, false
	}
	if rc == nil {
		// Disabled since they signed in, or their role is gone: the session ends with the right to use it.
		_ = auth.Sessions.Revoke(r.Context(), cookie.Value)
		writeJSONError(w, http.StatusUnauthorized, "No signed-in session.")
		return reqctx.RequestContext{}, false
	}
	return *rc, true
}
