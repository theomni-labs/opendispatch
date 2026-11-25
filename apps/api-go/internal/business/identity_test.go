// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors identity.test.ts.
package business

import (
	"context"
	"os"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func resetIdentityDeps() {
	ResetIdentityForTest()
	ResetUsersForTest()
	ResetNotificationsForTest()
	settingsstore.ResetForTest()
}

func preSessionCtx(customerID string, mode access.InstallMode) reqctx.PreSessionContext {
	return reqctx.PreSessionContext{CustomerID: customerID, InstallMode: mode}
}

func reqctxPreSession() reqctx.PreSessionContext { return preSessionCtx("t1", access.InstallPrivate) }

const (
	zoneA = "00000000-0000-4000-8000-0000000000a1"
	zoneB = "00000000-0000-4000-8000-0000000000a2"
	zoneC = "00000000-0000-4000-8000-0000000000a3"
)

// seedAdminGroupMapping: the rule tests rely on.
func seedAdminGroupMapping() {
	upsertRoleMappingRow(RoleMapping{
		BaseRecord: bd("00000000-0000-4000-8000-00000000a900", "t1"),
		GroupMatch: "opendispatch-administrators", GroupMatchType: "exact",
		AssignedRole: access.RoleAdministrator, ZoneIDs: []string{}, Priority: 100, IsEnabled: true,
	})
}

func preview(t *testing.T, ctx reqctx.RequestContext, groups []string, providerID *string) RoleMappingPreview {
	t.Helper()
	body := map[string]any{"groups": toAnySlice(groups)}
	if providerID != nil {
		body["identity_provider_id"] = *providerID
	}
	p, err := PreviewRoleMappings(ctx, body)
	check(t, err)
	return p
}

func toAnySlice(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

var entraBody = map[string]any{
	"preset_id": "entra_id_oidc", "display_name": "Customer Entra ID", "is_enabled": true,
	"email_domains": []any{"demo.example"},
	"config":        map[string]any{"directory_tenant_id": "11111111-2222-4333-8444-555555555555", "client_id": "66666666-7777-4888-8999-000000000000"},
	"client_secret": "not-a-real-secret-value",
}

// omitKey: cloneEntra drops the key entirely.
type omitKey struct{}

func cloneEntra(overrides map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range entraBody {
		out[k] = v
	}
	for k, v := range overrides {
		if _, isOmit := v.(omitKey); isOmit {
			delete(out, k)
			continue
		}
		out[k] = v
	}
	return out
}

func TestIdentityPresets_ListsAllNine(t *testing.T) {
	resetIdentityDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	page, err := ListIdentityProviderPresets(admin, datactx.PageQuery{})
	check(t, err)
	if len(page.Items) != 9 || page.Items[0].ID != "entra_id_oidc" {
		t.Fatalf("got %d presets starting %v, want 9 starting entra_id_oidc", len(page.Items), page.Items[0].ID)
	}
}

func TestIdentityProviders_CreateReadUpdateDelete(t *testing.T) {
	resetIdentityDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	created, err := CreateIdentityProvider(admin, cloneEntra(nil))
	check(t, err)
	if created.PresetID != "entra_id_oidc" || !created.HasSecret || !created.SignedAssertionsRequired {
		t.Fatalf("got %+v, want a filled Entra ID provider", created)
	}

	got, err := GetIdentityProvider(admin, created.ID)
	check(t, err)
	if got.DisplayName != "Customer Entra ID" {
		t.Fatalf("got %q, want Customer Entra ID", got.DisplayName)
	}

	updated, err := UpdateIdentityProvider(admin, created.ID, cloneEntra(map[string]any{"display_name": "Renamed", "client_secret": omitKey{}}))
	check(t, err)
	if updated.DisplayName != "Renamed" || !updated.HasSecret {
		t.Fatalf("got %+v, want Renamed with has_secret kept", updated)
	}

	if _, err := UpdateIdentityProvider(admin, MockProviderID, cloneEntra(nil)); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("update mock: got %v, want Conflict", err)
	}
	if err := DeleteIdentityProvider(admin, MockProviderID); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("delete mock: got %v, want Conflict", err)
	}
	if err := DeleteIdentityProvider(admin, created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := GetIdentityProvider(admin, created.ID); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("got %v, want NotFound after delete", err)
	}
}

