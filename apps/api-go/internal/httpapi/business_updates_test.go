// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUpdatesPatchRoutesAskForASession(t *testing.T) {
	mux := http.NewServeMux()
	RegisterUpdatesRoutes(mux, nil)
	for _, path := range []string{"/updates/connection", "/updates/change-windows", "/updates/change-policy"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPatch, path, strings.NewReader(`{}`)))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("PATCH %s: %d, want 401 (route registered, no session)", path, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPatch, "/updates/settings", strings.NewReader(`{}`)))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("PATCH /updates/settings: %d, want 405", rec.Code)
	}
}
