// SPDX-License-Identifier: AGPL-3.0-only

// Live: sign-in through an identity provider, the session, and every refusal (B3a.
package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
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
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc/oidctest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/session"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

type signInRig struct {
	t      *testing.T
	srv    *httptest.Server
	idp    *oidctest.Provider
	owner  *pgxpool.Pool
	tenant string
}

func uuidNew() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

// newSignInRig: the real router in oidc mode over Postgres, one customer, a mock identity provider with two people.
func newSignInRig(t *testing.T, policy session.Policy) *signInRig {
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

	r := &signInRig{t: t, owner: owner, tenant: uuidNew()}
	r.idp = oidctest.New("opendispatch", "idp-secret", map[string]oidctest.User{
		"admin":  {Subject: "kc-admin", Email: "admin@customer.example", Name: "Ada Admin", Groups: []string{"opendispatch-admins", "staff"}},
		"nobody": {Subject: "kc-nobody", Email: "nobody@customer.example", Name: "Nick Nobody", Groups: []string{"staff"}},
	})
	t.Cleanup(r.idp.Close)

	var handler http.Handler
	r.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) { handler.ServeHTTP(w, req) }))
	t.Cleanup(r.srv.Close)
	registry, err := oidc.NewConfigRegistry([]oidc.Tenant{{
		TenantID: r.tenant, Issuer: r.idp.Issuer, ClientID: "opendispatch", ClientSecret: "idp-secret", RedirectURI: r.srv.URL + "/auth/callback",
		InstallMode: "private", AllowInsecureHTTP: true,
	}})
	if err != nil {
		t.Fatal(err)
	}
	// oidc.NewConfigRegistry reads the secret from an environment variable; set it directly for the test.
	tenant, _ := registry.ByTenantID(r.tenant)
	tenant.ClientSecret = "idp-secret"
	registry, _ = oidc.NewConfigRegistry([]oidc.Tenant{tenant})
	client := &http.Client{Timeout: 10 * time.Second}
	SetAuth(&Auth{
		Mode: "oidc", Registry: registry, Secret: []byte(strings.Repeat("s", 40)), Client: client,
		Verifier: &oidc.Verifier{Registry: registry, Keys: oidc.NewKeyResolver(client), Skew: time.Second},
		Sessions: &session.Store{Conn: conn, Policy: func(string) (session.Policy, error) { return policy, nil }},
	})
	handler = NewMux(conn)

	if _, err := owner.Exec(ctx, `INSERT INTO role_mappings (tenant_id, id, data_source, group_match, group_match_type, assigned_role, priority, is_enabled)
		VALUES ($1, $2, 'SYNTHETIC', 'opendispatch-admins', 'exact', 'administrator', 1, true)`, r.tenant, uuidNew()); err != nil {
		t.Fatal(err)
	}
	return r
}

var standardPolicy = session.Policy{Idle: 30 * time.Minute, Absolute: 8 * time.Hour, MaxConcurrent: 3}

// browser: a client that follows nothing by itself and keeps cookies, so each redirect can be read.
func (r *signInRig) browser() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func location(t *testing.T, resp *http.Response, wantStatus int) string {
	t.Helper()
	defer resp.Body.Close()
	if resp.StatusCode != wantStatus {
		t.Fatalf("status %d, want %d (Location %q)", resp.StatusCode, wantStatus, resp.Header.Get("Location"))
	}
	return resp.Header.Get("Location")
}

