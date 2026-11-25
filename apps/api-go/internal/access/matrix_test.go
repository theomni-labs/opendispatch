// SPDX-License-Identifier: AGPL-3.0-only

package access

import (
	"sort"
	"testing"
)

// Literal tables, typed independently of the impl.

var opsIDByNumber = []ModuleID{
	ModuleOpsForecastExplorer, ModuleOpsLiveDispatchBoard, ModuleOpsRemoteQueue, ModuleOpsFieldPlanner,
	ModuleOpsStandbyCoverage, ModuleOpsGapSurplus, ModuleOpsServiceLevelSimulator, ModuleOpsScenarioLab,
	ModuleOpsLeavePlanner, ModuleOpsBreakPlanner, ModuleOpsManagementDashboards, ModuleOpsProductivityMetrics,
}

var adminIDByNumber = []ModuleID{
	ModuleAdminUsersRoles, ModuleAdminSignInIdentity, ModuleAdminLocations, ModuleAdminAgentsVehicles,
	ModuleAdminClassificationRules, ModuleAdminShiftBreakPolicies, ModuleAdminLeavePolicyCalendar,
	ModuleAdminForecastModel, ModuleAdminDataSources, ModuleAdminDataImportQuality, ModuleAdminAuditLog,
	ModuleAdminNotificationsAlerts, ModuleAdminAPIWebhooks, ModuleAdminSecurityCompliance,
	ModuleAdminSystemHealth, ModuleAdminUpdates, ModuleAdminLocalization,
	ModuleAdminAIAssistant,
}

type cells struct {
	edit []int
	view []int
}

// Ops column; approve-or-reject counts as "view".
var expectedOps = map[Role]cells{
	RoleAdministrator:      {edit: nil, view: []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}},
	RoleDispatchSupervisor: {edit: []int{2, 4}, view: []int{1, 3, 5, 6, 7, 8, 9, 10, 11, 12}},
	RoleDispatcher:         {edit: []int{2}, view: []int{1, 5}},
	RolePlanner:            {edit: []int{4, 5, 6, 7, 8, 9, 10, 11}, view: []int{1, 2, 3, 12}},
	RoleRemoteTeamLead:     {edit: []int{3}, view: []int{1, 6, 11}},
	RoleViewerAuditor:      {edit: nil, view: []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}},
	RoleChangeApprover:     {edit: nil, view: nil},
}

// Admin column, the role matrix, private install.
var expectedAdminPrivate = map[Role]cells{
	RoleAdministrator:      {edit: []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18}, view: []int{11}},
	RoleDispatchSupervisor: {edit: nil, view: []int{5}},
	RoleDispatcher:         {edit: nil, view: nil},
	RolePlanner:            {edit: nil, view: nil},
	RoleRemoteTeamLead:     {edit: nil, view: nil},
	RoleViewerAuditor:      {edit: nil, view: []int{11, 18}},
	RoleChangeApprover:     {edit: nil, view: []int{11, 16}},
}

func contains(xs []int, n int) bool {
	for _, x := range xs {
		if x == n {
			return true
		}
	}
	return false
}

func levelFor(c cells, n int) Access {
	if contains(c.edit, n) {
		return AccessEdit
	}
	if contains(c.view, n) {
		return AccessView
	}
	return AccessNone
}

// expectedPrivate: expected access, private install.
func expectedPrivate(role Role) map[ModuleID]Access {
	out := map[ModuleID]Access{}
	for i, id := range opsIDByNumber {
		out[id] = levelFor(expectedOps[role], i+1)
	}
	for i, id := range adminIDByNumber {
		out[id] = levelFor(expectedAdminPrivate[role], i+1)
	}
	return out
}

func TestMatrixLiteralTablesCoverAll30Modules(t *testing.T) {
	if len(opsIDByNumber) != 12 {
		t.Fatalf("ops table: got %d, want 12", len(opsIDByNumber))
	}
	if len(adminIDByNumber) != 18 {
		t.Fatalf("admin table: got %d, want 18", len(adminIDByNumber))
	}
	seen := map[ModuleID]bool{}
	for _, id := range opsIDByNumber {
		seen[id] = true
	}
	for _, id := range adminIDByNumber {
		seen[id] = true
	}
	if len(seen) != len(ModuleIDs) {
		t.Fatalf("literal tables cover %d modules, ModuleIDs has %d", len(seen), len(ModuleIDs))
	}
	for _, id := range ModuleIDs {
		if !seen[id] {
			t.Errorf("literal tables missing module %s", id)
		}
	}
}

func TestModuleAccessMatchesAppendixC(t *testing.T) {
	for _, role := range Roles {
		for id, expected := range expectedPrivate(role) {
			got := ModuleAccess(role, id, InstallPrivate)
			if got.Access != expected || got.Reduced {
				t.Errorf("%s / %s: got {%s reduced=%v}, want {%s reduced=false}", role, id, got.Access, got.Reduced, expected)
			}
		}
	}
}

