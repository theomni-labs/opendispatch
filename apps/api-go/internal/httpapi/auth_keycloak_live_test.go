// SPDX-License-Identifier: AGPL-3.0-only

// Live: a real Keycloak 26 with Organizations on.
package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc"
)

// tokenTap keeps the last ID token's organisation claim.
type tokenTap struct {
	mu  sync.Mutex
	org []any
}

func (c *tokenTap) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil || !strings.HasSuffix(req.URL.Path, "/token") {
		return resp, err
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	resp.Body = io.NopCloser(bytes.NewReader(body))
	var out struct {
		IDToken string `json:"id_token"`
	}
	if json.Unmarshal(body, &out) == nil {
		if parts := strings.Split(out.IDToken, "."); len(parts) == 3 {
			raw, _ := base64.RawURLEncoding.DecodeString(parts[1])
			var claims map[string]any
			_ = json.Unmarshal(raw, &claims)
			c.mu.Lock()
			c.org = append(c.org, claims["organization"])
			c.mu.Unlock()
		}
	}
	return resp, nil
}

var formAction = regexp.MustCompile(`<form[^>]*action="([^"]+)"`)

// kcSignIn: begin for a customer, sign in at Keycloak.
func (r *orgRig) kcSignIn(c *http.Client, tenant, user, password string) string {
	t := r.t
	t.Helper()
	next := location(t, get(t, c, r.srv.URL+"/auth/login?locale=en&return_to=/ops/live&tenant="+tenant), http.StatusSeeOther)
	resp := get(t, c, next)
	for i := 0; i < 6; i++ {
		switch {
		case resp.StatusCode == http.StatusFound || resp.StatusCode == http.StatusSeeOther:
			target := resp.Header.Get("Location")
			resp.Body.Close()
			if strings.HasPrefix(target, r.srv.URL+"/auth/callback") {
				return location(t, get(t, c, target), http.StatusSeeOther)
			}
			if strings.HasPrefix(target, "/") {
				return target
			}
			resp = get(t, c, target)
		case resp.StatusCode == http.StatusOK:
			page, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			m := formAction.FindSubmatch(page)
			if m == nil {
				text := strings.Join(strings.Fields(regexp.MustCompile(`(?s)<script.*?</script>|<[^>]*>`).ReplaceAllString(string(page), " ")), " ")
				return "keycloak: " + text[:min(len(text), 120)]
			}
			form := url.Values{"username": {user}, "password": {password}, "credentialId": {""}}
			var err error
			if resp, err = c.PostForm(html.UnescapeString(string(m[1])), form); err != nil {
				t.Fatal(err)
			}
		default:
			resp.Body.Close()
			return "keycloak: status " + resp.Status
		}
	}
	t.Fatal("the sign-in did not finish")
	return ""
}

func TestKeycloakOrganizations_EachUserLandsInTheirCustomer(t *testing.T) {
	issuer, secret, password, addr := os.Getenv("OPENDISPATCH_TEST_KEYCLOAK_ISSUER"), os.Getenv("OPENDISPATCH_TEST_KEYCLOAK_CLIENT_SECRET"),
		os.Getenv("OPENDISPATCH_TEST_KEYCLOAK_PASSWORD"), os.Getenv("OPENDISPATCH_TEST_KEYCLOAK_CALLBACK_ADDR")
	if issuer == "" || secret == "" || password == "" || addr == "" {
		t.Skip("OPENDISPATCH_TEST_KEYCLOAK_* not set: skipped, not faked.")
	}
	tap := &tokenTap{}
	client := &http.Client{Timeout: 15 * time.Second, Transport: tap}
	r := startOrgRig(t, addr, client, func(r *orgRig, callback string) ([]oidc.Tenant, string) {
		entry := func(id, org, orgID string) oidc.Tenant {
			return oidc.Tenant{TenantID: id, Issuer: issuer, ClientID: "opendispatch-web", ClientSecret: secret, RedirectURI: callback,
				InstallMode: "shared", AllowInsecureHTTP: true, Organization: org, OrganizationID: orgID}
		}
		return []oidc.Tenant{entry(r.acme, "acme", os.Getenv("OPENDISPATCH_TEST_KEYCLOAK_ACME_ID")), entry(r.globex, "globex", "")}, "opendispatch-administrators"
	})
	for _, c := range []struct{ user, tenant, ownEmail, otherEmail string }{
		{"ada", r.acme, "marker@acme.example", "marker@globex.example"},
		{"gil", r.globex, "marker@globex.example", "marker@acme.example"},
	} {
		b := r.browser()
		if final := r.kcSignIn(b, c.tenant, c.user, password); final != "/ops/live" {
			t.Fatalf("%s: got %q", c.user, final)
		}
		if got := r.meTenant(b); got != c.tenant {
			t.Fatalf("%s: landed in %q, want %q", c.user, got, c.tenant)
		}
		code, list := r.body(b, "/users?limit=100")
		if code != http.StatusOK || !strings.Contains(list, c.ownEmail) || strings.Contains(list, c.otherEmail) {
			t.Fatalf("%s: /users %d must list only its own customer: %s", c.user, code, list)
		}
		t.Logf("%s: landed in %s; ID token organization claim %v", c.user, c.tenant, tap.org[len(tap.org)-1])
	}
	// Ada begins a sign-in for globex: refused.
	b := r.browser()
	if final := r.kcSignIn(b, r.globex, "ada", password); final == "/ops/live" || r.hasSession(b) {
		t.Fatalf("a member of acme must not get into globex, got %q", final)
	} else {
		t.Logf("ada for globex: %s", final)
	}
	// Signed in as ada, then globex in the same browser.
	b = r.browser()
	if final := r.kcSignIn(b, r.acme, "ada", password); final != "/ops/live" {
		t.Fatalf("got %q", final)
	}
	final := r.kcSignIn(b, r.globex, "gil", password)
	if r.meTenant(b) != r.acme || final == "/ops/live" {
		t.Fatalf("the session must stay with acme; second sign-in gave %q", final)
	}
	t.Logf("gil over ada's session (same Keycloak session): %s", final)
	// Without Keycloak's cookies: gil gets a globex token.
	fresh := r.browser()
	u, _ := url.Parse(r.srv.URL)
	fresh.Jar.SetCookies(u, b.Jar.Cookies(u))
	before := len(tap.org)
	final = r.kcSignIn(fresh, r.globex, "gil", password)
	if final == "/ops/live" || r.meTenant(fresh) != r.acme || len(tap.org) != before+1 {
		t.Fatalf("a globex token over an acme session must be refused; got %q", final)
	}
	t.Logf("gil's globex token %v over ada's acme session: %s", tap.org[len(tap.org)-1], final)
}
