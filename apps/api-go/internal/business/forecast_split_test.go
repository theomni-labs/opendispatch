// SPDX-License-Identifier: AGPL-3.0-only

// A run keeps its stored split; rules preview.
package business

import (
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
)

const splitZone = "5b1c7f1e-0000-4000-8000-000000000001"

func seedSplitRun(t *testing.T) ForecastRun {
	t.Helper()
	resetForecastDeps()
	SeedFieldShareZonesForTest([]string{splitZone})
	SeedForecastSubZonesForTest([]ForecastSubZoneSeed{{ID: "sz-a", NameEn: "Alpha"}})
	ruleSet := "rules-stored"
	run := ForecastRun{BaseRecord: bd(runValuesID, "t1"), Status: "succeeded", HorizonStartDate: "2026-09-14", ModelVersion: "other", RuleSetVersion: &ruleSet}
	UpsertForecastRunForTest(run)
	SeedForecastValuesForTest([]ForecastValue{
		{BaseRecord: bd("v-a0", "t1"), ForecastRunID: run.ID, ZoneID: splitZone, SubZoneID: "sz-a", IntervalStart: "2026-09-14T00:00:00+03:00", IntervalIndex: 0, Expected: 10, FieldExpected: 2, RemoteInferredExpected: 8},
	})
	SeedCaseTypesForTest([]CaseType{{ID: "ct1", NameEn: "Collision"}})
	SeedCasesForTest([]Case{{ZoneID: splitZone, CaseTypeID: "ct1", PartiesInvolved: 1}, {ZoneID: splitZone, CaseTypeID: "ct1", PartiesInvolved: 4}})
	upsertRuleRow(ClassificationRule{RuleCode: "RULE-001", Status: "active"})
	return run
}

func ruleVersion(id, outcome, status string) RuleVersion {
	return RuleVersion{
		BaseRecord: bd(id, "t1"), RuleCode: "RULE-001", Version: 1, Outcome: outcome, Status: status,
		EffectiveFrom: strp("2026-01-01"),
		Condition:     RuleCondition{Match: "any", Predicates: []RulePredicate{{Field: "parties_involved", Operator: "gte", Value: 1}}},
	}
}

func TestForecastSplit_EditingActiveRulesLeavesTheRunsSplitAlone(t *testing.T) {
	run := seedSplitRun(t)
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	read := func() (ForecastSplitZone, string) {
		split, err := GetForecastSplit(admin, ForecastSplitQuery{Date: "2026-09-14"})
		check(t, err)
		return split.Zones[0], split.RuleSetVersion
	}
	before, version := read()
	if before.FieldExpected != 2 || before.RemoteInferredExpected != 8 || version != "rules-stored" {
		t.Fatalf("got %+v %q, want the stored 2 and 8 under the run's rule set", before, version)
	}
	upsertVersionRow(ruleVersion("v1", "field_mandatory", "active"))
	after, version := read()
	if after.FieldExpected != before.FieldExpected || after.RemoteInferredExpected != before.RemoteInferredExpected || version != "rules-stored" {
		t.Fatalf("got %+v %q after a rule went active, want %+v unchanged", after, version, before)
	}
	page, err := ListForecastValues(admin, ForecastValueQuery{RunID: run.ID, Date: "2026-09-14"})
	check(t, err)
	if page.Items[0].FieldExpected != 2 || page.Items[0].RemoteInferredExpected != 8 {
		t.Fatalf("got %+v, want the stored split on the value rows", page.Items[0])
	}
	timeline, err := GetForecastTimeline(admin, ForecastTimelineQuery{ZoneID: splitZone, Date: "2026-09-14", RunID: run.ID})
	check(t, err)
	if timeline.Intervals[0].FieldExpected != 2 || timeline.Intervals[0].RemoteInferredExpected != 8 {
		t.Fatalf("got %+v, want the stored split on the timeline", timeline.Intervals[0])
	}
}

func TestForecastSplit_DraftPreviewUsesTheRulesAndSaysSo(t *testing.T) {
	seedSplitRun(t)
	upsertVersionRow(ruleVersion("v1", "remote_eligible", "draft"))
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	split, err := GetForecastSplit(admin, ForecastSplitQuery{Date: "2026-09-14", RuleVersionID: "v1"})
	check(t, err)
	zone := split.Zones[0]
	if zone.FieldExpected != 0 || zone.RemoteInferredExpected != 10 {
		t.Fatalf("got %+v, want the draft's all-remote split of the 10 expected", zone)
	}
	if !strings.HasPrefix(split.RuleSetVersion, "preview-") {
		t.Fatalf("got %q, want a preview label", split.RuleSetVersion)
	}
}
