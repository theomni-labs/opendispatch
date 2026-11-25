// SPDX-License-Identifier: AGPL-3.0-only

// Migration job: apply migrations as owner, exit.
package main

import (
	"context"
	"log"
	"net/url"
	"os"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// appName: tag in pg_stat_activity.
const appName = "opendispatch-migrate"

func main() {
	ownerURL := os.Getenv("OPENDISPATCH_OWNER_DATABASE_URL")
	if ownerURL == "" {
		log.Fatal("OPENDISPATCH_OWNER_DATABASE_URL is required (owner role, BYPASSRLS)")
	}
	dir := os.Getenv("OPENDISPATCH_MIGRATIONS_DIR")
	if dir == "" {
		dir = "migrations"
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout())
	defer cancel()
	owner, err := tenancy.OpenConnection(ctx, named(ownerURL))
	if err != nil {
		log.Fatalf("open owner connection: %v", err)
	}
	defer owner.Close()
	started := time.Now()
	results, err := tenancy.ApplyMigrations(ctx, tenancy.ApplyMigrationsOptions{Pool: owner.Pool, Dir: dir})
	if err != nil {
		owner.Close()
		log.Fatalf("apply migrations: %v", err)
	}
	applied := 0
	for _, r := range results {
		if r.Applied {
			applied++
		}
	}
	log.Printf("migrations: %d files, %d newly applied, %s", len(results), applied, time.Since(started).Round(time.Millisecond))
}

// named adds application_name to a URL.
func named(raw string) string {
	if u, err := url.Parse(raw); err == nil && (u.Scheme == "postgres" || u.Scheme == "postgresql") {
		q := u.Query()
		q.Set("application_name", appName)
		u.RawQuery = q.Encode()
		return u.String()
	}
	return raw + " application_name=" + appName
}

// timeout: OPENDISPATCH_MIGRATE_TIMEOUT_SECONDS, else 30 min.
func timeout() time.Duration {
	if d, err := time.ParseDuration(os.Getenv("OPENDISPATCH_MIGRATE_TIMEOUT_SECONDS") + "s"); err == nil && d > 0 {
		return d
	}
	return 30 * time.Minute
}
