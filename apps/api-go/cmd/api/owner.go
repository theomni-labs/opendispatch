// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// ownerAppName: tag in pg_stat_activity.
const ownerAppName = "opendispatch-api-owner"

var ownerPools atomic.Int32

// ownerPoolsOpen: owner (BYPASSRLS) pools now open.
func ownerPoolsOpen() int32 { return ownerPools.Load() }

// ownerURLNamed adds the application_name tag.
func ownerURLNamed(raw string) string {
	if u, err := url.Parse(raw); err == nil && (u.Scheme == "postgres" || u.Scheme == "postgresql") {
		q := u.Query()
		q.Set("application_name", ownerAppName)
		u.RawQuery = q.Encode()
		return u.String()
	}
	return raw + " application_name=" + ownerAppName
}

// withOwner: open an owner pool, run, close.
func withOwner(ctx context.Context, ownerURL string, fn func(*tenancy.Connection) error) error {
	owner, err := tenancy.OpenConnection(ctx, ownerURLNamed(ownerURL))
	if err != nil {
		return fmt.Errorf("open owner connection: %w", err)
	}
	ownerPools.Add(1)
	defer func() {
		owner.Close()
		ownerPools.Add(-1)
	}()
	return fn(owner)
}

// migrate: the only start-up owner use.
func migrate(ctx context.Context, ownerURL, dir string) error {
	return withOwner(ctx, ownerURL, func(owner *tenancy.Connection) error {
		results, err := tenancy.ApplyMigrations(ctx, tenancy.ApplyMigrationsOptions{Pool: owner.Pool, Dir: dir})
		if err != nil {
			return fmt.Errorf("apply migrations: %w", err)
		}
		applied := 0
		for _, r := range results {
			if r.Applied {
				applied++
			}
		}
		log.Printf("migrations: %d files, %d newly applied", len(results), applied)
		return nil
	})
}

// ownerStartup: migrate, wire resets, hold no pool.
func ownerStartup(ctx context.Context, mode, ownerURL, dir string, getenv func(string) string) error {
	if err := migrate(ctx, ownerURL, dir); err != nil {
		return err
	}
	if testResetsOn(mode, getenv) {
		wireTestResets(ownerURL)
	}
	if n := ownerPoolsOpen(); n != 0 {
		return fmt.Errorf("the application role rule: %d owner pools open after start-up", n)
	}
	return nil
}

// testResetsOn: demo plus the test-routes opt-in.
func testResetsOn(mode string, getenv func(string) string) bool {
	return mode == "demo" && getenv("OPENDISPATCH_TEST_ROUTES") == "1"
}

type resetStep struct {
	name   string
	tables []string
	run    func(context.Context, *tenancy.Connection) error
}

// Master steps run only on ?master=1.
var masterSteps = []resetStep{
	{"ReseedLocationsForTest", []string{"cities", "zones", "sub_zones", "standby_points"}, business.ReseedLocationsForTest},
	{"ReseedPeopleForTest", []string{"vehicles", "agents", "agent_skills", "holidays", "leave_requests"}, business.ReseedPeopleForTest},
	{"ReseedImportsForTest", []string{"import_jobs", "data_quality_issues"}, business.ReseedImportsForTest},
	{"ReseedShiftBreakForTest", []string{"break_rules", "shift_patterns"}, business.ReseedShiftBreakForTest},
}