func TestAdministratorOpsViewOnlySeventeenAdminEdit(t *testing.T) {
	for _, id := range opsIDByNumber {
		if got := ModuleAccess(RoleAdministrator, id, InstallPrivate).Access; got != AccessView {
			t.Errorf("administrator / %s: got %s, want view", id, got)
		}
	}
	editCount, noneCount := 0, 0
	for _, id := range adminIDByNumber {
		switch ModuleAccess(RoleAdministrator, id, InstallPrivate).Access {
		case AccessEdit:
			editCount++
		case AccessNone:
			noneCount++
		}
	}
	if noneCount != 0 {
		t.Errorf("administrator has %d admin modules with none access, want 0", noneCount)
	}
	if editCount != 17 {
		t.Errorf("administrator has %d edit admin modules, want 17", editCount)
	}
}

func TestDispatchSupervisorEditsExactlyLiveDispatchAndFieldPlanner(t *testing.T) {
	var edits []ModuleID
	for _, id := range opsIDByNumber {
		if ModuleAccess(RoleDispatchSupervisor, id, InstallPrivate).Access == AccessEdit {
			edits = append(edits, id)
		}
	}
	want := []ModuleID{ModuleOpsLiveDispatchBoard, ModuleOpsFieldPlanner}
	if len(edits) != len(want) || edits[0] != want[0] || edits[1] != want[1] {
		t.Errorf("dispatch_supervisor edits %v, want %v", edits, want)
	}
}

func TestViewerAuditorNeverEdits(t *testing.T) {
	for _, id := range ModuleIDs {
		if got := ModuleAccess(RoleViewerAuditor, id, InstallPrivate).Access; got == AccessEdit {
			t.Errorf("viewer_auditor / %s: got edit, want not edit", id)
		}
	}
}

func TestOnlyFiveRolesCanEditAnything(t *testing.T) {
	var editors []Role
	for _, role := range Roles {
		for _, id := range ModuleIDs {
			if ModuleAccess(role, id, InstallPrivate).Access == AccessEdit {
				editors = append(editors, role)
				break
			}
		}
	}
	want := []Role{RoleAdministrator, RoleDispatchSupervisor, RoleDispatcher, RolePlanner, RoleRemoteTeamLead}
	if len(editors) != len(want) {
		t.Fatalf("editors %v, want %v", editors, want)
	}
	for i := range want {
		if editors[i] != want[i] {
			t.Errorf("editors %v, want %v", editors, want)
		}
	}
}

func TestStoredMatrixHasAllSevenRolesPerModule(t *testing.T) {
	wantRoles := append([]Role{}, Roles...)
	sort.Slice(wantRoles, func(i, j int) bool { return wantRoles[i] < wantRoles[j] })
	for _, id := range ModuleIDs {
		var gotRoles []Role
		for r := range RoleModuleAccess[id] {
			gotRoles = append(gotRoles, r)
		}
		sort.Slice(gotRoles, func(i, j int) bool { return gotRoles[i] < gotRoles[j] })
		if len(gotRoles) != len(wantRoles) {
			t.Errorf("%s: got %d roles, want %d", id, len(gotRoles), len(wantRoles))
			continue
		}
		for i := range wantRoles {
			if gotRoles[i] != wantRoles[i] {
				t.Errorf("%s: roles %v, want %v", id, gotRoles, wantRoles)
				break
			}
		}
	}
}

func TestDedicatedSharedMatchAppendixCExceptTwoAdministratorDifferences(t *testing.T) {
	sixRoles := []Role{RoleAdministrator, RoleDispatchSupervisor, RoleDispatcher, RolePlanner, RoleRemoteTeamLead, RoleViewerAuditor}
	for _, mode := range []InstallMode{InstallDedicated, InstallShared} {
		for _, role := range sixRoles {
			for id, expected := range expectedPrivate(role) {
				want := ModuleAccessResult{Access: expected, Reduced: false}
				if role == RoleAdministrator && id == ModuleAdminUpdates {
					want = ModuleAccessResult{Access: AccessView, Reduced: true}
				}
				if role == RoleAdministrator && id == ModuleAdminSignInIdentity && mode == InstallShared {
					want = ModuleAccessResult{Access: AccessView, Reduced: false}
				}
				got := ModuleAccess(role, id, mode)
				if got != want {
					t.Errorf("%s / %s / %s: got %+v, want %+v", role, id, mode, got, want)
				}
			}
		}
	}
}

func TestChangeApproverNoAccessOutsidePrivate(t *testing.T) {
	for _, mode := range []InstallMode{InstallDedicated, InstallShared} {
		for _, id := range ModuleIDs {
			want := ModuleAccessResult{Access: AccessNone, Reduced: false}
			if got := ModuleAccess(RoleChangeApprover, id, mode); got != want {
				t.Errorf("change_approver / %s / %s: got %+v, want %+v", id, mode, got, want)
			}
		}
	}
}
