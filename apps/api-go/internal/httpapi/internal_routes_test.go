// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func internalCitiesExist(t *testing.T) bool {
	t.Helper()
	rec := httptest.NewRecorder()
	NewMux(&tenancy.Connection{}).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/_internal/cities", nil))
	return rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed
}

func TestInternalCrudOnlyInDemoModeOrWithTheTestRoutesOptIn(t *testing.T) {
	defer SetAuth(nil)
	cases := []struct {
		name  string
		auth  *Auth
		flag  string
		exist bool
	}{
		{"no mode, no opt-in", nil, "", false},
		{"no mode, test routes on", nil, "1", true},
		{"demo mode", &Auth{Mode: "demo"}, "", true},
		{"oidc mode", &Auth{Mode: "oidc"}, "", false},
		{"oidc mode, test routes on", &Auth{Mode: "oidc"}, "1", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("OPENDISPATCH_TEST_ROUTES", c.flag)
			SetAuth(c.auth)
			if got := internalCitiesExist(t); got != c.exist {
				t.Fatalf("/_internal/cities registered = %v, want %v", got, c.exist)
			}
		})
	}
}
