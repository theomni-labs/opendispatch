// SPDX-License-Identifier: AGPL-3.0-only

// Rule criteria and live classification.
package business

import (
	"context"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func pred(field, op string, value any) RulePredicate {
	return RulePredicate{Field: field, Operator: op, Value: value}
}

func ruleOn(code, outcome string, preds ...RulePredicate) RuleVersion {
	from := "2026-01-01"
	return RuleVersion{RuleCode: code, Version: 1, Outcome: outcome, Status: "active", EffectiveFrom: &from,
		Condition: RuleCondition{Match: "all", Predicates: preds}}
}

// seedRules: active rules, memory store.
func seedRules(versions ...RuleVersion) {
	rulesMu.Lock()
	defer rulesMu.Unlock()
	rulesStore, versionStore, approvalStore = nil, nil, nil
	for _, v := range versions {
		ar := "قاعدة " + v.RuleCode
		rulesStore = append(rulesStore, ClassificationRule{RuleCode: v.RuleCode, NameEn: "Rule " + v.RuleCode, NameAr: &ar, Status: "active"})
		versionStore = append(versionStore, v)
	}
	rulesSeeded = true
}

func vp[T any](v T) *T { return &v }

func criteriaCase() Case {
	return Case{
		RegisteredAt: "2026-09-13T10:00:00+03:00", PartiesInvolved: 2, Severity: vp("minor"), InjuryPresent: vp(false), EstimatedDamageSar: vp(4200.0),
		Extra: map[string]any{"claim_value_sar": 5100.0, "damage_assessment_method": "photo", "location_type": "dense_urban", "customer_preference": "remote"},
	}
}

func TestCaseAttributes_NewCriteria(t *testing.T) {
	attrs := caseAttributes(criteriaCase(), "Standard case")
	want := map[string]any{"severity": "minor", "claim_value_sar": 5100.0, "damage_assessment_method": "photo", "location_type": "dense_urban", "customer_preference": "remote"}
	for k, v := range want {
		if attrs[k] != v {
			t.Fatalf("%s: got %v, want %v", k, attrs[k], v)
		}
	}
	if attrs["customer_requests_field_attendance"] != false || attrs["highway_or_outside_city_limits"] != false {
		t.Fatalf("derived flags: got %v", attrs)
	}
	c := criteriaCase()
	c.Extra["customer_preference"], c.Extra["location_type"] = "field", "highway"
	attrs = caseAttributes(c, "Standard case")
	if attrs["customer_requests_field_attendance"] != true || attrs["highway_or_outside_city_limits"] != true {
		t.Fatalf("a field preference and a highway should set the flags: got %v", attrs)
	}
	c.Extra[liveClassificationKey] = map[string]any{"outcome": "field_mandatory"}
	if _, ok := caseAttributes(c, "")[liveClassificationKey]; ok {
		t.Fatalf("the stored classification is not a criterion")
	}
}

// One rule per new criterion: holds, then not.
func TestDecideCase_EachNewCriterion(t *testing.T) {
	cases := []struct {
		name  string
		pred  RulePredicate
		other func(*Case)
	}{
		{"severity", pred("severity", "eq", "minor"), func(c *Case) { c.Severity = vp("severe") }},
		{"severity in", pred("severity", "in", []any{"minor", "moderate"}), func(c *Case) { c.Severity = vp("severe") }},
		{"claim value", pred("claim_value_sar", "lt", 8000.0), func(c *Case) { c.Extra["claim_value_sar"] = 25000.0 }},
		{"damage assessment", pred("damage_assessment_method", "in", []any{"photo", "video"}), func(c *Case) { c.Extra["damage_assessment_method"] = "in_person" }},
		{"location type", pred("location_type", "eq", "dense_urban"), func(c *Case) { c.Extra["location_type"] = "rural" }},
		{"customer preference", pred("customer_preference", "eq", "remote"), func(c *Case) { c.Extra["customer_preference"] = "none" }},
		{"missing value", pred("claim_value_sar", "lt", 8000.0), func(c *Case) { delete(c.Extra, "claim_value_sar") }},
	}
	for _, tc := range cases {
		versions := []RuleVersion{ruleOn("RULE-X", "remote_eligible", tc.pred)}
		c := criteriaCase()
		outcome, rule := decideCase(caseAttributes(c, "Standard case"), versions, defaultPrecedence, "field_preferred")
		if outcome != "remote_eligible" || rule == nil || rule.RuleCode != "RULE-X" {
			t.Fatalf("%s: got %s %v, want remote_eligible by RULE-X", tc.name, outcome, rule)
		}
		tc.other(&c)
		outcome, rule = decideCase(caseAttributes(c, "Standard case"), versions, defaultPrecedence, "field_preferred")
		if outcome != "field_preferred" || rule != nil {
			t.Fatalf("%s: got %s %v, want the default and no rule", tc.name, outcome, rule)
		}
	}
}

func TestDecideCase_NamesTheDecidingRule(t *testing.T) {
	versions := []RuleVersion{
		ruleOn("RULE-020", "remote_eligible", pred("severity", "eq", "minor")),
		ruleOn("RULE-011", "field_mandatory", pred("location_type", "eq", "dense_urban")),
		ruleOn("RULE-010", "field_mandatory", pred("damage_assessment_method", "eq", "photo")),
	}
	outcome, rule := decideCase(caseAttributes(criteriaCase(), ""), versions, defaultPrecedence, "field_preferred")
	if outcome != "field_mandatory" || rule == nil || rule.RuleCode != "RULE-010" {
		t.Fatalf("got %s %v, want field_mandatory by RULE-010 (precedence, then lowest code)", outcome, rule)
	}
}

func TestLiveClassifier_FeedHandlingAndSetting(t *testing.T) {
	settingsstore.ResetForTest()
	ResetForecastCoreForTest()
	seedRules(ruleOn("RULE-030", "remote_eligible", pred("customer_preference", "eq", "remote")))
	defer ResetRulesForTest()
	ctx := context.Background()
	tenant := datactx.NewID()

	l, err := newLiveClassifier(ctx, tenant)
	check(t, err)
	got := l.classify(criteriaCase(), "Standard case", "", "2026-09-13T10:00:05+03:00")
	if got.Handling != "remote_inferred" || got.Source != LiveHandlingRules || got.Outcome != "remote_eligible" {
		t.Fatalf("no feed handling: got %+v, want remote by the rules", got)
	}
	if got.RuleCode == nil || *got.RuleCode != "RULE-030" || got.RuleNameEn == nil || *got.RuleNameEn != "Rule RULE-030" || got.RuleNameAr == nil {
		t.Fatalf("got %+v, want RULE-030 and its names", got)
	}
	if got.RuleSetVersion == "" || got.RuleSetVersion == "rules-none" {
		t.Fatalf("got rule set %q, want a signature", got.RuleSetVersion)
	}
	got = l.classify(criteriaCase(), "Standard case", "field", "")
	if got.Handling != "field" || got.Source != LiveHandlingFeed || got.FeedHandling == nil || got.Outcome != "remote_eligible" {
		t.Fatalf("feed handling under the default: got %+v, want the feed's field, rule outcome kept", got)
	}

	check(t, settingsstore.Put(ctx, tenant, liveHandlingSourceKey, LiveHandlingRules))
	l, err = newLiveClassifier(ctx, tenant)
	check(t, err)
	got = l.classify(criteriaCase(), "Standard case", "field", "")
	if got.Handling != "remote_inferred" || got.Source != LiveHandlingRules || *got.FeedHandling != "field" {
		t.Fatalf("setting rules: got %+v, want the rules to win and the feed's value kept", got)
	}
}

func TestLiveClassifier_StoredRecordRoundTrip(t *testing.T) {
	settingsstore.ResetForTest()
	seedRules(ruleOn("RULE-030", "remote_eligible", pred("customer_preference", "eq", "remote")))
	defer ResetRulesForTest()
	l, err := newLiveClassifier(context.Background(), datactx.NewID())
	check(t, err)
	first := l.classify(criteriaCase(), "Standard case", "", "2026-09-13T10:00:05+03:00")
	c := criteriaCase()
	c.Handling = first.Handling
	c.Extra[liveClassificationKey] = jsonRound(t, first.record())
	seedRules()
	l2, err := newLiveClassifier(context.Background(), datactx.NewID())
	check(t, err)
	got := l2.of(c, "later")
	if got.Outcome != first.Outcome || *got.RuleCode != "RULE-030" || *got.RuleVersion != 1 || got.ClassifiedAt != first.ClassifiedAt || got.RuleSetVersion != first.RuleSetVersion {
		t.Fatalf("got %+v, want the stored classification, not a new one", got)
	}
}

func TestLiveClassifierFor_FeedPayload(t *testing.T) {
	settingsstore.ResetForTest()
	seedRules(
		ruleOn("RULE-040", "remote_eligible", pred("damage_assessment_method", "eq", "video"), pred("claim_value_sar", "lt", 10000.0)),
		ruleOn("RULE-041", "field_mandatory", pred("location_type", "eq", "highway")),
	)
	defer ResetRulesForTest()
	classify, err := LiveClassifierFor(context.Background(), datactx.NewID())
	check(t, err)
	p := feeds.CasePayload{RegisteredAt: time.Date(2026, 9, 13, 7, 0, 0, 0, time.UTC), PartiesInvolved: vp(2),
		DamageAssessment: vp("video"), ClaimValueSar: vp(4000.0), LocationType: vp("urban")}
	got := classify(p, "Standard case", time.Now())
	if got.Handling != "remote_inferred" || got.RuleCode != "RULE-040" || got.Record["rule_code"] != "RULE-040" {
		t.Fatalf("got %+v, want remote by RULE-040", got)
	}
	p.LocationType = vp("highway")
	if got = classify(p, "Standard case", time.Now()); got.Handling != "field" || got.RuleCode != "RULE-041" {
		t.Fatalf("got %+v, want field by RULE-041", got)
	}
	p.Handling = "remote_inferred"
	if got = classify(p, "Standard case", time.Now()); got.Handling != "remote_inferred" || got.Record["source"] != LiveHandlingFeed {
		t.Fatalf("got %+v, want the feed's handling under the default", got)
	}
}

// Replay mode: the rules route live cases to the queue.
func TestQueueItems_LiveCasesClassifiedRemote(t *testing.T) {
	resetRemoteDeps()
	settingsstore.ResetForTest()
	ResetReplayCasesForTest()
	defer ReloadReplayCasesForTest()
	rc, tenant := adminCtx(t)
	check(t, settingsstore.Put(context.Background(), tenant, liveHandlingSourceKey, LiveHandlingRules))
	seedRules(ruleOn("RULE-030", "remote_eligible", pred("customer_preference", "eq", "remote")))
	defer ResetRulesForTest()
	clock, err := readDispatchClock(context.Background(), tenant)
	check(t, err)
	at := isoAtMs(clock.AtMs - 60_000)
	remote, field := criteriaCase(), criteriaCase()
	remote.ID, remote.CaseNumber, remote.ZoneID, remote.Handling, remote.RegisteredAt, remote.DataSource = "live-r", "RD-LR", "z1", "field", at, "SYNTHETIC"
	field.ID, field.CaseNumber, field.ZoneID, field.Handling, field.RegisteredAt, field.DataSource = "live-f", "RD-LF", "z1", "field", at, "SYNTHETIC"
	field.Extra["customer_preference"] = "none"
	SeedReplayCasesForTest([]Case{remote, field})
	SeedCasesForTest(nil)

	queue, err := queueItems(context.Background(), rc)
	check(t, err)
	if queue == nil || len(queue.Items) != 1 || queue.Items[0].CaseID != "live-r" {
		t.Fatalf("got %+v, want only the rule-classified remote live case", queue)
	}
	cls := queue.Items[0].Classification
	if cls == nil || *cls.RuleCode != "RULE-030" || cls.Handling != "remote_inferred" || queue.LiveAsOf != clock.AtMs {
		t.Fatalf("got %+v, want RULE-030 and the live clock", cls)
	}

	check(t, settingsstore.Put(context.Background(), tenant, liveHandlingSourceKey, LiveHandlingFeed))
	queue, err = queueItems(context.Background(), rc)
	check(t, err)
	if queue != nil && len(queue.Items) != 0 {
		t.Fatalf("got %+v, want none: the feed said field and the setting keeps it", queue.Items)
	}
}

func jsonRound(t *testing.T, v map[string]any) map[string]any {
	t.Helper()
	out := map[string]any{}
	for k, x := range v {
		if n, ok := x.(int); ok {
			out[k] = float64(n)
			continue
		}
		out[k] = x
	}
	return out
}
