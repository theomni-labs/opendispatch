// SPDX-License-Identifier: AGPL-3.0-only

// Live: demo sign-in and its session.
package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/session"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	demoTenant   = "8f3c2a10-5b7e-4d64-9a21-3c6e0d7b1a55"
	demoNorth    = "eecf5c7f-237c-443c-b331-b75ba3fb26fc"
	demoReem     = "c52b2a62-8878-4cc0-b774-1247fc153dcc"
	demoRemoteTL = "c193e1f2"
)

type demoRig struct {
	t     *testing.T
	srv   *httptest.Server
	owner *pgxpool.Pool
}

// newDemoRig: demo mode over the seeded db.
func newDemoRig(t *testing.T) *demoRig {
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
	var zones int
	if err := owner.QueryRow(ctx, `SELECT count(*) FROM zones WHERE tenant_id = $1`, demoTenant).Scan(&zones); err != nil || zones == 0 {
		t.Skip("the database is not seeded from the fixtures: skipped, not faked.")
	}
	app, err := pgxpool.New(ctx, appURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	conn := &tenancy.Connection{Pool: app}
	business.UsePostgresUsers(conn)
	if err := business.ReseedUsersForTest(ctx, &tenancy.Connection{Pool: owner}); err != nil {
		t.Fatal(err)
	}
	auditlog.ResetForTest()
	t.Cleanup(func() {
		_ = business.ReseedUsersForTest(context.Background(), &tenancy.Connection{Pool: owner})
		business.UseMemoryUsers()
		SetAuth(nil)
		auditlog.ResetForTest()
	})
	SetAuth(&Auth{Mode: "demo", Sessions: &session.Store{Conn: conn, Policy: DemoPolicy}})
	r := &demoRig{t: t, owner: owner, srv: httptest.NewServer(NewMux(conn))}
	t.Cleanup(r.srv.Close)
	return r
}

func (r *demoRig) post(c *http.Client, path, body string) *http.Response {
	r.t.Helper()
	resp, err := c.Post(r.srv.URL+path, "application/json", strings.NewReader(body))
	if err != nil {
		r.t.Fatal(err)
	}
	return resp
}

// signIn returns the status and outcome.
func (r *demoRig) signIn(c *http.Client, body string) (int, string) {
	resp := r.post(c, "/auth/demo/sign-in", body)
	defer resp.Body.Close()
	var out struct {
		Outcome string `json:"outcome"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out.Outcome
}

func (r *demoRig) me(c *http.Client) (int, business.SessionContext) {
	resp := get(r.t, c, r.srv.URL+"/me")
	defer resp.Body.Close()
	var me business.SessionContext
	_ = json.NewDecoder(resp.Body).Decode(&me)
	return resp.StatusCode, me
}

func demoEvents(outcome string) int {
	n := 0
	for _, e := range auditlog.AllEvents() {
		if e.Action == "auth.demo_sign_in" && e.Outcome == outcome {
			n++
		}
	}
	return n
}

func newBrowser() *http.Client {
	return (&signInRig{}).browser()
}

func TestDemoSignIn_StartsAnAuditedSessionWithTheChosenScope(t *testing.T) {
	r := newDemoRig(t)
	c := newBrowser()
	if code, _ := r.me(c); code != http.StatusUnauthorized {
		t.Fatalf("no session yet: got %d", code)
	}
	code, outcome := r.signIn(c, `{"assigned_role":"planner","install_mode":"shared","zone_ids":["`+demoNorth+`"]}`)
	if code != http.StatusOK || outcome != "signed_in" {
		t.Fatalf("got %d %s", code, outcome)
	}
	if demoEvents("success") != 1 {
		t.Fatal("the sign-in must be audited once")
	}
	code, me := r.me(c)
	if code != http.StatusOK || me.User.ID != demoReem || me.User.AssignedRole != "planner" || me.InstallMode != "shared" || me.Tenant.ID != demoTenant {
		t.Fatalf("got %d %+v", code, me)
	}
	if len(me.User.ZoneIDs) != 1 || me.User.ZoneIDs[0] != demoNorth {
		t.Fatalf("the chosen zones: got %v", me.User.ZoneIDs)
	}
	var stored string
	if err := r.owner.QueryRow(context.Background(), `SELECT install_mode FROM sessions WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`, demoTenant, demoReem).Scan(&stored); err != nil || stored != "shared" {
		t.Fatalf("the session row keeps the install mode: %q %v", stored, err)
	}
	resp := r.post(c, "/auth/sign-out", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("sign-out: got %d", resp.StatusCode)
	}
	if code, _ := r.me(c); code != http.StatusUnauthorized {
		t.Fatalf("signed out: got %d", code)
	}
}

func TestDemoSignIn_RefusesWhatTheSwitcherCannotOffer(t *testing.T) {
	r := newDemoRig(t)
	for _, body := range []string{
		`{"assigned_role":"emperor","install_mode":"private","zone_ids":[]}`,
		`{"assigned_role":"change_approver","install_mode":"shared","zone_ids":[]}`,
		`{"assigned_role":"planner","install_mode":"cloud","zone_ids":[]}`,
		`{"assigned_role":"planner","install_mode":"private","zone_ids":["00000000-0000-4000-8000-000000000000"]}`,
		`{"assigned_role":"planner","install_mode":"private","zone_ids":[],"tenant_id":"` + demoTenant + `"}`,
		`{"assigned_role":"planner","install_mode":"private","zone_ids":[],"user_id":"` + demoReem + `"}`,
	} {
		c := newBrowser()
		if code, _ := r.signIn(c, body); code != http.StatusBadRequest {
			t.Fatalf("%s: got %d", body, code)
		}
		if code, _ := r.me(c); code != http.StatusUnauthorized {
			t.Fatalf("%s: a refused sign-in has no session", body)
		}
	}
}

func TestDemoSignIn_ARoleNoActiveAccountHoldsGetsNoAccess(t *testing.T) {
	r := newDemoRig(t)
	ctx := context.Background()
	if _, err := r.owner.Exec(ctx, `UPDATE users SET status = 'disabled' WHERE tenant_id = $1 AND assigned_role = 'remote_team_lead'`, demoTenant); err != nil {
		t.Fatal(err)
	}
	c := newBrowser()
	code, outcome := r.signIn(c, `{"assigned_role":"remote_team_lead","install_mode":"private","zone_ids":[]}`)
	if code != http.StatusOK || outcome != "no_role_assigned" || demoEvents("denied") != 1 {
		t.Fatalf("got %d %s", code, outcome)
	}
	if code, _ := r.me(c); code != http.StatusUnauthorized {
		t.Fatal("no default role")
	}
}

func TestDemoSession_EndsWhenTheAccountLosesItsRight(t *testing.T) {
	r := newDemoRig(t)
	c := newBrowser()
	if code, outcome := r.signIn(c, `{"assigned_role":"remote_team_lead","install_mode":"private","zone_ids":[]}`); outcome != "signed_in" {
		t.Fatalf("got %d %s", code, outcome)
	}
	if _, err := r.owner.Exec(context.Background(), `UPDATE users SET status = 'disabled' WHERE tenant_id = $1 AND id::text LIKE $2`, demoTenant, demoRemoteTL+"%"); err != nil {
		t.Fatal(err)
	}
	if code, _ := r.me(c); code != http.StatusUnauthorized {
		t.Fatalf("a disabled account loses the session: got %d", code)
	}
}

func TestDemoSession_TheTenantComesFromTheSession(t *testing.T) {
	r := newDemoRig(t)
	c := newBrowser()
	r.signIn(c, `{"assigned_role":"administrator","install_mode":"private","zone_ids":[]}`)
	u, _ := url.Parse(r.srv.URL)
	var token string
	for _, ck := range c.Jar.Cookies(u) {
		if ck.Name == SessionCookie {
			token = ck.Value
		}
	}
	_, secret, ok := strings.Cut(token, ".")
	if !ok {
		t.Fatal("no session cookie")
	}
	forged := newBrowser()
	forged.Jar.SetCookies(u, []*http.Cookie{{Name: SessionCookie, Value: uuidNew() + "." + secret}})
	if code, _ := r.me(forged); code != http.StatusUnauthorized {
		t.Fatalf("another customer's prefix: got %d", code)
	}
	req, _ := http.NewRequest(http.MethodGet, r.srv.URL+"/me?tenant_id="+uuidNew(), nil)
	req.Header.Set("X-Tenant-Id", uuidNew())
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var me business.SessionContext
	_ = json.NewDecoder(resp.Body).Decode(&me)
	if me.Tenant.ID != demoTenant {
		t.Fatalf("got tenant %s", me.Tenant.ID)
	}
}

func TestDemoOptions_ListZonesAndRolesPerInstallMode(t *testing.T) {
	r := newDemoRig(t)
	resp := get(t, newBrowser(), r.srv.URL+"/auth/demo/options")
	defer resp.Body.Close()
	var got business.DemoOptions
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("got %d %v", resp.StatusCode, err)
	}
	if got.TenantID != demoTenant || len(got.Zones) == 0 || got.Zones[0].CityName == "" {
		t.Fatalf("got %+v", got)
	}
	if got.CustomerName != "Example Response (synthetic)" || got.CustomerNameAr != "مثال للاستجابة (بيانات اصطناعية)" {
		t.Fatalf("customer names %q %q", got.CustomerName, got.CustomerNameAr)
	}
	has := func(mode, role string) bool {
		for m, roles := range got.RolesByInstallMode {
			if string(m) != mode {
				continue
			}
			for _, x := range roles {
				if string(x) == role {
					return true
				}
			}
		}
		return false
	}
	if !has("private", "change_approver") || has("shared", "change_approver") || !has("shared", "planner") {
		t.Fatalf("roles per mode: %+v", got.RolesByInstallMode)
	}
}
