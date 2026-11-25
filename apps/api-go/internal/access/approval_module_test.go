// SPDX-License-Identifier: AGPL-3.0-only

package access

import "testing"

func TestApprovalKindsFor_DispatchSupervisorApprovesRuleAndOverride(t *testing.T) {
	got := ApprovalKindsFor(RoleDispatchSupervisor, InstallPrivate)
	want := []ApprovalKind{ApprovalRule, ApprovalRosterOverride}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestApprovalKindsFor_ChangeApproverEmptyOutsidePrivate(t *testing.T) {
	got := ApprovalKindsFor(RoleChangeApprover, InstallShared)
	if len(got) != 0 {
		t.Fatalf("got %v, want empty", got)
	}
	got = ApprovalKindsFor(RoleChangeApprover, InstallPrivate)
	if len(got) != 1 || got[0] != ApprovalUpdate {
		t.Fatalf("got %v, want [update]", got)
	}
}

func TestApprovalModule_MapsEachKindToItsModule(t *testing.T) {
	want := map[ApprovalKind]ModuleID{
		ApprovalRule:           ModuleAdminClassificationRules,
		ApprovalRosterOverride: ModuleOpsFieldPlanner,
		ApprovalLeave:          ModuleOpsLeavePlanner,
		ApprovalUpdate:         ModuleAdminUpdates,
	}
	for kind, module := range want {
		if got := ApprovalModule[kind]; got != module {
			t.Errorf("%s: got %s, want %s", kind, got, module)
		}
	}
}