var resetSteps = []resetStep{
	{"ReseedUsersForTest", []string{"users"}, business.ReseedUsersForTest},
	{"ReseedRulesForTest", []string{"approvals", "classification_rules", "rule_versions"}, business.ReseedRulesForTest},
	{"ReseedRoleMappingsForTest", []string{"role_mappings"}, business.ReseedRoleMappingsForTest},
	{"ReseedForTest", []string{"settings"}, settingsstore.ReseedForTest},
	{"ReseedEngineAnswersForTest", []string{"engine_answers"}, business.ReseedEngineAnswersForTest},
	{"ReseedRostersForTest", []string{"overrides", "roster_assignments", "rosters", "simulation_results", "simulation_runs"}, business.ReseedRostersForTest},
	// After rosters: a test roster pins its run
	{"ReseedForecastForTest", []string{"forecast_runs", "forecast_values"}, business.ReseedForecastForTest},
	{"ReseedAssignmentsForTest", []string{"assignment_comparisons", "assignment_events", "assignments"}, business.ReseedAssignmentsForTest},
	{"ReseedOverridesForTest", []string{"overrides"}, business.ReseedOverridesForTest},
	{"ReseedScenariosForTest", []string{"scenarios", "simulation_results", "simulation_runs"}, business.ReseedScenariosForTest},
	{"ReseedSimulationsForTest", []string{"simulation_results", "simulation_runs"}, business.ReseedSimulationsForTest},
	{"ReseedNotificationsForTest", []string{"notification_rules", "notifications"}, business.ReseedNotificationsForTest},
	{"ReseedIntegrationsForTest", []string{"integrations"}, business.ReseedIntegrationsForTest},
	{"ReseedModelVersionsForTest", []string{"model_versions"}, business.ReseedModelVersionsForTest},
	{"ReseedAPIWebhooksForTest", []string{"api_clients", "webhook_deliveries", "webhooks"}, business.ReseedAPIWebhooksForTest},
	{"ReseedRemoteReviewsForTest", []string{"remote_reviews"}, business.ReseedRemoteReviewsForTest},
	{"ReseedSystemHealthForTest", []string{"diagnostics_bundles", "job_runs"}, business.ReseedSystemHealthForTest},
	{"ReseedSecurityComplianceForTest", []string{"control_evidence", "support_access_events"}, business.ReseedSecurityComplianceForTest},
	{"ReseedIdentityForTest", []string{"identity_providers"}, business.ReseedIdentityForTest},
	{"ReseedLeaveCalendarForTest", []string{"prayer_times"}, business.ReseedLeaveCalendarForTest},
	{"ReseedRollupsForTest", []string{"dashboard_rollups", "productivity_rollups"}, business.ReseedRollupsForTest},
	{"ReseedAuditForTest", []string{"audit_events"}, business.ReseedAuditForTest},
}

func signatureOf(ctx context.Context, owner *tenancy.Connection, tables []string) (string, error) {
	var out strings.Builder
	for _, t := range tables {
		var sig string
		q := `SELECT count(*)::text || ':' || coalesce(sum(hashtext(x::text)::bigint), 0)::text FROM ` + pgx.Identifier{t}.Sanitize() + ` x`
		if err := owner.Pool.QueryRow(ctx, q).Scan(&sig); err != nil {
			return "", err
		}
		out.WriteString(t + "=" + sig + ";")
	}
	return out.String(), nil
}

// wireTestResets: owner pool per call.
func wireTestResets(ownerURL string) {
	var resetMu sync.Mutex
	resetSignatures := map[string]string{}
	runSteps := func(ctx context.Context, steps []resetStep) error {
		resetMu.Lock()
		defer resetMu.Unlock()
		return withOwner(ctx, ownerURL, func(owner *tenancy.Connection) error {
			for _, step := range steps {
				started := time.Now()
				if want, known := resetSignatures[step.name]; known {
					if now, err := signatureOf(ctx, owner, step.tables); err == nil && now == want {
						continue
					}
				}
				if err := step.run(ctx, owner); err != nil {
					resetSignatures = map[string]string{}
					return fmt.Errorf("%s: %w", step.name, err)
				}
				if took := time.Since(started); took > 200*time.Millisecond {
					log.Printf("test reset: %s took %s", step.name, took.Round(time.Millisecond))
				}
			}
			for _, step := range steps {
				sig, err := signatureOf(ctx, owner, step.tables)
				if err != nil {
					resetSignatures = map[string]string{}
					return err
				}
				resetSignatures[step.name] = sig
			}
			return nil
		})
	}
	business.TestResetDB = func(ctx context.Context) error { return runSteps(ctx, resetSteps) }
	business.TestResetMasterDB = func(ctx context.Context) error { return runSteps(ctx, masterSteps) }
	auditlog.SetTestTruncate(func(ctx context.Context) error {
		return withOwner(ctx, ownerURL, func(owner *tenancy.Connection) error {
			_, err := owner.Pool.Exec(ctx, `TRUNCATE audit_events`)
			return err
		})
	})
}
