// SPDX-License-Identifier: AGPL-3.0-only

// Live: waiting spots from the feeds and the engine.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func repositionAnswerFor(zoneID, agentID string, km float64) string {
	b, _ := json.Marshal(map[string]any{"schema_version": "1.0", "request_id": datactx.NewID(), "engine": map[string]any{"name": "assignment", "version": "0.7.0"},
		"model_version": "scorer-0.3", "generated_at": "2026-09-13T09:00:00+03:00", "data_source": "SYNTHETIC", "illustrative": true, "zone_id": zoneID, "decision_time_ms": 3,
		"waiting_spots": []map[string]any{{"agent_id": agentID, "latitude": 24.73, "longitude": 46.72, "move_km": km, "reason_code": "cover_expected_demand"}}})
	return string(b)
}

func TestWaitingSpots_FromFeedsForecastAndEngine(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	ResetRepositionForTest()
	t.Cleanup(ResetRepositionForTest)
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RP", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central"})
	check(t, err)
	other, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "North"})
	check(t, err)
	sub, err := CreateSubZone(ctx, conn, rc, map[string]any{"zone_id": zone.ID, "name_en": "Sub A", "latitude": 24.72, "longitude": 46.71})
	check(t, err)
	now := time.Date(2026, 9, 13, 6, 0, 0, 0, time.UTC)
	var ids []string
	for i, status := range []string{"available", "available", "en_route"} {
		s, err := CreateAgent(ctx, conn, rc, map[string]any{"code": fmt.Sprintf("SUR-P%02d", i), "name_en": fmt.Sprintf("Idle %d", i), "kind": "field", "home_zone_id": zone.ID})
		check(t, err)
		ids = append(ids, s.ID)
		_, err = tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			_, err := tx.Exec(ctx, `INSERT INTO agent_live_state (tenant_id, agent_id, status, latitude, longitude, occurred_at) VALUES ($1,$2,$3,$4,$5,$6)`,
				tenantID, s.ID, status, 24.70+float64(i)*0.01, 46.70, now.Add(-time.Minute))
			return struct{}{}, err
		})
		check(t, err)
	}
	UseFeedsDispatch(conn, 24*time.Hour)
	t.Cleanup(UseReplayDispatch)
	clock := now
	feedSource.now = func() time.Time { return clock }
	t.Cleanup(func() { _ = settingsstore.Put(ctx, tenantID, repositionKey, false) })
	tick := func(d time.Duration) {
		clock = now.Add(d)
		_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			_, err := tx.Exec(ctx, `UPDATE agent_live_state SET occurred_at = $1`, clock.Add(-time.Minute))
			return struct{}{}, err
		})
		check(t, err)
	}
	srv := useMockEngines(t, time.Second)

	var values []map[string]any
	for i := 36; i < 44; i++ {
		values = append(values, map[string]any{"zone_id": zone.ID, "sub_zone_id": sub.ID, "interval_start": intervalStartOf("2026-09-13", i), "interval_index": i,
			"low": 0, "expected": 1.5, "high": 3, "field_expected": 1, "remote_inferred_expected": 0.5})
	}
	forecast, _ := json.Marshal(map[string]any{"schema_version": "1.0", "request_id": datactx.NewID(), "engine": map[string]any{"name": "forecaster", "version": "9.1.0"},
		"model_version": "m-9", "generated_at": "2026-09-13T02:00:00Z", "data_source": "SYNTHETIC", "illustrative": true, "rule_set_version": "rs-1",
		"horizon": map[string]any{"start_date": "2026-09-13", "days": 1}, "interval_minutes": 15, "intervals_per_day": 96, "range_coverage": 0.8, "values": values})
	check(t, keepAnswer(ctx, tenantID, engines.Forecaster, "run:test", forecast, nil))

	// Off by default: nothing asked, nothing shown.
	got, err := ListWaitingSpots(ctx, conn, rc, "")
	check(t, err)
	if got.Enabled || len(got.Items) != 0 || got.GeneratedAt != nil || len(srv.Requests()) != 0 {
		t.Fatalf("off: %+v, %d requests", got, len(srv.Requests()))
	}

	check(t, settingsstore.Put(ctx, tenantID, repositionKey, true))
	srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: repositionAnswerFor(zone.ID, ids[0], 3.2)})
	got, err = ListWaitingSpots(ctx, conn, rc, "")
	check(t, err)
	if !got.Enabled || !got.Illustrative || len(got.Items) != 1 || got.Items[0].AgentID != ids[0] || got.Items[0].ZoneID != zone.ID || got.ModelVersion == nil || *got.ModelVersion != "scorer-0.3" {
		t.Fatalf("on: %+v", got)
	}
	reqs := srv.Requests()
	if len(reqs) != 1 || reqs[0].Path != "/v1/assignment/reposition" {
		t.Fatalf("requests %+v", reqs)
	}
	var sent struct {
		ZoneID   string           `json:"zone_id"`
		Now      string           `json:"now"`
		Settings map[string]any   `json:"settings"`
		Idle     []map[string]any `json:"idle_agents"`
		Cells    []demandCell     `json:"demand_cells"`
	}
	check(t, json.Unmarshal([]byte(reqs[0].Body), &sent))
	if sent.ZoneID != zone.ID || len(sent.Idle) != 2 || sent.Settings["max_move_km"] != 5.0 || sent.Settings["look_ahead_hours"] != 1.0 || len(sent.Cells) != 1 || sent.Cells[0].Expected != 4 {
		t.Fatalf("request %+v", sent)
	}
	if !strings.HasPrefix(sent.Now, "2026-09-13T09:00:00") {
		t.Fatalf("now %s: want the board clock", sent.Now)
	}

	// Within the period: kept, not asked again.
	tick(29 * time.Minute)
	if _, err = ListWaitingSpots(ctx, conn, rc, ""); err != nil || len(srv.Requests()) != 1 {
		t.Fatalf("cached read asked again: %v, %d", err, len(srv.Requests()))
	}
	// Zone filter and zone scope.
	if got, _ = ListWaitingSpots(ctx, conn, rc, other.ID); len(got.Items) != 0 {
		t.Fatalf("other zone: %+v", got.Items)
	}
	scoped := roleCtx(tenantID, datactx.NewID(), access.RoleDispatchSupervisor)
	scoped.ZoneScope = access.ZoneScope{Kind: access.ScopeAssignedZones, ZoneIDs: []string{other.ID}}
	if got, err = ListWaitingSpots(ctx, conn, scoped, ""); err != nil || len(got.Items) != 0 {
		t.Fatalf("out of scope: %v %+v", err, got.Items)
	}

	// Next period: a stranger in the answer drops it.
	tick(31 * time.Minute)
	srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: repositionAnswerFor(zone.ID, datactx.NewID(), 1)})
	got, err = ListWaitingSpots(ctx, conn, rc, "")
	check(t, err)
	if len(srv.Requests()) != 2 || len(got.Items) != 0 {
		t.Fatalf("bad answer kept: %+v, %d requests", got.Items, len(srv.Requests()))
	}
	// Over the cap, or engine down: no spots.
	tick(62 * time.Minute)
	srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: repositionAnswerFor(zone.ID, ids[0], 9)})
	if got, err = ListWaitingSpots(ctx, conn, rc, ""); err != nil || len(got.Items) != 0 {
		t.Fatalf("over the cap: %v %+v", err, got.Items)
	}
	tick(93 * time.Minute)
	srv.Script(enginetest.Behavior{Kind: enginetest.Status500})
	if got, err = ListWaitingSpots(ctx, conn, rc, ""); err != nil || len(got.Items) != 0 {
		t.Fatalf("engine down: %v %+v", err, got.Items)
	}
	// Never touches live ranking's guard.
	for _, st := range EngineStatuses(tenantID) {
		if st.Name == engines.Assignment && st.Stats.Calls != 0 {
			t.Fatalf("assignment guard used: %+v", st.Stats)
		}
	}
}

