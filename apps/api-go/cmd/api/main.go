// SPDX-License-Identifier: AGPL-3.0-only

// Spike entrypoint: migrate, then serve. See README.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/httpapi"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importstorage"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/keycloakadmin"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/session"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func main() {
	ctx := context.Background()

	mode, err := authModeFromEnv(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	if err := recordsource.Load(os.Getenv); err != nil {
		log.Fatal(err)
	}
	log.Printf("records made in the app: data_source %s", recordsource.Get())

	appURL := os.Getenv("OPENDISPATCH_APP_DATABASE_URL")
	if appURL == "" {
		log.Fatal("OPENDISPATCH_APP_DATABASE_URL is required (application role)")
	}
	migrationsDir := os.Getenv("OPENDISPATCH_MIGRATIONS_DIR")
	if migrationsDir == "" {
		migrationsDir = "migrations"
	}

	onStart, err := migrateOnStart(mode, os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	if onStart {
		ownerURL := os.Getenv("OPENDISPATCH_OWNER_DATABASE_URL")
		if ownerURL == "" {
			log.Fatal("OPENDISPATCH_OWNER_DATABASE_URL is required (owner role, BYPASSRLS)")
		}
		if err := ownerStartup(ctx, mode, ownerURL, migrationsDir, os.Getenv); err != nil {
			log.Fatal(err)
		}
	} else {
		log.Print("migrations: applied by the migration job, not at start")
	}

	app, err := tenancy.OpenConnection(ctx, appURL)
	if err != nil {
		log.Fatalf("open application connection: %v", err)
	}
	defer app.Close()

	business.UsePostgresStores(app)
	keycloakAdminFromEnv()

	if mode == "oidc" {
		if _, _, err := importstorage.Keys(); err != nil {
			log.Fatal(err)
		}
	}
	httpapi.SetAuth(authFromEnv(app, mode))
	keys := feedsFromEnv(app)
	dispatchFromEnv(app)
	demoOutageFromEnv(mode)
	enginesFromEnv()
	fallbackMonitorFromEnv(keys, os.Getenv)
	unreachableMonitorFromEnv(keys, os.Getenv)
	if _, _, err := importstorage.Keys(); err == nil {
		go business.SweepImportUploadsEvery(ctx, time.Hour)
	}
	mux := httpapi.NewMux(app)
	addr := os.Getenv("OPENDISPATCH_LISTEN_ADDR")
	if addr == "" {
		addr = ":8081"
	}
	log.Printf("listening on %s", addr)
	srv := &http.Server{Addr: addr, Handler: httpapi.TrackWrites(mux)}
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	go logSignalAndStop(sigs, srv.Shutdown, os.Exit)
	err = srv.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		select {}
	}
	log.Fatal(err)
}

// logSignalAndStop leaves a log line before a signal ends the api.
func logSignalAndStop(sigs <-chan os.Signal, shutdown func(context.Context) error, exit func(int)) {
	s := <-sigs
	log.Printf("api: received %v, shutting down", s)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = shutdown(ctx)
	exit(0)
}

// migrateOnStart: off when a job migrates.
func migrateOnStart(mode string, getenv func(string) string) (bool, error) {
	switch v := getenv("OPENDISPATCH_MIGRATE_ON_START"); v {
	case "", "1", "true":
		return true, nil
	case "0", "false":
		if testResetsOn(mode, getenv) {
			return false, errors.New("OPENDISPATCH_TEST_ROUTES=1 needs the owner role: leave OPENDISPATCH_MIGRATE_ON_START on")
		}
		return false, nil
	default:
		return false, fmt.Errorf("OPENDISPATCH_MIGRATE_ON_START must be 1 or 0, got %q", v)
	}
}

// authModeFromEnv: no default mode (review M3).
func authModeFromEnv(getenv func(string) string) (string, error) {
	switch mode := getenv("OPENDISPATCH_AUTH_MODE"); mode {
	case "demo", "oidc":
		return mode, nil
	case "":
		return "", errors.New("OPENDISPATCH_AUTH_MODE is required: set demo (dev, CI, review builds) or oidc (installs)")
	default:
		return "", fmt.Errorf("OPENDISPATCH_AUTH_MODE must be demo or oidc, got %q", mode)
	}
}

