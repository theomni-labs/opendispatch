// SPDX-License-Identifier: AGPL-3.0-only

// Worker entrypoint: SPIKE scheduler. See README.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/httpapi"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := recordsource.Load(os.Getenv); err != nil {
		log.Fatal(err)
	}
	appURL := os.Getenv("OPENDISPATCH_APP_DATABASE_URL")
	if appURL == "" {
		log.Fatal("OPENDISPATCH_APP_DATABASE_URL is required (application role)")
	}
	tenantID := os.Getenv("OPENDISPATCH_TENANT_ID")
	if tenantID == "" {
		log.Fatal("OPENDISPATCH_TENANT_ID is required")
	}
	interval := workerInterval()

	conn, err := tenancy.OpenConnection(ctx, appURL)
	if err != nil {
		log.Fatalf("open application connection: %v", err)
	}
	defer conn.Close()

	serveProbes(conn)

	business.UsePostgresStores(conn)
	enginesFromEnv()

	actors := business.NewWorkerActors(tenantID)

	runCycle(ctx, conn, actors)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Print("worker: shutting down")
			return
		case <-ticker.C:
			runCycle(ctx, conn, actors)
		}
	}
}

func runCycle(ctx context.Context, conn *tenancy.Connection, actors business.WorkerActors) {
	report, err := business.RunWorkerCycle(ctx, conn, actors)
	if err != nil {
		log.Printf("worker: cycle failed: %v", err)
		return
	}
	log.Printf("worker: rosters built=%d skipped=%d failed=%d forecast created=%v skipped=%v",
		report.RostersBuilt, report.RostersSkipped, len(report.RostersFailed),
		report.ForecastCreated, report.ForecastSkipped)
	if report.ChallengerCreated || len(report.DegradedZones) > 0 {
		log.Printf("worker: challenger run=%v degraded zones=%v retrained=%v", report.ChallengerCreated, report.DegradedZones, report.Retrained)
	}
	if report.AccuracyStored {
		log.Printf("worker: rolling accuracy stored, %d day(s) measured", report.AccuracyDays)
	}
	for _, f := range report.RostersFailed {
		log.Printf("worker: roster failed: %s", f)
	}
}

// enginesFromEnv says where engine answers come from, as the api does.
func enginesFromEnv() {
	cfg, err := engines.ParseConfig(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	business.UseEngines(cfg)
}

// serveProbes answers /livez and /readyz when asked.
func serveProbes(conn *tenancy.Connection) {
	addr := os.Getenv("OPENDISPATCH_WORKER_HEALTH_ADDR")
	if addr == "" {
		return
	}
	go func() {
		log.Printf("worker: probes on %s", addr)
		srv := &http.Server{Addr: addr, Handler: httpapi.NewProbeMux(httpapi.DefaultReadiness(conn)), ReadHeaderTimeout: 5 * time.Second}
		if err := srv.ListenAndServe(); err != nil {
			log.Printf("worker: probe server stopped: %v", err)
		}
	}()
}

func workerInterval() time.Duration {
	raw := os.Getenv("OPENDISPATCH_WORKER_INTERVAL_SECONDS")
	if raw == "" {
		return 5 * time.Minute
	}
	secs, err := strconv.Atoi(raw)
	if err != nil || secs <= 0 {
		log.Fatalf("invalid OPENDISPATCH_WORKER_INTERVAL_SECONDS: %q", raw)
	}
	return time.Duration(secs) * time.Second
}
