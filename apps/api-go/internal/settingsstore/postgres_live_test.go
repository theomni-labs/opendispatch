// SPDX-License-Identifier: AGPL-3.0-only

// Live: settings kept in Postgres, one set per customer.
package settingsstore

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func newTenant() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = (b[6]&0x0f)|0x40, (b[8]&0x3f)|0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

func livePool(t *testing.T) *tenancy.Connection {
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
	t.Cleanup(UseMemory)
	return &tenancy.Connection{Pool: app}
}

func TestPostgres_RoundTripIsolationAndRestart(t *testing.T) {
	conn := livePool(t)
	UsePostgres(conn)
	a, b := newTenant(), newTenant()

	if got, err := Get(context.Background(), a, "k.str", "fallback"); err != nil || got != "fallback" {
		t.Fatalf("an unset key gives the fallback: %q %v", got, err)
	}
	for key, value := range map[string]any{"k.str": "v", "k.int": 42, "k.bool": true, "k.list": []string{"x", "y"}, "k.obj": map[string]any{"n": 1}} {
		if err := Put(context.Background(), a, key, value); err != nil {
			t.Fatal(err)
		}
	}
	if got, _ := Get(context.Background(), a, "k.int", 0); got != 42 {
		t.Fatalf("int: %d", got)
	}
	if got, _ := Get(context.Background(), a, "k.list", []string{}); len(got) != 2 || got[1] != "y" {
		t.Fatalf("list: %v", got)
	}
	// Another customer sees none of it, and its own value is its own.
	if got, _ := Get(context.Background(), b, "k.str", "fallback"); got != "fallback" {
		t.Fatalf("customer b read customer a's setting: %q", got)
	}
	if err := Put(context.Background(), b, "k.str", "b-value"); err != nil {
		t.Fatal(err)
	}
	if got, _ := Get(context.Background(), a, "k.str", ""); got != "v" {
		t.Fatalf("a's value changed by b: %q", got)
	}
	if es, _ := Entries(context.Background(), b); len(es) != 1 {
		t.Fatalf("b has %d entries, want 1", len(es))
	}
	if err := DeletePrefix(context.Background(), a, "k.l"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := Has(context.Background(), a, "k.list"); ok {
		t.Fatal("the prefix delete left a key")
	}
	if ok, _ := Has(context.Background(), a, "k.str"); !ok {
		t.Fatal("the prefix delete removed too much")
	}
	if ok, _ := Has(context.Background(), b, "k.str"); !ok {
		t.Fatal("the prefix delete of a reached b")
	}

	// A restart: a new backend on a new pool reads what the old one wrote.
	UseMemory()
	UsePostgres(conn)
	if got, _ := Get(context.Background(), a, "k.str", ""); got != "v" {
		t.Fatalf("after a restart: %q", got)
	}
}

func TestPostgres_PutManyIsAllOrNothing(t *testing.T) {
	conn := livePool(t)
	UsePostgres(conn)
	a := newTenant()
	if err := PutMany(context.Background(), a, KV{Key: "m.one", Value: 1}, KV{Key: "m.bad", Value: make(chan int)}); err == nil {
		t.Fatal("a value that cannot be stored must fail the whole write")
	}
	if ok, _ := Has(context.Background(), a, "m.one"); ok {
		t.Fatal("part of a failed PutMany was kept")
	}
	if err := PutMany(context.Background(), a, KV{Key: "m.one", Value: 1}, KV{Key: "m.two", Value: 2}); err != nil {
		t.Fatal(err)
	}
	if got, _ := Get(context.Background(), a, "m.two", 0); got != 2 {
		t.Fatalf("m.two: %d", got)
	}
}

func TestPostgres_IncrCountsEveryConcurrentCall(t *testing.T) {
	conn := livePool(t)
	UsePostgres(conn)
	a := newTenant()
	const n = 25
	var wg sync.WaitGroup
	seen := make(chan int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, err := Incr(context.Background(), a, "fail.count")
			if err != nil {
				t.Error(err)
				return
			}
			seen <- v
		}()
	}
	wg.Wait()
	close(seen)
	distinct := map[int]bool{}
	for v := range seen {
		distinct[v] = true
	}
	if len(distinct) != n {
		t.Fatalf("%d concurrent increments gave %d distinct values: a count was lost", n, len(distinct))
	}
	if got, _ := Get(context.Background(), a, "fail.count", 0); got != n {
		t.Fatalf("count %d, want %d", got, n)
	}
	if err := Put(context.Background(), a, "fail.count", 0); err != nil {
		t.Fatal(err)
	}
	if v, _ := Incr(context.Background(), a, "fail.count"); v != 1 {
		t.Fatalf("after a reset the next is %d, want 1", v)
	}
}

func TestPostgres_AddGivesAnAttemptBackAndNeverGoesBelowZero(t *testing.T) {
	conn := livePool(t)
	UsePostgres(conn)
	a := newTenant()
	if v, _ := Incr(context.Background(), a, "tries"); v != 1 {
		t.Fatalf("first attempt: %d", v)
	}
	if v, _ := Add(context.Background(), a, "tries", -1); v != 0 {
		t.Fatalf("given back: %d", v)
	}
	if v, _ := Add(context.Background(), a, "tries", -1); v != 0 {
		t.Fatalf("never below zero: %d", v)
	}
	if v, _ := Add(context.Background(), a, "fresh", -3); v != 0 {
		t.Fatalf("an unset key goes to zero, not below: %d", v)
	}
}

func TestPostgres_SwapLetsOneOfTwoStaleWritersWin(t *testing.T) {
	conn := livePool(t)
	UsePostgres(conn)
	a := newTenant()
	if ok, err := Swap(context.Background(), a, "s.one", "", map[string]int{"n": 1}); !ok || err != nil {
		t.Fatalf("insert: %v %v", ok, err)
	}
	_, stamp, err := GetStamped(context.Background(), a, "s.one", map[string]int{})
	if err != nil || stamp == "" {
		t.Fatalf("stamp %q %v", stamp, err)
	}
	first, _ := Swap(context.Background(), a, "s.one", stamp, map[string]int{"n": 2})
	second, _ := Swap(context.Background(), a, "s.one", stamp, map[string]int{"n": 3})
	if !first || second {
		t.Fatalf("first %v second %v: only the first may win", first, second)
	}
	if got, _ := Get(context.Background(), a, "s.one", map[string]int{}); got["n"] != 2 {
		t.Fatalf("stored %v", got)
	}
	if _, other, _ := GetStamped(context.Background(), newTenant(), "s.one", map[string]int{}); other != "" {
		t.Fatal("another customer sees the key")
	}
}
