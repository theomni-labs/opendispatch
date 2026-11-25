// SPDX-License-Identifier: AGPL-3.0-only

package access

import "testing"

func TestCheckApproval_DispatchSupervisorApprovesRule(t *testing.T) {
	got := CheckApproval(ApprovalRequest{Role: RoleDispatchSupervisor, RequesterUserID: "u1", ApproverUserID: "u2", Kind: ApprovalRule})
	if !got.Allowed {
		t.Fatalf("got %+v, want allowed", got)
	}
}

func TestCheckApproval_WrongRoleCannotApproveKind(t *testing.T) {
	got := CheckApproval(ApprovalRequest{Role: RolePlanner, RequesterUserID: "u1", ApproverUserID: "u2", Kind: ApprovalRule})
	if got.Allowed || got.Reason != DenialRoleCannotApproveKind {
		t.Fatalf("got %+v, want role_cannot_approve_kind", got)
	}
}

func TestCheckApproval_NobodyApprovesOwnRequest(t *testing.T) {
	got := CheckApproval(ApprovalRequest{Role: RoleDispatchSupervisor, RequesterUserID: "u1", ApproverUserID: "u1", Kind: ApprovalRule})
	if got.Allowed || got.Reason != DenialOwnRequest {
		t.Fatalf("got %+v, want own_request", got)
	}
}

func TestCheckApproval_ChangeApproverOnlyInPrivate(t *testing.T) {
	got := CheckApproval(ApprovalRequest{Role: RoleChangeApprover, RequesterUserID: "u1", ApproverUserID: "u2", Kind: ApprovalUpdate, InstallMode: InstallShared, HasInstallMode: true})
	if got.Allowed || got.Reason != DenialRoleNotInInstallMode {
		t.Fatalf("got %+v, want role_not_in_install_mode", got)
	}
	got = CheckApproval(ApprovalRequest{Role: RoleChangeApprover, RequesterUserID: "u1", ApproverUserID: "u2", Kind: ApprovalUpdate, InstallMode: InstallPrivate, HasInstallMode: true})
	if !got.Allowed {
		t.Fatalf("got %+v, want allowed", got)
	}
}

func TestCheckApproval_UnknownRoleOrKindFailsClosed(t *testing.T) {
	got := CheckApproval(ApprovalRequest{Role: "nope", RequesterUserID: "u1", ApproverUserID: "u2", Kind: ApprovalRule})
	if got.Allowed || got.Reason != DenialInvalidInput {
		t.Fatalf("got %+v, want invalid_input", got)
	}
	got = CheckApproval(ApprovalRequest{Role: RoleDispatchSupervisor, RequesterUserID: "u1", ApproverUserID: "u2", Kind: "nope"})
	if got.Allowed || got.Reason != DenialInvalidInput {
		t.Fatalf("got %+v, want invalid_input", got)
	}
}

func TestCanApprove_MatchesCheckApproval(t *testing.T) {
	req := ApprovalRequest{Role: RolePlanner, RequesterUserID: "u1", ApproverUserID: "u2", Kind: ApprovalLeave}
	if !CanApprove(req) {
		t.Fatalf("want true for planner approving leave")
	}
}
