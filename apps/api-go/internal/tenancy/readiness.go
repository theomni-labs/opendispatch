// SPDX-License-Identifier: AGPL-3.0-only

// Readiness: database reachable, migrations applied.
package tenancy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var createTablePattern = regexp.MustCompile(`(?im)^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?`)

// ExpectedTables lists tables the migration files create.
func ExpectedTables(dir string) ([]string, error) {
	names, err := listMigrationFiles(dir)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var tables []string
	for _, n := range names {
		body, err := os.ReadFile(filepath.Join(dir, n))
		if err != nil {
			return nil, err
		}
		for _, m := range createTablePattern.FindAllStringSubmatch(string(body), -1) {
			if !seen[m[1]] {
				seen[m[1]] = true
				tables = append(tables, m[1])
			}
		}
	}
	sort.Strings(tables)
	return tables, nil
}

// CheckReady needs only the application role: it
// pings, then looks for every table the files create.
func CheckReady(ctx context.Context, conn *Connection, migrationsDir string) error {
	if err := conn.Pool.Ping(ctx); err != nil {
		return fmt.Errorf("database unreachable")
	}
	tables, err := ExpectedTables(migrationsDir)
	if err != nil {
		return fmt.Errorf("migrations directory unreadable")
	}
	if len(tables) == 0 {
		return fmt.Errorf("no migrations found")
	}
	var missing []string
	err = conn.Pool.QueryRow(ctx, `
		SELECT coalesce(array_agg(t), '{}') FROM unnest($1::text[]) AS t
		WHERE to_regclass(format('public.%I', t)) IS NULL`, tables).Scan(&missing)
	if err != nil {
		return fmt.Errorf("migration check failed")
	}
	if len(missing) > 0 {
		return fmt.Errorf("migrations not applied: missing %s", strings.Join(missing[:min(3, len(missing))], ", "))
	}
	return nil
}
