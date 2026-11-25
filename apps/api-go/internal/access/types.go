// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors apps/web/src/lib/access.
package access

// Role is one of the seven the role matrix roles.
type Role string

const (
	RoleAdministrator      Role = "administrator"
	RoleDispatchSupervisor Role = "dispatch_supervisor"
	RoleDispatcher         Role = "dispatcher"
	RolePlanner            Role = "planner"
	RoleRemoteTeamLead     Role = "remote_team_lead"
	RoleViewerAuditor      Role = "viewer_auditor"
	RoleChangeApprover     Role = "change_approver"
)

// Roles lists every role, in the role matrix order.
var Roles = []Role{RoleAdministrator, RoleDispatchSupervisor, RoleDispatcher, RolePlanner, RoleRemoteTeamLead, RoleViewerAuditor, RoleChangeApprover}

// IsRole fails closed on unknown values.
func IsRole(value string) bool {
	for _, r := range Roles {
		if string(r) == value {
			return true
		}
	}
	return false
}

// Access is what a role may do in a module.
type Access string

const (
	AccessNone Access = "none"
	AccessView Access = "view"
	AccessEdit Access = "edit"
)

var accessRank = map[Access]int{AccessNone: 0, AccessView: 1, AccessEdit: 2}

// InstallMode is.
type InstallMode string

const (
	InstallPrivate   InstallMode = "private"
	InstallDedicated InstallMode = "dedicated"
	InstallShared    InstallMode = "shared"
)

var installModes = []InstallMode{InstallPrivate, InstallDedicated, InstallShared}

// IsInstallMode fails closed, like IsRole.
func IsInstallMode(value string) bool {
	for _, m := range installModes {
		if string(m) == value {
			return true
		}
	}
	return false
}

// ModuleID is "<console>.<slug>".
type ModuleID string

const (
	ModuleOpsForecastExplorer      ModuleID = "ops.forecast_explorer"
	ModuleOpsLiveDispatchBoard     ModuleID = "ops.live_dispatch_board"
	ModuleOpsRemoteQueue           ModuleID = "ops.remote_queue"
	ModuleOpsFieldPlanner          ModuleID = "ops.field_planner"
	ModuleOpsStandbyCoverage       ModuleID = "ops.standby_coverage"
	ModuleOpsGapSurplus            ModuleID = "ops.gap_surplus"
	ModuleOpsServiceLevelSimulator ModuleID = "ops.service_level_simulator"
	ModuleOpsScenarioLab           ModuleID = "ops.scenario_lab"
	ModuleOpsLeavePlanner          ModuleID = "ops.leave_planner"
	ModuleOpsBreakPlanner          ModuleID = "ops.break_planner"
	ModuleOpsManagementDashboards  ModuleID = "ops.management_dashboards"
	ModuleOpsProductivityMetrics   ModuleID = "ops.productivity_metrics"

	ModuleAdminUsersRoles          ModuleID = "admin.users_roles"
	ModuleAdminSignInIdentity      ModuleID = "admin.sign_in_identity"
	ModuleAdminLocations           ModuleID = "admin.locations"
	ModuleAdminAgentsVehicles      ModuleID = "admin.agents_vehicles"
	ModuleAdminClassificationRules ModuleID = "admin.classification_rules"
	ModuleAdminShiftBreakPolicies  ModuleID = "admin.shift_break_policies"
	ModuleAdminLeavePolicyCalendar ModuleID = "admin.leave_policy_calendar"
	ModuleAdminForecastModel       ModuleID = "admin.forecast_model"
	ModuleAdminDataSources         ModuleID = "admin.data_sources"
	ModuleAdminDataImportQuality   ModuleID = "admin.data_import_quality"
	ModuleAdminAuditLog            ModuleID = "admin.audit_log"
	ModuleAdminNotificationsAlerts ModuleID = "admin.notifications_alerts"
	ModuleAdminAPIWebhooks         ModuleID = "admin.api_webhooks"
	ModuleAdminSecurityCompliance  ModuleID = "admin.security_compliance"
	ModuleAdminSystemHealth        ModuleID = "admin.system_health"
	ModuleAdminUpdates             ModuleID = "admin.updates"
	ModuleAdminLocalization        ModuleID = "admin.localization"
	ModuleAdminAIAssistant         ModuleID = "admin.ai_assistant"
)

