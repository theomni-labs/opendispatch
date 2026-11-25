// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors migration-runner.live.test.ts, in order.
package tenancy

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func migrationHeaderText(needsDowntime, nonTransactional, requiresRestore bool, reason string) string {
	lines := []string{
		fmt.Sprintf("-- needs_downtime: %v", needsDowntime),
		fmt.Sprintf("-- non_transactional: %v", nonTransactional),
		fmt.Sprintf("-- requires_restore_to_rollback: %v", requiresRestore),
	}
	if reason != "" {
		lines = append(lines, "-- reason: "+reason)
	}
	return strings.Join(lines, "\n") + "\n"
}

func writeMigrationFile(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func TestApplyMigrations_LivePostgres(t *testing.T) {
	owner := openLiveTestPool(t, 5)
	ctx := context.Background()
	schema := fmt.Sprintf("mig_live_%d", time.Now().UnixNano())

	if _, err := owner.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	t.Cleanup(func() {
		owner.Exec(ctx, `DROP SCHEMA IF EXISTS `+schema+` CASCADE`) //nolint:errcheck
		// Shared tracking table; drop this suite's rows.
		owner.Exec(ctx, `DELETE FROM `+trackingTable+` WHERE filename LIKE $1`, schema+"%") //nolint:errcheck
	})

	t.Run("applies files in filename order and records each with a checksum", func(t *testing.T) {
		dir := t.TempDir()
		fileA := schema + "_0001_a.sql"
		fileB := schema + "_0002_b.sql"
		writeMigrationFile(t, dir, fileA, migrationHeaderText(false, false, false, "")+fmt.Sprintf("CREATE TABLE %s.a (id int);", schema))
		writeMigrationFile(t, dir, fileB, migrationHeaderText(false, false, false, "")+fmt.Sprintf("CREATE TABLE %s.b (id int);", schema))

		results, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: dir})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(results) != 2 || results[0].FileName != fileA || results[1].FileName != fileB {
			t.Fatalf("got %+v", results)
		}
		for _, r := range results {
			if !r.Applied {
				t.Errorf("%s: Applied = false, want true", r.FileName)
			}
		}

		rows, err := owner.Query(ctx, `SELECT filename, checksum FROM `+trackingTable+` WHERE filename LIKE $1 ORDER BY filename`, schema+"%")
		if err != nil {
			t.Fatalf("query tracked: %v", err)
		}
		var tracked []string
		for rows.Next() {
			var fn, cs string
			if err := rows.Scan(&fn, &cs); err != nil {
				t.Fatal(err)
			}
			if cs == "" {
				t.Errorf("%s: empty checksum", fn)
			}
			tracked = append(tracked, fn)
		}
		if !equalStrings(tracked, []string{fileA, fileB}) {
			t.Errorf("tracked = %v, want [%s %s]", tracked, fileA, fileB)
		}

		tableRows, err := owner.Query(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`, schema)
		if err != nil {
			t.Fatalf("query tables: %v", err)
		}
		var tables []string
		for tableRows.Next() {
			var name string
			if err := tableRows.Scan(&name); err != nil {
				t.Fatal(err)
			}
			tables = append(tables, name)
		}
		if !equalStrings(tables, []string{"a", "b"}) {
			t.Errorf("tables = %v, want [a b]", tables)
		}
	})

	t.Run("a second run against the same files applies nothing again (idempotent)", func(t *testing.T) {
		dir := t.TempDir()
		file := schema + "_0003_c.sql"
		writeMigrationFile(t, dir, file, migrationHeaderText(false, false, false, "")+fmt.Sprintf("CREATE TABLE %s.c (id int);", schema))

		first, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: dir})
		if err != nil || len(first) != 1 || !first[0].Applied {
			t.Fatalf("first run: results=%+v err=%v", first, err)
		}
		second, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: dir})
		if err != nil || len(second) != 1 || second[0].Applied {
			t.Fatalf("second run: results=%+v err=%v", second, err)
		}
	})

	t.Run("refuses to reapply a file whose content changed after it was applied", func(t *testing.T) {
		dir := t.TempDir()
		file := schema + "_0004_d.sql"
		writeMigrationFile(t, dir, file, migrationHeaderText(false, false, false, "")+fmt.Sprintf("CREATE TABLE %s.d (id int);", schema))
		if _, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: dir}); err != nil {
			t.Fatalf("first run: %v", err)
		}

		writeMigrationFile(t, dir, file, migrationHeaderText(false, false, false, "")+fmt.Sprintf("CREATE TABLE %s.d_edited (id int);", schema))
		_, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: dir})
		var checksumErr *MigrationChecksumError
		if !errors.As(err, &checksumErr) {
			t.Fatalf("got %v, want *MigrationChecksumError", err)
		}
	})

	t.Run("a transactional migration rolls back entirely when a later statement fails", func(t *testing.T) {
		dir := t.TempDir()
		file := schema + "_0005_e.sql"
		writeMigrationFile(t, dir, file,
			migrationHeaderText(false, false, false, "")+
				fmt.Sprintf("CREATE TABLE %s.e_rollback (id int);\nINSERT INTO %s.does_not_exist VALUES (1);", schema, schema))
		if _, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: dir}); err == nil {
			t.Fatal("want an error")
		}

		var count int
		err := owner.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'e_rollback'`, schema).Scan(&count)
		if err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Errorf("e_rollback exists; the failed statement's CREATE TABLE should have rolled back")
		}
	})

	t.Run("non_transactional lets CREATE INDEX CONCURRENTLY actually run", func(t *testing.T) {
		// Postgres refuses CONCURRENTLY in a transaction.
		if _, err := owner.Exec(ctx, fmt.Sprintf("CREATE TABLE %s.f_concurrent (id int)", schema)); err != nil {
			t.Fatalf("setup table: %v", err)
		}

		transactionalDir := t.TempDir()
		writeMigrationFile(t, transactionalDir, schema+"_0006a_f.sql",
			migrationHeaderText(false, false, false, "")+fmt.Sprintf("CREATE INDEX f_idx_txn ON %s.f_concurrent USING btree (id);", schema))
		// Sanity check: an ordinary index must succeed.
		if _, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: transactionalDir}); err != nil {
			t.Fatalf("ordinary index: %v", err)
		}

		concurrentTxnDir := t.TempDir()
		writeMigrationFile(t, concurrentTxnDir, schema+"_0006b_f.sql",
			migrationHeaderText(false, false, false, "")+fmt.Sprintf("CREATE INDEX CONCURRENTLY f_idx_bad ON %s.f_concurrent (id);", schema))
		if _, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: concurrentTxnDir}); err == nil {
			t.Fatal("want CONCURRENTLY inside a transaction block to fail")
		}

		concurrentDir := t.TempDir()
		writeMigrationFile(t, concurrentDir, schema+"_0006c_f.sql",
			migrationHeaderText(false, true, false, "")+fmt.Sprintf("CREATE INDEX CONCURRENTLY f_idx_good ON %s.f_concurrent (id);", schema))
		if _, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: concurrentDir}); err != nil {
			t.Fatalf("non_transactional CONCURRENTLY: %v", err)
		}

		rows, err := owner.Query(ctx, `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'f_concurrent' ORDER BY indexname`, schema)
		if err != nil {
			t.Fatal(err)
		}
		var indexes []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				t.Fatal(err)
			}
			indexes = append(indexes, name)
		}
		if !equalStrings(indexes, []string{"f_idx_good", "f_idx_txn"}) {
			t.Errorf("indexes = %v, want [f_idx_good f_idx_txn]", indexes)
		}
	})

	t.Run("requires a reason when requires_restore_to_rollback is true", func(t *testing.T) {
		dir := t.TempDir()
		writeMigrationFile(t, dir, schema+"_0007_g.sql",
			"-- needs_downtime: false\n-- non_transactional: false\n-- requires_restore_to_rollback: true\nSELECT 1;")
		_, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: dir})
		if err == nil || !strings.Contains(err.Error(), "reason") {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("a second concurrent run fails fast while the first holds the lock", func(t *testing.T) {
		holder := openLiveTestPool(t, 1)
		var got bool
		if err := holder.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtext('opendispatch:schema_migrations'), 0)`).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if !got {
			t.Fatal("holder failed to take the advisory lock")
		}
		defer holder.Exec(ctx, `SELECT pg_advisory_unlock(hashtext('opendispatch:schema_migrations'), 0)`) //nolint:errcheck

		dir := t.TempDir()
		writeMigrationFile(t, dir, schema+"_0008_h.sql", migrationHeaderText(false, false, false, "")+fmt.Sprintf("CREATE TABLE %s.h (id int);", schema))
		_, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: dir})
		var lockErr *MigrationLockError
		if !errors.As(err, &lockErr) {
			t.Fatalf("got %v, want *MigrationLockError", err)
		}
	})

	t.Run("the lock is released after a run, so a following run can proceed", func(t *testing.T) {
		dir := t.TempDir()
		writeMigrationFile(t, dir, schema+"_0009_i.sql", migrationHeaderText(false, false, false, "")+fmt.Sprintf("CREATE TABLE %s.i (id int);", schema))
		if _, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: dir}); err != nil {
			t.Fatalf("want no MigrationLockError, got: %v", err)
		}
	})
}

// Order-sensitive: callers rely on the given order.
func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
