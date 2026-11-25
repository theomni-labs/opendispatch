// SPDX-License-Identifier: AGPL-3.0-only

// Live: Run forecast after an approval.
package business

import (
	"context"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

func runField(t *testing.T, runID string) float64 {
	t.Helper()
	admin, _ := adminCtx(t)
	demand, err := zoneDemand(context.Background(), admin, splitZone, ruleSplitDate, nil, runID)
	check(t, err)
	var field float64
	for _, d := range demand {
		field += d.FieldExpected
	}
	return field
}

func TestRuleSplit_ANewRunFollowsTheApprovedRuleAndTheOldRunKeepsItsSplit(t *testing.T) {
	conn := openConn(t)
	ctx := context.Background()
	resetModelDeps()
	seedRuleSplit(t)
	SeedFieldShareZonesForTest([]string{splitZone})
	rc, _ := adminCtx(t)
	body := map[string]any{"horizon_start_date": ruleSplitDate, "horizon_days": 1.0}

	first, err := CreateForecastRun(ctx, conn, rc, body)
	check(t, err)
	if got := runField(t, first.ID); got != 2 {
		t.Fatalf("no rule change: got field %v, want the learned 2", got)
	}
	split, err := GetForecastSplit(rc, ForecastSplitQuery{Date: ruleSplitDate, RuleVersionID: "vx"})
	check(t, err)
	preview := split.Zones[0].FieldExpected

	at := time.Now().Add(time.Second)
	datactx.SetNowForTest(&at)
	t.Cleanup(func() { datactx.SetNowForTest(nil) })
	approveRuleX(t)
	later := at.Add(time.Second)
	datactx.SetNowForTest(&later)
	second, err := CreateForecastRun(ctx, conn, rc, body)
	check(t, err)
	if *second.RuleSetVersion == *first.RuleSetVersion {
		t.Fatalf("the new run kept rule set %q", *first.RuleSetVersion)
	}
	after := runField(t, second.ID)
	if after <= 2 {
		t.Fatalf("got field %v after a field_mandatory rule, want more than 2", after)
	}
	if !near(after, preview) {
		t.Fatalf("new run %v, earlier preview %v: want equal", after, preview)
	}
	if got := runField(t, first.ID); got != 2 {
		t.Fatalf("the earlier run's split moved to %v, want its own 2", got)
	}
}