// authFromEnv: oidc refuses an incomplete setup.
func authFromEnv(app *tenancy.Connection, mode string) *httpapi.Auth {
	if mode == "demo" {
		return &httpapi.Auth{Mode: "demo", Sessions: &session.Store{Conn: app, Policy: httpapi.DemoPolicy}, CookieSecure: os.Getenv("DEMO_COOKIE_SECURE") == "1"}
	}
	file := os.Getenv("OPENDISPATCH_OIDC_TENANTS_FILE")
	if file == "" {
		log.Fatal("OPENDISPATCH_OIDC_TENANTS_FILE is required in oidc mode (the customers that may sign in)")
	}
	registry, err := oidc.LoadTenantsFile(file)
	if err != nil {
		log.Fatalf("oidc tenants: %v", err)
	}
	if len(registry.Tenants()) == 0 {
		log.Fatal("oidc tenants: the file lists no customer")
	}
	secret := os.Getenv("OPENDISPATCH_AUTH_SECRET")
	if len(secret) < 32 {
		log.Fatal("OPENDISPATCH_AUTH_SECRET is required in oidc mode and must be at least 32 characters")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	return &httpapi.Auth{
		Mode:     "oidc",
		Registry: registry,
		Verifier: &oidc.Verifier{Registry: registry, Keys: oidc.NewKeyResolver(client), Skew: 30 * time.Second},
		Sessions: &session.Store{Conn: app, Policy: func(tenantID string) (session.Policy, error) {
			p, err := business.SessionPolicyFor(tenantID)
			if err != nil {
				return session.Policy{}, err
			}
			return session.Policy{Idle: time.Duration(p.IdleTimeoutMinutes) * time.Minute, Absolute: time.Duration(p.SessionLengthMinutes) * time.Minute, MaxConcurrent: p.MaxConcurrentSessions}, nil
		}},
		Secret:       []byte(secret),
		CookieSecure: os.Getenv("OPENDISPATCH_COOKIE_SECURE") == "1",
		Client:       client,
	}
}

// feedsFromEnv turns the inbound feeds on when a keys file is named.
func feedsFromEnv(app *tenancy.Connection) *feeds.Keys {
	file := os.Getenv("OPENDISPATCH_FEED_KEYS_FILE")
	if file == "" {
		return nil
	}
	keys, err := feeds.LoadKeysFile(file)
	if err != nil {
		log.Fatalf("feed keys: %v", err)
	}
	f := &httpapi.Feeds{Keys: keys, Store: &feeds.Store{Conn: app, Classifiers: business.LiveClassifierFor, OnClassified: business.AuditLiveClassification}, Busy: business.MaintenanceOn}
	httpapi.SetFeeds(f)
	business.FeedStateSource = func(ctx context.Context, tenantID string) ([]business.FeedState, error) {
		h, err := f.Store.Health(ctx, tenantID)
		out := make([]business.FeedState, len(h))
		for i, x := range h {
			out[i] = business.FeedState{Feed: x.Feed, Queued: x.Queued, LastReceived: x.LastReceived, LastApplied: x.LastApplied,
				RecentRejected: x.RecentRejected, LastErrorAt: x.LastErrorAt, LastError: x.LastError}
		}
		return out, err
	}
	days := 30
	if v, err := strconv.Atoi(os.Getenv("OPENDISPATCH_FEED_RETENTION_DAYS")); err == nil && v > 0 {
		days = v
	}
	go httpapi.RunFeedProcessor(context.Background(), f, time.Second, time.Duration(days)*24*time.Hour)
	return keys
}

// fallbackMonitorTenants: fed tenants, board on feeds.
func fallbackMonitorTenants(keys *feeds.Keys, getenv func(string) string) []string {
	if keys == nil || getenv("OPENDISPATCH_DISPATCH_SOURCE") != "feeds" {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, k := range keys.Tenants() {
		if !seen[k.TenantID] {
			seen[k.TenantID] = true
			out = append(out, k.TenantID)
		}
	}
	return out
}

// fallbackMonitorFromEnv: the operator fallback rule's self-signal.
func fallbackMonitorFromEnv(keys *feeds.Keys, getenv func(string) string) {
	tenants := fallbackMonitorTenants(keys, getenv)
	if len(tenants) == 0 {
		return
	}
	if v, err := strconv.Atoi(getenv("OPENDISPATCH_FALLBACK_SILENCE_SECONDS")); err == nil {
		business.SetFallbackSilenceDefault(v)
	}
	every := 15 * time.Second
	if v, err := strconv.Atoi(getenv("OPENDISPATCH_FALLBACK_CHECK_SECONDS")); err == nil && v > 0 {
		every = time.Duration(v) * time.Second
	}
	log.Printf("dispatch: fallback health check every %s for %d customer(s)", every, len(tenants))
	go business.RunDispatchFallbackMonitor(context.Background(), tenants, every)
}

// unreachableMonitorFromEnv: alert.
func unreachableMonitorFromEnv(keys *feeds.Keys, getenv func(string) string) {
	tenants := fallbackMonitorTenants(keys, getenv)
	if len(tenants) == 0 {
		return
	}
	every := 30 * time.Second
	if v, err := strconv.Atoi(getenv("OPENDISPATCH_UNREACHABLE_CHECK_SECONDS")); err == nil && v > 0 {
		every = time.Duration(v) * time.Second
	}
	log.Printf("dispatch: unreachable-case check every %s for %d customer(s)", every, len(tenants))
	go business.RunUnreachableMonitor(context.Background(), tenants, every)
}

// dispatchFromEnv lets the Live Dispatch Board read the feeds instead of the demo replay.
func dispatchFromEnv(app *tenancy.Connection) {
	switch os.Getenv("OPENDISPATCH_DISPATCH_SOURCE") {
	case "", "replay":
		return
	case "feeds":
		hours := 24
		if v, err := strconv.Atoi(os.Getenv("OPENDISPATCH_BOARD_WINDOW_HOURS")); err == nil && v > 0 {
			hours = v
		}
		business.UseFeedsDispatch(app, time.Duration(hours)*time.Hour)
	default:
		log.Fatalf("OPENDISPATCH_DISPATCH_SOURCE must be replay or feeds, got %q", os.Getenv("OPENDISPATCH_DISPATCH_SOURCE"))
	}
}

// enginesFromEnv says where engine answers come from: fixtures (the default) or the engine containers.
func enginesFromEnv() {
	cfg, err := engines.ParseConfig(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	business.UseEngines(cfg)
}

// keycloakAdminFromEnv: IdPs go to Keycloak if set.
func keycloakAdminFromEnv() {
	cfg, ok := keycloakadmin.FromEnv(os.Getenv)
	if !ok {
		log.Print("identity providers: stored only, Keycloak admin access not configured")
		return
	}
	business.UseKeycloakAdmin(keycloakadmin.New(cfg))
	log.Printf("identity providers: configured in Keycloak realm %s as %s", cfg.Realm, cfg.ClientID)
}
