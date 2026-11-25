// SPDX-License-Identifier: AGPL-3.0-only

// Demo sign-in: demo auth mode only.
package httpapi

import (
	"log"
	"net/http"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/session"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterDemoAuthRoutes: never in oidc mode.
func RegisterDemoAuthRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /auth/demo/options", func(w http.ResponseWriter, r *http.Request) {
		if oidcMode() {
			writeJSONError(w, http.StatusForbidden, "The demo sign-in is off: people sign in through their identity provider.")
			return
		}
		tenantID, err := fixtures.TenantID()
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := business.SeedUsersFromFixtures(); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		options, err := business.GetDemoOptions(r.Context(), conn, tenantID)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, options)
	})
	mux.HandleFunc("POST /auth/demo/sign-in", func(w http.ResponseWriter, r *http.Request) {
		pre, ok := requirePreSession(w, r)
		if !ok {
			return
		}
		body, ok := decodeBody(w, r)
		if !ok {
			return
		}
		choice, err := business.ParseDemoChoice(r.Context(), conn, pre.CustomerID, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		// The switcher's install mode, not the cookie's.
		pre.InstallMode = choice.InstallMode
		result, err := business.DemoSignIn(pre, choice)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		if result.Outcome == "signed_in" && result.UserID != nil {
			if !startDemoSession(w, r, pre, *result.UserID, choice.ZoneIDs) {
				return
			}
		}
		writeJSON(w, http.StatusOK, result)
	})
}

// startDemoSession sets the session cookie.
func startDemoSession(w http.ResponseWriter, r *http.Request, pre reqctx.PreSessionContext, userID string, zoneIDs []string) bool {
	if auth == nil || auth.Sessions == nil {
		writeJSONError(w, http.StatusInternalServerError, "Could not start a session.")
		return false
	}
	token, sess, err := auth.Sessions.CreateDemo(r.Context(), pre.CustomerID, userID, session.DemoScope{InstallMode: string(pre.InstallMode), ZoneIDs: zoneIDs})
	if err != nil {
		log.Printf("auth: starting a demo session failed: %v", err)
		writeJSONError(w, http.StatusInternalServerError, "Could not start a session.")
		return false
	}
	auth.setCookie(w, SessionCookie, token, int(time.Until(sess.AbsoluteExpiresAt).Seconds()))
	return true
}

// endDemoSession revokes the demo session.
func endDemoSession(r *http.Request) error {
	if oidcMode() || auth == nil || auth.Sessions == nil {
		return nil
	}
	cookie, err := r.Cookie(SessionCookie)
	if err != nil {
		return nil
	}
	return auth.Sessions.Revoke(r.Context(), cookie.Value)
}

// DemoPolicy: twelve hours, no per-person cap.
func DemoPolicy(string) (session.Policy, error) {
	return session.Policy{Idle: 12 * time.Hour, Absolute: 12 * time.Hour}, nil
}
