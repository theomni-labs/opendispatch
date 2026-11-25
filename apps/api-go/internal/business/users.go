// SPDX-License-Identifier: AGPL-3.0-only

// Ports users.ts (admin.users_roles, flow 6).
// Not Postgres in TS either (readAll/upsert from
// ./internal/store): in-memory here too, matching
// rules.go/localization.go/api_webhooks.go.
package business

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const moduleUsersRoles = access.ModuleAdminUsersRoles

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// UserStatuses: the allowed status values of a user.
var UserStatuses = []string{"invited", "active", "disabled"}

type roleName struct{ En, Ar string }

// roleNames mirrors ROLE_NAMES (English and Arabic).
var roleNames = map[access.Role]roleName{
	access.RoleAdministrator:      {"Administrator", "مسؤول النظام"},
	access.RoleDispatchSupervisor: {"Dispatch Supervisor", "مشرف الإرسال"},
	access.RoleDispatcher:         {"Dispatcher", "موزّع البلاغات"},
	access.RolePlanner:            {"Planner", "مخطِّط"},
	access.RoleRemoteTeamLead:     {"Remote Team Lead", "قائد فريق المراجعة عن بُعد"},
	access.RoleViewerAuditor:      {"Viewer / Auditor", "مطّلع / مدقق"},
	access.RoleChangeApprover:     {"Change Approver", "معتمد التغييرات"},
}

// RoleInfo mirrors the contract's Role.
type RoleInfo struct {
	ID          access.Role          `json:"id"`
	NameEn      string               `json:"name_en"`
	NameAr      string               `json:"name_ar"`
	Scope       access.ScopeKind     `json:"scope"`
	AvailableIn []access.InstallMode `json:"available_in"`
}

// User mirrors the contract's User.
type User struct {
	datactx.BaseRecord
	KeycloakSubject  *string     `json:"keycloak_subject"`
	Email            string      `json:"email"`
	DisplayName      string      `json:"display_name"`
	AssignedRole     access.Role `json:"assigned_role"`
	ZoneIDs          []string    `json:"zone_ids"`
	Status           string      `json:"status"`
	IsEmergencyAdmin bool        `json:"is_emergency_admin"`
	LastSignInAt     *string     `json:"last_sign_in_at"`
	PreferredLocale  string      `json:"preferred_locale"`
}

// UserDisplayName: one entry of UserDisplayNames.
type UserDisplayName struct {
	ID          string      `json:"id"`
	DisplayName string      `json:"display_name"`
	Role        access.Role `json:"role"`
}

// ModuleAccessEntry: one EffectiveAccess module row.
type ModuleAccessEntry struct {
	ModuleID   access.ModuleID `json:"module_id"`
	Access     access.Access   `json:"access"`
	CanApprove bool            `json:"can_approve"`
}

// EffectiveAccess mirrors the contract type.
type EffectiveAccess struct {
	UserID       string              `json:"user_id"`
	AssignedRole access.Role         `json:"assigned_role"`
	Scope        access.ScopeKind    `json:"scope"`
	ZoneIDs      []string            `json:"zone_ids"`
	Modules      []ModuleAccessEntry `json:"modules"`
}

// AccessPreview mirrors the contract type.
type AccessPreview struct {
	AssignedRole access.Role         `json:"assigned_role"`
	InstallMode  access.InstallMode  `json:"install_mode"`
	Scope        access.ScopeKind    `json:"scope"`
	ZoneIDs      []string            `json:"zone_ids"`
	Modules      []ModuleAccessEntry `json:"modules"`
}

// EmergencyAdminResetResult: the contract type.
type EmergencyAdminResetResult struct {
	ResetAt             string `json:"reset_at"`
	ResetKind           string `json:"reset_kind"`
	TemporarySecretHint string `json:"temporary_secret_hint"`
}

var (
	usersMu    sync.Mutex
	usersStore []User
)

// ResetUsersForTest clears the in-memory store.
func ResetUsersForTest() {
	usersMu.Lock()
	usersStore = nil
	usersMu.Unlock()
}

// SeedUsersFromFixtures: no-op once already seeded.
func SeedUsersFromFixtures() error {
	if _, inPostgres := userBackend.(pgUsers); inPostgres {
		return nil
	}
	usersMu.Lock()
	seeded := len(usersStore) > 0
	usersMu.Unlock()
	if seeded {
		return nil
	}
	rows, err := fixtures.Records[User]("User")
	if err != nil {
		return err
	}
	usersMu.Lock()
	if len(usersStore) == 0 {
		usersStore = rows
	}
	usersMu.Unlock()
	return nil
}

