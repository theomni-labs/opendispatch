// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

const bootTenant = "44444444-4444-4444-8444-444444444444"

func bootstrapEmpty(t *testing.T) {
	t.Helper()
	ResetUsersForTest()
	ResetIdentityForTest()
	auditlog.ResetForTest()
	settingsstore.ResetForTest()
	identityMu.Lock()
	roleMappingsSeeded = true
	roleMappingStore = nil
	identityMu.Unlock()
}

func bootstrapCounts(t *testing.T) (rules, events int) {
	t.Helper()
	all, err := allRoleMappings(context.Background(), bootTenant)
	check(t, err)
	return len(all), len(auditlog.AllEvents())
}

func TestBootstrap_EmptyCustomerGetsOneAuditedAdministratorRule(t *testing.T) {
	bootstrapEmpty(t)
	res, err := BootstrapAdministratorRule(context.Background(), bootTenant, access.InstallPrivate, "opendispatch-administrators")
	check(t, err)
	if res.Outcome != BootstrapCreated {
		t.Fatalf("got %+v", res)
	}
	rules, err := allRoleMappings(context.Background(), bootTenant)
	check(t, err)
	if len(rules) != 1 {
		t.Fatalf("exactly one rule, got %d", len(rules))
	}
	r := rules[0]
	if r.GroupMatch != "opendispatch-administrators" || r.GroupMatchType != "exact" || r.AssignedRole != access.RoleAdministrator ||
		!r.IsEnabled || r.IdentityProviderID != nil || r.CreatedBy != nil || r.ID != res.RuleID {
		t.Fatalf("got %+v", r)
	}
	events := auditlog.AllEvents()
	if len(events) != 1 {
		t.Fatalf("exactly one audit event, got %d", len(events))
	}
	e := events[0]
	if e.Action != "role_mapping.created" || e.ActorType != "system" || e.ActorUserID != nil || e.TenantID != bootTenant ||
		e.EntityID == nil || *e.EntityID != r.ID || e.Detail["source"] != "first_run_bootstrap" {
		t.Fatalf("got %+v", e)
	}
}

func TestBootstrap_SecondRunChangesNothing(t *testing.T) {
	bootstrapEmpty(t)
	_, err := BootstrapAdministratorRule(context.Background(), bootTenant, access.InstallPrivate, "opendispatch-administrators")
	check(t, err)
	res, err := BootstrapAdministratorRule(context.Background(), bootTenant, access.InstallPrivate, "opendispatch-administrators")
	check(t, err)
	if res.Outcome != BootstrapAlreadyDone {
		t.Fatalf("got %+v", res)
	}
	if rules, events := bootstrapCounts(t); rules != 1 || events != 1 {
		t.Fatalf("second run wrote: %d rules, %d events", rules, events)
	}
}

func TestBootstrap_RefusesWhenAnyRuleExists(t *testing.T) {
	bootstrapEmpty(t)
	check(t, saveRoleMapping(context.Background(), RoleMapping{
		BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: bootTenant, CreatedAt: datactx.NowISO(), UpdatedAt: datactx.NowISO(), DataSource: "SYNTHETIC"},
		GroupMatch: "their-own-admins", GroupMatchType: "exact", AssignedRole: access.RoleViewerAuditor, ZoneIDs: []string{}, Priority: 1, IsEnabled: true,
	}))
	res, err := BootstrapAdministratorRule(context.Background(), bootTenant, access.InstallPrivate, "opendispatch-administrators")
	check(t, err)
	if res.Outcome != BootstrapRulesExist {
		t.Fatalf("got %+v", res)
	}
	if rules, events := bootstrapCounts(t); rules != 1 || events != 0 {
		t.Fatalf("refusal wrote: %d rules, %d events", rules, events)
	}
}