func TestIdentityProviders_ValidatesPresetSecretAndDomains(t *testing.T) {
	resetIdentityDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	if _, err := CreateIdentityProvider(admin, cloneEntra(map[string]any{"preset_id": "nope"})); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad preset: got %v, want Invalid", err)
	}
	if _, err := CreateIdentityProvider(admin, cloneEntra(map[string]any{"config": map[string]any{"client_id": "x"}})); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("missing required field: got %v, want Invalid", err)
	}
	if _, err := CreateIdentityProvider(admin, cloneEntra(map[string]any{"client_secret": omitKey{}})); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("no secret: got %v, want Invalid", err)
	}
	badConfig := map[string]any{"directory_tenant_id": "11111111-2222-4333-8444-555555555555", "client_id": "66666666-7777-4888-8999-000000000000", "unknown_setting": "x"}
	if _, err := CreateIdentityProvider(admin, cloneEntra(map[string]any{"config": badConfig})); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("unknown config field: got %v, want Invalid", err)
	}
	if _, err := CreateIdentityProvider(admin, cloneEntra(map[string]any{"email_domains": []any{"not a domain"}})); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad domain: got %v, want Invalid", err)
	}

	saml, err := CreateIdentityProvider(admin, map[string]any{
		"preset_id": "generic_saml", "display_name": "SAML", "is_enabled": true,
		"config": map[string]any{"sso_url": "https://idp.example.com/sso", "entity_id": "https://idp.example.com/meta", "signing_certificate": fakeCert},
	})
	check(t, err)
	if saml.Protocol != "saml" || saml.HasSecret || !saml.SignedAssertionsRequired {
		t.Fatalf("got %+v, want a SAML provider with no secret", saml)
	}
}

func TestIdentityProviders_TestConnectionScripted(t *testing.T) {
	resetIdentityDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	good, err := CreateIdentityProvider(admin, cloneEntra(nil))
	check(t, err)
	ok, err := TestIdentityProviderConnection(admin, good.ID)
	check(t, err)
	if !ok.OK || len(ok.Steps) <= 2 {
		t.Fatalf("got %+v, want ok with several steps", ok)
	}
	got, err := GetIdentityProvider(admin, good.ID)
	check(t, err)
	if got.LastTestOk == nil || !*got.LastTestOk {
		t.Fatalf("got %+v, want last_test_ok true", got)
	}

	badConfig := map[string]any{"directory_tenant_id": "11111111-2222-4333-8444-555555555555", "client_id": "invalid-client"}
	bad, err := CreateIdentityProvider(admin, cloneEntra(map[string]any{"display_name": "Bad", "config": badConfig}))
	check(t, err)
	failed, err := TestIdentityProviderConnection(admin, bad.ID)
	check(t, err)
	if failed.OK || failed.ReferenceCode == nil {
		t.Fatalf("got %+v, want a failing test with a reference code", failed)
	}

	mockResult, err := TestIdentityProviderConnection(admin, MockProviderID)
	check(t, err)
	if !mockResult.OK {
		t.Fatalf("mock provider test: got %+v, want ok", mockResult)
	}
}

func TestIdentityProviders_AdministratorOnlyViewOnlyInShared(t *testing.T) {
	resetIdentityDeps()
	for _, role := range []access.Role{access.RoleDispatchSupervisor, access.RolePlanner, access.RoleViewerAuditor, access.RoleChangeApprover} {
		rc := roleCtx("t1", "u1", role)
		if _, err := ListIdentityProviders(rc, datactx.PageQuery{}); errCode(err) != dataerr.CodeForbidden {
			t.Fatalf("%s: got %v, want Forbidden", role, err)
		}
	}
	shared := roleCtx("t1", "u1", access.RoleAdministrator)
	shared.InstallMode = access.InstallShared
	page, err := ListIdentityProviders(shared, datactx.PageQuery{})
	check(t, err)
	for _, p := range page.Items {
		if !p.ReadOnly {
			t.Fatalf("shared install: %+v should be read only", p)
		}
	}
	if _, err := CreateIdentityProvider(shared, cloneEntra(nil)); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("create in shared: got %v, want Forbidden", err)
	}
}