// ListRolesQuery mirrors listRoles' query.
type ListRolesQuery struct {
	Limit  int
	Cursor string
}

// ListRoles mirrors listRoles.
func ListRoles(ctx reqctx.RequestContext, query ListRolesQuery) (datactx.PageResult[RoleInfo], error) {
	if err := reqctx.RequireAccess(ctx, moduleUsersRoles, access.AccessView); err != nil {
		return datactx.PageResult[RoleInfo]{}, err
	}
	var rows []RoleInfo
	for _, id := range access.RolesForInstallMode(ctx.InstallMode) {
		rows = append(rows, RoleInfo{
			ID: id, NameEn: roleNames[id].En, NameAr: roleNames[id].Ar,
			Scope: access.ScopeAppliesTo(id), AvailableIn: access.RoleInstallModes[id],
		})
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// ListUsersQuery mirrors listUsers' query.
type ListUsersQuery struct {
	Limit        int
	Cursor       string
	Q            string
	Status       string      // "" = unset
	AssignedRole access.Role // "" = unset
}

// ListUsers mirrors listUsers.
func ListUsers(ctx reqctx.RequestContext, query ListUsersQuery) (datactx.PageResult[User], error) {
	if err := reqctx.RequireAccess(ctx, moduleUsersRoles, access.AccessView); err != nil {
		return datactx.PageResult[User]{}, err
	}
	var rows []User
	userRows, err := allUsers(context.Background(), ctx.CustomerID)
	if err != nil {
		return datactx.PageResult[User]{}, err
	}
	for _, u := range userRows {
		if query.Status != "" && u.Status != query.Status {
			continue
		}
		if query.AssignedRole != "" && u.AssignedRole != query.AssignedRole {
			continue
		}
		if !datactx.MatchesText(u.DisplayName+" "+u.Email, query.Q) {
			continue
		}
		rows = append(rows, u)
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// GetUser mirrors getUser.
func GetUser(ctx reqctx.RequestContext, id string) (User, error) {
	if err := reqctx.RequireAccess(ctx, moduleUsersRoles, access.AccessView); err != nil {
		return User{}, err
	}
	if _, err := importutil.RequireID(id, "User"); err != nil {
		return User{}, err
	}
	u, err := oneUser(context.Background(), ctx.CustomerID, id)
	if err != nil {
		return User{}, err
	}
	if u != nil {
		return *u, nil
	}
	return User{}, dataerr.NotFound("User not found.")
}

// maxDisplayNameIDs: most ids per call (DG1).
const maxDisplayNameIDs = 100

// UserDisplayNamesResult mirrors UserDisplayNames.
type UserDisplayNamesResult struct {
	Items []UserDisplayName `json:"items"`
}

// ListUserDisplayNames mirrors listUserDisplayNames.
// Gated by platform.session, not admin.users_roles:
// any reader may resolve a name they can see.
func ListUserDisplayNames(ctx reqctx.RequestContext, ids []string) (UserDisplayNamesResult, error) {
	if err := datactx.RequirePlatform(ctx, datactx.PlatformSession); err != nil {
		return UserDisplayNamesResult{}, err
	}
	if ids == nil {
		return UserDisplayNamesResult{}, dataerr.Invalid("User ids: expected a list of ids.")
	}
	if len(ids) < 1 || len(ids) > maxDisplayNameIDs {
		return UserDisplayNamesResult{}, dataerr.Invalid(fmt.Sprintf("User ids: ask for 1 to %d ids at a time.", maxDisplayNameIDs))
	}
	seen := map[string]bool{}
	var wanted []string
	for _, raw := range ids {
		id, err := importutil.RequireID(raw, "User")
		if err != nil {
			return UserDisplayNamesResult{}, err
		}
		if !seen[id] {
			seen[id] = true
			wanted = append(wanted, id)
		}
	}
	byID := map[string]User{}
	userRows, err := allUsers(context.Background(), ctx.CustomerID)
	if err != nil {
		return UserDisplayNamesResult{}, err
	}
	for _, u := range userRows {
		byID[u.ID] = u
	}
	items := []UserDisplayName{}
	for _, id := range wanted {
		if u, ok := byID[id]; ok {
			items = append(items, UserDisplayName{ID: u.ID, DisplayName: u.DisplayName, Role: u.AssignedRole})
		}
	}
	return UserDisplayNamesResult{Items: items}, nil
}

func modulesFor(role access.Role, installMode access.InstallMode) []ModuleAccessEntry {
	approvalModules := map[access.ModuleID]bool{}
	for _, kind := range access.ApprovalKindsFor(role, installMode) {
		approvalModules[access.ApprovalModule[kind]] = true
	}
	out := make([]ModuleAccessEntry, len(access.ModuleIDs))
	for i, moduleID := range access.ModuleIDs {
		out[i] = ModuleAccessEntry{
			ModuleID:   moduleID,
			Access:     access.ModuleAccess(role, moduleID, installMode).Access,
			CanApprove: approvalModules[moduleID],
		}
	}
	return out
}

// GetEffectiveAccess mirrors getEffectiveAccess.
func GetEffectiveAccess(ctx reqctx.RequestContext, targetUserID string) (EffectiveAccess, error) {
	if err := reqctx.RequireAccess(ctx, moduleUsersRoles, access.AccessView); err != nil {
		return EffectiveAccess{}, err
	}
	if _, err := importutil.RequireID(targetUserID, "User"); err != nil {
		return EffectiveAccess{}, err
	}
	u, err := oneUser(context.Background(), ctx.CustomerID, targetUserID)
	if err != nil {
		return EffectiveAccess{}, err
	}
	if u == nil {
		return EffectiveAccess{}, dataerr.NotFound("User not found.")
	}
	scope := access.ScopeAppliesTo(u.AssignedRole)
	zoneIDs := []string{}
	if scope == access.ScopeAssignedZones {
		zoneIDs = u.ZoneIDs
	}
	return EffectiveAccess{UserID: u.ID, AssignedRole: u.AssignedRole, Scope: scope, ZoneIDs: zoneIDs, Modules: modulesFor(u.AssignedRole, ctx.InstallMode)}, nil
}

// PreviewEffectiveAccess: preview an unsaved role.
func PreviewEffectiveAccess(ctx reqctx.RequestContext, body any) (AccessPreview, error) {
	if err := reqctx.RequireAccess(ctx, moduleUsersRoles, access.AccessView); err != nil {
		return AccessPreview{}, err
	}
	input, err := datactx.Object(body, "Access preview", []string{"assigned_role", "install_mode", "zone_ids"})
	if err != nil {
		return AccessPreview{}, err
	}
	role, err := datactx.EnumOf(input, "assigned_role", access.Roles)
	if err != nil {
		return AccessPreview{}, err
	}
	mode, hasMode, err := datactx.OptEnum(input, "install_mode", []access.InstallMode{access.InstallPrivate, access.InstallDedicated, access.InstallShared})
	if err != nil {
		return AccessPreview{}, err
	}
	if !hasMode {
		mode = ctx.InstallMode
	}
	scope := access.ScopeAppliesTo(role)
	zoneIDs := []string{}
	if scope == access.ScopeAssignedZones {
		zoneIDs, err = datactx.UUIDList(input, "zone_ids", true)
		if err != nil {
			return AccessPreview{}, err
		}
	}
	return AccessPreview{AssignedRole: role, InstallMode: mode, Scope: scope, ZoneIDs: zoneIDs, Modules: modulesFor(role, mode)}, nil
}

// normalisedZones: zone-scoped needs >=1 zone.
func normalisedZones(goCtx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, role access.Role, zoneIDs []string) ([]string, error) {
	if access.ScopeAppliesTo(role) != access.ScopeAssignedZones {
		return []string{}, nil
	}
	if len(zoneIDs) == 0 {
		return nil, dataerr.Invalid(fmt.Sprintf("User: a %s needs at least one zone.", roleNames[role].En))
	}
	zones, err := allZones(goCtx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	known := map[string]bool{}
	for _, z := range zones {
		known[z.ID] = true
	}
	for _, id := range zoneIDs {
		if !known[id] {
			return nil, dataerr.Invalid(fmt.Sprintf("User: zone %s does not exist.", id))
		}
		zid := id
		if err := reqctx.RequireWriteZone(rc, &zid); err != nil {
			return nil, err
		}
	}
	out := make([]string, len(zoneIDs))
	copy(out, zoneIDs)
	return out, nil
}

func requireRoleInMode(installMode access.InstallMode, role access.Role) error {
	for _, r := range access.RolesForInstallMode(installMode) {
		if r == role {
			return nil
		}
	}
	return dataerr.Invalid(fmt.Sprintf("User: %s does not exist in a %s install.", roleNames[role].En, installMode))
}

func activeAdministrators(ctx context.Context, tenantID, exceptID string) ([]User, error) {
	var out []User
	userRows, err := allUsers(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for _, u := range userRows {
		if u.AssignedRole == access.RoleAdministrator && u.Status != "disabled" && u.ID != exceptID {
			out = append(out, u)
		}
	}
	return out, nil
}

// CreateUser mirrors createUser.
func CreateUser(goCtx context.Context, conn *tenancy.Connection, ctx reqctx.RequestContext, body any) (User, error) {
	return auditlog.WriteWithAudit(goCtx, ctx, auditlog.Guard{ModuleID: moduleUsersRoles}, auditlog.WriteMeta{Action: "user.created", EntityType: "user"}, func(uctx context.Context) (auditlog.AuditedWrite[User], error) {
		input, err := datactx.Object(body, "User", []string{"email", "display_name", "assigned_role", "zone_ids"})
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		email, err := datactx.String(input, "email", datactx.StrOpts{HasMax: true, Max: 254, Pattern: emailPattern})
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		userRows, err := allUsers(uctx, ctx.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		for _, u := range userRows {
			if strings.EqualFold(u.Email, email) {
				return auditlog.AuditedWrite[User]{}, dataerr.Conflict(fmt.Sprintf("A user with %s already exists.", email))
			}
		}
		role, err := datactx.EnumOf(input, "assigned_role", access.Roles)
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		if err := requireRoleInMode(ctx.InstallMode, role); err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		rawZones, err := datactx.UUIDList(input, "zone_ids", true)
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		zones, err := normalisedZones(uctx, conn, ctx, role, rawZones)
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		displayName, err := datactx.String(input, "display_name", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 120})
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		user := User{
			BaseRecord: datactx.NewRecord(ctx, "", ""), Email: email, DisplayName: displayName,
			AssignedRole: role, ZoneIDs: zones, Status: "invited", PreferredLocale: "en",
		}
		if err := saveUser(uctx, user); err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		id := user.ID
		return auditlog.AuditedWrite[User]{Result: user, EntityID: &id, SummaryEn: fmt.Sprintf("User %s invited as %s.", user.DisplayName, roleNames[role].En), Detail: sumDetail(map[string]any{"assigned_role": role, "zone_ids": zones}, map[string]any{"name": user.DisplayName, "role": string(role)})}, nil
	})
}

// UpdateUser mirrors updateUser.
func UpdateUser(goCtx context.Context, conn *tenancy.Connection, ctx reqctx.RequestContext, id string, body any) (User, error) {
	return auditlog.WriteWithAudit(goCtx, ctx, auditlog.Guard{ModuleID: moduleUsersRoles}, auditlog.WriteMeta{Action: "user.updated", EntityType: "user", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[User], error) {
		if _, err := importutil.RequireID(id, "User"); err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		existing, err := oneUser(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		if existing == nil {
			return auditlog.AuditedWrite[User]{}, dataerr.NotFound("User not found.")
		}
		input, err := datactx.Object(body, "User", []string{"display_name", "assigned_role", "zone_ids"})
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		role, err := datactx.EnumOf(input, "assigned_role", access.Roles)
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		if err := requireRoleInMode(ctx.InstallMode, role); err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		others, err := activeAdministrators(uctx, ctx.CustomerID, existing.ID)
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		if existing.AssignedRole == access.RoleAdministrator && role != access.RoleAdministrator && existing.Status != "disabled" && len(others) == 0 {
			return auditlog.AuditedWrite[User]{}, dataerr.Conflict("The last active Administrator cannot be given another role.")
		}
		if existing.IsEmergencyAdmin && role != access.RoleAdministrator {
			return auditlog.AuditedWrite[User]{}, dataerr.Conflict("The emergency administrator keeps the Administrator role.")
		}
		rawZones, err := datactx.UUIDList(input, "zone_ids", true)
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		zones, err := normalisedZones(uctx, conn, ctx, role, rawZones)
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		displayName, err := datactx.String(input, "display_name", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 120})
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		next := *existing
		next.DisplayName, next.AssignedRole, next.ZoneIDs, next.UpdatedAt = displayName, role, zones, datactx.NowISO()
		if err := saveUser(uctx, next); err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		detail := map[string]any{"from_role": existing.AssignedRole, "to_role": role, "from_zone_ids": existing.ZoneIDs, "to_zone_ids": zones}
		return auditlog.AuditedWrite[User]{Result: next, SummaryEn: fmt.Sprintf("User %s updated (%s).", next.DisplayName, roleNames[role].En), Detail: detail}, nil
	})
}

// DisableUser mirrors disableUser.
func DisableUser(ctx reqctx.RequestContext, id string) (User, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleUsersRoles}, auditlog.WriteMeta{Action: "user.disabled", EntityType: "user", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[User], error) {
		if _, err := importutil.RequireID(id, "User"); err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		existing, err := oneUser(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		if existing == nil {
			return auditlog.AuditedWrite[User]{}, dataerr.NotFound("User not found.")
		}
		if existing.ID == ctx.UserID {
			return auditlog.AuditedWrite[User]{}, dataerr.Conflict("You cannot disable your own account.")
		}
		if existing.Status == "disabled" {
			return auditlog.AuditedWrite[User]{}, dataerr.Conflict("The user is already disabled.")
		}
		others, err := activeAdministrators(uctx, ctx.CustomerID, existing.ID)
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		if existing.AssignedRole == access.RoleAdministrator && len(others) == 0 {
			return auditlog.AuditedWrite[User]{}, dataerr.Conflict("The last active Administrator cannot be disabled.")
		}
		next := *existing
		next.Status, next.UpdatedAt = "disabled", datactx.NowISO()
		if err := saveUser(uctx, next); err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		return auditlog.AuditedWrite[User]{Result: next, SummaryEn: fmt.Sprintf("User %s disabled.", next.DisplayName), Detail: sumDetail(nil, map[string]any{"name": next.DisplayName})}, nil
	})
}

// EnableUser mirrors enableUser.
func EnableUser(ctx reqctx.RequestContext, id string) (User, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleUsersRoles}, auditlog.WriteMeta{Action: "user.enabled", EntityType: "user", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[User], error) {
		if _, err := importutil.RequireID(id, "User"); err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		existing, err := oneUser(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		if existing == nil {
			return auditlog.AuditedWrite[User]{}, dataerr.NotFound("User not found.")
		}
		if existing.Status != "disabled" {
			return auditlog.AuditedWrite[User]{}, dataerr.Conflict("The user is not disabled.")
		}
		if err := requireRoleInMode(ctx.InstallMode, existing.AssignedRole); err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		// Never signed in -> invited, not active.
		status := "active"
		if existing.LastSignInAt == nil {
			status = "invited"
		}
		next := *existing
		next.Status, next.UpdatedAt = status, datactx.NowISO()
		if err := saveUser(uctx, next); err != nil {
			return auditlog.AuditedWrite[User]{}, err
		}
		return auditlog.AuditedWrite[User]{Result: next, SummaryEn: fmt.Sprintf("User %s enabled.", next.DisplayName), Detail: sumDetail(nil, map[string]any{"name": next.DisplayName})}, nil
	})
}

// resetEmergencyAdmin: LABELLED STUB, no change.
// The temporary secret would be created and held by
// Keycloak; only a hint is ever returned.
func resetEmergencyAdmin(ctx reqctx.RequestContext, id string, kind string) (EmergencyAdminResetResult, error) {
	action := "emergency_admin.password_reset"
	label := "password"
	if kind == "mfa" {
		action, label = "emergency_admin.mfa_reset", "authenticator app"
	}
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleUsersRoles}, auditlog.WriteMeta{Action: action, EntityType: "user", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[EmergencyAdminResetResult], error) {
		if _, err := importutil.RequireID(id, "User"); err != nil {
			return auditlog.AuditedWrite[EmergencyAdminResetResult]{}, err
		}
		user, err := oneUser(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[EmergencyAdminResetResult]{}, err
		}
		if user == nil {
			return auditlog.AuditedWrite[EmergencyAdminResetResult]{}, dataerr.NotFound("User not found.")
		}
		if !user.IsEmergencyAdmin {
			return auditlog.AuditedWrite[EmergencyAdminResetResult]{}, dataerr.Conflict("Only the emergency administrator account can be reset here.")
		}
		var raw [3]byte
		_, _ = rand.Read(raw[:])
		hint := hex.EncodeToString(raw[:])[:4]
		result := EmergencyAdminResetResult{ResetAt: datactx.NowISO(), ResetKind: kind, TemporarySecretHint: hint}
		summary := fmt.Sprintf("Emergency administrator %s reset (stub: nothing changed).", label)
		return auditlog.AuditedWrite[EmergencyAdminResetResult]{Result: result, SummaryEn: summary, Detail: map[string]any{"reset_kind": kind, "stub": true}}, nil
	})
}

// ResetEmergencyAdminPassword: password-reset stub.
func ResetEmergencyAdminPassword(ctx reqctx.RequestContext, id string) (EmergencyAdminResetResult, error) {
	return resetEmergencyAdmin(ctx, id, "password")
}

// ResetEmergencyAdminMfa: the MFA-reset stub.
func ResetEmergencyAdminMfa(ctx reqctx.RequestContext, id string) (EmergencyAdminResetResult, error) {
	return resetEmergencyAdmin(ctx, id, "mfa")
}