func TestBootstrap_NeverComesBackAfterTheRulesAreRemoved(t *testing.T) {
	bootstrapEmpty(t)
	res, err := BootstrapAdministratorRule(context.Background(), bootTenant, access.InstallPrivate, "opendispatch-administrators")
	check(t, err)
	check(t, deleteRoleMapping(context.Background(), bootTenant, res.RuleID))
	again, err := BootstrapAdministratorRule(context.Background(), bootTenant, access.InstallPrivate, "opendispatch-administrators")
	check(t, err)
	if again.Outcome != BootstrapAlreadyDone {
		t.Fatalf("got %+v", again)
	}
	if rules, events := bootstrapCounts(t); rules != 0 || events != 1 {
		t.Fatalf("got %d rules, %d events", rules, events)
	}
}

func TestBootstrap_OnlyGroupMembersGetTheRole(t *testing.T) {
	bootstrapEmpty(t)
	_, err := BootstrapAdministratorRule(context.Background(), bootTenant, access.InstallPrivate, "opendispatch-administrators")
	check(t, err)
	pre := reqctx.PreSessionContext{CustomerID: bootTenant, InstallMode: access.InstallPrivate}
	out, err := SignInOIDC(pre, OIDCIdentity{Subject: "kc-outsider", Email: "x@customer.example", Groups: []string{"staff", "opendispatch-administrators-old"}})
	check(t, err)
	if out.Outcome != "no_role_assigned" || out.AssignedRole != nil {
		t.Fatalf("a non-member gets no access, got %+v", out)
	}
	none, err := SignInOIDC(pre, OIDCIdentity{Subject: "kc-nogroups", Email: "y@customer.example"})
	check(t, err)
	if none.Outcome != "no_role_assigned" {
		t.Fatalf("no groups, no access; got %+v", none)
	}
	in, err := SignInOIDC(pre, OIDCIdentity{Subject: "kc-admin", Email: "admin@customer.example", EmailVerified: true, Groups: []string{"opendispatch-administrators"}})
	check(t, err)
	if in.Outcome != "signed_in" || in.AssignedRole == nil || *in.AssignedRole != access.RoleAdministrator {
		t.Fatalf("the member is Administrator, got %+v", in)
	}
}

func TestBootstrap_RejectsBadInput(t *testing.T) {
	bootstrapEmpty(t)
	cases := []struct {
		tenant string
		mode   access.InstallMode
		group  string
	}{
		{bootTenant, access.InstallPrivate, "  "},
		{"not-a-uuid", access.InstallPrivate, "opendispatch-administrators"},
		{bootTenant, access.InstallMode("cloud"), "opendispatch-administrators"},
	}
	for _, c := range cases {
		if _, err := BootstrapAdministratorRule(context.Background(), c.tenant, c.mode, c.group); err == nil {
			t.Fatalf("want an error for %+v", c)
		}
	}
	if rules, events := bootstrapCounts(t); rules != 0 || events != 0 {
		t.Fatalf("bad input wrote: %d rules, %d events", rules, events)
	}
}

func TestBootstrap_RuleIsLabelledLikeAnAdminMadeRule(t *testing.T) {
	bootstrapEmpty(t)
	res, err := BootstrapAdministratorRule(context.Background(), bootTenant, access.InstallPrivate, "opendispatch-administrators")
	check(t, err)
	admin := reqctx.RequestContext{CustomerID: bootTenant, UserID: datactx.NewID(), Role: access.RoleAdministrator,
		ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}, InstallMode: access.InstallPrivate}
	made, err := CreateRoleMapping(admin, map[string]any{"group_match": "planners", "group_match_type": "exact", "assigned_role": "administrator"})
	check(t, err)
	rules, err := allRoleMappings(context.Background(), bootTenant)
	check(t, err)
	found := false
	for _, r := range rules {
		if r.ID == res.RuleID {
			found = true
			if r.DataSource == "" || r.DataSource != made.DataSource {
				t.Fatalf("bootstrap rule data_source %q, Admin-made rule %q: want the same", r.DataSource, made.DataSource)
			}
		}
	}
	if !found {
		t.Fatal("bootstrap rule not found")
	}
}
