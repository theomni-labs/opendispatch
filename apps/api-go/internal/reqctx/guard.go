// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors apps/web/src/lib/data/guard.ts.
package reqctx

import (
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

// RequestContext: who is asking.
type RequestContext struct {
	CustomerID  string
	UserID      string
	Role        access.Role
	ZoneScope   access.ZoneScope
	InstallMode access.InstallMode
}

// AuditCustomerID: for auditlog.RequestContext.
func (ctx RequestContext) AuditCustomerID() string { return ctx.CustomerID }

// AuditUserID: satisfies auditlog.RequestContext.
func (ctx RequestContext) AuditUserID() *string {
	id := ctx.UserID
	return &id
}

// PreSessionContext: asking before sign-in.
// Only MockSignIn and EmergencyAdminSignIn take it.
type PreSessionContext struct {
	CustomerID  string
	InstallMode access.InstallMode
}

// AuditCustomerID: for auditlog.RequestContext.
func (pre PreSessionContext) AuditCustomerID() string { return pre.CustomerID }

// AuditUserID: no actor before sign-in.
func (pre PreSessionContext) AuditUserID() *string { return nil }

// RequireAccess mirrors requireAccess.
func RequireAccess(ctx RequestContext, moduleID access.ModuleID, needed access.Access) error {
	if !access.CanAccess(ctx.Role, moduleID, ctx.InstallMode, needed) {
		return dataerr.Forbidden(string(ctx.Role) + " may not " + string(needed) + " " + string(moduleID) + " in a " + string(ctx.InstallMode) + " install.")
	}
	return nil
}

// CanReadZone mirrors canReadZone.
func CanReadZone(ctx RequestContext, zoneID *string) bool {
	if ctx.ZoneScope.Kind != access.ScopeAssignedZones {
		return true
	}
	if zoneID == nil {
		return false
	}
	return access.ZoneAllowed(ctx.ZoneScope, *zoneID)
}

// CanWriteZone mirrors canWriteZone.
func CanWriteZone(ctx RequestContext, zoneID *string) bool {
	if ctx.ZoneScope.Kind == access.ScopeWholeInstall {
		return true
	}
	if zoneID == nil {
		return false
	}
	return access.ZoneAllowed(ctx.ZoneScope, *zoneID)
}

// RequireWriteZone mirrors requireWriteZone.
func RequireWriteZone(ctx RequestContext, zoneID *string) error {
	if !CanWriteZone(ctx, zoneID) {
		id := "null"
		if zoneID != nil {
			id = *zoneID
		}
		return dataerr.Forbidden("Zone " + id + " is outside the zone scope of " + string(ctx.Role) + ".")
	}
	return nil
}
