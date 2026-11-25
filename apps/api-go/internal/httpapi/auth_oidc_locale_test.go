// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc"
)

func localeTestAuth(t *testing.T) (*Auth, oidc.Tenant) {
	t.Helper()
	reg, err := oidc.NewConfigRegistry([]oidc.Tenant{{
		TenantID: "8f3c2a10-5b7e-4d64-9a21-3c6e0d7b1a55", Issuer: "https://idp.example/realms/opendispatch", ClientID: "opendispatch-web",
		RedirectURI: "https://opendispatch.example/auth/callback",
	}})
	if err != nil {
		t.Fatal(err)
	}
	tenant := reg.Tenants()[0]
	e := &oidc.Endpoints{
		Issuer: tenant.Issuer, AuthorizationEndpoint: tenant.Issuer + "/protocol/openid-connect/auth",
		EndSessionEndpoint: tenant.Issuer + "/protocol/openid-connect/logout",
	}
	a := &Auth{Mode: "oidc", Registry: reg, Secret: []byte("unit-test-key-unit-test-key-unit-test-key")}
	a.endpoints = map[string]cachedEndpoints{tenant.TenantID: {at: time.Now(), e: e}}
	return a, tenant
}

func TestLogin_SendsThePersonsLanguageToTheProvider(t *testing.T) {
	a, _ := localeTestAuth(t)
	for given, want := range map[string]string{"ar": "ar", "en": "en", "": "en", "fr": "en", "ar-SA": "en"} {
		w := httptest.NewRecorder()
		a.login(w, httptest.NewRequest(http.MethodGet, "/auth/login?locale="+url.QueryEscape(given), nil))
		if w.Code != http.StatusSeeOther {
			t.Fatalf("locale %q: status %d", given, w.Code)
		}
		loc, err := url.Parse(w.Header().Get("Location"))
		if err != nil {
			t.Fatal(err)
		}
		if got := loc.Query().Get("ui_locales"); got != want {
			t.Errorf("locale %q: ui_locales %q, want %q", given, got, want)
		}
		if loc.Query().Get("code_challenge_method") != "S256" {
			t.Errorf("locale %q: PKCE missing", given)
		}
	}
}

func TestLogout_TheProvidersPageIsInThePersonsLanguage(t *testing.T) {
	a, tenant := localeTestAuth(t)
	e := a.endpoints[tenant.TenantID].e
	for given, want := range map[string]string{"ar": "ar", "en": "en", "": "en"} {
		target, ok := endSessionURL(e, tenant, given)
		if !ok {
			t.Fatalf("locale %q: no logout address", given)
		}
		loc, _ := url.Parse(target)
		if got := loc.Query().Get("ui_locales"); got != want {
			t.Errorf("locale %q: ui_locales %q, want %q", given, got, want)
		}
		if got := loc.Query().Get("post_logout_redirect_uri"); got != "https://opendispatch.example/"+want+"/signed-out" {
			t.Errorf("locale %q: comes back to %q", given, got)
		}
	}
	if _, ok := endSessionURL(&oidc.Endpoints{}, tenant, "ar"); ok {
		t.Error("a provider without a logout endpoint gave a logout address")
	}
}
