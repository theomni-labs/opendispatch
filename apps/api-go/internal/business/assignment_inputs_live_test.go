// SPDX-License-Identifier: AGPL-3.0-only

// Live: shift ends and open cases from the tables.
package business

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestWithAssignmentFacts_ReadsPublishedShiftsAndOpenCases(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RF", "name_en": "Facts"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Facts"})
	check(t, err)
	var ids []string
	for _, code := range []string{"SUR-F1", "SUR-F2", "SUR-F3"} {
		s, err := CreateAgent(ctx, conn, rc, map[string]any{"code": code, "name_en": code, "kind": "field", "home_zone_id": zone.ID})
		check(t, err)
		ids = append(ids, s.ID)
	}
	now := time.Date(2026, 9, 13, 9, 0, 0, 0, riyadhZone)
	arrived := now.Add(-10 * time.Minute)
	_, err = tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		roster := func(status string) string {
			id := datactx.NewID()
			if _, err := tx.Exec(ctx, `INSERT INTO rosters (tenant_id, id, data_source, zone_id, roster_date, status, planning_level) VALUES ($1,$2,'SYNTHETIC',$3,'2026-09-13',$4,'zone')`,
				tenantID, id, zone.ID, status); err != nil {
				t.Fatal(err)
			}
			return id
		}
		line := func(rosterID, agent string, start, end time.Time) {
			if _, err := tx.Exec(ctx, `INSERT INTO roster_assignments (tenant_id, data_source, roster_id, agent_id, roster_date, start_at, end_at) VALUES ($1,'SYNTHETIC',$2,$3,'2026-09-13',$4,$5)`,
				tenantID, rosterID, agent, start, end); err != nil {
				t.Fatal(err)
			}
		}
		pub, draft := roster("published"), roster("draft")
		line(pub, ids[0], now.Add(-2*time.Hour), now.Add(4*time.Hour))
		line(pub, ids[1], now.Add(-9*time.Hour), now.Add(-time.Hour))
		line(draft, ids[1], now.Add(-time.Hour), now.Add(7*time.Hour))
		for i, c := range []struct {
			agent    string
			assigned time.Time
			arrived  any
			closed   any
		}{
			{ids[0], now.Add(-30 * time.Minute), now.Add(-20 * time.Minute), now.Add(-5 * time.Minute)},
			{ids[0], now.Add(-15 * time.Minute), arrived, nil},
			{ids[1], now.Add(-3 * time.Minute), nil, nil},
		} {
			if _, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, id, data_source, case_number, registered_at, city_id, zone_id, handling, latitude, longitude, agent_id, assigned_at, arrived_at, closed_at)
				VALUES ($1,$2,'SYNTHETIC',$3,$4,$5,$6,'field',24.7,46.7,$7,$8,$9,$10)`,
				tenantID, datactx.NewID(), "RF-"+string(rune('A'+i)), c.assigned.Add(-time.Minute), city.ID, zone.ID, c.agent, c.assigned, c.arrived, c.closed); err != nil {
				t.Fatal(err)
			}
		}
		return struct{}{}, nil
	})
	check(t, err)
	f := &dispatchFeedSource{conn: conn, window: 24 * time.Hour, now: func() time.Time { return now }}
	states := []liveAgent{{ID: ids[0]}, {ID: ids[1]}, {ID: ids[2]}}
	got, err := f.withAssignmentFacts(ctx, tenantID, now.UnixMilli(), states)
	check(t, err)
	if got[0].ShiftEnd == nil || !got[0].ShiftEnd.Equal(now.Add(4*time.Hour)) {
		t.Fatalf("published shift end: %v", got[0].ShiftEnd)
	}
	if got[1].ShiftEnd != nil || got[2].ShiftEnd != nil {
		t.Fatalf("ended or draft lines counted: %v %v", got[1].ShiftEnd, got[2].ShiftEnd)
	}
	if o := got[0].Open; o == nil || o.ArrivedAt == nil || !o.ArrivedAt.Equal(arrived) {
		t.Fatalf("open case of %s: %+v", ids[0], o)
	}
	if o := got[1].Open; o == nil || o.ArrivedAt != nil || o.Lat == nil {
		t.Fatalf("en-route case of %s: %+v", ids[1], o)
	}
	if got[2].Open != nil {
		t.Fatalf("no case, got %+v", got[2].Open)
	}
}
