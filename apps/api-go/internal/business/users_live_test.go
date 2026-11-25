// SPDX-License-Identifier: AGPL-3.0-only

// Live: the one Postgres touch in users.go -- zone
// existence, via locations.go's allZones.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestCreateUser_ZoneScopedRoleNeedsRealWritableZone(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	ResetUsersForTest()

	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RD", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Riyadh Central"})
	check(t, err)

	_, err = CreateUser(ctx, conn, rc, map[string]any{
		"email": "planner@example.com", "display_name": "Planner", "assigned_role": "planner",
		"zone_ids": []any{"00000000-0000-4000-8000-000000000000"},
	})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("unknown zone: got %v, want Invalid", err)
	}

	created, err := CreateUser(ctx, conn, rc, map[string]any{
		"email": "planner2@example.com", "display_name": "Planner", "assigned_role": "planner",
		"zone_ids": []any{zone.ID},
	})
	check(t, err)
	if len(created.ZoneIDs) != 1 || created.ZoneIDs[0] != zone.ID {
		t.Fatalf("got zones %v, want [%s]", created.ZoneIDs, zone.ID)
	}

	updated, err := UpdateUser(ctx, conn, rc, created.ID, map[string]any{"display_name": "Planner", "assigned_role": "administrator", "zone_ids": []any{}})
	check(t, err)
	if len(updated.ZoneIDs) != 0 {
		t.Fatalf("administrator (whole_install) got zones %v, want none", updated.ZoneIDs)
	}
}
