// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

func TestListRoles_HasEnglishAndArabicNames(t *testing.T) {
	ResetUsersForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	page, err := ListRoles(admin, ListRolesQuery{})
	check(t, err)
	found := false
	for _, r := range page.Items {
		if r.ID == access.RoleAdministrator {
			found = true
			if r.NameEn != "Administrator" || r.NameAr == "" {
				t.Fatalf("got %+v, want English+Arabic names", r)
			}
		}
	}
	if !found {
		t.Fatal("administrator role missing from listRoles")
	}
}

func TestListRoles_ChangeApproverOnlyInPrivate(t *testing.T) {
	ResetUsersForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	shared := admin
	shared.InstallMode = access.InstallShared
	privatePage, err := ListRoles(admin, ListRolesQuery{})
	check(t, err)
	sharedPage, err := ListRoles(shared, ListRolesQuery{})
	check(t, err)
	if len(sharedPage.Items) >= len(privatePage.Items) {
		t.Fatalf("shared has %d roles, private has %d; want shared < private", len(sharedPage.Items), len(privatePage.Items))
	}
}

func TestCreateUser_DuplicateEmailAndZoneRules(t *testing.T) {
	ResetUsersForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	created, err := CreateUser(nil, nil, admin, map[string]any{
		"email": "reem@example.com", "display_name": "Reem", "assigned_role": "administrator", "zone_ids": []any{},
	})
	check(t, err)
	if created.Status != "invited" {
		t.Fatalf("status = %q, want invited", created.Status)
	}

	_, err = CreateUser(nil, nil, admin, map[string]any{
		"email": "REEM@example.com", "display_name": "Reem 2", "assigned_role": "administrator", "zone_ids": []any{},
	})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("dup email: got %v, want Conflict", err)
	}

	_, err = CreateUser(nil, nil, admin, map[string]any{
		"email": "planner@example.com", "display_name": "P", "assigned_role": "planner", "zone_ids": []any{},
	})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("zone-scoped role, no zones: got %v, want Invalid", err)
	}
}

func TestUpdateUser_LastAdminAndEmergencyAdminGuards(t *testing.T) {
	ResetUsersForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	only, err := CreateUser(nil, nil, admin, map[string]any{
		"email": "only@example.com", "display_name": "Only Admin", "assigned_role": "administrator", "zone_ids": []any{},
	})
	check(t, err)

	_, err = UpdateUser(nil, nil, admin, only.ID, map[string]any{"display_name": "Only Admin", "assigned_role": "viewer_auditor", "zone_ids": []any{}})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("last admin demoted: got %v, want Conflict", err)
	}

	_, err = CreateUser(nil, nil, admin, map[string]any{
		"email": "second@example.com", "display_name": "Second Admin", "assigned_role": "administrator", "zone_ids": []any{},
	})
	check(t, err)
	updated, err := UpdateUser(nil, nil, admin, only.ID, map[string]any{"display_name": "Only Admin", "assigned_role": "viewer_auditor", "zone_ids": []any{}})
	check(t, err)
	if updated.AssignedRole != access.RoleViewerAuditor {
		t.Fatalf("got role %s, want viewer_auditor", updated.AssignedRole)
	}
}

func TestDisableEnableUser_SelfAndLastAdminGuards(t *testing.T) {
	ResetUsersForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	only, err := CreateUser(nil, nil, admin, map[string]any{
		"email": "solo@example.com", "display_name": "Solo Admin", "assigned_role": "administrator", "zone_ids": []any{},
	})
	check(t, err)

	callerAsOnly := reqctx.RequestContext{CustomerID: "t1", UserID: only.ID, Role: access.RoleAdministrator, ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}, InstallMode: access.InstallPrivate}
	if _, err := DisableUser(callerAsOnly, only.ID); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("self-disable: got %v, want Conflict", err)
	}

	other := roleCtx("t1", "someone-else", access.RoleAdministrator)
	if _, err := DisableUser(other, only.ID); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("last admin disable: got %v, want Conflict", err)
	}

	second, err := CreateUser(nil, nil, admin, map[string]any{
		"email": "second2@example.com", "display_name": "Second", "assigned_role": "administrator", "zone_ids": []any{},
	})
	check(t, err)
	disabled, err := DisableUser(other, second.ID)
	check(t, err)
	if disabled.Status != "disabled" {
		t.Fatalf("status = %q, want disabled", disabled.Status)
	}
	enabled, err := EnableUser(other, second.ID)
	check(t, err)
	if enabled.Status != "invited" {
		t.Fatalf("re-enabled (never signed in) status = %q, want invited", enabled.Status)
	}
}

func TestListUserDisplayNames_DedupOrderAndBounds(t *testing.T) {
	ResetUsersForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	a, err := CreateUser(nil, nil, admin, map[string]any{"email": "a@example.com", "display_name": "A", "assigned_role": "administrator", "zone_ids": []any{}})
	check(t, err)
	b, err := CreateUser(nil, nil, admin, map[string]any{"email": "b@example.com", "display_name": "B", "assigned_role": "viewer_auditor", "zone_ids": []any{}})
	check(t, err)

	viewer := roleCtx("t1", "u2", access.RoleViewerAuditor)
	res, err := ListUserDisplayNames(viewer, []string{b.ID, "00000000-0000-4000-8000-000000000000", a.ID, b.ID})
	check(t, err)
	if len(res.Items) != 2 || res.Items[0].ID != b.ID || res.Items[1].ID != a.ID || res.Items[0].Role != access.RoleViewerAuditor || res.Items[1].Role != access.RoleAdministrator {
		t.Fatalf("got %+v, want [b, a] (order kept, dup dropped, unknown dropped)", res.Items)
	}

	if _, err := ListUserDisplayNames(viewer, nil); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("empty: got %v, want Invalid", err)
	}
	var tooMany []string
	for i := 0; i < 101; i++ {
		tooMany = append(tooMany, a.ID)
	}
	if _, err := ListUserDisplayNames(viewer, tooMany); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("101 ids: got %v, want Invalid", err)
	}
}

func TestEffectiveAccess_CanApproveReflectsApprovalKind(t *testing.T) {
	ResetUsersForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	preview, err := PreviewEffectiveAccess(admin, map[string]any{"assigned_role": "dispatch_supervisor", "install_mode": "private", "zone_ids": []any{}})
	check(t, err)
	sawApprove := false
	for _, m := range preview.Modules {
		if m.ModuleID == access.ModuleAdminClassificationRules && m.CanApprove {
			sawApprove = true
		}
	}
	if !sawApprove {
		t.Fatal("dispatch_supervisor should be able to approve admin.classification_rules")
	}
}

func TestEmergencyAdminReset_StubDisclosesItself(t *testing.T) {
	ResetUsersForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	ordinary, err := CreateUser(nil, nil, admin, map[string]any{
		"email": "ord@example.com", "display_name": "Ord", "assigned_role": "administrator", "zone_ids": []any{},
	})
	check(t, err)
	if _, err := ResetEmergencyAdminPassword(admin, ordinary.ID); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("non-emergency-admin: got %v, want Conflict", err)
	}
}
