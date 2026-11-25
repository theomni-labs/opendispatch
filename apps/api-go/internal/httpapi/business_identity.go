// SPDX-License-Identifier: AGPL-3.0-only

// Sign-in, identity providers, group rules, session.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"
	"os"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/demosession"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// requirePreSession: mode from signed cookie.
func requirePreSession(w http.ResponseWriter, r *http.Request) (reqctx.PreSessionContext, bool) {
	if oidcMode() {
		writeJSONError(w, http.StatusForbidden, "The demo sign-in is off: people sign in through their identity provider.")
		return reqctx.PreSessionContext{}, false
	}
	mode := access.InstallPrivate
	if cookie, err := r.Cookie(demosession.ModeCookieName); err == nil {
		mode = demosession.VerifyMode(cookie.Value, os.Getenv("DEMO_SESSION_SECRET"), time.Now().Unix())
	}
	tenantID, err := fixtures.TenantID()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return reqctx.PreSessionContext{}, false
	}
	if err := business.SeedUsersFromFixtures(); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return reqctx.PreSessionContext{}, false
	}
	return reqctx.PreSessionContext{CustomerID: tenantID, InstallMode: mode}, true
}

// RegisterIdentityRoutes: sign-in, providers, rules, policy.
func RegisterIdentityRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
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
			if status == http.StatusNoContent {
				w.WriteHeader(status)
				return
			}
			writeJSON(w, status, result)
		})
	}
	page := func(r *http.Request) datactx.PageQuery {
		q := r.URL.Query()
		return datactx.PageQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")}
	}
	none := func(err error) (any, error) { return nil, err }
	refreshZones := func(r *http.Request, rc reqctx.RequestContext) error {
		return business.RefreshIdentityZones(r.Context(), conn, rc.CustomerID)
	}

	preSession := func(pattern string, run func(pre reqctx.PreSessionContext, body map[string]any) (business.SignInResult, error)) {
		mux.HandleFunc("POST "+pattern, func(w http.ResponseWriter, r *http.Request) {
			pre, ok := requirePreSession(w, r)
			if !ok {
				return
			}
			body, ok := decodeBody(w, r)
			if !ok {
				return
			}
			result, err := run(pre, body)
			if err != nil {
				writeBusinessError(w, err)
				return
			}
			if result.Outcome == "signed_in" && result.UserID != nil {
				zones := append([]string{}, result.ZoneIDs...)
				if !startDemoSession(w, r, pre, *result.UserID, zones) {
					return
				}
			}
			writeJSON(w, http.StatusOK, result)
		})
	}
	preSession("/auth/mock-sign-in", func(pre reqctx.PreSessionContext, body map[string]any) (business.SignInResult, error) {
		return business.MockSignIn(pre, body)
	})
	preSession("/auth/emergency-admin/sign-in", func(pre reqctx.PreSessionContext, body map[string]any) (business.SignInResult, error) {
		return business.EmergencyAdminSignIn(pre, body)
	})

	handle("GET", "/me", http.StatusOK, false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetSessionContext(rc)
	})
	handle("POST", "/auth/sign-out", http.StatusNoContent, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		if err := business.SignOut(rc); err != nil {
			return nil, err
		}
		return nil, endDemoSession(r)
	})

	handle("GET", "/identity-providers/presets", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.ListIdentityProviderPresets(rc, page(r))
	})
	handle("GET", "/identity-providers", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.ListIdentityProviders(rc, page(r))
	})
	handle("POST", "/identity-providers", http.StatusCreated, true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.CreateIdentityProvider(rc, body)
	})
	handle("POST", "/identity-providers/change-requests", http.StatusCreated, true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.RequestIdentityProviderChange(rc, body)
	})
	handle("GET", "/identity-providers/{provider_id}", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetIdentityProvider(rc, r.PathValue("provider_id"))
	})
	handle("PUT", "/identity-providers/{provider_id}", http.StatusOK, true, func(r *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.UpdateIdentityProvider(rc, r.PathValue("provider_id"), body)
	})
	handle("DELETE", "/identity-providers/{provider_id}", http.StatusNoContent, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return none(business.DeleteIdentityProvider(rc, r.PathValue("provider_id")))
	})
	handle("POST", "/identity-providers/{provider_id}/test", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.TestIdentityProviderConnection(rc, r.PathValue("provider_id"))
	})

	handle("GET", "/role-mappings", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.ListRoleMappings(rc, page(r))
	})
	handle("POST", "/role-mappings", http.StatusCreated, true, func(r *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		if err := refreshZones(r, rc); err != nil {
			return nil, err
		}
		return business.CreateRoleMapping(rc, body)
	})
	handle("POST", "/role-mappings/preview", http.StatusOK, true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.PreviewRoleMappings(rc, body)
	})
	handle("PUT", "/role-mappings/{id}", http.StatusOK, true, func(r *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		if err := refreshZones(r, rc); err != nil {
			return nil, err
		}
		return business.UpdateRoleMapping(rc, r.PathValue("id"), body)
	})
	handle("DELETE", "/role-mappings/{id}", http.StatusNoContent, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return none(business.DeleteRoleMapping(rc, r.PathValue("id")))
	})

	handle("GET", "/sign-in-policy", http.StatusOK, false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetSignInPolicy(rc)
	})
	handle("PUT", "/sign-in-policy", http.StatusOK, true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.UpdateSignInPolicy(rc, body)
	})
}
