// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
)

func simAnswerFor(t *testing.T, zoneID string, share float64) []byte {
	t.Helper()
	b, err := json.Marshal(map[string]any{"engine": map[string]any{"version": "5.0.0"},
		"zones": []map[string]any{{"zone_id": zoneID, "service_level": map[string]any{
			"from_assignment": map[string]any{"share": share}, "from_registration": map[string]any{"share": share}}}}})
	check(t, err)
	return b
}

func TestSimulateZones_AnotherDaysAnswerLeavesTheBaseline(t *testing.T) {
	resetSimDeps()
	useMockEngines(t, time.Second)
	UseMemoryEngineAnswers()
	t.Cleanup(UseMemoryEngineAnswers)
	rc, _ := adminCtx(t)
	zoneID := "091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a"
	SeedSimZonesForTest([]simZoneRow{{ID: zoneID, NameEn: "Fixture Zone"}})
	var cases []Case
	for i, id := range []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"} {
		day := "2026-09-14"
		if i%2 == 1 {
			day = "2026-09-20"
		}
		cases = append(cases, Case{ID: id, ZoneID: zoneID, Handling: "field", RegisteredAt: day + "T09:00:00+03:00"})
	}
	SeedCasesForTest(cases)
	cover := []ZoneCoverage{{ZoneID: zoneID, Ratio: simReferenceCoverage}}
	before, err := simulateZones(context.Background(), rc, "2026-09-14", "nearest", cover)
	check(t, err)
	check(t, keepAnswer(context.Background(), rc.CustomerID, engines.Simulator, "2026-09-20", simAnswerFor(t, "another-zone", 0.1), nil))
	after, err := simulateZones(context.Background(), rc, "2026-09-14", "nearest", cover)
	check(t, err)
	if !reflect.DeepEqual(after, before) {
		t.Fatalf("got %+v, want 14 Sept unchanged %+v", after[0].FromAssignment, before[0].FromAssignment)
	}
	check(t, keepAnswer(context.Background(), rc.CustomerID, engines.Simulator, "2026-09-20", simAnswerFor(t, zoneID, 0.2), nil))
	own, err := simulateZones(context.Background(), rc, "2026-09-20", "nearest", cover)
	check(t, err)
	if own[0].FromAssignment.WithinCount != 1 {
		t.Fatalf("got %+v, want 20 Sept's own answer (0.2 of 5)", own[0].FromAssignment)
	}
}
