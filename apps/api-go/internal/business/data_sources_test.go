// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestUpdateIntegration_ValidatesCredentialRefAndTimeout(t *testing.T) {
	ResetIntegrationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	UpsertIntegrationForTest(Integration{
		BaseRecord: bd("00000000-0000-4000-8000-000000000001", "t1"), Direction: "inbound", Health: "unknown",
		IsEnabled: true, Kind: "case_feed", NameEn: "Case Feed",
	})

	_, err := UpdateIntegration(admin, "00000000-0000-4000-8000-000000000001", map[string]any{"credential_ref": "plain-text-secret"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad credential_ref: got %v, want Invalid", err)
	}

	updated, err := UpdateIntegration(admin, "00000000-0000-4000-8000-000000000001", map[string]any{"credential_ref": "secret://vault/case-feed", "fallback_timeout_seconds": 30.0})
	check(t, err)
	if updated.CredentialRef == nil || *updated.CredentialRef != "secret://vault/case-feed" {
		t.Fatalf("credential_ref = %v, want secret://vault/case-feed", updated.CredentialRef)
	}
	if updated.FallbackTimeoutSeconds == nil || *updated.FallbackTimeoutSeconds != 30 {
		t.Fatalf("fallback_timeout_seconds = %v, want 30", updated.FallbackTimeoutSeconds)
	}
}

func TestUpdateIntegration_DisablingSetsHealthDisabled(t *testing.T) {
	ResetIntegrationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	UpsertIntegrationForTest(Integration{BaseRecord: bd("00000000-0000-4000-8000-000000000002", "t1"), IsEnabled: true, Health: "healthy", Kind: "weather_feed", NameEn: "Weather"})

	off, err := UpdateIntegration(admin, "00000000-0000-4000-8000-000000000002", map[string]any{"is_enabled": false})
	check(t, err)
	if off.Health != "disabled" {
		t.Fatalf("health = %q after disabling, want disabled", off.Health)
	}

	on, err := UpdateIntegration(admin, "00000000-0000-4000-8000-000000000002", map[string]any{"is_enabled": true})
	check(t, err)
	if on.Health != "unknown" {
		t.Fatalf("health = %q after re-enabling a disabled feed, want unknown", on.Health)
	}
}

func TestTestIntegration_ScriptedByStoredHealth(t *testing.T) {
	ResetIntegrationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	UpsertIntegrationForTest(Integration{BaseRecord: bd("00000000-0000-4000-8000-000000000003", "t1"), IsEnabled: false, Health: "unknown", Kind: "case_feed", NameEn: "Off"})
	UpsertIntegrationForTest(Integration{BaseRecord: bd("00000000-0000-4000-8000-000000000004", "t1"), IsEnabled: true, Health: "down", Kind: "case_feed", NameEn: "Down"})
	UpsertIntegrationForTest(Integration{BaseRecord: bd("00000000-0000-4000-8000-000000000005", "t1"), IsEnabled: true, Health: "healthy", Kind: "case_feed", NameEn: "Up"})

	off, err := TestIntegration(admin, "00000000-0000-4000-8000-000000000003")
	check(t, err)
	if off.OK || off.Message == nil || !strings.Contains(*off.Message, "switched off") {
		t.Fatalf("off: got %+v, want ok=false and 'switched off'", off)
	}

	down, err := TestIntegration(admin, "00000000-0000-4000-8000-000000000004")
	check(t, err)
	if down.OK || down.LatencyMs != nil {
		t.Fatalf("down: got %+v, want ok=false, no latency", down)
	}

	up, err := TestIntegration(admin, "00000000-0000-4000-8000-000000000005")
	check(t, err)
	if !up.OK || up.LatencyMs == nil {
		t.Fatalf("up: got %+v, want ok=true with latency", up)
	}
	if up.Message == nil || !strings.Contains(*up.Message, StubNothingSent) {
		t.Fatalf("up: message %v must disclose the stub", up.Message)
	}

	after, err := GetIntegration(admin, "00000000-0000-4000-8000-000000000005")
	check(t, err)
	if after.LastSuccessAt == nil {
		t.Fatalf("a successful test should stamp last_success_at")
	}
}

func TestGetIntegrationsHealth_WorstAmongEnabledOnly(t *testing.T) {
	ResetIntegrationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	UpsertIntegrationForTest(Integration{BaseRecord: bd("00000000-0000-4000-8000-000000000006", "t1"), IsEnabled: true, Health: "healthy", Kind: "case_feed", NameEn: "A"})
	UpsertIntegrationForTest(Integration{BaseRecord: bd("00000000-0000-4000-8000-000000000007", "t1"), IsEnabled: false, Health: "down", Kind: "case_feed", NameEn: "B (disabled, ignored)"})
	UpsertIntegrationForTest(Integration{BaseRecord: bd("00000000-0000-4000-8000-000000000008", "t1"), IsEnabled: true, Health: "degraded", Kind: "case_feed", NameEn: "C"})

	health, err := GetIntegrationsHealth(admin)
	check(t, err)
	if health.Overall != "degraded" {
		t.Fatalf("overall = %q, want degraded (worst of the enabled ones, i7 is disabled)", health.Overall)
	}
	if len(health.Integrations) != 3 {
		t.Fatalf("got %d rows, want 3 (all listed, regardless of enabled)", len(health.Integrations))
	}
}

func TestListIntegrations_RefusesWrongRole(t *testing.T) {
	ResetIntegrationsForTest()
	planner := roleCtx("t1", "u1", access.RolePlanner)
	_, err := ListIntegrations(planner, IntegrationQuery{})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner: got %v, want Forbidden", err)
	}
}
