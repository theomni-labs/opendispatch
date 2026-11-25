// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors migration-runner.ts.
package tenancy

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Readable in pg_locks via hashtext, not a magic id.
const lockKey = "opendispatch:schema_migrations"

const trackingSchema = "opendispatch_meta"
const trackingTable = trackingSchema + ".schema_migrations"

// MigrationLockError mirrors MigrationLockError.
type MigrationLockError struct{}

func (e *MigrationLockError) Error() string {
	return "Another migration run holds the lock. Wait for it to finish, then retry."
}

// MigrationChecksumError mirrors the TS error.
type MigrationChecksumError struct{ FileName string }

func (e *MigrationChecksumError) Error() string {
	return fmt.Sprintf("%s: already applied with a different checksum. An applied migration must never be edited — add a new one instead.", e.FileName)
}

// NonTransactionalMultiStatementError: see below.
type NonTransactionalMultiStatementError struct {
	FileName string
	Count    int
}

func (e *NonTransactionalMultiStatementError) Error() string {
	return fmt.Sprintf(
		"%s: non_transactional is true but the file has %d statements. Postgres wraps a "+
			"multi-statement string sent in one query in an implicit transaction regardless of BEGIN/COMMIT, "+
			"which would silently defeat non_transactional — so such a file must contain exactly one statement "+
			"(the usual case: one CREATE INDEX CONCURRENTLY, on its own).",
		e.FileName, e.Count,
	)
}

// MigrationResult mirrors MigrationResult.
type MigrationResult struct {
	FileName string
	Header   MigrationHeader
	Applied  bool // false when already applied (checksum matched, skipped)
}

type parsedMigration struct {
	fileName string
	toApply  string
	header   MigrationHeader
	checksum string
}

func checksumOf(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

func listMigrationFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// Runner state, not a customer table.
func ensureTrackingTable(ctx context.Context, conn *pgxpool.Conn) error {
	_, err := conn.Exec(ctx, `
		CREATE SCHEMA IF NOT EXISTS `+trackingSchema+`;
		CREATE TABLE IF NOT EXISTS `+trackingTable+` (
			filename text PRIMARY KEY,
			checksum text NOT NULL,
			applied_at timestamptz NOT NULL DEFAULT now()
		);
	`)
	return err
}

func acquireLock(ctx context.Context, conn *pgxpool.Conn) error {
	var got bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtext($1), 0)`, lockKey).Scan(&got); err != nil {
		return err
	}
	if !got {
		return &MigrationLockError{}
	}
	return nil
}

func releaseLock(ctx context.Context, conn *pgxpool.Conn) error {
	_, err := conn.Exec(ctx, `SELECT pg_advisory_unlock(hashtext($1), 0)`, lockKey)
	return err
}

func alreadyApplied(ctx context.Context, conn *pgxpool.Conn, fileName string) (string, bool, error) {
	var checksum string
	err := conn.QueryRow(ctx, `SELECT checksum FROM `+trackingTable+` WHERE filename = $1`, fileName).Scan(&checksum)
	if err == pgx.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return checksum, true, nil
}

func recordApplied(ctx context.Context, conn *pgxpool.Conn, fileName, checksum string) error {
	_, err := conn.Exec(ctx, `INSERT INTO `+trackingTable+` (filename, checksum) VALUES ($1, $2)`, fileName, checksum)
	return err
}

func applyOne(ctx context.Context, conn *pgxpool.Conn, statement string, header MigrationHeader) error {
	if header.NonTransactional {
		// Autocommit, e.g. for CREATE INDEX CONCURRENTLY.
		_, err := conn.Exec(ctx, statement)
		return err
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed
	if _, err := tx.Exec(ctx, statement); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ApplyMigrationsOptions: Pool must be owner-role.
type ApplyMigrationsOptions struct {
	Pool *pgxpool.Pool
	Dir  string // directory of *.sql migration files
}

// ApplyMigrations mirrors applyMigrations.
func ApplyMigrations(ctx context.Context, opts ApplyMigrationsOptions) ([]MigrationResult, error) {
	fileNames, err := listMigrationFiles(opts.Dir)
	if err != nil {
		return nil, err
	}

	// Validates every file first; no half-applied runs.
	parsed := make([]parsedMigration, 0, len(fileNames))
	for _, fileName := range fileNames {
		content, err := os.ReadFile(filepath.Join(opts.Dir, fileName))
		if err != nil {
			return nil, err
		}
		header, err := ParseMigrationHeader(string(content), fileName)
		if err != nil {
			return nil, err
		}
		checksum := checksumOf(string(content))
		if header.NonTransactional {
			statements := SplitStatements(string(content))
			if len(statements) != 1 {
				return nil, &NonTransactionalMultiStatementError{fileName, len(statements)}
			}
			parsed = append(parsed, parsedMigration{fileName, statements[0], header, checksum})
			continue
		}
		parsed = append(parsed, parsedMigration{fileName, string(content), header, checksum})
	}

	conn, err := opts.Pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()

	if err := ensureTrackingTable(ctx, conn); err != nil {
		return nil, err
	}
	if err := acquireLock(ctx, conn); err != nil {
		return nil, err
	}
	defer releaseLock(ctx, conn) //nolint:errcheck // best-effort unlock

	results := make([]MigrationResult, 0, len(parsed))
	for _, file := range parsed {
		existingChecksum, applied, err := alreadyApplied(ctx, conn, file.fileName)
		if err != nil {
			return nil, err
		}
		if applied {
			if existingChecksum != file.checksum {
				return nil, &MigrationChecksumError{file.fileName}
			}
			results = append(results, MigrationResult{file.fileName, file.header, false})
			continue
		}
		if err := applyOne(ctx, conn, file.toApply, file.header); err != nil {
			return nil, err
		}
		if err := recordApplied(ctx, conn, file.fileName, file.checksum); err != nil {
			return nil, err
		}
		results = append(results, MigrationResult{file.fileName, file.header, true})
	}
	return results, nil
}
