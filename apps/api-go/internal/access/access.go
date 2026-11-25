// SPDX-License-Identifier: AGPL-3.0-only

package access

// Fails closed on unknown values.
// Ported: ModuleAccess, ZoneAllowed, ScopeAppliesTo,
// ZoneScopeFor. Not ported: menus, approval flow.

func roleExistsIn(role Role, installMode InstallMode) bool {
	if !IsRole(string(role)) || !IsInstallMode(string(installMode)) {
		return false
	}
	for _, m := range RoleInstallModes[role] {
		if m == installMode {
			return true
		}
	}
	return false
}

// RolesForInstallMode mirrors rolesForInstallMode.
func RolesForInstallMode(installMode InstallMode) []Role {
	var out []Role
	for _, r := range Roles {
		if roleExistsIn(r, installMode) {
			out = append(out, r)
		}
	}
	return out
}

// ModuleAccess mirrors moduleAccess.
func ModuleAccess(role Role, moduleID ModuleID, installMode InstallMode) ModuleAccessResult {
	if !IsModuleID(string(moduleID)) || !roleExistsIn(role, installMode) {
		return ModuleAccessResult{Access: AccessNone, Reduced: false}
	}
	for _, rule := range InstallModeRules {
		if rule.ModuleID != moduleID || rule.Role != role {
			continue
		}
		for _, mode := range rule.Modes {
			if mode == installMode {
				return rule.Result
			}
		}
	}
	return ModuleAccessResult{Access: RoleModuleAccess[moduleID][role], Reduced: false}
}

// CanAccess mirrors canAccess.
func CanAccess(role Role, moduleID ModuleID, installMode InstallMode, needed Access) bool {
	return accessRank[ModuleAccess(role, moduleID, installMode).Access] >= accessRank[needed]
}

// ScopeAppliesTo mirrors scopeAppliesTo.
func ScopeAppliesTo(role Role) ScopeKind {
	return ScopeByRole[role]
}

// ZoneScopeFor mirrors zoneScopeFor.
func ZoneScopeFor(role Role, assignedZoneIDs []string) ZoneScope {
	kind := ScopeAssignedZones
	if IsRole(string(role)) {
		kind = ScopeAppliesTo(role)
	}
	switch kind {
	case ScopeWholeInstall:
		return ZoneScope{Kind: ScopeWholeInstall}
	case ScopeRemotePool:
		return ZoneScope{Kind: ScopeRemotePool}
	default:
		ids := make([]string, len(assignedZoneIDs))
		copy(ids, assignedZoneIDs)
		return ZoneScope{Kind: ScopeAssignedZones, ZoneIDs: ids}
	}
}

// CheckApproval mirrors checkApproval.
func CheckApproval(req ApprovalRequest) ApprovalDecision {
	if !IsRole(string(req.Role)) || !IsApprovalKind(string(req.Kind)) {
		return ApprovalDecision{Allowed: false, Reason: DenialInvalidInput}
	}
	if req.HasInstallMode {
		if !IsInstallMode(string(req.InstallMode)) {
			return ApprovalDecision{Allowed: false, Reason: DenialInvalidInput}
		}
		if !roleExistsIn(req.Role, req.InstallMode) {
			return ApprovalDecision{Allowed: false, Reason: DenialRoleNotInInstallMode}
		}
	}
	approvers := ApproverRoles[req.Kind]
	allowed := false
	for _, r := range approvers {
		if r == req.Role {
			allowed = true
			break
		}
	}
	if !allowed {
		return ApprovalDecision{Allowed: false, Reason: DenialRoleCannotApproveKind}
	}
	if req.RequesterUserID == "" || req.ApproverUserID == "" {
		return ApprovalDecision{Allowed: false, Reason: DenialInvalidInput}
	}
	if req.RequesterUserID == req.ApproverUserID {
		return ApprovalDecision{Allowed: false, Reason: DenialOwnRequest}
	}
	return ApprovalDecision{Allowed: true}
}

// CanApprove: true when CheckApproval allows it.
func CanApprove(req ApprovalRequest) bool {
	return CheckApproval(req).Allowed
}

// ApprovalKindsFor mirrors approvalKindsFor.
func ApprovalKindsFor(role Role, installMode InstallMode) []ApprovalKind {
	if !roleExistsIn(role, installMode) {
		return nil
	}
	var out []ApprovalKind
	for _, kind := range ApprovalKinds {
		for _, r := range ApproverRoles[kind] {
			if r == role {
				out = append(out, kind)
				break
			}
		}
	}
	return out
}

// ZoneAllowed mirrors zoneAllowed.
func ZoneAllowed(scope ZoneScope, zoneID string) bool {
	switch scope.Kind {
	case ScopeWholeInstall:
		return true
	case ScopeAssignedZones:
		for _, id := range scope.ZoneIDs {
			if id == zoneID {
				return true
			}
		}
		return false
	default: // ScopeRemotePool
		return false
	}
}
