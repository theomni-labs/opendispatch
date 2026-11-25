// SPDX-License-Identifier: AGPL-3.0-only

// Live: group rules in Postgres.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func usePgRoleMappings(t *testing.T) *tenancy.Connection {
	t.Helper()
	conn := openConn(t)
	UsePostgresUsers(conn)
	UsePostgresRoleMappings(conn)
	t.Cleanup(func() {
		UseMemoryUsers()
		UseMemoryRoleMappings()
	})
	return conn
}

func TestRoleMappingsPg_CreateListResolveUpdateDelete(t *testing.T) {
	usePgRoleMappings(t)
	tenant := datactx.NewID()
	admin := actorIn(t, tenant, access.RoleAdministrator)

	planners, err := CreateRoleMapping(admin, map[string]any{"group_match": "opendispatch-planners", "group_match_type": "exact", "assigned_role": "viewer_auditor", "zone_ids": []any{}})
	check(t, err)
	_, err = CreateRoleMapping(admin, map[string]any{"group_match": "opendispatch-admins", "group_match_type": "exact", "assigned_role": "administrator", "zone_ids": []any{}})
	check(t, err)
	if planners.Priority != 1 {
		t.Fatalf("the first rule gets priority 1, got %d", planners.Priority)
	}

	page, err := ListRoleMappings(admin, datactx.PageQuery{})
	check(t, err)
	if len(page.Items) != 2 || page.Items[0].GroupMatch != "opendispatch-planners" {
		t.Fatalf("got %+v", page.Items)
	}

	preview, err := PreviewRoleMappings(admin, map[string]any{"groups": []any{"staff", "opendispatch-admins"}})
	check(t, err)
	if preview.AssignedRole == nil || *preview.AssignedRole != access.RoleAdministrator {
		t.Fatalf("the admins rule must match, got %+v", preview)
	}
	none, err := PreviewRoleMappings(admin, map[string]any{"groups": []any{"staff"}})
	check(t, err)
	if none.AssignedRole != nil {
		t.Fatalf("no matching rule means no role, got %v", *none.AssignedRole)
	}

	off, err := UpdateRoleMapping(admin, planners.ID, map[string]any{"group_match": "opendispatch-planners", "group_match_type": "exact", "assigned_role": "viewer_auditor", "zone_ids": []any{}, "is_enabled": false})
	check(t, err)
	if off.IsEnabled {
		t.Fatal("the rule must be switched off")
	}
	gone, err := PreviewRoleMappings(admin, map[string]any{"groups": []any{"opendispatch-planners"}})
	check(t, err)
	if gone.AssignedRole != nil {
		t.Fatal("a switched-off rule must not match")
	}

	check(t, DeleteRoleMapping(admin, planners.ID))
	if _, err := UpdateRoleMapping(admin, planners.ID, map[string]any{"group_match": "opendispatch-planners", "group_match_type": "exact", "assigned_role": "viewer_auditor", "zone_ids": []any{}, "is_enabled": true}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("a deleted rule is NotFound, got %v", err)
	}
}

func TestRoleMappingsPg_TenantsNeverSeeEachOthersRules(t *testing.T) {
	usePgRoleMappings(t)
	a := actorIn(t, datactx.NewID(), access.RoleAdministrator)
	b := actorIn(t, datactx.NewID(), access.RoleAdministrator)
	_, err := CreateRoleMapping(a, map[string]any{"group_match": "only-in-a", "group_match_type": "exact", "assigned_role": "viewer_auditor", "zone_ids": []any{}})
	check(t, err)
	page, err := ListRoleMappings(b, datactx.PageQuery{})
	check(t, err)
	if len(page.Items) != 0 {
		t.Fatalf("tenant B sees %+v", page.Items)
	}
	preview, err := PreviewRoleMappings(b, map[string]any{"groups": []any{"only-in-a"}})
	check(t, err)
	if preview.AssignedRole != nil {
		t.Fatal("tenant A's rule must not give tenant B a role")
	}
	_ = context.Background()
}
