// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

func sysJSONKeys(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return strings.Join(keys, ",")
}

func TestSystemTypes_JSONKeysAreSnakeCase(t *testing.T) {
	cases := map[string]struct {
		v    any
		want string
	}{
		"backup":      {BackupStatus{}, "confirmed_by_user_id,last_confirmed_at,note,restore_drill_due_at,source"},
		"storage":     {StorageStatus{Areas: []StorageArea{}}, "areas,checked_at,total_bytes,used_bytes"},
		"download":    {DiagnosticsDownload{}, "content_base64,content_type,file_name"},
		"overview":    {HealthOverview{}, "as_of,components,data_source,feeds,last_job_failure_at,overall"},
		"integ_test":  {IntegrationTestResult{}, "checked_at,latency_ms,message,ok"},
		"integ_hlth":  {IntegrationsHealth{}, "as_of,data_source,integrations,overall"},
		"session":     {SessionPolicy{}, "idle_timeout_minutes,max_concurrent_sessions,session_length_minutes"},
		"support":     {SupportAccessSetting{}, "enabled,max_duration_hours"},
		"rate_limits": {ApiRateLimits{}, "limits"},
		"hook_test":   {WebhookTestResult{}, "delivered,http_status,latency_ms"},
		"retry":       {WebhookDeliveryRetryResult{}, "delivered,delivery,message"},
		"created":     {ApiClientCreated{}, "client,secret"},
	}
	for name, c := range cases {
		if got := sysJSONKeys(t, c.v); got != c.want {
			t.Errorf("%s keys = %s, want %s", name, got, c.want)
		}
	}
}

func TestControlsAndSupportEvents_SeedThenResetThenReload(t *testing.T) {
	ReloadSecurityComplianceForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	page, err := ListControlEvidence(admin, ControlEvidenceQuery{Limit: 100})
	check(t, err)
	if len(page.Items) != 11 {
		t.Fatalf("seeded controls = %d, want 11", len(page.Items))
	}
	if got := sysJSONKeys(t, page.Items[0]); !strings.Contains(got, "control_ref") || !strings.Contains(got, "evidence_note") {
		t.Fatalf("control keys = %s", got)
	}
	ResetSecurityComplianceForTest()
	page, err = ListControlEvidence(admin, ControlEvidenceQuery{})
	check(t, err)
	if len(page.Items) != 0 {
		t.Fatalf("after reset = %d, want 0", len(page.Items))
	}
	ReloadSecurityComplianceForTest()
	events, err := ListSupportAccessEvents(admin, datactx.PageQuery{})
	check(t, err)
	if len(events.Items) != 1 {
		t.Fatalf("seeded support events = %d, want 1", len(events.Items))
	}
	ResetSecurityComplianceForTest()
}

func TestIntegrations_SeedFromFixturesThenReset(t *testing.T) {
	ReloadIntegrationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	health, err := GetIntegrationsHealth(admin)
	check(t, err)
	if len(health.Integrations) == 0 || health.DataSource != "SYNTHETIC" {
		t.Fatalf("health = %+v, want fixture integrations", health)
	}
	ResetIntegrationsForTest()
	health, err = GetIntegrationsHealth(admin)
	check(t, err)
	if len(health.Integrations) != 0 {
		t.Fatalf("after reset = %d, want 0", len(health.Integrations))
	}
	ReloadIntegrationsForTest()
}

func TestDashboardsAndFieldShareZones_SeedFromFixtures(t *testing.T) {
	ReloadDashboardsForTest()
	if len(allDashboardRollups()) == 0 || len(allProductivityRollups()) == 0 {
		t.Fatal("rollups not seeded from fixtures")
	}
	ResetDashboardsForTest()
	if len(allDashboardRollups()) != 0 {
		t.Fatal("reset should empty the rollups")
	}
	ReloadDashboardsForTest()

	ReloadFieldShareZonesForTest()
	if len(demoZoneIDs()) == 0 {
		t.Fatal("zones not seeded from fixtures")
	}
	ResetFieldShareForTest()
	if len(demoZoneIDs()) != 0 {
		t.Fatal("reset should empty the zones")
	}
	ReloadFieldShareZonesForTest()
}
