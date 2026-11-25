// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
)

func engineTile(t *testing.T) HealthComponent {
	t.Helper()
	health, err := GetSystemHealth(roleCtx(tenantOfTest, "u1", access.RoleAdministrator))
	check(t, err)
	for _, c := range health.Components {
		if c.Name == "engines" {
			return c
		}
	}
	t.Fatal("no engines component")
	return HealthComponent{}
}

func TestEnginesTile_FixtureModeIsOKWithFixtureModels(t *testing.T) {
	resetSystemHealthDeps()
	UseFixtureEngines()
	c := engineTile(t)
	if c.Status != "ok" || c.Detail == nil || *c.Detail != "Fixture models" {
		t.Fatalf("fixture tile: %+v", c)
	}
}

func TestEnginesTile_EngineModeCountsEnginesOn(t *testing.T) {
	resetSystemHealthDeps()
	useMockEngines(t, 60*time.Millisecond)
	c := engineTile(t)
	if c.Status != "ok" || c.Detail == nil || *c.Detail != "4 of 4 engines on" {
		t.Fatalf("engine tile: %+v", c)
	}
}

func TestEnginesTile_OpenBreakerIsDegradedNeverDown(t *testing.T) {
	resetSystemHealthDeps()
	srv := useMockEngines(t, 60*time.Millisecond)
	srv.Script(enginetest.Behavior{Kind: enginetest.Status500})
	for i := 0; i < 6; i++ {
		engineAssignment(context.Background(), engineCase("c-tile-"+string(rune('a'+i))), engineStates(), time.Now().UnixMilli(), "shadow")
	}
	c := engineTile(t)
	if c.Status != "degraded" || c.Detail == nil || !strings.HasPrefix(*c.Detail, "4 of 4 engines on") {
		t.Fatalf("open breaker tile: %+v", c)
	}
}
