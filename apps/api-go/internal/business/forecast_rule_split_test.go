// SPDX-License-Identifier: AGPL-3.0-only

// Approved rules move the next run.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

const ruleSplitDate = "2026-09-14"

// seedRuleSplit: learned 2 of 10 field, 4 cases.
func seedRuleSplit(t *testing.T) ForecastRun {
	t.Helper()
	resetForecastDeps()
	SeedFieldShareZonesForTest([]string{splitZone})
	SeedForecastSubZonesForTest([]ForecastSubZoneSeed{{ID: "sz-a", NameEn: "Alpha"}})
	ruleSet := "rules-learned"
	run := ForecastRun{BaseRecord: bd(runValuesID, "t1"), Status: "succeeded", HorizonStartDate: ruleSplitDate, HorizonDays: 1, ModelVersion: "other", RuleSetVersion: &ruleSet}
	UpsertForecastRunForTest(run)
	SeedForecastValuesForTest([]ForecastValue{
		{BaseRecord: bd("v-a0", "t1"), ForecastRunID: run.ID, ZoneID: splitZone, SubZoneID: "sz-a", IntervalStart: ruleSplitDate + "T00:00:00+03:00", IntervalIndex: 0, Expected: 10, FieldExpected: 2, RemoteInferredExpected: 8},
	})
	SeedCaseTypesForTest([]CaseType{{ID: "ct1", NameEn: "Collision"}})
	var cases []Case
	for i, parties := range []int{1, 1, 4, 4} {
		cases = append(cases, Case{ID: string(rune('a' + i)), ZoneID: splitZone, CaseTypeID: "ct1", PartiesInvolved: parties, RegisteredAt: "2026-09-06T10:00:00+03:00"})
	}
	SeedCasesForTest(cases)
	upsertRuleRow(ClassificationRule{RuleCode: "RULE-X", Status: "draft"})
	upsertVersionRow(RuleVersion{
		BaseRecord: bd("vx", "t1"), RuleCode: "RULE-X", Version: 1, Outcome: "field_mandatory", Status: "draft",
		Condition: RuleCondition{Match: "all", Predicates: []RulePredicate{{Field: "parties_involved", Operator: "gte", Value: 4}}},
	})
	return run
}

// approveRuleX: active from the 13th, decided now.
func approveRuleX(t *testing.T) {
	t.Helper()
	now := datactx.NowISO()
	v := RuleVersion{
		BaseRecord: bd("vx", "t1"), RuleCode: "RULE-X", Version: 1, Outcome: "field_mandatory", Status: "active",
		EffectiveFrom: strp("2026-09-13"), DecidedAt: &now,
		Condition: RuleCondition{Match: "all", Predicates: []RulePredicate{{Field: "parties_involved", Operator: "gte", Value: 4}}},
	}
	v.UpdatedAt = now
	upsertVersionRow(v)
	upsertRuleRow(ClassificationRule{RuleCode: "RULE-X", Status: "active"})
}

func learnedDoc() ForecasterEngineOutput {
	return ForecasterEngineOutput{Values: []EngineValue{{ZoneID: splitZone, SubZoneID: "sz-a", IntervalStart: ruleSplitDate + "T00:00:00+03:00", Expected: 10, FieldExpected: 2, RemoteInferredExpected: 8}}}
}

func placeholderField(t *testing.T) (float64, bool) {
	t.Helper()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	values, err := placeholderRuleValues(context.Background(), admin, ruleSplitDate)
	check(t, err)
	if values == nil {
		return 0, false
	}
	var field float64
	for _, v := range values {
		field += v.FieldExpected
	}
	return field, true
}

func TestRuleSplit_NoRuleChangeKeepsTheLearnedSplit(t *testing.T) {
	seedRuleSplit(t)
	doc := learnedDoc()
	check(t, applyRulesToForecast(context.Background(), "t1", &doc))
	if v := doc.Values[0]; v.FieldExpected != 2 || v.RemoteInferredExpected != 8 {
		t.Fatalf("got %+v, want the learned 2 and 8 exactly", v)
	}
	if field, stored := placeholderField(t); stored {
		t.Fatalf("got stored values (field %v), want the reference split borrowed as before", field)
	}
}

func TestRuleSplit_AnApprovedRuleMovesTheNextRunToField(t *testing.T) {
	seedRuleSplit(t)
	approveRuleX(t)
	doc := learnedDoc()
	check(t, applyRulesToForecast(context.Background(), "t1", &doc))
	// two of four cases move from 0.5 to 1: +0.25
	if v := doc.Values[0]; !near(v.FieldExpected, 4.5) || !near(v.RemoteInferredExpected, 5.5) {
		t.Fatalf("engine: got %+v, want 4.5 field and 5.5 remote", v)
	}
	field, stored := placeholderField(t)
	if !stored || !near(field, 4.5) {
		t.Fatalf("placeholder: got %v (stored %v), want 4.5", field, stored)
	}
}

func TestRuleSplit_ThePreviewIsTheRunWithTheDraft(t *testing.T) {
	seedRuleSplit(t)
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	split, err := GetForecastSplit(admin, ForecastSplitQuery{Date: ruleSplitDate, RuleVersionID: "vx"})
	check(t, err)
	preview := split.Zones[0]
	approveRuleX(t)
	doc := learnedDoc()
	check(t, applyRulesToForecast(context.Background(), "t1", &doc))
	field, _ := placeholderField(t)
	if !near(preview.FieldExpected, doc.Values[0].FieldExpected) || !near(preview.FieldExpected, field) {
		t.Fatalf("preview %v, engine run %v, placeholder run %v: want all equal", preview.FieldExpected, doc.Values[0].FieldExpected, field)
	}
}

func TestRuleSplit_ARuleKnownBeforeTheHistoryIsAlreadyLearned(t *testing.T) {
	seedRuleSplit(t)
	old := "2026-07-28T09:30:00+03:00"
	upsertVersionRow(RuleVersion{
		BaseRecord: bd("vx", "t1"), RuleCode: "RULE-X", Version: 1, Outcome: "field_mandatory", Status: "active",
		EffectiveFrom: strp("2026-08-01"), DecidedAt: &old,
		Condition: RuleCondition{Match: "all", Predicates: []RulePredicate{{Field: "parties_involved", Operator: "gte", Value: 4}}},
	})
	upsertRuleRow(ClassificationRule{RuleCode: "RULE-X", Status: "active"})
	doc := learnedDoc()
	check(t, applyRulesToForecast(context.Background(), "t1", &doc))
	if v := doc.Values[0]; v.FieldExpected != 2 {
		t.Fatalf("got %+v, want the learned split: the history already reflects the rule", v)
	}
}
