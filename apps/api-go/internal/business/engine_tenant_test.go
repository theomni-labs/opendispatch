// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
)

const tenantOfOther = "00000000-0000-4000-8000-0000000000bb"

func assignmentStatus(tenant string) EngineStatus {
	for _, s := range EngineStatuses(tenant) {
		if s.Name == engines.Assignment {
			return s
		}
	}
	return EngineStatus{}
}

func TestOneTenantsFailuresDoNotOpenAnotherTenantsBreaker(t *testing.T) {
	srv := useMockEngines(t, 60*time.Millisecond)
	srv.Script(enginetest.Behavior{Kind: enginetest.Status500})
	for i := 0; i < 8; i++ {
		engineAssignment(context.Background(), engineCase("c-a-"+string(rune('a'+i))), engineStates(), time.Now().UnixMilli(), "shadow")
	}
	if a := assignmentStatus(tenantOfTest); a.Stats.BreakerOpens < 1 || !enginesBreakerTripped(tenantOfTest) {
		t.Fatalf("A's breaker must be open: %+v", a.Stats)
	}
	if b := assignmentStatus(tenantOfOther); b.Stats.Calls != 0 || b.Stats.State != "" || enginesBreakerTripped(tenantOfOther) || b.Fallbacks != 0 {
		t.Fatalf("B has no history, closed breaker and zero counters: %+v", b)
	}
	c := engineCase("c-b-1")
	c.TenantID = tenantOfOther
	srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: rankedFor(c.ID)})
	if out := engineAssignment(context.Background(), c, engineStates(), time.Now().UnixMilli(), "shadow"); out.Status != "ranked" {
		t.Fatalf("B must still get answers: %+v", out)
	}
	b := assignmentStatus(tenantOfOther)
	if b.Stats.Calls != 1 || b.Stats.Failures != 0 || b.Model != "scorer-9" || assignmentStatus(tenantOfTest).Model != "" {
		t.Fatalf("statuses must differ per tenant: B %+v A %+v", b, assignmentStatus(tenantOfTest))
	}
	UseEngines(engineCfg)
	if assignmentStatus(tenantOfTest).Stats.Calls != 0 || assignmentStatus(tenantOfOther).Stats.Calls != 0 {
		t.Fatal("a reset clears every tenant")
	}
}
