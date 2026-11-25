// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"reflect"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
)

// The cache must not change a single number.
func TestForecastReadsAreTheSameWithAndWithoutTheCache(t *testing.T) {
	UseFixtureEngines()
	resetModelDeps()
	ReloadFieldShareZonesForTest()
	t.Cleanup(ResetFieldShareForTest)
	UseMemoryForecast()
	ReloadForecastFixturesForTest()
	tenant, err := fixtures.TenantID()
	check(t, err)
	rc := roleCtx(tenant, "u1", access.RolePlanner)
	run, err := requireRun(context.Background(), tenant, "")
	check(t, err)
	doc, err := readForecasterOutput(context.Background(), tenant)
	check(t, err)
	if doc == nil || !answerOf(doc, run) {
		t.Fatal("want the fixture run to be the fixture output's run")
	}
	dates := []string{run.HorizonStartDate, shiftDateBy(run.HorizonStartDate, 1), shiftDateBy(run.HorizonStartDate, 30)}
	read := func(cold bool) []any {
		var out []any
		for _, date := range dates {
			if cold {
				forgetAllForecasterOutputs()
			}
			split, err := GetForecastSplit(rc, ForecastSplitQuery{Date: date})
			check(t, err)
			split.GeneratedAt = ""
			out = append(out, split)
			for _, zoneID := range demoZoneIDs() {
				if cold {
					forgetAllForecasterOutputs()
				}
				line, err := GetForecastTimeline(rc, ForecastTimelineQuery{ZoneID: zoneID, Date: date})
				check(t, err)
				out = append(out, line)
			}
		}
		return out
	}
	cold, warm := read(true), read(false)
	if !reflect.DeepEqual(cold, warm) {
		t.Fatal("the cached reads differ from fresh reads")
	}
	first := cold[0].(ForecastSplit)
	if len(first.Zones) == 0 || first.Zones[0].FieldExpected+first.Zones[0].RemoteInferredExpected == 0 {
		t.Fatalf("want real values to compare, got %+v", first.Zones)
	}
}
