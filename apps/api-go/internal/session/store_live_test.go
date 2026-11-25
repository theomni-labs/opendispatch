// SPDX-License-Identifier: AGPL-3.0-only

// Live: the sessions table.
package session

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

type rig struct {
	store *Store
	owner *pgxpool.Pool
	now   time.Time
}

// newRig: migrate as owner, use the store as the application role, with a clock the test moves.
func newRig(t *testing.T, policy Policy) *rig {
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
	r := &rig{owner: owner, now: time.Now().UTC().Truncate(time.Second)}
	r.store = &Store{Conn: &tenancy.Connection{Pool: app}, Policy: func(string) (Policy, error) { return policy, nil }, Now: func() time.Time { return r.now }}
	return r
}

// person makes a users row (a session's foreign key) in a fresh tenant.
func (r *rig) person(t *testing.T, tenantID string) string {
	t.Helper()
	id := newUUID()
	if _, err := r.owner.Exec(context.Background(), `INSERT INTO users (tenant_id, id, data_source, email, display_name, assigned_role, status, preferred_locale)
		VALUES ($1, $2, 'SYNTHETIC', $3, 'Test', 'viewer_auditor', 'active', 'en')`, tenantID, id, id+"@test.example"); err != nil {
		t.Fatal(err)
	}
	return id
}

var standard = Policy{Idle: 30 * time.Minute, Absolute: 8 * time.Hour, MaxConcurrent: 3}

