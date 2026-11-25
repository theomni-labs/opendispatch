// SPDX-License-Identifier: AGPL-3.0-only

// Live: the plan's prayers read zones once.
package business

import (
	"context"
	"reflect"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
)

func TestPlanPrayersMatchPrayerMinutesFor(t *testing.T) {
	conn := openConn(t)
	ctx := context.Background()
	tenant, err := fixtures.TenantID()
	check(t, err)
	rc := roleCtx(tenant, "u1", access.RolePlanner)
	zones, err := allZones(ctx, conn, tenant)
	check(t, err)
	if len(zones) == 0 {
		t.Skip("the fixture tenant is not seeded")
	}
	plan, err := loadPlan(ctx, conn, rc)
	check(t, err)
	compared := 0
	for _, z := range zones {
		for i := 0; i < 10; i++ {
			date := shiftDateBy("2026-09-10", i)
			want, err := PrayerMinutesFor(ctx, conn, tenant, z.ID, date)
			check(t, err)
			got, err := plan.Prayers(z.ID, date)
			check(t, err)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("%s %s: got %v, want %v", z.ID, date, got, want)
			}
			compared += len(want)
		}
	}
	if compared == 0 {
		t.Fatal("want prayers to compare, got none")
	}
}
