// SPDX-License-Identifier: AGPL-3.0-only

// Live: two customers on one issuer, by organisation.
package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc/oidctest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/session"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

type orgRig struct {
	t      *testing.T
	srv    *httptest.Server
	idp    *oidctest.Provider
	owner  *pgxpool.Pool
	acme   string
	globex string
	// marker user ids, one per customer
	acmeMarker, globexMarker string
}

// startOrgRig: two shared customers over Postgres.
func startOrgRig(t *testing.T, listen string, client *http.Client, build func(r *orgRig, callback string) ([]oidc.Tenant, string)) *orgRig {
	t.Helper()
	ownerURL, appURL := os.Getenv("OPENDISPATCH_TEST_DATABASE_URL"), os.Getenv("OPENDISPATCH_TEST_APP_DATABASE_URL")
	if ownerURL == "" || appURL == "" {
		t.Skip("OPENDISPATCH_TEST_DATABASE_URL and OPENDISPATCH_TEST_APP_DATABASE_URL are not both set: skipped, not faked.")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, ownerURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	dir, _ := filepath.Abs(filepath.Join("..", "..", "migrations"))
	if _, err := tenancy.ApplyMigrations(ctx, tenancy.ApplyMigrationsOptions{Pool: owner, Dir: dir}); err != nil {
		t.Fatal(err)
	}
	app, err := pgxpool.New(ctx, appURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	conn := &tenancy.Connection{Pool: app}
	business.UsePostgresUsers(conn)
	business.UsePostgresRoleMappings(conn)
	t.Cleanup(func() {
		business.UseMemoryUsers()
		business.UseMemoryRoleMappings()
		SetAuth(nil)
		auditlog.ResetForTest()
	})

	r := &orgRig{t: t, owner: owner, acme: uuidNew(), globex: uuidNew()}
	var handler http.Handler
	r.srv = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) { handler.ServeHTTP(w, req) }))
	if listen != "" {
		l, err := net.Listen("tcp", listen)
		if err != nil {
			t.Fatal(err)
		}
		r.srv.Listener.Close()
		r.srv.Listener = l
	}
	r.srv.Start()
	t.Cleanup(r.srv.Close)
	entries, group := build(r, r.srv.URL+"/auth/callback")
	registry, err := oidc.NewConfigRegistry(entries)
	if err != nil {
		t.Fatal(err)
	}
	SetAuth(&Auth{
		Mode: "oidc", Registry: registry, Secret: []byte(strings.Repeat("s", 40)), Client: client,
		Verifier: &oidc.Verifier{Registry: registry, Keys: oidc.NewKeyResolver(client), Skew: time.Second},
		Sessions: &session.Store{Conn: conn, Policy: func(string) (session.Policy, error) { return standardPolicy, nil }},
	})
	handler = NewMux(conn)

	for _, tenant := range []string{r.acme, r.globex} {
		if _, err := owner.Exec(ctx, `INSERT INTO role_mappings (tenant_id, id, data_source, group_match, group_match_type, assigned_role, priority, is_enabled)
			VALUES ($1, $2, 'SYNTHETIC', $3, 'exact', 'administrator', 1, true)`, tenant, uuidNew(), group); err != nil {
			t.Fatal(err)
		}
	}
	r.acmeMarker, r.globexMarker = r.marker(r.acme, "marker@acme.example"), r.marker(r.globex, "marker@globex.example")
	return r
}

// newOrgRig: the mock provider, five people.
func newOrgRig(t *testing.T) *orgRig {
	return startOrgRig(t, "", &http.Client{Timeout: 10 * time.Second}, func(r *orgRig, callback string) ([]oidc.Tenant, string) {
		admins := []string{"opendispatch-admins"}
		r.idp = oidctest.New("opendispatch", "idp-secret", map[string]oidctest.User{
			"ada":      {Subject: "kc-ada", Email: "ada@acme.example", Name: "Ada", Groups: admins, Organization: []any{"acme"}},
			"gil":      {Subject: "kc-gil", Email: "gil@globex.example", Name: "Gil", Groups: admins, Organization: map[string]any{"globex": map[string]any{"id": "org-globex"}}},
			"both":     {Subject: "kc-both", Email: "both@x.example", Name: "Both", Groups: admins, Organization: []any{"acme", "globex"}},
			"none":     {Subject: "kc-none", Email: "none@x.example", Name: "None", Groups: admins},
			"stranger": {Subject: "kc-str", Email: "s@initech.example", Name: "Stranger", Groups: admins, Organization: []any{"initech"}},
		})
		t.Cleanup(r.idp.Close)
		entry := func(id, org string) oidc.Tenant {
			return oidc.Tenant{TenantID: id, Issuer: r.idp.Issuer, ClientID: "opendispatch", ClientSecret: "idp-secret", RedirectURI: callback,
				InstallMode: "shared", AllowInsecureHTTP: true, Organization: org}
		}
		return []oidc.Tenant{entry(r.acme, "acme"), entry(r.globex, "globex")}, "opendispatch-admins"
	})
}

