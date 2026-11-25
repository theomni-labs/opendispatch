// SPDX-License-Identifier: AGPL-3.0-only

package access

// RoleModuleAccess mirrors ROLE_MODULE_ACCESS.
// Private-install matrix; use ModuleAccess instead.
var RoleModuleAccess = map[ModuleID]map[Role]Access{
	ModuleOpsForecastExplorer:      {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessView, RoleDispatcher: AccessView, RolePlanner: AccessView, RoleRemoteTeamLead: AccessView, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},
	ModuleOpsLiveDispatchBoard:     {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessEdit, RoleDispatcher: AccessEdit, RolePlanner: AccessView, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},
	ModuleOpsRemoteQueue:           {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessView, RoleDispatcher: AccessNone, RolePlanner: AccessView, RoleRemoteTeamLead: AccessEdit, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},
	ModuleOpsFieldPlanner:          {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessEdit, RoleDispatcher: AccessNone, RolePlanner: AccessEdit, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},
	ModuleOpsStandbyCoverage:       {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessView, RoleDispatcher: AccessView, RolePlanner: AccessEdit, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},
	ModuleOpsGapSurplus:            {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessView, RoleDispatcher: AccessNone, RolePlanner: AccessEdit, RoleRemoteTeamLead: AccessView, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},
	ModuleOpsServiceLevelSimulator: {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessView, RoleDispatcher: AccessNone, RolePlanner: AccessEdit, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},
	ModuleOpsScenarioLab:           {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessView, RoleDispatcher: AccessNone, RolePlanner: AccessEdit, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},
	ModuleOpsLeavePlanner:          {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessView, RoleDispatcher: AccessNone, RolePlanner: AccessEdit, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},
	ModuleOpsBreakPlanner:          {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessView, RoleDispatcher: AccessNone, RolePlanner: AccessEdit, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},
	ModuleOpsManagementDashboards:  {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessView, RoleDispatcher: AccessNone, RolePlanner: AccessEdit, RoleRemoteTeamLead: AccessView, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},
	ModuleOpsProductivityMetrics:   {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessView, RoleDispatcher: AccessNone, RolePlanner: AccessView, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},

	ModuleAdminUsersRoles:          {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminSignInIdentity:      {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminLocations:           {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminAgentsVehicles:      {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminClassificationRules: {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessView, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminShiftBreakPolicies:  {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminLeavePolicyCalendar: {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminForecastModel:       {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminDataSources:         {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminDataImportQuality:   {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminAuditLog:            {RoleAdministrator: AccessView, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessView},
	ModuleAdminNotificationsAlerts: {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminAPIWebhooks:         {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminSecurityCompliance:  {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminSystemHealth:        {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminUpdates:             {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessView},
	ModuleAdminLocalization:        {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessNone, RoleChangeApprover: AccessNone},
	ModuleAdminAIAssistant:         {RoleAdministrator: AccessEdit, RoleDispatchSupervisor: AccessNone, RoleDispatcher: AccessNone, RolePlanner: AccessNone, RoleRemoteTeamLead: AccessNone, RoleViewerAuditor: AccessView, RoleChangeApprover: AccessNone},
}

// InstallModeRule overrides a RoleModuleAccess cell.
type InstallModeRule struct {
	ModuleID ModuleID
	Role     Role
	Modes    []InstallMode
	Result   ModuleAccessResult
}

// InstallModeRules mirrors INSTALL_MODE_RULES.
var InstallModeRules = []InstallModeRule{
	{ModuleID: ModuleAdminUpdates, Role: RoleAdministrator, Modes: []InstallMode{InstallDedicated, InstallShared}, Result: ModuleAccessResult{Access: AccessView, Reduced: true}},
	{ModuleID: ModuleAdminSignInIdentity, Role: RoleAdministrator, Modes: []InstallMode{InstallShared}, Result: ModuleAccessResult{Access: AccessView, Reduced: false}},
}

// RoleInstallModes mirrors ROLE_INSTALL_MODES.
var RoleInstallModes = map[Role][]InstallMode{
	RoleAdministrator:      {InstallPrivate, InstallDedicated, InstallShared},
	RoleDispatchSupervisor: {InstallPrivate, InstallDedicated, InstallShared},
	RoleDispatcher:         {InstallPrivate, InstallDedicated, InstallShared},
	RolePlanner:            {InstallPrivate, InstallDedicated, InstallShared},
	RoleRemoteTeamLead:     {InstallPrivate, InstallDedicated, InstallShared},
	RoleViewerAuditor:      {InstallPrivate, InstallDedicated, InstallShared},
	RoleChangeApprover:     {InstallPrivate},
}

// ScopeByRole mirrors matrix.ts's SCOPE_BY_ROLE.
var ScopeByRole = map[Role]ScopeKind{
	RoleAdministrator:      ScopeWholeInstall,
	RoleDispatchSupervisor: ScopeAssignedZones,
	RoleDispatcher:         ScopeAssignedZones,
	RolePlanner:            ScopeAssignedZones,
	RoleRemoteTeamLead:     ScopeRemotePool,
	RoleViewerAuditor:      ScopeWholeInstall,
	RoleChangeApprover:     ScopeWholeInstall,
}

// ApproverRoles mirrors matrix.ts's APPROVER_ROLES.
var ApproverRoles = map[ApprovalKind][]Role{
	ApprovalRule:           {RoleDispatchSupervisor},
	ApprovalRosterOverride: {RoleDispatchSupervisor},
	ApprovalLeave:          {RolePlanner},
	ApprovalUpdate:         {RoleChangeApprover},
}

// ApprovalModule mirrors APPROVAL_MODULE.
var ApprovalModule = map[ApprovalKind]ModuleID{
	ApprovalRule:           ModuleAdminClassificationRules,
	ApprovalRosterOverride: ModuleOpsFieldPlanner,
	ApprovalLeave:          ModuleOpsLeavePlanner,
	ApprovalUpdate:         ModuleAdminUpdates,
}
