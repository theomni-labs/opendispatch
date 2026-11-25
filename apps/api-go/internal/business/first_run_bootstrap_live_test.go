// SPDX-License-Identifier: AGPL-3.0-only

// Live: first-run bootstrap as the app role.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func usePgBootstrap(t *testing.T) *tenancy.Connection {
	t.Helper()
	conn := usePgRoleMappings(t)
	settingsstore.UsePostgres(conn)
	auditlog.UseStore(auditlog.PgStore{Conn: conn})
	t.Cleanup(func() {
		settingsstore.UseMemory()
		auditlog.UseStore(auditlog.MemoryStore())
	})
	return conn
}

func TestBootstrapPg_OneRuleOneEventThenNoOp(t *testing.T) {
	conn := usePgBootstrap(t)
	tenant := datactx.NewID()
	ctx := context.Background()
	res, err := BootstrapAdministratorRule(ctx, tenant, access.InstallPrivate, "opendispatch-administrators")
	check(t, err)
	if res.Outcome != BootstrapCreated {
		t.Fatalf("got %+v", res)
	}
	again, err := BootstrapAdministratorRule(ctx, tenant, access.InstallPrivate, "opendispatch-administrators")
	check(t, err)
	if again.Outcome != BootstrapAlreadyDone {
		t.Fatalf("got %+v", again)
	}
	rules := countIn(t, conn, tenant, `SELECT count(*)::int FROM role_mappings WHERE assigned_role = 'administrator' AND group_match = 'opendispatch-administrators'`)
	all := countIn(t, conn, tenant, `SELECT count(*)::int FROM role_mappings`)
	events := countIn(t, conn, tenant, `SELECT count(*)::int FROM audit_events WHERE action = 'role_mapping.created' AND actor_type = 'system' AND detail->>'source' = 'first_run_bootstrap'`)
	if rules != 1 || all != 1 || events != 1 {
		t.Fatalf("got %d admin rules, %d rules, %d events", rules, all, events)
	}
	pre := reqctx.PreSessionContext{CustomerID: tenant, InstallMode: access.InstallPrivate}
	out, err := SignInOIDC(pre, OIDCIdentity{Subject: "kc-outsider", Email: "o@customer.example", Groups: []string{"staff"}})
	check(t, err)
	if out.Outcome != "no_role_assigned" {
		t.Fatalf("a non-member gets no access, got %+v", out)
	}
	in, err := SignInOIDC(pre, OIDCIdentity{Subject: "kc-admin", Email: "a@customer.example", EmailVerified: true, Groups: []string{"opendispatch-administrators"}})
	check(t, err)
	if in.AssignedRole == nil || *in.AssignedRole != access.RoleAdministrator {
		t.Fatalf("got %+v", in)
	}
}

func TestBootstrapPg_RefusesWhenRulesExist(t *testing.T) {
	conn := usePgBootstrap(t)
	tenant := datactx.NewID()
	admin := actorIn(t, tenant, access.RoleAdministrator)
	_, err := CreateRoleMapping(admin, map[string]any{"group_match": "their-admins", "group_match_type": "exact", "assigned_role": "administrator", "zone_ids": []any{}})
	check(t, err)
	before := countIn(t, conn, tenant, `SELECT count(*)::int FROM audit_events`)
	res, err := BootstrapAdministratorRule(context.Background(), tenant, access.InstallPrivate, "opendispatch-administrators")
	check(t, err)
	if res.Outcome != BootstrapRulesExist {
		t.Fatalf("got %+v", res)
	}
	rules := countIn(t, conn, tenant, `SELECT count(*)::int FROM role_mappings`)
	after := countIn(t, conn, tenant, `SELECT count(*)::int FROM audit_events`)
	if rules != 1 || after != before {
		t.Fatalf("refusal wrote: %d rules, events %d -> %d", rules, before, after)
	}
}
