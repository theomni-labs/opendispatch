// SPDX-License-Identifier: AGPL-3.0-only

// Live: the demo seed's sample rule and setting.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func TestSeedDemoDispatch_OneApprovedSampleRuleAndWaitingSpotsOn(t *testing.T) {
	_ = usePgRules(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	check(t, settingsstore.Put(ctx, tenantID, repositionKey, false))
	if _, err := SeedDemoDispatch(ctx, tenantID); err == nil {
		t.Fatal("no users: want a refusal")
	}
	for _, role := range []access.Role{access.RoleAdministrator, access.RoleDispatchSupervisor} {
		at := datactx.NowISO()
		u := User{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenantID, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"}, Email: string(role) + "@example.test",
			DisplayName: string(role), AssignedRole: role, ZoneIDs: []string{}, Status: "active", PreferredLocale: "en"}
		check(t, userBackend.upsert(ctx, u))
	}
	t.Cleanup(func() { _ = settingsstore.Put(ctx, tenantID, repositionKey, false) })

	res, err := SeedDemoDispatch(ctx, tenantID)
	check(t, err)
	if !res.RuleCreated || !res.RepositionEnabled || !getReposition(ctx, tenantID) {
		t.Fatalf("first seed %+v", res)
	}
	rule, err := GetRule(rc, DemoSampleRuleCode)
	check(t, err)
	if rule.Status != "active" || rule.ActiveVersion == nil || *rule.ActiveVersion != 1 || rule.SourceNote == nil || *rule.SourceNote != demoSeedNote {
		t.Fatalf("rule %+v", rule)
	}
	versions, err := ListRuleVersions(rc, DemoSampleRuleCode, datactx.PageQuery{})
	check(t, err)
	v := versions.Items[0]
	if v.Outcome != "remote_eligible" || v.Status != "active" || len(v.Condition.Predicates) != 3 || v.DecidedByUserID == nil || *v.DecidedByUserID == "" {
		t.Fatalf("version %+v", v)
	}

	again, err := SeedDemoDispatch(ctx, tenantID)
	check(t, err)
	if again.RuleCreated || again.RepositionEnabled {
		t.Fatalf("second seed changed something: %+v", again)
	}
	for action, want := range map[string]int{"rule.created": 1, "rule.submitted": 1, "rule.approved": 1, "settings.live_assignment_changed": 1, "demo.seeded": 1} {
		page, err := ListAuditEvents(rc, AuditFilter{Action: action})
		check(t, err)
		if len(page.Items) != want {
			t.Fatalf("%s: %d audit events, want %d", action, len(page.Items), want)
		}
	}
}
