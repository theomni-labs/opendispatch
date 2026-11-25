// SPDX-License-Identifier: AGPL-3.0-only

// Field share: classification and weights.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func resetFieldShareDeps() {
	ResetForecastCoreForTest()
	ResetFieldShareForTest()
	ResetRulesForTest()
}

func TestHolds_NumericCrossTypeComparison(t *testing.T) {
	// int vs. JSON float64: eq/gte must compare
	// numerically, not by Go's own type.
	if !holds(3, "eq", 3.0) {
		t.Fatalf("int 3 should eq float64 3.0")
	}
	if !holds(3, "gte", 3.0) {
		t.Fatalf("int 3 should be gte float64 3.0")
	}
	if holds(nil, "eq", 3.0) {
		t.Fatalf("nil actual should never hold")
	}
	if !holds("a", "in", []any{"a", "b"}) {
		t.Fatalf("'a' should be in [a, b]")
	}
}

func TestCaseAttributes_ComputesFlagsFromExtra(t *testing.T) {
	c := Case{PartiesInvolved: 3, Extra: map[string]any{"pedestrian_involved": true}}
	attrs := caseAttributes(c, "Collision")
	if attrs["multi_vehicle"] != true {
		t.Fatalf("3 parties should be multi_vehicle")
	}
	if attrs["pedestrian_involved"] != true {
		t.Fatalf("got %v, want pedestrian_involved true", attrs["pedestrian_involved"])
	}
	if attrs["highway_or_outside_city_limits"] != false {
		t.Fatalf("got %v, want highway flag false (absent from extra)", attrs["highway_or_outside_city_limits"])
	}
	if attrs["case_type"] != "Collision" {
		t.Fatalf("got %v, want case_type Collision", attrs["case_type"])
	}
}

func TestClassifyCase_PrecedenceAndDefault(t *testing.T) {
	versions := []RuleVersion{
		{RuleCode: "RULE-001", Outcome: "remote_eligible", Condition: RuleCondition{Match: "all", Predicates: []RulePredicate{{Field: "multi_vehicle", Operator: "eq", Value: false}}}},
		{RuleCode: "RULE-002", Outcome: "field_mandatory", Condition: RuleCondition{Match: "all", Predicates: []RulePredicate{{Field: "multi_vehicle", Operator: "eq", Value: false}}}},
	}
	attrs := map[string]any{"multi_vehicle": false}
	got := classifyCase(attrs, versions, defaultPrecedence, "field_preferred")
	if got != "field_mandatory" {
		t.Fatalf("got %q, want field_mandatory (precedence wins over remote_eligible)", got)
	}
	none := classifyCase(map[string]any{"multi_vehicle": true}, versions, defaultPrecedence, "field_preferred")
	if none != "field_preferred" {
		t.Fatalf("got %q, want the default when nothing matches", none)
	}
}

func TestClassifyCase_MatchAnyAndMissingValue(t *testing.T) {
	anyRule := []RuleVersion{{RuleCode: "RULE-001", Outcome: "remote_eligible", Condition: RuleCondition{Match: "any", Predicates: []RulePredicate{
		{Field: "a", Operator: "eq", Value: 1.0},
		{Field: "b", Operator: "in", Value: []any{"x", "y"}},
	}}}}
	if got := classifyCase(map[string]any{"b": "y"}, anyRule, defaultPrecedence, "field_preferred"); got != "remote_eligible" {
		t.Fatalf("got %q, want remote_eligible (one predicate of any)", got)
	}
	if got := classifyCase(map[string]any{"a": 2.0, "b": "z"}, anyRule, defaultPrecedence, "field_preferred"); got != "field_preferred" {
		t.Fatalf("got %q, want field_preferred (no predicate holds)", got)
	}
	if got := classifyCase(map[string]any{}, nil, defaultPrecedence, "field_preferred"); got != "field_preferred" {
		t.Fatalf("got %q, want the default with no rules", got)
	}
}

func TestGetFieldShare_ClassifiesAndWeighsCases(t *testing.T) {
	resetFieldShareDeps()
	SeedFieldShareZonesForTest([]string{"z1"})
	SeedCaseTypesForTest([]CaseType{{ID: "ct1", NameEn: "Collision"}})
	SeedCasesForTest([]Case{
		{ZoneID: "z1", CaseTypeID: "ct1", PartiesInvolved: 1},
		{ZoneID: "z1", CaseTypeID: "ct1", PartiesInvolved: 4},
	})
	upsertRuleRow(ClassificationRule{RuleCode: "RULE-001", Status: "active"})
	upsertVersionRow(RuleVersion{
		BaseRecord: bd("v1", "t1"), RuleCode: "RULE-001", Version: 1, Outcome: "field_mandatory", Status: "active",
		EffectiveFrom: strp("2026-01-01"),
		Condition:     RuleCondition{Match: "all", Predicates: []RulePredicate{{Field: "multi_vehicle", Operator: "eq", Value: true}}},
	})
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	result, err := getFieldShare(context.Background(), admin, FieldShareOptions{Date: "2026-09-14"})
	check(t, err)
	if len(result.Zones) != 1 || result.Zones[0].CaseCount != 2 {
		t.Fatalf("got %+v, want 1 zone with 2 cases", result.Zones)
	}
	share := result.Zones[0].FieldShare
	// one case defaults to field_preferred (0.5), the
	// other matches field_mandatory (1.0): avg 0.75.
	if share == nil || *share != 0.75 {
		t.Fatalf("got %v, want 0.75", share)
	}
}

func TestGetFieldShare_RefusesARoleWithNoForecastExplorerAccess(t *testing.T) {
	resetFieldShareDeps()
	SeedFieldShareZonesForTest([]string{"z1"})
	approver := roleCtx("t1", "u1", access.RoleChangeApprover)
	_, err := getFieldShare(context.Background(), approver, FieldShareOptions{Date: "2026-09-14"})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden (change_approver has no view access)", err)
	}
}
