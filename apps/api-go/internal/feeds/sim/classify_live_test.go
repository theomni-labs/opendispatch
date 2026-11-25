// SPDX-License-Identifier: AGPL-3.0-only

// Live: the drain classifies cases with no handling.
package sim_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds"
)

func TestTheDrainClassifiesCasesTheFeedLeavesOpen(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	var audited []feeds.Classified
	r.store.Classifiers = func(context.Context, string) (feeds.Classifier, error) {
		return func(c feeds.CasePayload, caseType string, now time.Time) feeds.Classification {
			if c.Handling != "" {
				return feeds.Classification{Handling: c.Handling, Outcome: "field_preferred", Record: map[string]any{"outcome": "field_preferred", "source": "feed"}}
			}
			if c.LocationType != nil && *c.LocationType == "dense_urban" {
				return feeds.Classification{Handling: "remote_inferred", Outcome: "remote_eligible", RuleCode: "RULE-X", Record: map[string]any{"outcome": "remote_eligible", "rule_code": "RULE-X", "source": "rules", "case_type": caseType}}
			}
			return feeds.Classification{Handling: "field", Outcome: "field_preferred", Record: map[string]any{"outcome": "field_preferred", "source": "rules"}}
		}, nil
	}
	r.store.OnClassified = func(_ context.Context, _ string, e feeds.Classified) error {
		audited = append(audited, e)
		return nil
	}
	t.Cleanup(func() { r.store.Classifiers, r.store.OnClassified = nil, nil })

	send := func(ext, key string, at time.Time, mutate func(*feeds.CasePayload)) {
		e := feeds.CaseEvent{Event: feeds.Event{IdempotencyKey: key, OccurredAt: at},
			Case: feeds.CasePayload{ExternalID: ext, CaseNumber: "T-" + ext, RegisteredAt: at, UpdatedAt: at, ZoneExternalID: "2001", CaseTypeExternalID: "1"}}
		mutate(&e.Case)
		raw, _ := json.Marshal(e)
		body, _ := json.Marshal(map[string]any{"events": []json.RawMessage{raw}})
		if resp := r.post(t, "/feeds/v1/cases", body, nil); resp.StatusCode != 202 {
			t.Fatalf("post: %d", resp.StatusCode)
		}
	}
	now := time.Now().UTC().Truncate(time.Second)
	urban, claim := "dense_urban", 4200.0
	send("http-cls-1", "cls-1a", now, func(c *feeds.CasePayload) { c.LocationType, c.ClaimValueSar = &urban, &claim })
	send("http-cls-2", "cls-2a", now, func(c *feeds.CasePayload) { c.Handling = "field" })
	if tally := r.drainAll(t); tally.Applied != 2 || tally.Rejected != 0 {
		t.Fatalf("tally %+v", tally)
	}
	var handling, rule, loc string
	var claimStored float64
	if err := r.owner.QueryRow(ctx, `SELECT handling, extra->'classification'->>'rule_code', extra->>'location_type', (extra->>'claim_value_sar')::float8
		FROM cases WHERE tenant_id = $1 AND external_id = 'http-cls-1'`, tenant).Scan(&handling, &rule, &loc, &claimStored); err != nil {
		t.Fatal(err)
	}
	if handling != "remote_inferred" || rule != "RULE-X" || loc != "dense_urban" || claimStored != 4200 {
		t.Fatalf("stored %s %s %s %v, want remote_inferred by RULE-X with its criteria", handling, rule, loc, claimStored)
	}
	if len(audited) != 2 || audited[0].Previous != nil || audited[0].CaseID == "" {
		t.Fatalf("audited %+v, want one per new case", audited)
	}

	// Same answer again: no new audit; a change: one.
	send("http-cls-1", "cls-1b", now.Add(time.Minute), func(c *feeds.CasePayload) { c.LocationType, c.ClaimValueSar = &urban, &claim })
	r.drainAll(t)
	if len(audited) != 2 {
		t.Fatalf("audited %d, want no new event for the same classification", len(audited))
	}
	rural := "rural"
	send("http-cls-1", "cls-1c", now.Add(2*time.Minute), func(c *feeds.CasePayload) { c.LocationType = &rural })
	r.drainAll(t)
	if len(audited) != 3 || audited[2].Handling != "field" || audited[2].Previous == nil || *audited[2].Previous != "remote_inferred" {
		t.Fatalf("audited %+v, want a change to field", audited)
	}
}

func TestWithNoClassifierAMissingHandlingIsRejected(t *testing.T) {
	r := newRig(t)
	now := time.Now().UTC().Truncate(time.Second)
	e := feeds.CaseEvent{Event: feeds.Event{IdempotencyKey: "nocls-1", OccurredAt: now},
		Case: feeds.CasePayload{ExternalID: "http-nocls-1", CaseNumber: "T-NOCLS", RegisteredAt: now, UpdatedAt: now, ZoneExternalID: "2001", CaseTypeExternalID: "1"}}
	raw, _ := json.Marshal(e)
	body, _ := json.Marshal(map[string]any{"events": []json.RawMessage{raw}})
	r.post(t, "/feeds/v1/cases", body, nil)
	if tally := r.drainAll(t); tally.Rejected != 1 {
		t.Fatalf("tally %+v, want the case rejected", tally)
	}
}
