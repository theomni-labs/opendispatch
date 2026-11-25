// SPDX-License-Identifier: AGPL-3.0-only

package business

import "context"

// Test shims: the in-memory user store ignores the tenant.
func upsertUserRow(u User) User {
	if err := saveUser(context.Background(), u); err != nil {
		panic(err)
	}
	return u
}

func upsertRoleMappingRow(m RoleMapping) RoleMapping {
	if err := saveRoleMapping(context.Background(), m); err != nil {
		panic(err)
	}
	return m
}

func oneUserT(id string) *User {
	u, err := oneUser(context.Background(), "", id)
	if err != nil {
		panic(err)
	}
	return u
}
