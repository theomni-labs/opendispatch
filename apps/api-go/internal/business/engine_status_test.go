// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
)

func TestGetEngineStatuses_FixtureModeListsFourClosedEngines(t *testing.T) {
	UseFixtureEngines()
	got, err := GetEngineStatuses(roleCtx(tenantOfTest, "u1", access.RoleAdministrator))
	check(t, err)
	if len(got.Items) != 4 || got.AsOf == "" {
		t.Fatalf("got %+v", got)
	}
	for _, it := range got.Items {
		if it.Mode != "fixture" || it.BreakerState != "closed" || it.ModelVersion != nil || it.LastFailure != nil {
			t.Fatalf("fixture row: %+v", it)
		}
	}
}

func TestGetEngineStatuses_RefusesRolesWithoutAccess(t *testing.T) {
	if _, err := GetEngineStatuses(roleCtx("t1", "u1", access.RolePlanner)); err == nil {
		t.Fatal("a planner has no access to system health")
	}
}

func TestGetEngineStatuses_ShowsModelVersionFailuresAndOpenBreaker(t *testing.T) {
	resetSystemHealthDeps()
	srv := useMockEngines(t, 60*time.Millisecond)
	c := engineCase("c-model")
	srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: rankedFor(c.ID)})
	engineAssignment(context.Background(), c, engineStates(), time.Now().UnixMilli(), "shadow")
	admin := roleCtx(tenantOfTest, "u1", access.RoleAdministrator)
	row := func() EngineStatusItem {
		got, err := GetEngineStatuses(admin)
		check(t, err)
		for _, it := range got.Items {
			if it.Engine == string(engines.Assignment) {
				return it
			}
		}
		t.Fatal("no assignment row")
		return EngineStatusItem{}
	}
	if it := row(); it.ModelVersion == nil || *it.ModelVersion != "scorer-9" || it.Calls != 1 || it.LastFailure != nil || it.Mode != "engine" {
		t.Fatalf("after an answer: %+v", it)
	}
	if enginesBreakerTripped(tenantOfTest) {
		t.Fatal("breaker is closed")
	}
	srv.Script(enginetest.Behavior{Kind: enginetest.Status500})
	for i := 0; i < 6; i++ {
		engineAssignment(context.Background(), engineCase("c-bad-"+string(rune('a'+i))), engineStates(), time.Now().UnixMilli(), "shadow")
	}
	it := row()
	if it.BreakerState != "open" || it.BreakerOpens < 1 || it.Failures < 1 || it.Rejected < 1 || it.LastFailure == nil {
		t.Fatalf("after failures: %+v", it)
	}
	if !enginesBreakerTripped(tenantOfTest) {
		t.Fatal("an open breaker must show")
	}
	health, err := GetSystemHealth(admin)
	check(t, err)
	for _, c := range health.Components {
		if c.Name == "engines" && c.Status != "degraded" {
			t.Fatalf("engines tile must be degraded, never down: %+v", c)
		}
	}
	if health.Overall != "degraded" {
		t.Fatalf("overall %s", health.Overall)
	}
}
