// SPDX-License-Identifier: AGPL-3.0-only

package feeds

import (
	"strings"
	"testing"
	"time"
)

func validCase() CaseEvent {
	now := time.Now()
	return CaseEvent{Event: Event{IdempotencyKey: "k", OccurredAt: now},
		Case: CasePayload{ExternalID: "1", CaseNumber: "RD-1", RegisteredAt: now, UpdatedAt: now}}
}

func TestValidate_HandlingIsOptionalAndCriteriaChecked(t *testing.T) {
	s := func(v string) *string { return &v }
	f := func(v float64) *float64 { return &v }
	for name, tc := range map[string]struct {
		mutate func(*CasePayload)
		want   string
	}{
		"no handling":  {func(*CasePayload) {}, ""},
		"field":        {func(c *CasePayload) { c.Handling = "field" }, ""},
		"bad handling": {func(c *CasePayload) { c.Handling = "remote" }, "case.handling"},
		"all criteria": {func(c *CasePayload) {
			c.LocationType, c.DamageAssessment, c.CustomerPreference, c.ClaimValueSar = s("urban"), s("video"), s("none"), f(10)
		}, ""},
		"bad location":        {func(c *CasePayload) { c.LocationType = s("moon") }, "case.location_type"},
		"bad assessment":      {func(c *CasePayload) { c.DamageAssessment = s("drone") }, "case.damage_assessment_method"},
		"bad preference":      {func(c *CasePayload) { c.CustomerPreference = s("phone") }, "case.customer_preference"},
		"negative claim":      {func(c *CasePayload) { c.ClaimValueSar = f(-1) }, "cannot be negative"},
		"unknown severity ok": {func(c *CasePayload) { c.Severity = s("unknown") }, ""},
	} {
		e := validCase()
		tc.mutate(&e.Case)
		got := e.Validate()
		if (tc.want == "") != (got == "") || !strings.Contains(got, tc.want) {
			t.Fatalf("%s: got %q, want %q", name, got, tc.want)
		}
	}
}

func TestCriteriaExtra_OnlyWhatTheFeedSent(t *testing.T) {
	yes, loc, claim := true, "highway", 1200.0
	got := CasePayload{PedestrianInvolved: &yes, LocationType: &loc, ClaimValueSar: &claim}.CriteriaExtra()
	if len(got) != 3 || got["pedestrian_involved"] != true || got["location_type"] != "highway" || got["claim_value_sar"] != 1200.0 {
		t.Fatalf("got %v", got)
	}
	if len(CasePayload{}.CriteriaExtra()) != 0 {
		t.Fatalf("an empty payload adds nothing")
	}
}

func TestPriorChanged(t *testing.T) {
	c := Classification{Handling: "field", Outcome: "field_preferred"}
	var none *prior
	if !none.changed("field", c) {
		t.Fatalf("a new case is a change")
	}
	same := &prior{handling: "field", outcome: "field_preferred"}
	if same.changed("field", c) {
		t.Fatalf("same answer is not a change")
	}
	if !same.changed("remote_inferred", c) || !(&prior{handling: "field", outcome: "field_preferred", rule: "R"}).changed("field", c) {
		t.Fatalf("another handling or rule is a change")
	}
}
