// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

const dzZone = "11111111-1111-4111-8111-111111111111"

func seedFarPointScenario(t *testing.T) {
	t.Helper()
	seedRecommendScenario(t)
	lat, lon := 24.71, 46.68
	UpsertZoneForTest(standbyZone{ID: dzZone, NameEn: "Zone One", Latitude: &lat, Longitude: &lon})
	t.Cleanup(func() { _ = settingsstore.DeletePrefix(context.Background(), "", maxDeployDistanceKey) })
}

func TestMaxDeployDistance_DefaultAndBounds(t *testing.T) {
	_ = settingsstore.DeletePrefix(context.Background(), "", maxDeployDistanceKey)
	if got := getMaxDeployDistanceKm(context.Background(), ""); got != defaultMaxDeployDistKm {
		t.Fatalf("got %v, want the default %v", got, defaultMaxDeployDistKm)
	}
	check(t, settingsstore.Put(context.Background(), "", maxDeployDistanceKey, 900.0))
	defer func() { _ = settingsstore.DeletePrefix(context.Background(), "", maxDeployDistanceKey) }()
	if got := getMaxDeployDistanceKm(context.Background(), ""); got != defaultMaxDeployDistKm {
		t.Fatalf("got %v, want the default for an out-of-range value", got)
	}
}

func TestCoverage_MarksPointsBeyondTheLimit(t *testing.T) {
	seedFarPointScenario(t)
	planner := roleCtx("t1", "u1", access.RolePlanner)
	view, err := GetCoverage(planner, CoverageQuery{ZoneID: strp(dzZone), Date: strp("2026-09-14")})
	check(t, err)
	if view.MaxDeployDistanceKm == nil || *view.MaxDeployDistanceKm != 15 {
		t.Fatalf("got %v, want the 15 km default", view.MaxDeployDistanceKm)
	}
	for _, a := range view.Areas {
		far := a.StandbyPointID == "55555555-5555-4555-8555-555555555555"
		if a.BeyondDeployLimit == nil || *a.BeyondDeployLimit != far || a.HomeDistanceKm == nil {
			t.Fatalf("area %+v: want beyond=%v with a distance", a, far)
		}
	}
}

func TestStandbyMoves_NeverToAPointBeyondTheLimit(t *testing.T) {
	seedFarPointScenario(t)
	planner := roleCtx("t1", "u1", access.RolePlanner)
	rec, err := RecommendStandbyMoves(planner, CoverageQuery{ZoneID: strp(dzZone), Date: strp("2026-09-14")})
	check(t, err)
	if len(rec.Moves) != 0 {
		t.Fatalf("got %+v, want no move to the far point", rec.Moves)
	}
	body := map[string]any{"zone_id": dzZone, "roster_date": "2026-09-14", "from_standby_point_id": "44444444-4444-4444-8444-444444444444", "to_standby_point_id": "55555555-5555-4555-8555-555555555555", "agents": 1.0}
	if _, err := ApplyStandbyMove(planner, body); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid beyond the limit", err)
	}
	check(t, settingsstore.Put(context.Background(), "", maxDeployDistanceKey, 60.0))
	rec, err = RecommendStandbyMoves(planner, CoverageQuery{ZoneID: strp(dzZone), Date: strp("2026-09-14")})
	check(t, err)
	if len(rec.Moves) != 1 {
		t.Fatalf("got %+v, want the move once the limit is 60 km", rec.Moves)
	}
	if _, err := ApplyStandbyMove(planner, body); err != nil {
		t.Fatalf("got %v, want the move within 60 km", err)
	}
}

func TestOptimizerRequest_SendsTheDistanceLimitWithAHome(t *testing.T) {
	plain, err := buildOptimizerRequest(testOptimizerSource())
	check(t, err)
	var doc map[string]any
	check(t, json.Unmarshal(plain, &doc))
	if _, ok := doc["dispatch_centres"]; ok {
		t.Fatalf("no home zone: want no dispatch_centres in %s", plain)
	}
	s := testOptimizerSource()
	lat, lon := 24.71, 46.68
	s.Home, s.DeployLimitKm = &Zone{BaseRecord: trec(tZone, "SYNTHETIC"), Latitude: &lat, Longitude: &lon}, 15
	raw, err := buildOptimizerRequest(s)
	check(t, err)
	doc = map[string]any{}
	check(t, json.Unmarshal(raw, &doc))
	centres, _ := doc["dispatch_centres"].([]any)
	objective, _ := doc["objective"].(map[string]any)
	if len(centres) != 1 || objective["max_deploy_distance_km"] != 15.0 {
		t.Fatalf("want one centre and the 15 km limit in %s", raw)
	}
	checkRequest(t, "optimizer", raw)
}
