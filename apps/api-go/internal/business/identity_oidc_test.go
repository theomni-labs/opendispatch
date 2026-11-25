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

const oidcTenant = "33333333-3333-4333-8333-333333333333"

func oidcSetup(t *testing.T) reqctx.PreSessionContext {
	t.Helper()
	ResetUsersForTest()
	ResetIdentityForTest()
	auditlog.ResetForTest()
	// A rule set of our own: one rule for any provider, nothing from the fixtures.
	identityMu.Lock()
	roleMappingsSeeded = true
	roleMappingStore = nil
	identityMu.Unlock()
	saveRule := func(group string, role access.Role, priority int) {
		check(t, saveRoleMapping(context.Background(), RoleMapping{
			BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: oidcTenant, CreatedAt: datactx.NowISO(), UpdatedAt: datactx.NowISO(), DataSource: "SYNTHETIC"},
			GroupMatch: group, GroupMatchType: "exact", AssignedRole: role, ZoneIDs: []string{}, Priority: priority, IsEnabled: true,
		}))
	}
	saveRule("opendispatch-admins", access.RoleAdministrator, 1)
	saveRule("opendispatch-viewers", access.RoleViewerAuditor, 2)
	return reqctx.PreSessionContext{CustomerID: oidcTenant, InstallMode: access.InstallPrivate}
}

func TestSignInOIDC_AGroupRuleGivesTheRoleAndCreatesTheAccount(t *testing.T) {
	pre := oidcSetup(t)
	res, err := SignInOIDC(pre, OIDCIdentity{Subject: "kc-1", Email: "Ann@customer.example", EmailVerified: true, Name: "Ann Admin", Groups: []string{"staff", "opendispatch-admins"}})
	check(t, err)
	if res.Outcome != "signed_in" || res.AssignedRole == nil || *res.AssignedRole != access.RoleAdministrator || res.UserID == nil {
		t.Fatalf("got %+v", res)
	}
	u, err := oneUser(context.Background(), oidcTenant, *res.UserID)
	check(t, err)
	if u == nil || u.KeycloakSubject == nil || *u.KeycloakSubject != "kc-1" || u.DisplayName != "Ann Admin" || u.Status != "active" {
		t.Fatalf("got %+v", u)
	}
	// The next sign-in is the same person, not a second account, and the role follows the rules.
	again, err := SignInOIDC(pre, OIDCIdentity{Subject: "kc-1", Email: "ann@customer.example", Groups: []string{"opendispatch-viewers"}})
	check(t, err)
	if again.UserID == nil || *again.UserID != *res.UserID || again.AssignedRole == nil || *again.AssignedRole != access.RoleViewerAuditor {
		t.Fatalf("got %+v", again)
	}
	all, _ := allUsers(context.Background(), oidcTenant)
	if len(all) != 1 {
		t.Fatalf("one person, one account; got %d", len(all))
	}
}

func TestSignInOIDC_NoMatchingGroupMeansNoAccessAndNoAccount(t *testing.T) {
	pre := oidcSetup(t)
	res, err := SignInOIDC(pre, OIDCIdentity{Subject: "kc-2", Email: "x@customer.example", Groups: []string{"staff", "everyone"}})
	check(t, err)
	if res.Outcome != "no_role_assigned" || res.AssignedRole != nil || res.UserID != nil {
		t.Fatalf("got %+v", res)
	}
	all, _ := allUsers(context.Background(), oidcTenant)
	if len(all) != 0 {
		t.Fatalf("no account may be made for a person with no role, got %d", len(all))
	}
	events := auditlog.AllEvents()
	if len(events) != 1 || events[0].Outcome != "denied" || events[0].Action != "auth.sign_in" {
		t.Fatalf("the refusal must be audited, got %+v", events)
	}
}

func TestSignInOIDC_ADisabledAccountIsLocked(t *testing.T) {
	pre := oidcSetup(t)
	first, err := SignInOIDC(pre, OIDCIdentity{Subject: "kc-3", Email: "d@customer.example", Groups: []string{"opendispatch-viewers"}})
	check(t, err)
	u, _ := oneUser(context.Background(), oidcTenant, *first.UserID)
	u.Status = "disabled"
	check(t, saveUser(context.Background(), *u))
	res, err := SignInOIDC(pre, OIDCIdentity{Subject: "kc-3", Email: "d@customer.example", Groups: []string{"opendispatch-viewers"}})
	check(t, err)
	if res.Outcome != "locked" || res.AssignedRole != nil {
		t.Fatalf("got %+v", res)
	}
}

func TestSignInOIDC_AnInvitedAccountIsLinkedOnlyByAVerifiedEmail(t *testing.T) {
	pre := oidcSetup(t)
	invited := User{
		BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: oidcTenant, CreatedAt: datactx.NowISO(), UpdatedAt: datactx.NowISO(), DataSource: "SYNTHETIC"},
		Email:      "invited@customer.example", DisplayName: "Invited", AssignedRole: access.RoleViewerAuditor, ZoneIDs: []string{}, Status: "invited", PreferredLocale: "en",
	}
	check(t, saveUser(context.Background(), invited))

	res, err := SignInOIDC(pre, OIDCIdentity{Subject: "kc-attacker", Email: "invited@customer.example", EmailVerified: false, Groups: []string{"opendispatch-admins"}})
	check(t, err)
	if res.Outcome != "refused_by_provider" {
		t.Fatalf("an unverified email must not claim the account, got %+v", res)
	}
	res, err = SignInOIDC(pre, OIDCIdentity{Subject: "kc-real", Email: "invited@customer.example", EmailVerified: true, Groups: []string{"opendispatch-viewers"}})
	check(t, err)
	if res.Outcome != "signed_in" || res.UserID == nil || *res.UserID != invited.ID {
		t.Fatalf("a verified email links the invited account, got %+v", res)
	}
	// Once linked, another subject with the same email cannot take it over.
	res, err = SignInOIDC(pre, OIDCIdentity{Subject: "kc-other", Email: "invited@customer.example", EmailVerified: true, Groups: []string{"opendispatch-admins"}})
	check(t, err)
	if res.Outcome != "refused_by_provider" {
		t.Fatalf("got %+v", res)
	}
}

func TestSignInOIDC_ThePolicyCanRequireASecondFactor(t *testing.T) {
	pre := oidcSetup(t)
	_ = settingsstore.Put(context.Background(), "", "auth.require_mfa_claim", true)
	t.Cleanup(settingsstore.ReloadForTest)
	res, err := SignInOIDC(pre, OIDCIdentity{Subject: "kc-4", Email: "m@customer.example", Groups: []string{"opendispatch-viewers"}, MFA: false})
	check(t, err)
	if res.Outcome != "mfa_required" {
		t.Fatalf("got %+v", res)
	}
	res, err = SignInOIDC(pre, OIDCIdentity{Subject: "kc-4", Email: "m@customer.example", Groups: []string{"opendispatch-viewers"}, MFA: true})
	check(t, err)
	if res.Outcome != "signed_in" {
		t.Fatalf("got %+v", res)
	}
}

func TestSignInOIDC_ATokenWithoutASubjectIsAnError(t *testing.T) {
	pre := oidcSetup(t)
	res, err := SignInOIDC(pre, OIDCIdentity{Subject: "  ", Groups: []string{"opendispatch-admins"}})
	check(t, err)
	if res.Outcome != "error" {
		t.Fatalf("got %+v", res)
	}
}