func TestSession_CreateThenLookupFindsThePerson(t *testing.T) {
	r := newRig(t, standard)
	tenant := newUUID()
	user := r.person(t, tenant)
	token, created, err := r.store.Create(context.Background(), tenant, user)
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.store.Lookup(context.Background(), token)
	if err != nil || got == nil || got.UserID != user || got.TenantID != tenant || got.ID != created.ID {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestSession_TheDatabaseKeepsOnlyAHash(t *testing.T) {
	r := newRig(t, standard)
	tenant := newUUID()
	token, _, err := r.store.Create(context.Background(), tenant, r.person(t, tenant))
	if err != nil {
		t.Fatal(err)
	}
	secret := token[strings.Index(token, ".")+1:]
	var n int
	if err := r.owner.QueryRow(context.Background(), `SELECT count(*) FROM sessions WHERE tenant_id = $1 AND encode(token_hash, 'escape') LIKE '%' || $2 || '%'`, tenant, secret[:12]).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("the token itself must not be stored")
	}
}

func TestSession_IdleAndAbsoluteTimeouts(t *testing.T) {
	r := newRig(t, standard)
	tenant := newUUID()
	token, _, err := r.store.Create(context.Background(), tenant, r.person(t, tenant))
	if err != nil {
		t.Fatal(err)
	}
	// Active use slides the idle deadline: a lookup every 20 minutes keeps it alive well past 30 minutes in total.
	for i := 0; i < 4; i++ {
		r.now = r.now.Add(20 * time.Minute)
		if got, err := r.store.Lookup(context.Background(), token); err != nil || got == nil {
			t.Fatalf("active use at +%d min: %v %v", (i+1)*20, got, err)
		}
	}
	// Left alone for longer than the idle timeout, it ends.
	r.now = r.now.Add(31 * time.Minute)
	if got, _ := r.store.Lookup(context.Background(), token); got != nil {
		t.Fatal("an idle session must have ended")
	}
	// The absolute length ends a session however active it is.
	token, _, err = r.store.Create(context.Background(), tenant, r.person(t, tenant))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 20; i++ {
		r.now = r.now.Add(25 * time.Minute)
		got, _ := r.store.Lookup(context.Background(), token)
		if r.now.Sub(r.now.Add(-time.Duration(i+1)*25*time.Minute)) > 8*time.Hour && got != nil {
			t.Fatal("a session past its length must have ended")
		}
		if got == nil {
			if time.Duration(i+1)*25*time.Minute < 8*time.Hour {
				t.Fatalf("ended too early at +%d min", (i+1)*25)
			}
			return
		}
	}
	t.Fatal("the session never ended")
}

func TestSession_LogoutAndDisableEndSessions(t *testing.T) {
	r := newRig(t, standard)
	tenant := newUUID()
	user := r.person(t, tenant)
	a, _, _ := r.store.Create(context.Background(), tenant, user)
	b, _, _ := r.store.Create(context.Background(), tenant, user)
	if err := r.store.Revoke(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.store.Lookup(context.Background(), a); got != nil {
		t.Fatal("a signed-out session must be dead")
	}
	if got, _ := r.store.Lookup(context.Background(), b); got == nil {
		t.Fatal("the other session must live")
	}
	if err := r.store.RevokeUser(context.Background(), tenant, user); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.store.Lookup(context.Background(), b); got != nil {
		t.Fatal("disabling the person must end every session")
	}
	if err := r.store.Revoke(context.Background(), "nonsense"); err != nil {
		t.Fatalf("revoking an unknown value is not an error: %v", err)
	}
}

func TestSession_ThePolicyCapsLiveSessionsPerPerson(t *testing.T) {
	r := newRig(t, Policy{Idle: time.Hour, Absolute: 8 * time.Hour, MaxConcurrent: 2})
	tenant := newUUID()
	user := r.person(t, tenant)
	var tokens []string
	for i := 0; i < 3; i++ {
		r.now = r.now.Add(time.Second)
		token, _, err := r.store.Create(context.Background(), tenant, user)
		if err != nil {
			t.Fatal(err)
		}
		tokens = append(tokens, token)
	}
	if got, _ := r.store.Lookup(context.Background(), tokens[0]); got != nil {
		t.Fatal("the oldest session must have ended when the third began")
	}
	for _, token := range tokens[1:] {
		if got, _ := r.store.Lookup(context.Background(), token); got == nil {
			t.Fatal("the two newest sessions must live")
		}
	}
}

func TestSession_ACookieOnlyWorksInItsOwnCustomer(t *testing.T) {
	r := newRig(t, standard)
	a, b := newUUID(), newUUID()
	tokenA, _, err := r.store.Create(context.Background(), a, r.person(t, a))
	if err != nil {
		t.Fatal(err)
	}
	secret := tokenA[strings.Index(tokenA, ".")+1:]
	// The same secret with another customer's hint finds nothing: that customer's rows are a different set.
	if got, _ := r.store.Lookup(context.Background(), b+"."+secret); got != nil {
		t.Fatal("a session must not cross customers")
	}
	for _, bad := range []string{"", "x", a + ".short", a + "." + strings.Repeat("A", 43) /* right shape, wrong secret */, "not-a-uuid." + secret} {
		if got, err := r.store.Lookup(context.Background(), bad); got != nil || err != nil {
			t.Fatalf("%q: got %v, %v", bad, got, err)
		}
	}
}

func TestSession_NoTenantSetFailsOnTheTable(t *testing.T) {
	r := newRig(t, standard)
	var n int
	if r.store.Conn.Pool.QueryRow(context.Background(), `SELECT count(*) FROM sessions`).Scan(&n) == nil {
		t.Fatal("a query with no tenant set must fail")
	}
}

func TestSession_DemoScopeRoundTripsAndRealSessionsHaveNone(t *testing.T) {
	r := newRig(t, Policy{Idle: time.Hour, Absolute: 12 * time.Hour})
	tenant := newUUID()
	user := r.person(t, tenant)
	zone := newUUID()
	demo, _, err := r.store.CreateDemo(context.Background(), tenant, user, DemoScope{InstallMode: "shared", ZoneIDs: []string{zone}})
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.store.Lookup(context.Background(), demo)
	if err != nil || got == nil || got.Demo == nil || got.Demo.InstallMode != "shared" || len(got.Demo.ZoneIDs) != 1 || got.Demo.ZoneIDs[0] != zone {
		t.Fatalf("demo scope lost: %+v %v", got, err)
	}
	own, _, err := r.store.CreateDemo(context.Background(), tenant, user, DemoScope{InstallMode: "private"})
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := r.store.Lookup(context.Background(), own); got == nil || got.Demo == nil || got.Demo.ZoneIDs != nil {
		t.Fatalf("own zones must stay nil: %+v", got)
	}
	plain, _, err := r.store.Create(context.Background(), tenant, user)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := r.store.Lookup(context.Background(), plain); got == nil || got.Demo != nil {
		t.Fatalf("a real session has no demo scope: %+v", got)
	}
	if _, err := r.owner.Exec(context.Background(), `INSERT INTO sessions (tenant_id, user_id, token_hash, idle_expires_at, absolute_expires_at, install_mode) VALUES ($1, $2, 'x', now(), now(), 'cloud')`, tenant, user); err == nil {
		t.Fatal("an unknown install mode must be refused")
	}
}