// Plan 6.2 item 2: read only in the shared tier.
func TestSignInIdentity_AdministratorInEveryInstallMode(t *testing.T) {
	policy := map[string]any{"force_sso_email_domains": []any{}, "require_mfa_claim": false, "allow_local_users_for_outsiders": false, "emergency_admin_enabled": true}
	for _, mode := range []access.InstallMode{access.InstallPrivate, access.InstallDedicated, access.InstallShared} {
		resetIdentityDeps()
		seed := roleCtx("t1", "u1", access.RoleAdministrator)
		provider, err := CreateIdentityProvider(seed, cloneEntra(nil))
		check(t, err)
		rule, err := CreateRoleMapping(seed, map[string]any{"group_match": "g-" + string(mode), "group_match_type": "exact", "assigned_role": "viewer_auditor", "priority": 40.0})
		check(t, err)
		admin := roleCtx("t1", "u1", access.RoleAdministrator)
		admin.InstallMode = mode
		reads := map[string]error{}
		_, reads["list providers"] = ListIdentityProviders(admin, datactx.PageQuery{})
		_, reads["list rules"] = ListRoleMappings(admin, datactx.PageQuery{})
		_, reads["preview"] = PreviewRoleMappings(admin, map[string]any{"groups": []any{"g"}})
		_, reads["policy"] = GetSignInPolicy(admin)
		_, reads["request change"] = RequestIdentityProviderChange(admin, map[string]any{"provider_id": nil, "change": "Add a provider."})
		for name, err := range reads {
			if err != nil {
				t.Fatalf("%s %s: %v", mode, name, err)
			}
		}
		writes := map[string]error{}
		_, writes["test connection"] = TestIdentityProviderConnection(admin, provider.ID)
		_, writes["create rule"] = CreateRoleMapping(admin, map[string]any{"group_match": "h", "group_match_type": "exact", "assigned_role": "viewer_auditor", "priority": 41.0})
		_, writes["update rule"] = UpdateRoleMapping(admin, rule.ID, map[string]any{"group_match": "g2", "group_match_type": "exact", "assigned_role": "viewer_auditor", "priority": 40.0})
		_, writes["update policy"] = UpdateSignInPolicy(admin, policy)
		_, writes["create provider"] = CreateIdentityProvider(admin, cloneEntra(map[string]any{"display_name": "Second"}))
		writes["delete rule"] = DeleteRoleMapping(admin, rule.ID)
		for name, err := range writes {
			if mode == access.InstallShared && errCode(err) != dataerr.CodeForbidden {
				t.Fatalf("shared %s: got %v, want Forbidden", name, err)
			}
			if mode != access.InstallShared && err != nil {
				t.Fatalf("%s %s: %v", mode, name, err)
			}
		}
	}
}

