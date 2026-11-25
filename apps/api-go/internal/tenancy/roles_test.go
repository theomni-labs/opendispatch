// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors roles.test.ts; same 8 assertions.
package tenancy

import "testing"

func TestRoles_HasExactlyTheThreeNamedRoles(t *testing.T) {
	if len(Roles) != 3 {
		t.Fatalf("want 3 roles, got %d", len(Roles))
	}
	for _, name := range []RoleName{RoleApplication, RoleOwner, RoleAgent} {
		if _, ok := Roles[name]; !ok {
			t.Errorf("missing role %q", name)
		}
	}
}

func TestRoles_ApplicationOwnsNoTablesAndLacksBypassRLS(t *testing.T) {
	r := Roles[RoleApplication]
	if r.OwnsTables {
		t.Error("application role must not own tables")
	}
	if r.BypassRLS {
		t.Error("application role must not have BYPASSRLS")
	}
}

func TestRoles_ApplicationIsReadOnlyOnPlatformTables(t *testing.T) {
	if got := Roles[RoleApplication].PlatformAccess; got != PlatformReadOnly {
		t.Errorf("application platform access = %q, want %q", got, PlatformReadOnly)
	}
}

func TestRoles_OnlyOwnerHasBypassRLS(t *testing.T) {
	for name, r := range Roles {
		want := name == RoleOwner
		if r.BypassRLS != want {
			t.Errorf("role %q BypassRLS = %v, want %v (forced RLS applies to the owner too)", name, r.BypassRLS, want)
		}
	}
}

func TestRoles_OwnerOwnsTheTables(t *testing.T) {
	if !Roles[RoleOwner].OwnsTables {
		t.Error("owner role must own the tables")
	}
}

func TestRoles_AgentCannotReadCustomerData(t *testing.T) {
	r := Roles[RoleAgent]
	if r.BypassRLS {
		t.Error("agent role must not have BYPASSRLS")
	}
	if r.OwnsTables {
		t.Error("agent role must not own tables")
	}
	if r.PlatformAccess != PlatformOwnTablesOnly {
		t.Errorf("agent platform access = %q, want %q (writes only its own platform tables)", r.PlatformAccess, PlatformOwnTablesOnly)
	}
}

func TestRoles_AgentIsDocumentedAsNotUsedByOpenDispatch(t *testing.T) {
	if Roles[RoleAgent].Note == "" {
		t.Error("agent role must document that opendispatch never uses it (owned by the host platform)")
	}
}

func TestRoles_EveryRoleHasADistinctPostgresRoleName(t *testing.T) {
	seen := map[string]RoleName{}
	for name, r := range Roles {
		if other, dup := seen[r.PostgresRole]; dup {
			t.Errorf("roles %q and %q share Postgres role name %q", name, other, r.PostgresRole)
		}
		seen[r.PostgresRole] = name
	}
}
