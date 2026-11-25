// SPDX-License-Identifier: AGPL-3.0-only

// Live: the settings-backed domains keep their data across a restart and apart per customer.
package business

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func freshTenant() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = (b[6]&0x0f)|0x40, (b[8]&0x3f)|0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

func settingsConn(t *testing.T) *tenancy.Connection {
	t.Helper()
	ownerURL, appURL := os.Getenv("OPENDISPATCH_TEST_DATABASE_URL"), os.Getenv("OPENDISPATCH_TEST_APP_DATABASE_URL")
	if ownerURL == "" || appURL == "" {
		t.Skip("OPENDISPATCH_TEST_DATABASE_URL and OPENDISPATCH_TEST_APP_DATABASE_URL are not both set: skipped, not faked.")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, ownerURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	dir, _ := filepath.Abs(filepath.Join("..", "..", "migrations"))
	if _, err := tenancy.ApplyMigrations(ctx, tenancy.ApplyMigrationsOptions{Pool: owner, Dir: dir}); err != nil {
		t.Fatal(err)
	}
	app, err := pgxpool.New(ctx, appURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	return &tenancy.Connection{Pool: app}
}

func adminOf(tenant string) reqctx.RequestContext {
	return reqctx.RequestContext{CustomerID: tenant, UserID: "00000000-0000-4000-8000-0000000000aa", Role: access.RoleAdministrator, InstallMode: access.InstallPrivate, ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}}
}

func TestSettingsDomainsSurviveARestartAndStayPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	settingsstore.UsePostgres(conn)
	t.Cleanup(settingsstore.UseMemory)
	a, b := adminOf(freshTenant()), adminOf(freshTenant())

	if _, err := UpdateSessionPolicy(a, map[string]any{"session_length_minutes": 120.0, "idle_timeout_minutes": 15.0, "max_concurrent_sessions": 2.0}); err != nil {
		t.Fatal(err)
	}
	if _, err := UpdateSignInPolicy(a, map[string]any{"force_sso_email_domains": []any{"example.org"}, "require_mfa_claim": true, "allow_local_users_for_outsiders": true, "emergency_admin_enabled": false}); err != nil {
		t.Fatal(err)
	}
	if _, err := UpdateClockStart(a, map[string]any{"clock_start": "registration"}); err != nil {
		t.Fatal(err)
	}
	if _, err := UpdateSupportAccessSetting(a, map[string]any{"enabled": true, "max_duration_hours": 4.0}); err != nil {
		t.Fatal(err)
	}
	if _, err := ConfirmBackup(a, map[string]any{"note": "taken by the test"}); err != nil {
		t.Fatal(err)
	}
	if _, err := UpdateUpdateSettings(a, map[string]any{"channel": "hotfix", "check_interval_hours": 12.0, "auto_download": true, "notify_only": false}); err != nil {
		t.Fatal(err)
	}

	for round, restart := range []func(){func() {}, func() { settingsstore.UseMemory(); settingsstore.UsePostgres(conn) }} {
		restart()
		policy, err := SessionPolicyFor(a.CustomerID)
		if err != nil || policy.SessionLengthMinutes != 120 || policy.IdleTimeoutMinutes != 15 || policy.MaxConcurrentSessions != 2 {
			t.Fatalf("round %d: session policy %+v %v", round, policy, err)
		}
		sign, err := readSignInPolicy(context.Background(), a.CustomerID)
		if err != nil || !sign.RequireMFAClaim || sign.EmergencyAdminEnabled || !sign.AllowLocalUsersForOutsiders || len(sign.ForceSSOEmailDomains) != 1 {
			t.Fatalf("round %d: sign-in policy %+v %v", round, sign, err)
		}
		if got := getClockStart(context.Background(), a.CustomerID); got != "registration" {
			t.Fatalf("round %d: clock start %q", round, got)
		}
		support, err := GetSupportAccessSetting(a)
		if err != nil || !support.Enabled || support.MaxDurationHours != 4 {
			t.Fatalf("round %d: support access %+v %v", round, support, err)
		}
		backup, err := backupStatusStore(context.Background(), a.CustomerID)
		if err != nil || backup.Note == nil || *backup.Note != "taken by the test" {
			t.Fatalf("round %d: backup %+v %v", round, backup, err)
		}
		upd, err := GetUpdateSettings(a)
		if err != nil || upd.Channel != "hotfix" || upd.CheckIntervalHours != 12 || !upd.AutoDownload {
			t.Fatalf("round %d: update settings %+v %v", round, upd, err)
		}
		// Another customer has none of it.
		other, err := SessionPolicyFor(b.CustomerID)
		if err != nil || other != defaultSessionPolicy {
			t.Fatalf("round %d: customer b got %+v", round, other)
		}
		if got := getClockStart(context.Background(), b.CustomerID); got != "assignment" {
			t.Fatalf("round %d: customer b clock start %q", round, got)
		}
	}
}
