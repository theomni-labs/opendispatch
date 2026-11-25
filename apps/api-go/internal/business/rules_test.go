// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors rules.test.ts, fresh in-memory state.
package business

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

func rulesCtx(role access.Role) reqctx.RequestContext {
	return reqctx.RequestContext{
		CustomerID: "11111111-1111-4111-8111-111111111111", UserID: "u-" + string(role),
		Role: role, ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}, InstallMode: access.InstallPrivate,
	}
}

func ruleErrCode(err error) dataerr.Code {
	if de, ok := err.(*dataerr.DataError); ok {
		return de.Code
	}
	return ""
}

var severeVersion = map[string]any{
	"condition":         map[string]any{"match": "all", "predicates": []any{map[string]any{"field": "severity", "operator": "eq", "value": "severe"}}},
	"condition_text_en": "Severity is severe",
	"outcome":           "field_mandatory",
}

func TestRules_ListDeniesNonAdminSupervisor(t *testing.T) {
	ResetRulesForTest()
	admin := rulesCtx(access.RoleAdministrator)
	if _, err := CreateRule(admin, map[string]any{"rule_code": "RULE-091", "name_en": "x", "first_version": severeVersion}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	if _, err := ListRules(rulesCtx(access.RoleDispatchSupervisor), ListRulesQuery{}); err != nil {
		t.Fatalf("supervisor list: %v", err)
	}
	for _, role := range []access.Role{access.RolePlanner, access.RoleDispatcher, access.RoleRemoteTeamLead, access.RoleViewerAuditor, access.RoleChangeApprover} {
		if _, err := ListRules(rulesCtx(role), ListRulesQuery{}); ruleErrCode(err) != dataerr.CodeForbidden {
			t.Fatalf("%s: got %v, want Forbidden", role, err)
		}
	}
}

func TestRules_GetAnswersNotFoundAndInvalid(t *testing.T) {
	ResetRulesForTest()
	admin := rulesCtx(access.RoleAdministrator)
	if _, err := GetRule(admin, "RULE-999"); ruleErrCode(err) != dataerr.CodeNotFound {
		t.Fatalf("got %v, want NotFound", err)
	}
	if _, err := GetRule(admin, "rule-1"); ruleErrCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid", err)
	}
	if _, err := ListRules(admin, ListRulesQuery{Status: "bogus"}); ruleErrCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid", err)
	}
}

func TestRules_DraftSubmitApproveFlow(t *testing.T) {
	ResetRulesForTest()
	admin := rulesCtx(access.RoleAdministrator)
	supervisor := rulesCtx(access.RoleDispatchSupervisor)

	created, err := CreateRule(admin, map[string]any{"rule_code": "RULE-010", "name_en": "Severe: field mandatory", "first_version": severeVersion})
	if err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	if created.Status != "draft" || created.ActiveVersion != nil {
		t.Fatalf("got %+v, want draft/nil active_version", created)
	}
	versions, err := ListRuleVersions(admin, "RULE-010", struct {
		Limit  int
		Cursor string
	}{})
	if err != nil {
		t.Fatalf("ListRuleVersions: %v", err)
	}
	if len(versions.Items) != 1 || versions.Items[0].Status != "draft" {
		t.Fatalf("got %+v, want one draft version", versions.Items)
	}

	if _, err := SubmitRuleVersion(admin, "RULE-010", 1); err != nil {
		t.Fatalf("SubmitRuleVersion: %v", err)
	}
	approved, err := ApproveRuleVersion(supervisor, "RULE-010", 1, map[string]any{"note": "Agreed."})
	if err != nil {
		t.Fatalf("ApproveRuleVersion: %v", err)
	}
	if approved.Status != "active" {
		t.Fatalf("got %s, want active", approved.Status)
	}
	if approved.EffectiveFrom == nil || *approved.EffectiveFrom != "2026-09-13" {
		t.Fatalf("effective_from = %v, want 2026-09-13", approved.EffectiveFrom)
	}
	if approved.DecidedByUserID == nil || *approved.DecidedByUserID != supervisor.UserID {
		t.Fatalf("decided_by_user_id = %v, want %s", approved.DecidedByUserID, supervisor.UserID)
	}
	rule, err := GetRule(admin, "RULE-010")
	if err != nil {
		t.Fatalf("GetRule: %v", err)
	}
	if rule.Status != "active" || rule.ActiveVersion == nil || *rule.ActiveVersion != 1 {
		t.Fatalf("got %+v, want active/1", rule)
	}
}

