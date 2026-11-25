// SPDX-License-Identifier: AGPL-3.0-only

// Live: rules, versions and approvals in Postgres.
package business

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func usePgRules(t *testing.T) *tenancy.Connection {
	t.Helper()
	conn := openConn(t)
	UsePostgresUsers(conn)
	UsePostgresRules(conn)
	t.Cleanup(func() {
		UseMemoryUsers()
		UseMemoryRules()
	})
	return conn
}

// actorIn: a request context whose user exists in the users table (decided_by is a foreign key).
func actorIn(t *testing.T, tenantID string, role access.Role) reqctx.RequestContext {
	t.Helper()
	id := datactx.NewID()
	at := datactx.NowISO()
	check(t, saveUser(context.Background(), User{
		BaseRecord: datactx.BaseRecord{ID: id, TenantID: tenantID, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
		Email:      id + "@example.com", DisplayName: string(role), AssignedRole: role, ZoneIDs: []string{}, Status: "active", PreferredLocale: "en",
	}))
	return roleCtx(tenantID, id, role)
}

func countIn(t *testing.T, conn *tenancy.Connection, tenantID, sql string, args ...any) int {
	t.Helper()
	n, err := tenancy.WithTenant(context.Background(), conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (int, error) {
		var n int
		return n, tx.QueryRow(ctx, sql, args...).Scan(&n)
	})
	check(t, err)
	return n
}

func TestRulesPg_DraftSubmitApproveSupersedeAndRetire(t *testing.T) {
	conn := usePgRules(t)
	tenant := datactx.NewID()
	admin := actorIn(t, tenant, access.RoleAdministrator)
	approver := actorIn(t, tenant, access.RoleDispatchSupervisor)

	rule, err := CreateRule(admin, map[string]any{"rule_code": "RULE-701", "name_en": "Severe", "first_version": severeVersion})
	check(t, err)
	if rule.Status != "draft" || countIn(t, conn, tenant, `SELECT count(*) FROM rule_versions WHERE rule_code = 'RULE-701'`) != 1 {
		t.Fatalf("draft not stored: %+v", rule)
	}

	_, err = CreateRule(admin, map[string]any{"rule_code": "RULE-701", "name_en": "Again", "first_version": severeVersion})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("duplicate code: got %v, want Conflict", err)
	}

	_, err = SubmitRuleVersion(admin, "RULE-701", 1)
	check(t, err)
	if countIn(t, conn, tenant, `SELECT count(*) FROM approvals WHERE status = 'pending'`) != 1 {
		t.Fatal("the pending approval must be in the approvals table")
	}

	approved, err := ApproveRuleVersion(approver, "RULE-701", 1, map[string]any{"note": "ok"})
	check(t, err)
	if approved.Status != "active" || approved.DecidedByUserID == nil || *approved.DecidedByUserID != approver.UserID {
		t.Fatalf("got %+v", approved)
	}
	got, err := GetRule(admin, "RULE-701")
	check(t, err)
	if got.Status != "active" || got.ActiveVersion == nil || *got.ActiveVersion != 1 {
		t.Fatalf("got %+v", got)
	}

	_, err = CreateRuleVersionDraft(admin, "RULE-701", severeVersion)
	check(t, err)
	_, err = SubmitRuleVersion(admin, "RULE-701", 2)
	check(t, err)
	_, err = ApproveRuleVersion(approver, "RULE-701", 2, map[string]any{})
	check(t, err)
	versions, err := ListRuleVersions(admin, "RULE-701", datactx.PageQuery{})
	check(t, err)
	if len(versions.Items) != 2 || versions.Items[0].Status != "superseded" || versions.Items[0].EffectiveTo == nil || versions.Items[1].Status != "active" {
		t.Fatalf("v1 must be superseded and v2 active, got %+v", versions.Items)
	}

	retired, err := RetireRule(admin, "RULE-701", map[string]any{"note": "gone"})
	check(t, err)
	if retired.Status != "retired" || retired.ActiveVersion != nil {
		t.Fatalf("got %+v", retired)
	}
	if countIn(t, conn, tenant, `SELECT count(*) FROM rule_versions WHERE status = 'retired'`) != 1 {
		t.Fatal("the active version must end retired in the table")
	}
}

func TestRulesPg_TenantsNeverSeeEachOther(t *testing.T) {
	usePgRules(t)
	tenantA, tenantB := datactx.NewID(), datactx.NewID()
	a := actorIn(t, tenantA, access.RoleAdministrator)
	b := actorIn(t, tenantB, access.RoleAdministrator)
	_, err := CreateRule(a, map[string]any{"rule_code": "RULE-702", "name_en": "A only", "first_version": severeVersion})
	check(t, err)
	if _, err := GetRule(b, "RULE-702"); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("tenant B must not see it: got %v", err)
	}
	page, err := ListRules(b, ListRulesQuery{})
	check(t, err)
	if len(page.Items) != 0 {
		t.Fatalf("tenant B sees %+v", page.Items)
	}
	// The same code is free in the other tenant.
	_, err = CreateRule(b, map[string]any{"rule_code": "RULE-702", "name_en": "B", "first_version": severeVersion})
	check(t, err)
}

func TestRulesPg_AWriteIsAllOrNothing(t *testing.T) {
	conn := usePgRules(t)
	tenant := datactx.NewID()
	rc := actorIn(t, tenant, access.RoleAdministrator)
	at := datactx.NowISO()
	rule := ClassificationRule{BaseRecord: datactx.NewRecord(rc, "", at), RuleCode: "RULE-703", NameEn: "Half", Status: "draft"}
	orphan := RuleVersion{BaseRecord: datactx.NewRecord(rc, "", at), RuleID: datactx.NewID(), RuleCode: "RULE-703", Version: 1,
		Condition: RuleCondition{Match: "all", Predicates: []RulePredicate{}}, ConditionTextEn: "x", Outcome: "field_mandatory", Status: "draft"}
	var w ruleWrites
	w.rule(rule)
	w.version(orphan) // its rule_id points at no rule: the foreign key refuses it
	if err := w.commit(context.Background(), tenant); err == nil {
		t.Fatal("the orphan version must be refused")
	}
	if countIn(t, conn, tenant, `SELECT count(*) FROM classification_rules`) != 0 {
		t.Fatal("the rule written before the failure must have been rolled back")
	}
}

func TestRulesPg_ApprovalsAreSharedWithOtherDomains(t *testing.T) {
	usePgRules(t)
	tenant := datactx.NewID()
	rc := actorIn(t, tenant, access.RoleAdministrator)
	at := datactx.NowISO()
	subject := datactx.NewID()
	check(t, openApproval(context.Background(), rc, "roster", subject, "Roster for Zone X", at))
	pending, err := pendingApprovalFor(context.Background(), tenant, "roster", subject)
	check(t, err)
	if pending == nil || pending.Status != "pending" || pending.SubjectType != "roster" {
		t.Fatalf("got %+v", pending)
	}
	other, err := pendingApprovalFor(context.Background(), datactx.NewID(), "roster", subject)
	check(t, err)
	if other != nil {
		t.Fatal("another tenant must not see the approval")
	}
}

func TestRulesPg_NoTenantSetFailsOnTheRuleTables(t *testing.T) {
	conn := usePgRules(t)
	for _, table := range []string{"classification_rules", "rule_versions", "approvals"} {
		var n int
		if conn.Pool.QueryRow(context.Background(), `SELECT count(*) FROM `+table).Scan(&n) == nil {
			t.Fatalf("%s: a query with no tenant set must fail", table)
		}
	}
}