// ModuleIDs: every module id, Ops first, plan order.
var ModuleIDs = []ModuleID{
	ModuleOpsForecastExplorer, ModuleOpsLiveDispatchBoard, ModuleOpsRemoteQueue, ModuleOpsFieldPlanner,
	ModuleOpsStandbyCoverage, ModuleOpsGapSurplus, ModuleOpsServiceLevelSimulator, ModuleOpsScenarioLab,
	ModuleOpsLeavePlanner, ModuleOpsBreakPlanner, ModuleOpsManagementDashboards, ModuleOpsProductivityMetrics,
	ModuleAdminUsersRoles, ModuleAdminSignInIdentity, ModuleAdminLocations, ModuleAdminAgentsVehicles,
	ModuleAdminClassificationRules, ModuleAdminShiftBreakPolicies, ModuleAdminLeavePolicyCalendar,
	ModuleAdminForecastModel, ModuleAdminDataSources, ModuleAdminDataImportQuality, ModuleAdminAuditLog,
	ModuleAdminNotificationsAlerts, ModuleAdminAPIWebhooks, ModuleAdminSecurityCompliance,
	ModuleAdminSystemHealth, ModuleAdminUpdates, ModuleAdminLocalization,
	ModuleAdminAIAssistant,
}

// IsModuleID fails closed, like IsRole.
func IsModuleID(value string) bool {
	for _, m := range ModuleIDs {
		if string(m) == value {
			return true
		}
	}
	return false
}

// ScopeKind: how far a role reaches.
type ScopeKind string

const (
	ScopeWholeInstall  ScopeKind = "whole_install"
	ScopeAssignedZones ScopeKind = "assigned_zones"
	ScopeRemotePool    ScopeKind = "remote_pool"
)

// ZoneScope is one person's scope; ZoneIDs only set
// when Kind is ScopeAssignedZones.
type ZoneScope struct {
	Kind    ScopeKind
	ZoneIDs []string
}

// ModuleAccessResult is ModuleAccess's result.
type ModuleAccessResult struct {
	Access Access
	// Reduced: Updates, Admin, dedicated/shared only.
	Reduced bool
}

// ApprovalKind: what is being approved.
type ApprovalKind string

const (
	ApprovalRule           ApprovalKind = "rule"
	ApprovalRosterOverride ApprovalKind = "roster_override"
	ApprovalLeave          ApprovalKind = "leave"
	ApprovalUpdate         ApprovalKind = "update"
)

// ApprovalKinds lists every kind.
var ApprovalKinds = []ApprovalKind{ApprovalRule, ApprovalRosterOverride, ApprovalLeave, ApprovalUpdate}

// IsApprovalKind fails closed, like IsRole.
func IsApprovalKind(value string) bool {
	for _, k := range ApprovalKinds {
		if string(k) == value {
			return true
		}
	}
	return false
}

// ApprovalRequest: input to CheckApproval.
type ApprovalRequest struct {
	Role            Role
	RequesterUserID string
	ApproverUserID  string
	Kind            ApprovalKind
	// InstallMode: "" means not checked (caller unsure).
	InstallMode    InstallMode
	HasInstallMode bool
}

// ApprovalDenial: why CheckApproval refused.
type ApprovalDenial string

const (
	DenialInvalidInput          ApprovalDenial = "invalid_input"
	DenialRoleNotInInstallMode  ApprovalDenial = "role_not_in_install_mode"
	DenialRoleCannotApproveKind ApprovalDenial = "role_cannot_approve_kind"
	DenialOwnRequest            ApprovalDenial = "own_request"
)

// ApprovalDecision is CheckApproval's result.
type ApprovalDecision struct {
	Allowed bool
	// Reason: only set when Allowed is false.
	Reason ApprovalDenial
}