func TestRules_SupersedesPreviousActiveVersion(t *testing.T) {
	ResetRulesForTest()
	admin := rulesCtx(access.RoleAdministrator)
	supervisor := rulesCtx(access.RoleDispatchSupervisor)

	if _, err := CreateRule(admin, map[string]any{"rule_code": "RULE-092", "name_en": "x", "first_version": severeVersion}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	if _, err := SubmitRuleVersion(admin, "RULE-092", 1); err != nil {
		t.Fatalf("Submit v1: %v", err)
	}
	if _, err := ApproveRuleVersion(supervisor, "RULE-092", 1, map[string]any{}); err != nil {
		t.Fatalf("Approve v1: %v", err)
	}

	next := map[string]any{
		"condition":         severeVersion["condition"],
		"condition_text_en": "Injury present, softened",
		"outcome":           "field_preferred",
	}
	if _, err := CreateRuleVersionDraft(admin, "RULE-092", next); err != nil {
		t.Fatalf("CreateRuleVersionDraft: %v", err)
	}
	if _, err := CreateRuleVersionDraft(admin, "RULE-092", next); ruleErrCode(err) != dataerr.CodeConflict {
		t.Fatalf("second draft: got %v, want Conflict", err)
	}
	if _, err := SubmitRuleVersion(admin, "RULE-092", 2); err != nil {
		t.Fatalf("Submit v2: %v", err)
	}
	if _, err := ApproveRuleVersion(supervisor, "RULE-092", 2, map[string]any{}); err != nil {
		t.Fatalf("Approve v2: %v", err)
	}
	versions, err := ListRuleVersions(admin, "RULE-092", struct {
		Limit  int
		Cursor string
	}{})
	if err != nil {
		t.Fatalf("ListRuleVersions: %v", err)
	}
	if len(versions.Items) != 2 || versions.Items[0].Status != "superseded" || versions.Items[1].Status != "active" {
		t.Fatalf("got %+v, want [superseded active]", versions.Items)
	}
	rule, err := GetRule(admin, "RULE-092")
	if err != nil || rule.ActiveVersion == nil || *rule.ActiveVersion != 2 {
		t.Fatalf("got %+v / %v, want active_version=2", rule, err)
	}
}

func TestRules_RejectLeavesRuleAsDraft(t *testing.T) {
	ResetRulesForTest()
	admin := rulesCtx(access.RoleAdministrator)
	supervisor := rulesCtx(access.RoleDispatchSupervisor)
	if _, err := CreateRule(admin, map[string]any{"rule_code": "RULE-093", "name_en": "x", "first_version": severeVersion}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	if _, err := SubmitRuleVersion(admin, "RULE-093", 1); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	rejected, err := RejectRuleVersion(supervisor, "RULE-093", 1, map[string]any{"note": "Needs more evidence."})
	if err != nil {
		t.Fatalf("Reject: %v", err)
	}
	if rejected.Status != "rejected" || rejected.DecisionNote == nil || *rejected.DecisionNote != "Needs more evidence." {
		t.Fatalf("got %+v", rejected)
	}
	rule, err := GetRule(admin, "RULE-093")
	if err != nil || rule.Status != "draft" {
		t.Fatalf("got %+v / %v, want draft", rule, err)
	}
	if _, err := ApproveRuleVersion(supervisor, "RULE-093", 1, map[string]any{}); ruleErrCode(err) != dataerr.CodeConflict {
		t.Fatalf("approve rejected: got %v, want Conflict", err)
	}
}

func TestRules_RetireCancelsPendingAndEndsActive(t *testing.T) {
	ResetRulesForTest()
	admin := rulesCtx(access.RoleAdministrator)
	supervisor := rulesCtx(access.RoleDispatchSupervisor)
	if _, err := CreateRule(admin, map[string]any{"rule_code": "RULE-091", "name_en": "x", "first_version": severeVersion}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	if _, err := SubmitRuleVersion(admin, "RULE-091", 1); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if _, err := ApproveRuleVersion(supervisor, "RULE-091", 1, map[string]any{}); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if _, err := RetireRule(admin, "RULE-091", map[string]any{"note": "Simple cases need a second look."}); err != nil {
		t.Fatalf("Retire: %v", err)
	}
	rule, err := GetRule(admin, "RULE-091")
	if err != nil || rule.Status != "retired" || rule.ActiveVersion != nil {
		t.Fatalf("got %+v / %v, want retired/nil", rule, err)
	}
	versions, err := ListRuleVersions(admin, "RULE-091", struct {
		Limit  int
		Cursor string
	}{})
	if err != nil || versions.Items[0].Status != "retired" || versions.Items[0].EffectiveTo == nil || *versions.Items[0].EffectiveTo != "2026-09-13" {
		t.Fatalf("got %+v / %v", versions.Items, err)
	}
	if _, err := RetireRule(admin, "RULE-091", map[string]any{}); ruleErrCode(err) != dataerr.CodeConflict {
		t.Fatalf("re-retire: got %v, want Conflict", err)
	}
}

func TestRules_WhoMayDoWhatAndAudits(t *testing.T) {
	ResetRulesForTest()
	admin := rulesCtx(access.RoleAdministrator)
	supervisor := rulesCtx(access.RoleDispatchSupervisor)
	if _, err := CreateRule(admin, map[string]any{"rule_code": "RULE-093", "name_en": "x", "first_version": severeVersion}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	if _, err := CreateRule(supervisor, map[string]any{"rule_code": "RULE-012", "name_en": "x", "first_version": severeVersion}); ruleErrCode(err) != dataerr.CodeForbidden {
		t.Fatalf("supervisor create: got %v, want Forbidden", err)
	}
	if _, err := SubmitRuleVersion(supervisor, "RULE-093", 1); ruleErrCode(err) != dataerr.CodeForbidden {
		t.Fatalf("supervisor submit: got %v, want Forbidden", err)
	}
	if _, err := RetireRule(supervisor, "RULE-091", map[string]any{}); ruleErrCode(err) != dataerr.CodeForbidden {
		t.Fatalf("supervisor retire: got %v, want Forbidden", err)
	}
	if _, err := SubmitRuleVersion(admin, "RULE-093", 1); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if _, err := ApproveRuleVersion(admin, "RULE-093", 1, map[string]any{}); ruleErrCode(err) != dataerr.CodeForbidden {
		t.Fatalf("admin approve: got %v, want Forbidden", err)
	}
	rule, err := GetRule(admin, "RULE-093")
	if err != nil || rule.Status != "draft" {
		t.Fatalf("got %+v / %v, want still draft", rule, err)
	}
	for _, role := range []access.Role{access.RolePlanner, access.RoleDispatcher, access.RoleRemoteTeamLead, access.RoleViewerAuditor, access.RoleChangeApprover} {
		if _, err := ApproveRuleVersion(rulesCtx(role), "RULE-093", 1, map[string]any{}); ruleErrCode(err) != dataerr.CodeForbidden {
			t.Fatalf("%s approve: got %v, want Forbidden", role, err)
		}
		if _, err := CreateRule(rulesCtx(role), map[string]any{"rule_code": "RULE-013", "name_en": "x", "first_version": severeVersion}); ruleErrCode(err) != dataerr.CodeForbidden {
			t.Fatalf("%s create: got %v, want Forbidden", role, err)
		}
	}
}

func TestRules_NobodyApprovesOwnSubmission(t *testing.T) {
	ResetRulesForTest()
	admin := rulesCtx(access.RoleAdministrator)
	supervisor := rulesCtx(access.RoleDispatchSupervisor)
	if _, err := CreateRule(supervisor, map[string]any{"rule_code": "RULE-093", "name_en": "x", "first_version": severeVersion}); err == nil {
		t.Fatalf("expected supervisor create to be forbidden (setup check)")
	}
	if _, err := CreateRule(admin, map[string]any{"rule_code": "RULE-093", "name_en": "x", "first_version": severeVersion}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	if _, err := SubmitRuleVersion(supervisor, "RULE-093", 1); ruleErrCode(err) != dataerr.CodeForbidden {
		t.Fatalf("setup: supervisor cannot submit, got %v", err)
	}
	// Submit as admin, approve as the same person.
	if _, err := SubmitRuleVersion(admin, "RULE-093", 1); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	// admin's own user id, different role: own_request.
	selfCtx := reqctx.RequestContext{CustomerID: admin.CustomerID, UserID: admin.UserID, Role: access.RoleDispatchSupervisor, ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}, InstallMode: access.InstallPrivate}
	if _, err := ApproveRuleVersion(selfCtx, "RULE-093", 1, map[string]any{}); ruleErrCode(err) != dataerr.CodeForbidden {
		t.Fatalf("own request: got %v, want Forbidden", err)
	}
	rule, err := GetRule(admin, "RULE-093")
	if err != nil || rule.Status != "draft" {
		t.Fatalf("got %+v / %v, want still draft", rule, err)
	}
}

func TestRules_RefusesInvalidBodyShapes(t *testing.T) {
	ResetRulesForTest()
	admin := rulesCtx(access.RoleAdministrator)
	if _, err := CreateRule(admin, map[string]any{"rule_code": "RULE-1", "name_en": "x", "first_version": severeVersion}); ruleErrCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad code: got %v, want Invalid", err)
	}
	bad := map[string]any{
		"condition":         severeVersion["condition"],
		"condition_text_en": "x",
		"outcome":           "maybe",
	}
	if _, err := CreateRule(admin, map[string]any{"rule_code": "RULE-014", "name_en": "x", "first_version": bad}); ruleErrCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad outcome: got %v, want Invalid", err)
	}
	empty := map[string]any{
		"condition":         map[string]any{"match": "all", "predicates": []any{}},
		"condition_text_en": "x",
		"outcome":           "field_preferred",
	}
	if _, err := CreateRule(admin, map[string]any{"rule_code": "RULE-014", "name_en": "x", "first_version": empty}); ruleErrCode(err) != dataerr.CodeInvalid {
		t.Fatalf("empty predicates: got %v, want Invalid", err)
	}
	if _, err := CreateRule(admin, map[string]any{"rule_code": "RULE-091", "name_en": "x", "first_version": severeVersion}); err != nil {
		t.Fatalf("seed RULE-091: %v", err)
	}
	if _, err := CreateRule(admin, map[string]any{"rule_code": "RULE-091", "name_en": "x", "first_version": severeVersion}); ruleErrCode(err) != dataerr.CodeConflict {
		t.Fatalf("dup code: got %v, want Conflict", err)
	}
}

func TestRules_CraftedRuleCodesAndVersions(t *testing.T) {
	ResetRulesForTest()
	admin := rulesCtx(access.RoleAdministrator)
	if _, err := CreateRule(admin, map[string]any{"rule_code": "RULE-093", "name_en": "x", "first_version": severeVersion}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	junk := []any{42, true, nil, []any{"RULE-091"}, map[string]any{}}
	for _, code := range junk {
		if _, err := GetRule(admin, code); ruleErrCode(err) != dataerr.CodeInvalid {
			t.Fatalf("GetRule(%v): got %v, want Invalid", code, err)
		}
		if _, err := CreateRuleVersionDraft(admin, code, map[string]any{}); ruleErrCode(err) != dataerr.CodeInvalid {
			t.Fatalf("CreateRuleVersionDraft(%v): got %v, want Invalid", code, err)
		}
	}
	approver := rulesCtx(access.RoleDispatchSupervisor)
	for _, version := range []any{0, -1, 1.5, "1", nil, map[string]any{}} {
		if _, err := ApproveRuleVersion(approver, "RULE-093", version, map[string]any{}); ruleErrCode(err) != dataerr.CodeInvalid {
			t.Fatalf("version %v: got %v, want Invalid", version, err)
		}
	}
}
