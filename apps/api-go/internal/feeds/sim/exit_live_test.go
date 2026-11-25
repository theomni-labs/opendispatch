// SPDX-License-Identifier: AGPL-3.0-only

// Live: end-to-end test, a full synthetic day through the signed feeds.
package sim_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds/sim"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/httpapi"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const tenant = "8f3c2a10-5b7e-4d64-9a21-3c6e0d7b1a55"

func pools(t *testing.T) (owner, app *pgxpool.Pool) {
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
	dir, _ := filepath.Abs(filepath.Join("..", "..", "..", "migrations"))
	if _, err := tenancy.ApplyMigrations(ctx, tenancy.ApplyMigrationsOptions{Pool: owner, Dir: dir}); err != nil {
		t.Fatal(err)
	}
	app, err = pgxpool.New(ctx, appURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	return owner, app
}

func randomSecret(t *testing.T) string {
	t.Helper()
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b[:])
}

type rig struct {
	owner  *pgxpool.Pool
	store  *feeds.Store
	server *httptest.Server
	sender *sim.Sender
	busy   func() bool
	ids    []string
}

func newRig(t *testing.T) *rig {
	t.Helper()
	owner, app := pools(t)
	var zones int
	if err := owner.QueryRow(context.Background(), `SELECT count(*) FROM zones WHERE tenant_id = $1 AND external_id IS NOT NULL`, tenant).Scan(&zones); err != nil || zones == 0 {
		t.Skip("the database is not seeded from the fixtures (pnpm seed:postgres): skipped, not faked.")
	}
	t.Setenv("FEED_TEST_SECRET", randomSecret(t))
	keys, err := feeds.NewKeys([]feeds.Key{{ID: "sim", TenantID: tenant, SecretEnv: "FEED_TEST_SECRET", Status: "active", DataSource: "SYNTHETIC"}})
	if err != nil {
		t.Fatal(err)
	}
	key, _ := keys.Lookup("sim", time.Now())
	r := &rig{owner: owner, store: &feeds.Store{Conn: &tenancy.Connection{Pool: app}}}
	f := &httpapi.Feeds{Keys: keys, Store: r.store, Busy: func(string) bool { return r.busy != nil && r.busy() }}
	httpapi.SetFeeds(f)
	t.Cleanup(func() { httpapi.SetFeeds(nil) })
	mux := http.NewServeMux()
	httpapi.RegisterFeedRoutes(mux)
	r.server = httptest.NewServer(mux)
	t.Cleanup(r.server.Close)
	r.sender = &sim.Sender{URL: r.server.URL, Key: key}
	day, err := sim.LoadDay(filepath.Join("..", "..", "..", "..", "..", "fixtures"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range day.Cases {
		if strings.HasSuffix(e.IdempotencyKey, ":registered") {
			r.ids = append(r.ids, e.Case.ExternalID)
		}
	}
	r.clean(t)
	t.Cleanup(func() { r.clean(t) })
	return r
}

// clean removes everything the feeds wrote, so a run starts and ends at the baseline.
func (r *rig) clean(t *testing.T) {
	t.Helper()
	for _, q := range []string{
		`DELETE FROM assignment_events WHERE tenant_id = $1 AND case_id IN (SELECT id FROM cases WHERE tenant_id = $1 AND (external_id = ANY($2) OR external_id LIKE 'http-%'))`,
		`DELETE FROM assignments WHERE tenant_id = $1 AND case_id IN (SELECT id FROM cases WHERE tenant_id = $1 AND (external_id = ANY($2) OR external_id LIKE 'http-%'))`,
		`DELETE FROM feed_events WHERE tenant_id = $1`,
		`DELETE FROM agent_status_history WHERE tenant_id = $1`,
		`DELETE FROM agent_live_state WHERE tenant_id = $1`,
		`DELETE FROM cases WHERE tenant_id = $1 AND (external_id = ANY($2) OR external_id LIKE 'http-%')`,
	} {
		args := []any{tenant}
		if strings.Contains(q, "$2") {
			args = append(args, r.ids)
		}
		if _, err := r.owner.Exec(context.Background(), q, args...); err != nil {
			t.Fatal(err)
		}
	}
}

func (r *rig) drainAll(t *testing.T) feeds.Tally {
	t.Helper()
	var total feeds.Tally
	for {
		got, err := r.store.Drain(context.Background(), tenant, "SYNTHETIC", feeds.MaxBatch)
		if err != nil {
			t.Fatal(err)
		}
		total.Applied, total.Stale, total.Rejected = total.Applied+got.Applied, total.Stale+got.Stale, total.Rejected+got.Rejected
		if got.Applied+got.Stale+got.Rejected == 0 {
			return total
		}
	}
}

func TestADaySurvivesDuplicatesReorderingAnOutageAndMaintenance(t *testing.T) {
	r := newRig(t)
	day, err := sim.LoadDay(filepath.Join("..", "..", "..", "..", "..", "fixtures"))
	if err != nil {
		t.Fatal(err)
	}
	requests := 0
	r.busy = func() bool { requests++; return requests >= 8 && requests <= 10 }
	opt := sim.Options{Seed: 7, DuplicateRate: 0.15, ReorderWindow: 25, BatchSize: 80, Down: func(b int) bool { return b >= 3 && b <= 5 }}
	var tally feeds.Tally
	after := func(int) {
		got := r.drainAll(t)
		tally.Applied, tally.Stale, tally.Rejected = tally.Applied+got.Applied, tally.Stale+got.Stale, tally.Rejected+got.Rejected
	}
	ctx := context.Background()
	caseRep, err := r.sender.Replay(ctx, "/feeds/v1/cases", sim.Raw(day.Cases), opt, after)
	if err != nil {
		t.Fatal(err)
	}
	statusRep, err := r.sender.Replay(ctx, "/feeds/v1/agent-status", sim.Raw(day.Statuses), opt, after)
	if err != nil {
		t.Fatal(err)
	}
	if caseRep.Retries == 0 || caseRep.Maintenance == 0 || caseRep.Duplicates == 0 {
		t.Fatalf("the faults were not injected: %+v", caseRep)
	}
	t.Logf("cases: %+v; status: %+v; applied %+v", caseRep, statusRep, tally)

	// None lost, none duplicated: every case once, each in its final state.
	var stored, distinct int
	if err := r.owner.QueryRow(ctx, `SELECT count(*), count(DISTINCT external_id) FROM cases WHERE tenant_id = $1 AND external_id = ANY($2)`, tenant, r.ids).Scan(&stored, &distinct); err != nil {
		t.Fatal(err)
	}
	if stored != day.Cases759 || distinct != day.Cases759 {
		t.Fatalf("stored %d cases (%d distinct), want %d", stored, distinct, day.Cases759)
	}
	var wrong int
	if err := r.owner.QueryRow(ctx, `SELECT count(*) FROM cases c WHERE c.tenant_id = $1 AND c.external_id = ANY($2)
		AND c.assigned_at IS NOT NULL AND (c.agent_id IS NULL OR c.closed_at IS NULL OR c.arrived_at IS NULL)`, tenant, r.ids).Scan(&wrong); err != nil {
		t.Fatal(err)
	}
	if wrong != 0 {
		t.Fatalf("%d cases did not reach their final state", wrong)
	}
	want := map[string]feeds.CaseEvent{}
	for _, e := range day.Cases {
		if cur, ok := want[e.Case.ExternalID]; !ok || e.Case.UpdatedAt.After(cur.Case.UpdatedAt) {
			want[e.Case.ExternalID] = e
		}
	}
	rows, err := r.owner.Query(ctx, `SELECT external_id, updated_at FROM cases WHERE tenant_id = $1 AND external_id = ANY($2)`, tenant, r.ids)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var ext string
		var updated time.Time
		if err := rows.Scan(&ext, &updated); err != nil {
			t.Fatal(err)
		}
		if !updated.Equal(want[ext].Case.UpdatedAt) {
			t.Fatalf("case %s is at %s, the last version is %s", ext, updated, want[ext].Case.UpdatedAt)
		}
	}
	rows.Close()

	// Every event was kept once and dealt with; retries and duplicates added nothing.
	if want, got := len(day.Cases)+len(day.Statuses), tally.Applied+tally.Stale+tally.Rejected; want != got || tally.Rejected != 0 {
		t.Fatalf("events dealt with: %d, want %d, none rejected (%+v)", got, want, tally)
	}
	if tally.Stale == 0 {
		t.Fatal("the reordering never produced a late event; the ordering rule was not exercised")
	}
	health, err := r.store.Health(ctx, tenant)
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range health {
		if h.Queued != 0 || h.Rejected != 0 || h.Applied+h.Stale != len(day.Cases) || h.LastReceived == nil || h.LastApplied == nil {
			t.Fatalf("feed health after the day: %+v, want %d events, all dealt with", h, len(day.Cases))
		}
	}
	var history int
	if err := r.owner.QueryRow(ctx, `SELECT count(*) FROM agent_status_history WHERE tenant_id = $1`, tenant).Scan(&history); err != nil {
		t.Fatal(err)
	}
	if history != len(day.Statuses) {
		t.Fatalf("status history has %d rows, want %d", history, len(day.Statuses))
	}
	// The live state of each agent is the newest event, however it arrived.
	newest := map[string]time.Time{}
	for _, e := range day.Statuses {
		if e.OccurredAt.After(newest[e.AgentCode]) {
			newest[e.AgentCode] = e.OccurredAt
		}
	}
	srows, err := r.owner.Query(ctx, `SELECT s.code, l.occurred_at FROM agent_live_state l JOIN agents s ON s.tenant_id = l.tenant_id AND s.id = l.agent_id WHERE l.tenant_id = $1`, tenant)
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for srows.Next() {
		var code string
		var at time.Time
		if err := srows.Scan(&code, &at); err != nil {
			t.Fatal(err)
		}
		seen++
		if !at.Equal(newest[code]) {
			t.Fatalf("agent %s is at %s, the newest event is %s", code, at, newest[code])
		}
	}
	srows.Close()
	if seen != len(newest) {
		t.Fatalf("%d agents have a live state, want %d", seen, len(newest))
	}
}
