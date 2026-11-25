// SPDX-License-Identifier: AGPL-3.0-only

// Three-role model; mirrors roles.ts.
package tenancy

// RoleName names one of the three tenancy roles.
type RoleName string

const (
	RoleApplication RoleName = "application"
	RoleOwner       RoleName = "owner"
	RoleAgent       RoleName = "agent"
)

// PlatformAccess: a role's platform.* access.
type PlatformAccess string

const (
	PlatformReadOnly      PlatformAccess = "read-only"
	PlatformOwnTablesOnly PlatformAccess = "own-tables-only"
	PlatformNone          PlatformAccess = "none"
)

// RoleDefinition mirrors roles.ts.
type RoleDefinition struct {
	Name           RoleName
	PostgresRole   string // the Postgres role name the customer's DB team creates
	OwnsTables     bool
	BypassRLS      bool
	PlatformAccess PlatformAccess
	UsedBy         string
	Note           string
}

// Roles mirrors TENANCY_ROLES; not granted here.
var Roles = map[RoleName]RoleDefinition{
	RoleApplication: {
		Name:           RoleApplication,
		PostgresRole:   "opendispatch_app",
		OwnsTables:     false,
		BypassRLS:      false,
		PlatformAccess: PlatformReadOnly,
		UsedBy:         "apps/api and apps/worker, at runtime, on every request and job",
		Note:           "Never BYPASSRLS: this is the role RLS has to actually hold against.",
	},
	RoleOwner: {
		Name:           RoleOwner,
		PostgresRole:   "opendispatch_owner",
		OwnsTables:     true,
		BypassRLS:      true,
		PlatformAccess: PlatformReadOnly,
		UsedBy:         "the migration runner only (internal/tenancy/migration_runner.go)",
		Note:           "BYPASSRLS is required because forced RLS applies to the owner too, and data-fix migrations must reach every customer.",
	},
	RoleAgent: {
		Name:           RoleAgent,
		PostgresRole:   "opendispatch_agent",
		OwnsTables:     false,
		BypassRLS:      false,
		PlatformAccess: PlatformOwnTablesOnly,
		UsedBy:         "the host platform's update agent — not used by opendispatch itself",
		Note:           "Owned by the host platform. Listed here only so opendispatch code never assumes it can use it, and never grants it more than this.",
	},
}
