// SPDX-License-Identifier: AGPL-3.0-only

// Live-Postgres helper. Skips, never fakes, unset.
package tenancy

import (
	"context"
	"crypto/rand"
	"fmt"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const noLiveDBReason = "OPENDISPATCH_TEST_DATABASE_URL is not set: skipped, not faked."

// liveTestDatabaseURL mirrors live-db.ts.
func liveTestDatabaseURL() string {
	return os.Getenv("OPENDISPATCH_TEST_DATABASE_URL")
}

// openLiveTestPool skips t with no live DB set.
func openLiveTestPool(t *testing.T, maxConns int32) *pgxpool.Pool {
	t.Helper()
	dbURL := liveTestDatabaseURL()
	if dbURL == "" {
		t.Skip(noLiveDBReason)
	}
	return openTestPoolAt(t, dbURL, maxConns)
}

// openTestPoolAt: any url, not env-gated.
func openTestPoolAt(t *testing.T, dbURL string, maxConns int32) *pgxpool.Pool {
	t.Helper()
	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		t.Fatalf("bad database url: %v", err)
	}
	if maxConns > 0 {
		cfg.MaxConns = maxConns
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// withCredentials swaps a url's user and password.
func withCredentials(t *testing.T, baseURL, username, password string) string {
	t.Helper()
	u, err := url.Parse(baseURL)
	if err != nil {
		t.Fatalf("bad base url: %v", err)
	}
	u.User = url.UserPassword(username, password)
	return u.String()
}

func mustExec(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

// drainErr: pgx Query is lazy; reads surface errors.
func drainErr(ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) error {
	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return err
	}
	for rows.Next() {
	}
	rows.Close()
	return rows.Err()
}

// insertRow: an insert under WithTenant(tenantID).
func insertRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID, sql string) {
	t.Helper()
	_, err := WithTenant(ctx, pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, sql, tenantID)
		return struct{}{}, err
	})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
}

// stringColumn: one text column, under WithTenant.
func stringColumn(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID, sql string) []string {
	t.Helper()
	out, err := WithTenant(ctx, pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]string, error) {
		rows, err := tx.Query(ctx, sql)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var values []string
		for rows.Next() {
			var v string
			if err := rows.Scan(&v); err != nil {
				return nil, err
			}
			values = append(values, v)
		}
		return values, rows.Err()
	})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	return out
}

// countRows: row count under WithTenant(tenantID).
func countRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID, sql string) int {
	t.Helper()
	n, err := WithTenant(ctx, pool, tenantID, func(ctx context.Context, tx pgx.Tx) (int, error) {
		rows, err := tx.Query(ctx, sql)
		if err != nil {
			return 0, err
		}
		defer rows.Close()
		count := 0
		for rows.Next() {
			count++
		}
		return count, rows.Err()
	})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	return n
}

func queryNames(ctx context.Context, tx pgx.Tx, schema string) ([]string, error) {
	rows, err := tx.Query(ctx, `SELECT name FROM `+schema+`.widgets ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

// newUUIDv4: no dep for one throwaway id per run.
func newUUIDv4() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