func get(t *testing.T, c *http.Client, target string) *http.Response {
	t.Helper()
	resp, err := c.Get(target)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// signIn walks the whole flow for one person and returns where the api finally sent the browser.
func (r *signInRig) signIn(c *http.Client, person string) string {
	t := r.t
	t.Helper()
	authorize := location(t, get(t, c, r.srv.URL+"/auth/login?locale=en&return_to=/ops/live"), http.StatusSeeOther)
	u, _ := url.Parse(authorize)
	q := u.Query()
	if !strings.HasPrefix(authorize, r.idp.Issuer+"/authorize") || q.Get("code_challenge_method") != "S256" || q.Get("state") == "" || q.Get("nonce") == "" || q.Get("client_id") != "opendispatch" {
		t.Fatalf("the sign-in must go to the provider with PKCE, state and nonce: %s", authorize)
	}
	callback := location(t, get(t, c, authorize+"&user="+person), http.StatusFound)
	return location(t, get(t, c, callback), http.StatusSeeOther)
}

func (r *signInRig) status(c *http.Client, path string) int {
	resp := get(r.t, c, r.srv.URL+path)
	defer resp.Body.Close()
	return resp.StatusCode
}

func (r *signInRig) hasSession(c *http.Client) bool {
	u, _ := url.Parse(r.srv.URL)
	for _, ck := range c.Jar.Cookies(u) {
		if ck.Name == SessionCookie {
			return true
		}
	}
	return false
}

func (r *signInRig) userCount() int {
	var n int
	if err := r.owner.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE tenant_id = $1`, r.tenant).Scan(&n); err != nil {
		r.t.Fatal(err)
	}
	return n
}

func TestSignIn_APersonInAMappedGroupSignsInAndHasASession(t *testing.T) {
	r := newSignInRig(t, standardPolicy)
	c := r.browser()
	if got := location(t, get(t, c, r.srv.URL+"/auth/login?locale=en&return_to=/ops/live"), http.StatusSeeOther); got == "" {
		t.Fatal("no redirect")
	}
	c = r.browser()
	final := r.signIn(c, "admin")
	if final != "/ops/live" {
		t.Fatalf("the person must land where they were going, got %q", final)
	}
	if !r.hasSession(c) {
		t.Fatal("a session cookie must be set")
	}
	resp := get(t, c, r.srv.URL+"/me")
	defer resp.Body.Close()
	var me struct {
		User struct {
			DisplayName  string `json:"display_name"`
			AssignedRole string `json:"assigned_role"`
		} `json:"user"`
		Tenant struct {
			ID string `json:"id"`
		} `json:"tenant"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&me) != nil {
		t.Fatalf("/me answered %d", resp.StatusCode)
	}
	if me.User.AssignedRole != "administrator" || me.User.DisplayName != "Ada Admin" || me.Tenant.ID != r.tenant {
		t.Fatalf("got %+v", me)
	}
	if r.idp.Approvals < 1 {
		t.Fatal("the sign-in must really have gone through the provider")
	}
}

func TestSignIn_NoMatchingGroupMeansNoSessionAndNoAccount(t *testing.T) {
	r := newSignInRig(t, standardPolicy)
	c := r.browser()
	if got := r.signIn(c, "nobody"); got != "/en/sign-in/message/no-role" {
		t.Fatalf("got %q", got)
	}
	if r.hasSession(c) || r.status(c, "/me") != http.StatusUnauthorized {
		t.Fatal("a person with no role must get no session")
	}
	if r.userCount() != 0 {
		t.Fatal("no account may be made for a person with no role")
	}
}

func TestSignIn_AProviderThatClaimsAnotherIssuerIsRefused(t *testing.T) {
	r := newSignInRig(t, standardPolicy)
	r.idp.TokenIssuer = "https://evil.example"
	c := r.browser()
	if got := r.signIn(c, "admin"); got != "/en/sign-in/message/refused" {
		t.Fatalf("got %q", got)
	}
	if r.hasSession(c) || r.userCount() != 0 {
		t.Fatal("a token from an unknown issuer must give nothing")
	}
}

func TestSignIn_AStateThatDoesNotMatchIsRefused(t *testing.T) {
	r := newSignInRig(t, standardPolicy)
	c := r.browser()
	authorize := location(t, get(t, c, r.srv.URL+"/auth/login"), http.StatusSeeOther)
	callback := location(t, get(t, c, authorize+"&user=admin"), http.StatusFound)
	u, _ := url.Parse(callback)
	q := u.Query()
	q.Set("state", "forged")
	u.RawQuery = q.Encode()
	if got := location(t, get(t, c, u.String()), http.StatusSeeOther); !strings.HasPrefix(got, "/en/sign-in/message/error") {
		t.Fatalf("got %q", got)
	}
	if r.hasSession(c) {
		t.Fatal("a forged state must give no session")
	}
}

func TestSignIn_ACallbackWithoutItsTransactionCookieIsRefused(t *testing.T) {
	r := newSignInRig(t, standardPolicy)
	first := r.browser()
	authorize := location(t, get(t, first, r.srv.URL+"/auth/login"), http.StatusSeeOther)
	callback := location(t, get(t, first, authorize+"&user=admin"), http.StatusFound)
	// Another browser, which never began this sign-in, presents the callback (a stolen code or a login CSRF).
	other := r.browser()
	if got := location(t, get(t, other, callback), http.StatusSeeOther); !strings.HasPrefix(got, "/en/sign-in/message/error") {
		t.Fatalf("got %q", got)
	}
	if r.hasSession(other) {
		t.Fatal("no session for a callback that was not begun here")
	}
	// The same callback twice in the browser that began it: the code and the transaction both work once.
	if got := location(t, get(t, first, callback), http.StatusSeeOther); got != "/" {
		t.Fatalf("the first use works, got %q", got)
	}
	again := r.browser()
	if got := location(t, get(t, again, callback), http.StatusSeeOther); !strings.HasPrefix(got, "/en/sign-in/message/error") {
		t.Fatalf("a replayed code must be refused, got %q", got)
	}
}

