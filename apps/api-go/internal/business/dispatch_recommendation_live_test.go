// SPDX-License-Identifier: AGPL-3.0-only

// Live: one case's ranking matches the board's.
package business

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestGetCaseRecommendation_FeedsMatchTheWholeBoardRead(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RY", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central"})
	check(t, err)
	now := time.Date(2026, 9, 13, 9, 0, 0, 0, time.UTC)
	var agentIDs []string
	for i := 0; i < 24; i++ {
		kind := "field"
		if i%7 == 6 {
			kind = "remote"
		}
		s, err := CreateAgent(ctx, conn, rc, map[string]any{"code": fmt.Sprintf("SUR-R%02d", i), "name_en": fmt.Sprintf("Ranked %d", i), "kind": kind, "home_zone_id": zone.ID})
		check(t, err)
		agentIDs = append(agentIDs, s.ID)
	}
	var caseIDs []string
	_, err = tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for i, id := range agentIDs {
			// Coarse grid: equal distances, ties by code.
			status := []string{"available", "available", "en_route", "on_scene"}[i%4]
			if _, err := tx.Exec(ctx, `INSERT INTO agent_live_state (tenant_id, agent_id, status, latitude, longitude, occurred_at) VALUES ($1,$2,$3,$4,$5,$6)`,
				tenantID, id, status, 24.70+float64(i%3)*0.01, 46.70+float64(i%2)*0.01, now.Add(-time.Minute)); err != nil {
				return struct{}{}, err
			}
		}
		for i := 0; i < 70; i++ {
			id := datactx.NewID()
			caseIDs = append(caseIDs, id)
			lat, lon := 24.69+float64(i%5)*0.007, 46.69+float64(i%4)*0.009
			if i%11 == 0 {
				lat, lon = 0, 0
			}
			// Pairs share a time; some are out of window.
			registered := now.Add(-time.Duration(i/2) * 47 * time.Minute)
			var assigned any
			if i%3 == 0 {
				assigned = registered.Add(4 * time.Minute)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, id, data_source, case_number, registered_at, city_id, zone_id, handling, latitude, longitude, external_id, assigned_at)
				VALUES ($1,$2,'SYNTHETIC',$3,$4,$5,$6,'field',$7,$8,$9,$10)`,
				tenantID, id, fmt.Sprintf("RC-%03d", i), registered, city.ID, zone.ID, lat, lon, fmt.Sprintf("ext-rc-%d", i), assigned); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	check(t, err)

	UseFeedsDispatch(conn, 24*time.Hour)
	t.Cleanup(UseReplayDispatch)
	feedSource.now = func() time.Time { return now }

	whole, err := dispatchInputFor(ctx, tenantID)
	check(t, err)
	if len(whole.Cases) == 0 || len(whole.Cases) == len(caseIDs) {
		t.Fatalf("the board read %d of %d cases: want some outside the window", len(whole.Cases), len(caseIDs))
	}
	ranked, missing := 0, 0
	dispatcher := roleCtx(tenantID, datactx.NewID(), access.RoleDispatchSupervisor)
	for _, id := range append(caseIDs, strings.ToUpper(caseIDs[0])) {
		got, err := GetCaseRecommendation(dispatcher, id)
		want, inWindow := whole.Outputs[id]
		if !inWindow {
			if errCode(err) != dataerr.CodeNotFound {
				t.Fatalf("case %s is not on the board: got %v, want not found", id, err)
			}
			missing++
			continue
		}
		check(t, err)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("case %s: got %+v, want %+v", id, got, want)
		}
		if got.Status == "ranked" {
			ranked++
		}
	}
	if ranked == 0 || missing < 3 {
		t.Fatalf("ranked %d, not found %d: the comparison proves too little", ranked, missing)
	}

	// The engine's share: first unassigned, in order.
	var want []string
	for _, c := range whole.Cases {
		if c.AssignedAt == nil && len(want) < assignmentMaxCalls {
			want = append(want, c.ID)
		}
	}
	waiting, err := feedSource.engineWaiting(ctx, tenantID, now.UnixMilli())
	check(t, err)
	got := []string{}
	for _, c := range waiting {
		got = append(got, c.ID)
	}
	if len(want) < assignmentMaxCalls || !reflect.DeepEqual(got, want) {
		t.Fatalf("engine cases %v, want %v (%d)", got, want, assignmentMaxCalls)
	}
}