func TestWaitingSpots_SettingsAreReadWrittenAndAudited(t *testing.T) {
	_ = openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	reset := func() {
		check(t, settingsstore.PutMany(ctx, tenantID, settingsstore.KV{Key: repositionKey, Value: false},
			settingsstore.KV{Key: repositionMaxMoveKey, Value: 5.0}, settingsstore.KV{Key: prayerPenaltyKey, Value: false}))
	}
	reset()
	t.Cleanup(reset)
	snap, err := GetSettingsSnapshot(rc)
	check(t, err)
	if snap.Reposition || snap.RepositionMaxMoveKm != 5 || snap.PrayerPenalty {
		t.Fatalf("defaults %+v", snap)
	}
	snap, err = UpdateLiveAssignmentSettings(rc, map[string]any{"dispatch_reposition": true, "dispatch_reposition_max_move_km": 3.5, "dispatch_prayer_penalty": true})
	check(t, err)
	if !snap.Reposition || snap.RepositionMaxMoveKm != 3.5 || !snap.PrayerPenalty {
		t.Fatalf("after %+v", snap)
	}
	for _, bad := range []map[string]any{{"dispatch_reposition_max_move_km": 0.0}, {"dispatch_reposition_max_move_km": 51.0}, {"dispatch_reposition": "yes"}} {
		if _, err := UpdateLiveAssignmentSettings(rc, bad); err == nil {
			t.Fatalf("%v accepted", bad)
		}
	}
	page, err := ListAuditEvents(rc, AuditFilter{Action: "settings.live_assignment_changed"})
	check(t, err)
	if len(page.Items) != 1 {
		t.Fatalf("audit events %d", len(page.Items))
	}
	d := page.Items[0].Detail
	if _, ok := d["dispatch_reposition"]; !ok || page.Items[0].SummaryEn != "Live assignment dispatch settings changed." {
		t.Fatalf("audit %+v (tenant %s)", page.Items[0], tenantID)
	}
	for _, k := range []string{"dispatch_reposition_max_move_km", "dispatch_prayer_penalty"} {
		if _, ok := d[k]; !ok {
			t.Fatalf("audit detail misses %s: %+v", k, d)
		}
	}
}