func TestSignIn_LogoutEndsTheSessionAtOnce(t *testing.T) {
	r := newSignInRig(t, standardPolicy)
	c := r.browser()
	r.signIn(c, "admin")
	if r.status(c, "/me") != http.StatusOK {
		t.Fatal("signed in")
	}
	resp, err := c.Post(r.srv.URL+"/auth/logout", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Redirect string `json:"redirect"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	resp.Body.Close()
	if !strings.HasPrefix(out.Redirect, r.idp.Issuer+"/logout") {
		t.Fatalf("logout must also end the provider's session, got %q", out.Redirect)
	}
	if r.status(c, "/me") != http.StatusUnauthorized {
		t.Fatal("after logout the session must be dead")
	}
}

func TestSignIn_AnIdleSessionEnds(t *testing.T) {
	r := newSignInRig(t, session.Policy{Idle: time.Second, Absolute: time.Hour, MaxConcurrent: 3})
	c := r.browser()
	r.signIn(c, "admin")
	if r.status(c, "/me") != http.StatusOK {
		t.Fatal("signed in")
	}
	time.Sleep(1300 * time.Millisecond)
	if r.status(c, "/me") != http.StatusUnauthorized {
		t.Fatal("a session idle past its timeout must end")
	}
}

func TestSignIn_DisablingThePersonEndsTheirSession(t *testing.T) {
	r := newSignInRig(t, standardPolicy)
	c := r.browser()
	r.signIn(c, "admin")
	if _, err := r.owner.Exec(context.Background(), `UPDATE users SET status = 'disabled' WHERE tenant_id = $1`, r.tenant); err != nil {
		t.Fatal(err)
	}
	if r.status(c, "/me") != http.StatusUnauthorized {
		t.Fatal("a disabled person must lose access at once")
	}
}

func TestSignIn_InOidcModeTheDemoWayInIsClosed(t *testing.T) {
	r := newSignInRig(t, standardPolicy)
	// A perfectly valid demo session cookie, signed with the demo secret.
	t.Setenv("DEMO_SESSION_SECRET", strings.Repeat("d", 40))
	payload, _ := json.Marshal(map[string]any{"v": 1, "exp": time.Now().Add(time.Hour).Unix(), "role": "administrator", "installMode": "private", "zoneIds": []string{}})
	body := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(strings.Repeat("d", 40)))
	mac.Write([]byte(body))
	demo := body + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	req, _ := http.NewRequest(http.MethodGet, r.srv.URL+"/me", nil)
	req.AddCookie(&http.Cookie{Name: "opendispatch_demo_session", Value: demo})
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("a demo cookie must not work in oidc mode, got %d", resp.StatusCode)
	}
	req, _ = http.NewRequest(http.MethodPost, r.srv.URL+"/auth/mock-sign-in", strings.NewReader(`{"provider_id":"mock","subject":"x","groups":[]}`))
	req.AddCookie(&http.Cookie{Name: "opendispatch_demo_session", Value: demo})
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("the mock sign-in must be off, got %d", resp.StatusCode)
	}
	for _, path := range []string{"/_internal/cities", "/_internal/test/reset", "/auth/demo/options", "/auth/demo/sign-in", "/_internal/test/demo-session"} {
		if code := r.status(http.DefaultClient, path); code != http.StatusNotFound && code != http.StatusMethodNotAllowed {
			t.Fatalf("%s must not exist in oidc mode, got %d", path, code)
		}
	}
}

func TestSignIn_TheEmergencyAdministratorSignsInWithoutAProvider(t *testing.T) {
	r := newSignInRig(t, standardPolicy)
	t.Setenv("DEMO_EMERGENCY_ADMIN_PASSWORD", "correct-horse-battery")
	t.Setenv("DEMO_EMERGENCY_ADMIN_TOTP", "123456")
	if _, err := r.owner.Exec(context.Background(), `INSERT INTO users (tenant_id, id, data_source, email, display_name, assigned_role, status, is_emergency_admin, preferred_locale)
		VALUES ($1, $2, 'SYNTHETIC', 'emergency@customer.example', 'Emergency Admin', 'administrator', 'active', true, 'en')`, r.tenant, uuidNew()); err != nil {
		t.Fatal(err)
	}
	c := r.browser()
	post := func(body string) map[string]any {
		resp, err := c.Post(r.srv.URL+"/auth/emergency", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return out
	}
	if out := post(`{"email":"emergency@customer.example","password":"wrong"}`); out["outcome"] != "invalid_credentials" || r.hasSession(c) {
		t.Fatalf("a wrong password must fail and give no session, got %v", out)
	}
	if out := post(`{"email":"emergency@customer.example","password":"correct-horse-battery"}`); out["outcome"] != "mfa_required" || r.hasSession(c) {
		t.Fatalf("the password alone is not enough, got %v", out)
	}
	if out := post(`{"email":"emergency@customer.example","password":"correct-horse-battery","totp_code":"123456"}`); out["outcome"] != "signed_in" || !r.hasSession(c) {
		t.Fatalf("got %v", out)
	}
	if r.status(c, "/me") != http.StatusOK {
		t.Fatal("the emergency administrator must have a working session")
	}
	_ = datactx.NewID()
}
