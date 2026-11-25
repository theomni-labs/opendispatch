// SPDX-License-Identifier: AGPL-3.0-only

// Command demoforecasts stores demo forecasts for past days.
package main

import (
	"context"
	"flag"
	"fmt"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/demoguard"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func main() {
	days := flag.Int("days", 28, "past days to forecast, each as of its own midnight")
	flag.Parse()
	if os.Getenv("OPENDISPATCH_DEMO") != "1" {
		fail("refusing: set OPENDISPATCH_DEMO=1 to store demo forecasts")
	}
	dsn := os.Getenv("OPENDISPATCH_APP_DATABASE_URL")
	if err := checkDemoURL(dsn); err != nil {
		fail("%v", err)
	}
	tenant := os.Getenv("OPENDISPATCH_TENANT_ID")
	if tenant == "" {
		fail("OPENDISPATCH_TENANT_ID is required")
	}
	ctx := context.Background()
	conn, err := tenancy.OpenConnection(ctx, dsn)
	if err != nil {
		fail("open application connection: %v", err)
	}
	defer conn.Close()
	business.UsePostgresStores(conn)
	cfg, err := engines.ParseConfig(os.Getenv)
	if err != nil {
		fail("%v", err)
	}
	business.UseEngines(cfg)
	t0 := time.Now()
	done := 0
	out, err := business.BackfillPastForecasts(ctx, conn, business.NewWorkerActors(tenant).Forecast, *days, func(p business.PastForecast) {
		done++
		fmt.Println(progressLine(done, *days, p, time.Since(t0)))
	})
	if err != nil {
		fail("%v", err)
	}
	fmt.Printf("Past forecasts: %d day(s), %.1fs\n", len(out), time.Since(t0).Seconds())
	acc, err := business.RefreshRollingAccuracy(ctx, conn, business.NewWorkerActors(tenant).Forecast)
	if err != nil {
		fail("rolling accuracy: %v", err)
	}
	fmt.Printf("Rolling accuracy: %s to %s, %d day(s) measured, %d zone(s) (Illustrative)\n", acc.WindowStart, acc.WindowEnd, acc.Days, acc.Zones)
}

// fail: a line the demo scripts look for.
func fail(format string, args ...any) {
	fmt.Printf("Past forecasts FAILED: "+format+"\n", args...)
	os.Exit(1)
}

// progressLine: one day done, as n/total.
func progressLine(n, total int, p business.PastForecast, took time.Duration) string {
	what := "run " + p.RunID + " (SYNTHETIC history before that day)"
	if p.Skipped {
		what = "a run exists, skipped"
	}
	return fmt.Sprintf("   [%d/%d] %s: %s, %.0fs", n, total, p.Date, what, took.Seconds())
}

// checkDemoURL refuses a non-demo or non-local database.
func checkDemoURL(dsn string) error {
	if dsn == "" {
		return fmt.Errorf("OPENDISPATCH_APP_DATABASE_URL is not set")
	}
	u, err := url.Parse(dsn)
	if err != nil {
		return fmt.Errorf("database url: %w", err)
	}
	if db := strings.TrimPrefix(u.Path, "/"); !strings.Contains(db, "demo") {
		return fmt.Errorf("refusing: database %q is not a demo database", db)
	}
	if h := u.Hostname(); !demoguard.LocalHost(h) {
		return fmt.Errorf("refusing: host %q is not local", h)
	}
	return nil
}
