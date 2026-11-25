// SPDX-License-Identifier: AGPL-3.0-only

// Demo sign-in (dev, CI and review builds only).
package business

import (
	"context"
	"fmt"
	"os"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// DemoInstallModes is the switcher's order.
var DemoInstallModes = []access.InstallMode{access.InstallPrivate, access.InstallDedicated, access.InstallShared}

// DemoZone is one zone the switcher offers.
type DemoZone struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	CityName string `json:"city_name"`
}

// The demo customer's name, both languages.
const (
	DemoCustomerNameEn = "Example Response (synthetic)"
	DemoCustomerNameAr = "مثال للاستجابة (بيانات اصطناعية)"
)

// demoCustomerNames: env overrides for recordings.
func demoCustomerNames() (string, string) {
	en, ar := os.Getenv("OPENDISPATCH_DEMO_CUSTOMER_NAME"), os.Getenv("OPENDISPATCH_DEMO_CUSTOMER_NAME_AR")
	if en == "" {
		return DemoCustomerNameEn, DemoCustomerNameAr
	}
	if ar == "" {
		ar = en
	}
	return en, ar
}

// DemoOptions mirrors the contract type.
type DemoOptions struct {
	CustomerName       string                               `json:"customer_name"`
	CustomerNameAr     string                               `json:"customer_name_ar"`
	TenantID           string                               `json:"customer_id"`
	Zones              []DemoZone                           `json:"zones"`
	InstallModes       []access.InstallMode                 `json:"install_modes"`
	RolesByInstallMode map[access.InstallMode][]access.Role `json:"roles_by_install_mode"`
}

// GetDemoOptions: zones and held roles.
func GetDemoOptions(goCtx context.Context, conn *tenancy.Connection, tenantID string) (DemoOptions, error) {
	cities, err := allCities(goCtx, conn, tenantID)
	if err != nil {
		return DemoOptions{}, err
	}
	cityName := make(map[string]string, len(cities))
	for _, c := range cities {
		cityName[c.ID] = c.NameEn
	}
	zones, err := allZones(goCtx, conn, tenantID)
	if err != nil {
		return DemoOptions{}, err
	}
	nameEn, nameAr := demoCustomerNames()
	out := DemoOptions{CustomerName: nameEn, CustomerNameAr: nameAr, TenantID: tenantID, Zones: make([]DemoZone, 0, len(zones)), InstallModes: DemoInstallModes, RolesByInstallMode: map[access.InstallMode][]access.Role{}}
	for _, z := range zones {
		out.Zones = append(out.Zones, DemoZone{ID: z.ID, Name: z.NameEn, CityName: cityName[z.CityID]})
	}
	for _, mode := range DemoInstallModes {
		roles := []access.Role{}
		for _, role := range access.RolesForInstallMode(mode) {
			user, err := PickDemoUser(tenantID, role, nil)
			if err != nil {
				return DemoOptions{}, err
			}
			if user != nil {
				roles = append(roles, role)
			}
		}
		out.RolesByInstallMode[mode] = roles
	}
	return out, nil
}

// DemoChoice is a checked demo sign-in request.
type DemoChoice struct {
	Role        access.Role
	InstallMode access.InstallMode
	ZoneIDs     []string
}

// ParseDemoChoice checks role, mode and zones.
func ParseDemoChoice(goCtx context.Context, conn *tenancy.Connection, tenantID string, body any) (DemoChoice, error) {
	input, err := datactx.Object(body, "Demo sign-in", []string{"assigned_role", "install_mode", "zone_ids"})
	if err != nil {
		return DemoChoice{}, err
	}
	role, err := datactx.EnumOf(input, "assigned_role", access.Roles)
	if err != nil {
		return DemoChoice{}, err
	}
	mode, err := datactx.EnumOf(input, "install_mode", DemoInstallModes)
	if err != nil {
		return DemoChoice{}, err
	}
	if !roleInMode(role, mode) {
		return DemoChoice{}, dataerr.Invalid(fmt.Sprintf("Input: assigned_role %s does not exist in a %s install.", role, mode))
	}
	zoneIDs, err := datactx.UUIDList(input, "zone_ids", true)
	if err != nil {
		return DemoChoice{}, err
	}
	known, err := knownZones(goCtx, conn, tenantID)
	if err != nil {
		return DemoChoice{}, err
	}
	for _, id := range zoneIDs {
		if !known[id] {
			return DemoChoice{}, dataerr.Invalid("Input: zone_ids names a zone that does not exist.")
		}
	}
	if access.ScopeAppliesTo(role) != access.ScopeAssignedZones {
		zoneIDs = []string{}
	}
	return DemoChoice{Role: role, InstallMode: mode, ZoneIDs: zoneIDs}, nil
}

// DemoSignIn picks the account and audits.
func DemoSignIn(pre reqctx.PreSessionContext, choice DemoChoice) (SignInResult, error) {
	if err := datactx.RequirePreSession(pre); err != nil {
		return SignInResult{}, err
	}
	user, err := PickDemoUser(pre.CustomerID, choice.Role, choice.ZoneIDs)
	if err != nil {
		return SignInResult{}, err
	}
	detail := map[string]any{"assigned_role": string(choice.Role), "install_mode": string(choice.InstallMode), "zones": len(choice.ZoneIDs)}
	if user == nil {
		_, _ = auditlog.RecordAudit(pre, auditlog.AuditInput{
			Action: "auth.demo_sign_in", EntityType: "user", SummaryEn: fmt.Sprintf("Demo sign-in as %s refused: no active account holds that role.", choice.Role),
			Outcome: "denied", ActorType: "demo", ActorUserIDGiven: true, Detail: detail,
		}, "", "")
		return SignInResult{Outcome: "no_role_assigned", ZoneIDs: []string{}}, nil
	}
	id := user.ID
	if _, err := auditlog.RecordAudit(pre, auditlog.AuditInput{
		Action: "auth.demo_sign_in", EntityType: "user", EntityID: &id, SummaryEn: fmt.Sprintf("%s signed in through the demo switcher as %s.", user.DisplayName, choice.Role),
		ActorType: "demo", ActorUserID: &id, ActorUserIDGiven: true, Detail: detail,
	}, "", ""); err != nil {
		return SignInResult{}, err
	}
	role := choice.Role
	return SignInResult{Outcome: "signed_in", UserID: &id, AssignedRole: &role, ZoneIDs: choice.ZoneIDs}, nil
}

// DemoUserForTest: named account or a pick.
func DemoUserForTest(tenantID, userID string, role access.Role, zoneIDs []string) (*User, error) {
	if err := SeedUsersFromFixtures(); err != nil {
		return nil, err
	}
	if userID != "" {
		u, err := oneUser(context.Background(), tenantID, userID)
		if err != nil {
			return nil, err
		}
		if u != nil && u.AssignedRole == role && u.Status == "active" {
			return u, nil
		}
	}
	return PickDemoUser(tenantID, role, zoneIDs)
}