func TestRoleMappings_PreviewAndPriorityAndZoneMerge(t *testing.T) {
	resetIdentityDeps()
	SeedIdentityZoneIDsForTest([]string{zoneA, zoneB, zoneC})
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	none := preview(t, admin, []string{"marketing", "everyone"}, nil)
	if none.AssignedRole != nil {
		t.Fatalf("got %+v, want no role", none)
	}

	first, err := CreateRoleMapping(admin, map[string]any{"group_match": "3f2504e0-4f89-41d3-9a0c-0305e82c3301", "group_match_type": "object_id", "assigned_role": "dispatcher", "zone_ids": []any{zoneA}, "priority": 20.0})
	check(t, err)
	if first.GroupMatchType != "object_id" {
		t.Fatalf("got %+v", first)
	}
	_, err = CreateRoleMapping(admin, map[string]any{"group_match": "dispatch-north", "group_match_type": "prefix", "assigned_role": "dispatcher", "zone_ids": []any{zoneB}, "priority": 21.0})
	check(t, err)

	got := preview(t, admin, []string{"3F2504E0-4F89-41D3-9A0C-0305E82C3301", "dispatch-north-team"}, nil)
	if got.AssignedRole == nil || *got.AssignedRole != access.RoleDispatcher || len(got.ZoneIDs) != 2 || len(got.MatchedMappingIDs) != 2 {
		t.Fatalf("got %+v, want dispatcher with 2 merged zones and 2 matches", got)
	}

	if _, err := CreateRoleMapping(admin, map[string]any{"group_match": "not-a-guid", "group_match_type": "object_id", "assigned_role": "planner", "zone_ids": []any{zoneA}}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad object id: got %v, want Invalid", err)
	}
	if _, err := CreateRoleMapping(admin, map[string]any{"group_match": "g", "group_match_type": "exact", "assigned_role": "planner"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("planner with no zone: got %v, want Invalid", err)
	}
	if _, err := CreateRoleMapping(admin, map[string]any{"group_match": "g", "group_match_type": "exact", "assigned_role": "boss"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("unknown role: got %v, want Invalid", err)
	}
	if _, err := CreateRoleMapping(admin, map[string]any{"group_match": "g", "group_match_type": "exact", "assigned_role": "viewer_auditor", "identity_provider_id": "unknown-provider"}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("unknown provider: got %v, want NotFound", err)
	}
}

func TestRoleMappings_PriorityOrderAndEditDelete(t *testing.T) {
	resetIdentityDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	low, err := CreateRoleMapping(admin, map[string]any{"group_match": "shared-group", "group_match_type": "exact", "assigned_role": "viewer_auditor", "priority": 50.0})
	check(t, err)
	high, err := CreateRoleMapping(admin, map[string]any{"group_match": "shared-group", "group_match_type": "exact", "assigned_role": "administrator", "priority": 5.0})
	check(t, err)

	p1 := preview(t, admin, []string{"shared-group"}, nil)
	if p1.AssignedRole == nil || *p1.AssignedRole != access.RoleAdministrator {
		t.Fatalf("got %+v, want administrator (lower priority wins)", p1)
	}
	_, err = UpdateRoleMapping(admin, high.ID, map[string]any{"group_match": "shared-group", "group_match_type": "exact", "assigned_role": "administrator", "priority": 5.0, "is_enabled": false})
	check(t, err)
	p2 := preview(t, admin, []string{"shared-group"}, nil)
	if p2.AssignedRole == nil || *p2.AssignedRole != access.RoleViewerAuditor {
		t.Fatalf("got %+v, want viewer_auditor once the high rule is disabled", p2)
	}
	if err := DeleteRoleMapping(admin, low.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	p3 := preview(t, admin, []string{"shared-group"}, nil)
	if p3.AssignedRole != nil {
		t.Fatalf("got %+v, want no role once both are gone/disabled", p3)
	}
}

func TestRoleMappings_IgnoresRoleNotInInstallMode(t *testing.T) {
	resetIdentityDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	_, err := CreateRoleMapping(admin, map[string]any{"group_match": "opendispatch-change-approvers", "group_match_type": "exact", "assigned_role": "change_approver", "priority": 1.0})
	check(t, err)
	if p := preview(t, admin, []string{"opendispatch-change-approvers"}, nil); p.AssignedRole == nil || *p.AssignedRole != access.RoleChangeApprover {
		t.Fatalf("private install: got %+v, want change_approver", p)
	}
	shared := roleCtx("t1", "u1", access.RoleAdministrator)
	shared.InstallMode = access.InstallShared
	if p := preview(t, shared, []string{"opendispatch-change-approvers"}, nil); p.AssignedRole != nil {
		t.Fatalf("shared install: got %+v, want no role", p)
	}
}

func TestRoleMappings_AdministratorOnly(t *testing.T) {
	resetIdentityDeps()
	planner := roleCtx("t1", "u1", access.RolePlanner)
	if _, err := PreviewRoleMappings(planner, map[string]any{"groups": []any{}}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden", err)
	}
	viewer := roleCtx("t1", "u1", access.RoleViewerAuditor)
	if _, err := ListRoleMappings(viewer, datactx.PageQuery{}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden", err)
	}
}

func TestSignInPolicy_DefaultsUpdateAndValidate(t *testing.T) {
	resetIdentityDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	policy, err := GetSignInPolicy(admin)
	check(t, err)
	if policy.RequireMFAClaim || policy.AllowLocalUsersForOutsiders || !policy.EmergencyAdminEnabled {
		t.Fatalf("got %+v, want the fixture defaults", policy)
	}
	next, err := UpdateSignInPolicy(admin, map[string]any{"force_sso_email_domains": []any{"demo.example", "customer.example"}, "require_mfa_claim": true, "allow_local_users_for_outsiders": false, "emergency_admin_enabled": true})
	check(t, err)
	if !next.RequireMFAClaim {
		t.Fatalf("got %+v, want require_mfa_claim true", next)
	}
	if _, err := UpdateSignInPolicy(admin, map[string]any{"force_sso_email_domains": []any{"bad domain"}, "require_mfa_claim": true, "allow_local_users_for_outsiders": false, "emergency_admin_enabled": true}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid", err)
	}
}

func TestMockSignIn_CreatesAccountAndRecalculatesRole(t *testing.T) {
	resetIdentityDeps()
	seedAdminGroupMapping()
	pre := reqctxPreSession()
	result, err := MockSignIn(pre, map[string]any{"provider_id": MockProviderID, "subject": "huda.test@demo.example", "groups": []any{"opendispatch-administrators"}})
	check(t, err)
	if result.Outcome != "signed_in" || result.AssignedRole == nil || *result.AssignedRole != access.RoleAdministrator {
		t.Fatalf("got %+v, want signed_in as administrator", result)
	}
	created := oneUserT(*result.UserID)
	if created == nil || created.Status != "active" || created.KeycloakSubject == nil || *created.KeycloakSubject != "huda.test@demo.example" {
		t.Fatalf("got %+v, want an active created user", created)
	}
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	_, err = CreateRoleMapping(admin, map[string]any{"group_match": "temp-viewers", "group_match_type": "exact", "assigned_role": "viewer_auditor", "priority": 1.0})
	check(t, err)
	again, err := MockSignIn(pre, map[string]any{"provider_id": MockProviderID, "subject": "huda.test@demo.example", "groups": []any{"temp-viewers"}})
	check(t, err)
	if again.AssignedRole == nil || *again.AssignedRole != access.RoleViewerAuditor || *again.UserID != *result.UserID {
		t.Fatalf("got %+v, want the same user recalculated to viewer_auditor", again)
	}
}

func TestMockSignIn_NoRuleMatchesGivesNoRoleAndCreatesNothing(t *testing.T) {
	resetIdentityDeps()
	pre := reqctxPreSession()
	before := len(usersOrLog(context.Background(), ""))
	result, err := MockSignIn(pre, map[string]any{"provider_id": MockProviderID, "subject": "nobody@demo.example", "groups": []any{"random-group"}})
	check(t, err)
	if result.Outcome != "no_role_assigned" || result.AssignedRole != nil {
		t.Fatalf("got %+v, want no_role_assigned", result)
	}
	if len(usersOrLog(context.Background(), "")) != before {
		t.Fatalf("a nobody sign-in must create no user")
	}
}

func TestMockSignIn_UnknownProviderAndDisabledAccount(t *testing.T) {
	resetIdentityDeps()
	seedAdminGroupMapping()
	pre := reqctxPreSession()
	unknown, err := MockSignIn(pre, map[string]any{"provider_id": "unknown", "subject": "s", "groups": []any{"opendispatch-administrators"}})
	check(t, err)
	if unknown.Outcome != "refused_by_provider" {
		t.Fatalf("got %+v, want refused_by_provider", unknown)
	}
	upsertUserRow(User{BaseRecord: bd("00000000-0000-4000-8000-0000000000d1", "t1"), Email: "disabled@demo.example", DisplayName: "Disabled", AssignedRole: access.RoleViewerAuditor, Status: "disabled", PreferredLocale: "en"})
	disabled, err := MockSignIn(pre, map[string]any{"provider_id": MockProviderID, "subject": "disabled@demo.example", "groups": []any{"opendispatch-administrators"}})
	check(t, err)
	if disabled.Outcome != "locked" {
		t.Fatalf("got %+v, want locked", disabled)
	}
	if _, err := MockSignIn(pre, map[string]any{"provider_id": MockProviderID, "subject": "s", "groups": []any{}, "role": "administrator"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("extra field: got %v, want Invalid", err)
	}
}

func TestMockSignIn_ScriptedProviderFailure(t *testing.T) {
	resetIdentityDeps()
	seedAdminGroupMapping()
	pre := reqctxPreSession()
	for _, groups := range [][]any{{}, {"opendispatch-administrators"}} {
		result, err := MockSignIn(pre, map[string]any{"provider_id": MockProviderID, "subject": "provider.error", "groups": groups})
		check(t, err)
		if result.Outcome != "error" || result.UserID != nil {
			t.Fatalf("got %+v, want error with no user", result)
		}
	}
	caseInsensitive, err := MockSignIn(pre, map[string]any{"provider_id": MockProviderID, "subject": "Provider.Error", "groups": []any{"opendispatch-administrators"}})
	check(t, err)
	if caseInsensitive.Outcome != "error" {
		t.Fatalf("got %+v, want error (case-insensitive trigger)", caseInsensitive)
	}
	for _, subject := range []string{"provider.errors", "xprovider.error", "provider-error"} {
		result, err := MockSignIn(pre, map[string]any{"provider_id": MockProviderID, "subject": subject, "groups": []any{"opendispatch-administrators"}})
		check(t, err)
		if result.Outcome != "signed_in" {
			t.Fatalf("subject %q: got %+v, want signed_in (only an exact match triggers)", subject, result)
		}
	}
}

func TestPreSession_RefusesForgedContexts(t *testing.T) {
	resetIdentityDeps()
	seedAdminGroupMapping()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	upsertUserRow(User{BaseRecord: bd("u1", "t1"), Email: "a@b.example", DisplayName: "A", AssignedRole: access.RoleAdministrator, Status: "active", PreferredLocale: "en"})
	if _, err := GetSessionContext(admin); err != nil {
		t.Fatalf("sanity: admin session should work: %v", err)
	}
	for _, mode := range []access.InstallMode{access.InstallPrivate, access.InstallDedicated, access.InstallShared} {
		pre := preSessionCtx("t1", mode)
		if _, err := MockSignIn(pre, map[string]any{"provider_id": MockProviderID, "subject": "visitor-" + string(mode) + "@demo.example", "groups": []any{"opendispatch-administrators"}}); err != nil {
			t.Fatalf("mode %s: %v", mode, err)
		}
	}
	bad := preSessionCtx("", access.InstallPrivate)
	if _, err := MockSignIn(bad, map[string]any{"provider_id": MockProviderID, "subject": "s", "groups": []any{}}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("empty customer: got %v, want Forbidden", err)
	}
	badMode := preSessionCtx("t1", access.InstallMode("cloud"))
	if _, err := MockSignIn(badMode, map[string]any{"provider_id": MockProviderID, "subject": "s", "groups": []any{}}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("unknown install mode: got %v, want Forbidden", err)
	}
}

func TestEmergencyAdminSignIn_MfaThenSuccessAudited(t *testing.T) {
	resetIdentityDeps()
	os.Setenv("DEMO_EMERGENCY_ADMIN_PASSWORD", "demo-password-for-tests-only")
	os.Setenv("DEMO_EMERGENCY_ADMIN_TOTP", "123456")
	defer os.Unsetenv("DEMO_EMERGENCY_ADMIN_PASSWORD")
	defer os.Unsetenv("DEMO_EMERGENCY_ADMIN_TOTP")

	upsertUserRow(User{BaseRecord: bd("00000000-0000-4000-8000-0000000000e1", "t1"), Email: "emergency@demo.example", DisplayName: "Emergency", AssignedRole: access.RoleAdministrator, IsEmergencyAdmin: true, Status: "active", PreferredLocale: "en"})
	UpsertNotificationRuleForTest(NotificationRule{
		BaseRecord: bd("00000000-0000-4000-8000-0000000000e9", "t1"), EventType: "emergency_admin_sign_in",
		Channels: []string{"in_app"}, RecipientRoles: []access.Role{access.RoleAdministrator}, Severity: "warning", IsEnabled: true,
	})
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	before, err := CountUnreadNotifications(admin)
	check(t, err)
	pre := reqctxPreSession()
	mfa, err := EmergencyAdminSignIn(pre, map[string]any{"email": "emergency@demo.example", "password": "demo-password-for-tests-only"})
	check(t, err)
	if mfa.Outcome != "mfa_required" {
		t.Fatalf("got %+v, want mfa_required", mfa)
	}
	done, err := EmergencyAdminSignIn(pre, map[string]any{"email": "emergency@demo.example", "password": "demo-password-for-tests-only", "totp_code": "123456"})
	check(t, err)
	if done.Outcome != "signed_in" || done.AssignedRole == nil || *done.AssignedRole != access.RoleAdministrator {
		t.Fatalf("got %+v, want signed_in as administrator", done)
	}
	after, err := CountUnreadNotifications(admin)
	check(t, err)
	if after <= before {
		t.Fatalf("got %d unread after signing in, want more than %d", after, before)
	}
}

func TestEmergencyAdminSignIn_WrongCredentialsLockAfterFive(t *testing.T) {
	resetIdentityDeps()
	os.Setenv("DEMO_EMERGENCY_ADMIN_PASSWORD", "demo-password-for-tests-only")
	os.Setenv("DEMO_EMERGENCY_ADMIN_TOTP", "123456")
	defer os.Unsetenv("DEMO_EMERGENCY_ADMIN_PASSWORD")
	defer os.Unsetenv("DEMO_EMERGENCY_ADMIN_TOTP")
	upsertUserRow(User{BaseRecord: bd("00000000-0000-4000-8000-0000000000e2", "t1"), Email: "emergency2@demo.example", DisplayName: "Emergency", AssignedRole: access.RoleAdministrator, IsEmergencyAdmin: true, Status: "active", PreferredLocale: "en"})
	pre := reqctxPreSession()

	wrong, err := EmergencyAdminSignIn(pre, map[string]any{"email": "emergency2@demo.example", "password": "wrong"})
	check(t, err)
	if wrong.Outcome != "invalid_credentials" {
		t.Fatalf("got %+v, want invalid_credentials", wrong)
	}
	for i := 0; i < 4; i++ {
		_, err := EmergencyAdminSignIn(pre, map[string]any{"email": "emergency2@demo.example", "password": "wrong"})
		check(t, err)
	}
	locked, err := EmergencyAdminSignIn(pre, map[string]any{"email": "emergency2@demo.example", "password": "demo-password-for-tests-only", "totp_code": "123456"})
	check(t, err)
	if locked.Outcome != "locked" {
		t.Fatalf("got %+v, want locked after five failures", locked)
	}
}

func TestEmergencyAdminSignIn_RefusesUnconfiguredSecrets(t *testing.T) {
	resetIdentityDeps()
	os.Unsetenv("DEMO_EMERGENCY_ADMIN_PASSWORD")
	os.Unsetenv("DEMO_EMERGENCY_ADMIN_TOTP")
	upsertUserRow(User{BaseRecord: bd("00000000-0000-4000-8000-0000000000e3", "t1"), Email: "emergency3@demo.example", DisplayName: "Emergency", AssignedRole: access.RoleAdministrator, IsEmergencyAdmin: true, Status: "active", PreferredLocale: "en"})
	pre := reqctxPreSession()
	for _, expected := range []string{"", "replace-me"} {
		if expected != "" {
			os.Setenv("DEMO_EMERGENCY_ADMIN_PASSWORD", expected)
		} else {
			os.Unsetenv("DEMO_EMERGENCY_ADMIN_PASSWORD")
		}
		for _, given := range []string{"x", "replace-me", "demo-password-for-tests-only"} {
			result, err := EmergencyAdminSignIn(pre, map[string]any{"email": "emergency3@demo.example", "password": given})
			check(t, err)
			if result.Outcome != "invalid_credentials" {
				t.Fatalf("expected=%q given=%q: got %+v, want invalid_credentials", expected, given, result)
			}
		}
	}
	if _, err := EmergencyAdminSignIn(pre, map[string]any{"email": "emergency3@demo.example", "password": ""}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("empty password: got %v, want Invalid", err)
	}
	os.Unsetenv("DEMO_EMERGENCY_ADMIN_PASSWORD")
}

func TestEmergencyAdminSignIn_CanBeSwitchedOff(t *testing.T) {
	resetIdentityDeps()
	os.Setenv("DEMO_EMERGENCY_ADMIN_PASSWORD", "demo-password-for-tests-only")
	os.Setenv("DEMO_EMERGENCY_ADMIN_TOTP", "123456")
	defer os.Unsetenv("DEMO_EMERGENCY_ADMIN_PASSWORD")
	defer os.Unsetenv("DEMO_EMERGENCY_ADMIN_TOTP")
	upsertUserRow(User{BaseRecord: bd("00000000-0000-4000-8000-0000000000e4", "t1"), Email: "emergency4@demo.example", DisplayName: "Emergency", AssignedRole: access.RoleAdministrator, IsEmergencyAdmin: true, Status: "active", PreferredLocale: "en"})
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	_, err := UpdateSignInPolicy(admin, map[string]any{"force_sso_email_domains": []any{}, "require_mfa_claim": false, "allow_local_users_for_outsiders": false, "emergency_admin_enabled": false})
	check(t, err)
	pre := reqctxPreSession()
	off, err := EmergencyAdminSignIn(pre, map[string]any{"email": "emergency4@demo.example", "password": "demo-password-for-tests-only", "totp_code": "123456"})
	check(t, err)
	if off.Outcome != "invalid_credentials" {
		t.Fatalf("got %+v, want invalid_credentials once switched off", off)
	}
}

func TestSession_DescribesCallerAndSignOutAudits(t *testing.T) {
	resetIdentityDeps()
	upsertUserRow(User{BaseRecord: bd("u1", "t1"), Email: "a@b.example", DisplayName: "A", AssignedRole: access.RolePlanner, Status: "active", PreferredLocale: "en"})
	ctx := roleCtx("t1", "u1", access.RolePlanner)
	session, err := GetSessionContext(ctx)
	check(t, err)
	if session.User.ID != "u1" || session.User.AssignedRole != access.RolePlanner || len(session.Modules) != 30 {
		t.Fatalf("got %+v, want 30 modules for u1/planner", session)
	}
	if err := SignOut(ctx); err != nil {
		t.Fatalf("sign out: %v", err)
	}
}

func TestSession_RefusesInstallModeOutsideRole(t *testing.T) {
	resetIdentityDeps()
	upsertUserRow(User{BaseRecord: bd("u2", "t1"), Email: "b@b.example", DisplayName: "B", AssignedRole: access.RoleChangeApprover, Status: "active", PreferredLocale: "en"})
	ctx := roleCtx("t1", "u2", access.RoleChangeApprover)
	ctx.InstallMode = access.InstallShared
	if _, err := GetSessionContext(ctx); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden", err)
	}
}

func TestRequestIdentityProviderChange_ViewOnlySendsReceiptAndAlert(t *testing.T) {
	resetIdentityDeps()
	shared := roleCtx("t1", "u1", access.RoleAdministrator)
	shared.InstallMode = access.InstallShared
	if _, err := CreateIdentityProvider(shared, cloneEntra(nil)); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("create in shared: got %v, want Forbidden", err)
	}
	receipt, err := RequestIdentityProviderChange(shared, map[string]any{"provider_id": nil, "change": "Please add our second Entra ID tenant."})
	check(t, err)
	if receipt.ReferenceCode == "" {
		t.Fatalf("got %+v, want a reference code", receipt)
	}
	count, err := CountUnreadNotifications(roleCtx("t1", "u1", access.RoleAdministrator))
	check(t, err)
	if count == 0 {
		t.Fatalf("expected an unread alert for the Administrators")
	}
}

func TestRequestIdentityProviderChange_ValidatesFields(t *testing.T) {
	resetIdentityDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	bad := []map[string]any{
		{}, {"change": ""}, {"change": 5}, {"change": "x", "role": "administrator"},
		{"change": "x", "provider_id": 5},
	}
	for _, body := range bad {
		if _, err := RequestIdentityProviderChange(admin, body); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("body %+v: got %v, want Invalid", body, err)
		}
	}
	if _, err := RequestIdentityProviderChange(admin, map[string]any{"change": "no such provider", "provider_id": "no-such-provider"}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("got %v, want NotFound", err)
	}
}

func TestRequestIdentityProviderChange_AdministratorOnly(t *testing.T) {
	resetIdentityDeps()
	for _, role := range []access.Role{access.RoleDispatchSupervisor, access.RoleDispatcher, access.RolePlanner, access.RoleRemoteTeamLead, access.RoleViewerAuditor, access.RoleChangeApprover} {
		rc := roleCtx("t1", "u1", role)
		if _, err := RequestIdentityProviderChange(rc, map[string]any{"change": "x"}); errCode(err) != dataerr.CodeForbidden {
			t.Fatalf("%s: got %v, want Forbidden", role, err)
		}
	}
}