func (r *orgRig) marker(tenant, email string) string {
	id := uuidNew()
	if _, err := r.owner.Exec(context.Background(), `INSERT INTO users (tenant_id, id, data_source, email, display_name, assigned_role, status, preferred_locale)
		VALUES ($1, $2, 'SYNTHETIC', $3, 'Marker', 'viewer_auditor', 'active', 'en')`, tenant, id, email); err != nil {
		r.t.Fatal(err)
	}
	return id
}

func (r *orgRig) browser() *http.Client { return (&signInRig{}).browser() }

// signIn: begin for a customer, approve a person.
func (r *orgRig) signIn(c *http.Client, tenant, person string) (final, authorize string) {
	t := r.t
	t.Helper()
	authorize = location(t, get(t, c, r.srv.URL+"/auth/login?locale=en&return_to=/ops/live&tenant="+tenant), http.StatusSeeOther)
	callback := location(t, get(t, c, authorize+"&user="+person), http.StatusFound)
	return location(t, get(t, c, callback), http.StatusSeeOther), authorize
}

func (r *orgRig) body(c *http.Client, path string) (int, string) {
	resp := get(r.t, c, r.srv.URL+path)
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func (r *orgRig) meTenant(c *http.Client) string {
	code, raw := r.body(c, "/me")
	if code != http.StatusOK {
		return ""
	}
	var me struct {
		Tenant struct {
			ID string `json:"id"`
		} `json:"tenant"`
	}
	_ = json.Unmarshal([]byte(raw), &me)
	return me.Tenant.ID
}

func (r *orgRig) hasSession(c *http.Client) bool {
	u, _ := url.Parse(r.srv.URL)
	for _, ck := range c.Jar.Cookies(u) {
		if ck.Name == SessionCookie {
			return true
		}
	}
	return false
}

func TestOrgSignIn_EachCustomerLandsInItsOwnDataOnly(t *testing.T) {
	r := newOrgRig(t)
	for _, c := range []struct {
		person, tenant, org, own, ownEmail, other, otherEmail string
	}{
		{"ada", r.acme, "acme", r.acmeMarker, "marker@acme.example", r.globexMarker, "marker@globex.example"},
		{"gil", r.globex, "globex", r.globexMarker, "marker@globex.example", r.acmeMarker, "marker@acme.example"},
	} {
		b := r.browser()
		final, authorize := r.signIn(b, c.tenant, c.person)
		if final != "/ops/live" {
			t.Fatalf("%s: got %q", c.person, final)
		}
		u, _ := url.Parse(authorize)
		if !strings.Contains(" "+u.Query().Get("scope")+" ", " organization:"+c.org+" ") {
			t.Fatalf("%s: the sign-in must ask for the organisation, scope %q", c.person, u.Query().Get("scope"))
		}
		if got := r.meTenant(b); got != c.tenant {
			t.Fatalf("%s: landed in %q, want %q", c.person, got, c.tenant)
		}
		code, list := r.body(b, "/users?limit=100")
		if code != http.StatusOK || !strings.Contains(list, c.ownEmail) || strings.Contains(list, c.otherEmail) {
			t.Fatalf("%s: /users %d must list only its own customer's people: %s", c.person, code, list)
		}
		if code, _ := r.body(b, "/users/"+c.own); code != http.StatusOK {
			t.Fatalf("%s: own record answered %d", c.person, code)
		}
		if code, _ := r.body(b, "/users/"+c.other); code == http.StatusOK {
			t.Fatalf("%s: the other customer's record must not be readable", c.person)
		}
	}
}

func TestOrgSignIn_CrossOrganisationCasesAreRefused(t *testing.T) {
	r := newOrgRig(t)
	cases := []struct{ name, tenant, person string }{
		{"begun for globex, token says acme", r.globex, "ada"},
		{"begun for acme, token says globex", r.acme, "gil"},
		{"two mapped organisations", r.acme, "both"},
		{"no organisation", r.acme, "none"},
		{"unknown organisation", r.globex, "stranger"},
	}
	for _, c := range cases {
		b := r.browser()
		if final, _ := r.signIn(b, c.tenant, c.person); final != "/en/sign-in/message/refused" {
			t.Errorf("%s: got %q", c.name, final)
		}
		if r.hasSession(b) {
			t.Errorf("%s: no session may be made", c.name)
		}
	}
	var n int
	if err := r.owner.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE tenant_id IN ($1, $2) AND email NOT LIKE 'marker@%'`, r.acme, r.globex).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("a refused sign-in must make no account, found %d", n)
	}
}

func TestOrgSignIn_ASignInForAnotherCustomerThanTheLiveSessionIsRefused(t *testing.T) {
	r := newOrgRig(t)
	b := r.browser()
	if final, _ := r.signIn(b, r.acme, "ada"); final != "/ops/live" {
		t.Fatalf("got %q", final)
	}
	if final, _ := r.signIn(b, r.globex, "gil"); final != "/en/sign-in/message/refused" {
		t.Fatalf("a sign-in for another customer over a live session must be refused, got %q", final)
	}
	if got := r.meTenant(b); got != r.acme {
		t.Fatalf("the session must stay bound to its customer, got %q", got)
	}
	// The same customer again is fine.
	if final, _ := r.signIn(b, r.acme, "ada"); final != "/ops/live" {
		t.Fatalf("got %q", final)
	}
}
