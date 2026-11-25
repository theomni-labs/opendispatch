// SPDX-License-Identifier: AGPL-3.0-only

// Command demohistory loads a demo-only SYNTHETIC history.
package main

import (
	"context"
	"flag"
	"fmt"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/demoguard"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func main() {
	weeks := flag.Int("weeks", 156, "weeks of history (52: the old one-year history)")
	seed := flag.Int64("seed", 20260905, "random seed")
	flag.Parse()
	if os.Getenv("OPENDISPATCH_DEMO") != "1" {
		log.Fatal("Refusing: set OPENDISPATCH_DEMO=1 to load the demo history.")
	}
	dsn := os.Getenv("OPENDISPATCH_MIGRATION_DATABASE_URL")
	if err := CheckDemoURL(dsn); err != nil {
		log.Fatal(err)
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close(ctx)
	t0 := time.Now()
	n, first, last, err := Run(ctx, conn, *weeks, *seed)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Demo history: %d SYNTHETIC cases, %s to %s, %.1fs\n", n, first, last, time.Since(t0).Seconds())
}

// CheckDemoURL refuses a non-demo or non-local database.
func CheckDemoURL(dsn string) error {
	if dsn == "" {
		return fmt.Errorf("OPENDISPATCH_MIGRATION_DATABASE_URL is not set")
	}
	u, err := url.Parse(dsn)
	if err != nil {
		return fmt.Errorf("database url: %w", err)
	}
	db := strings.TrimPrefix(u.Path, "/")
	if !strings.Contains(db, "demo") {
		return fmt.Errorf("refusing: database %q is not a demo database (name must contain \"demo\")", db)
	}
	if h := u.Hostname(); !demoguard.LocalHost(h) {
		return fmt.Errorf("refusing: host %q is not local (127.0.0.1 or localhost only)", h)
	}
	return nil
}
