// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors forecast-core's dayFactor tests.
package business

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
)

func TestDayFactorOf_ScalesBySameWeekdayHistory(t *testing.T) {
	ResetForecastCoreForTest()
	// Consecutive days: each anchors its own weekday, so
	// this compares 9/6's and 9/7's own counts directly.
	rows := make([]Case, 0, 6)
	for i := 0; i < 4; i++ {
		rows = append(rows, Case{ZoneID: "z1", RegisteredAt: "2026-09-06T10:00:00+03:00"})
	}
	for i := 0; i < 2; i++ {
		rows = append(rows, Case{ZoneID: "z1", RegisteredAt: "2026-09-07T10:00:00+03:00"})
	}
	SeedCasesForTest(rows)
	rc := roleCtx("t1", "u1", access.RoleAdministrator)
	factor := DayFactorOf(rc)
	got := factor("z1", "2026-09-06", "2026-09-07")
	if got != 2 {
		t.Fatalf("got %v, want 2 (4 cases vs 2 on their own weekday anchors)", got)
	}
}

func TestDayFactorOf_DefaultsToOneWithNoHistory(t *testing.T) {
	ResetForecastCoreForTest()
	rc := roleCtx("t1", "u1", access.RoleAdministrator)
	factor := DayFactorOf(rc)
	if got := factor("z1", "2026-09-06", "2026-09-13"); got != 1 {
		t.Fatalf("got %v, want 1 with no case history", got)
	}
}

func TestDayFactorOf_RefusesAZoneOutsideScope(t *testing.T) {
	ResetForecastCoreForTest()
	SeedCasesForTest([]Case{{ZoneID: "z1", RegisteredAt: "2026-09-06T10:00:00+03:00"}})
	zoned := roleCtx("t1", "u1", access.RolePlanner)
	zoned.ZoneScope = access.ZoneScope{Kind: access.ScopeAssignedZones, ZoneIDs: []string{"other-zone"}}
	factor := DayFactorOf(zoned)
	if got := factor("z1", "2026-09-06", "2026-09-13"); got != 1 {
		t.Fatalf("got %v, want 1 for a zone outside scope", got)
	}
}
