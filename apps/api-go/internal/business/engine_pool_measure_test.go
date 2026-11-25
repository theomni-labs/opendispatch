// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
)

// Manual: board pool wall time.
func TestMeasureAssignmentPool(t *testing.T) {
	addr := os.Getenv("OPENDISPATCH_POOL_ADDR")
	if addr == "" {
		t.Skip("set OPENDISPATCH_POOL_ADDR to measure")
	}
	urls := map[engines.Name]string{}
	for _, n := range engines.All {
		urls[n] = "http://" + addr
	}
	UseEngines(engines.Config{Mode: engines.ModeEngine, URLs: urls, AssignmentDeadline: 5 * time.Second})
	t.Cleanup(UseFixtureEngines)
	var states []liveAgent
	for i := 0; i < 80; i++ {
		lat, lon := 24.6+float64(i%10)*0.02, 46.6+float64(i/10)*0.02
		states = append(states, liveAgent{ID: scaleUUID(), Kind: "field", Status: "available", Lat: &lat, Lon: &lon, At: time.Now()})
	}
	probe := engineCase(scaleUUID())
	probe.ZoneID = scaleUUID()
	if _, err := callEngine(context.Background(), probe.TenantID, engines.Assignment, func() ([]byte, error) {
		return assignmentRequest(probe, states, time.Now().UnixMilli(), "shadow", time.Second, assignmentExtrasFor(context.Background(), probe, time.Now().UnixMilli()))
	}); err != nil {
		t.Fatalf("probe: %v", err)
	}
	var walls []float64
	for round := 0; round < 8; round++ {
		var cs []Case
		for i := 0; i < 20; i++ {
			c := engineCase(scaleUUID())
			c.ZoneID = scaleUUID()
			c.Latitude, c.Longitude = 24.6+float64(i)*0.01, 46.6+float64(i)*0.01
			cs = append(cs, c)
		}
		t0 := time.Now()
		outs := engineAssignments(context.Background(), cs, states, time.Now().UnixMilli(), "shadow")
		walls = append(walls, time.Since(t0).Seconds())
		ok := 0
		for _, o := range outs {
			if o.Engine.Version != "unavailable" {
				ok++
			}
		}
		if ok != 20 {
			t.Fatalf("round %d: %d of 20 answered by the engine", round, ok)
		}
	}
	sort.Float64s(walls)
	fmt.Printf("workers=%d 20 cases wall: min %.3fs median %.3fs max %.3fs\n", assignmentWorkers, walls[0], walls[len(walls)/2], walls[len(walls)-1])
}
