// SPDX-License-Identifier: AGPL-3.0-only

// Request contexts of signed-in sessions.
package business

import (
	"context"
	"sort"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func sortedJoin(ids []string) string {
	sorted := append([]string(nil), ids...)
	sort.Strings(sorted)
	return strings.Join(sorted, "|")
}

// ContextForUser builds the request context of a person who signed in through their identity provider: their own role and zones,
// as the group rules gave them at sign-in, never a stand-in picked by role. nil when the person cannot act: unknown, disabled,
// not yet signed in, or holding a role this install mode does not have.
func ContextForUser(goCtx context.Context, conn *tenancy.Connection, tenantID, userID string, installMode access.InstallMode) (*reqctx.RequestContext, error) {
	return contextOf(goCtx, conn, tenantID, userID, installMode, nil)
}

// ContextForDemoSession: nil zones = own zones.
func ContextForDemoSession(goCtx context.Context, conn *tenancy.Connection, tenantID, userID string, installMode access.InstallMode, zoneIDs []string) (*reqctx.RequestContext, error) {
	if zoneIDs == nil {
		return contextOf(goCtx, conn, tenantID, userID, installMode, nil)
	}
	return contextOf(goCtx, conn, tenantID, userID, installMode, &zoneIDs)
}

func contextOf(goCtx context.Context, conn *tenancy.Connection, tenantID, userID string, installMode access.InstallMode, chosen *[]string) (*reqctx.RequestContext, error) {
	user, err := oneUser(goCtx, tenantID, userID)
	if err != nil || user == nil || user.Status != "active" {
		return nil, err
	}
	if !roleInMode(user.AssignedRole, installMode) {
		return nil, nil
	}
	zoneIDs := []string{}
	if access.ScopeAppliesTo(user.AssignedRole) == access.ScopeAssignedZones {
		wanted := user.ZoneIDs
		if chosen != nil {
			wanted = *chosen
		}
		known, err := knownZones(goCtx, conn, tenantID)
		if err != nil {
			return nil, err
		}
		for _, id := range wanted {
			if known[id] {
				zoneIDs = append(zoneIDs, id)
			}
		}
	}
	return &reqctx.RequestContext{CustomerID: tenantID, UserID: user.ID, Role: user.AssignedRole, ZoneScope: access.ZoneScopeFor(user.AssignedRole, zoneIDs), InstallMode: installMode}, nil
}

func roleInMode(role access.Role, mode access.InstallMode) bool {
	for _, r := range access.RolesForInstallMode(mode) {
		if r == role {
			return true
		}
	}
	return false
}

func knownZones(goCtx context.Context, conn *tenancy.Connection, tenantID string) (map[string]bool, error) {
	zones, err := allZones(goCtx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	known := make(map[string]bool, len(zones))
	for _, z := range zones {
		known[z.ID] = true
	}
	return known, nil
}

// PickDemoUser: nil when none.
func PickDemoUser(tenantID string, role access.Role, zoneIDs []string) (*User, error) {
	if err := SeedUsersFromFixtures(); err != nil {
		return nil, err
	}
	rows, err := allUsers(context.Background(), tenantID)
	if err != nil {
		return nil, err
	}
	var candidates []User
	for _, u := range rows {
		if u.AssignedRole == role && u.Status == "active" && !u.IsEmergencyAdmin {
			candidates = append(candidates, u)
		}
	}
	if len(candidates) == 0 {
		return nil, nil
	}
	wanted := sortedJoin(zoneIDs)
	for _, c := range candidates {
		if sortedJoin(c.ZoneIDs) == wanted {
			return &c, nil
		}
	}
	return &candidates[0], nil
}

// SessionPolicyFor is a customer's session policy as it stands now.
func SessionPolicyFor(tenantID string) (SessionPolicy, error) {
	return readSettingStrict(context.Background(), tenantID, "security.session_policy", defaultSessionPolicy)
}
