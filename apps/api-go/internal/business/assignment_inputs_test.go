// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

const prayerCity = "c602613f-ca37-49ae-b617-7e2c29fc2a84"

func inputsRig(t *testing.T) {
	t.Helper()
	settingsstore.ResetForTest()
	t.Cleanup(settingsstore.ReloadForTest)
}

func requestDoc(t *testing.T, c Case, states []liveAgent, at time.Time) map[string]any {
	t.Helper()
	body, err := assignmentRequest(c, states, at.UnixMilli(), "shadow", 2*time.Second, assignmentExtrasFor(context.Background(), c, at.UnixMilli()))
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "assignment", body)
	var doc map[string]any
	if err := json.Unmarshal(body, &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

func TestAssignmentRequest_PrayerPenaltyOffByDefault(t *testing.T) {
	inputsRig(t)
	c := engineCase("c-prayer-off")
	c.CityID = prayerCity
	at := time.Date(2026, 9, 6, 11, 50, 0, 0, riyadhZone)
	doc := requestDoc(t, c, engineStates(), at)
	if w, ok := doc["prayer_window"]; !ok || w != nil {
		t.Fatalf("prayer_window = %v, want null with the setting off", w)
	}
}

func TestAssignmentRequest_PrayerPenaltyOnSendsTheWindow(t *testing.T) {
	inputsRig(t)
	ctx := context.Background()
	check(t, settingsstore.Put(ctx, tenantOfTest, prayerPenaltyKey, true))
	check(t, settingsstore.Put(ctx, tenantOfTest, prayerWindowKey, 20))
	c := engineCase("c-prayer-on")
	c.CityID = prayerCity
	at := time.Date(2026, 9, 6, 11, 50, 0, 0, riyadhZone)
	w, _ := requestDoc(t, c, engineStates(), at)["prayer_window"].(map[string]any)
	if w == nil || w["name"] != "dhuhr" || w["starts_at"] != "2026-09-06T11:52:00+03:00" || w["ends_at"] != "2026-09-06T12:12:00+03:00" {
		t.Fatalf("prayer_window = %v, want dhuhr 11:52 to 12:12", w)
	}
	late := time.Date(2026, 9, 6, 23, 0, 0, 0, riyadhZone)
	if w := requestDoc(t, c, engineStates(), late)["prayer_window"]; w != nil {
		t.Fatalf("after isha: %v, want null", w)
	}
}

func TestAssignmentRequest_SendsTravelShiftEndAndBusyUntil(t *testing.T) {
	inputsRig(t)
	ctx := context.Background()
	check(t, settingsstore.Put(ctx, tenantOfTest, travelSpeedKey, 30.0))
	check(t, settingsstore.Put(ctx, tenantOfTest, demandOnSceneKey, 20.0))
	at := time.Date(2026, 9, 14, 9, 0, 0, 0, riyadhZone)
	lat, lon := 24.71, 46.71
	shiftEnd := at.Add(3 * time.Hour)
	arrived := at.Add(-5 * time.Minute)
	longAgo := at.Add(-2 * time.Hour)
	states := []liveAgent{
		{ID: "free", Kind: "field", Status: "available", Lat: &lat, Lon: &lon, At: at, ShiftEnd: &shiftEnd},
		{ID: "scene", Kind: "field", Status: "on_scene", Lat: &lat, Lon: &lon, At: at, Open: &openCase{AssignedAt: at.Add(-20 * time.Minute), ArrivedAt: &arrived}},
		{ID: "late", Kind: "field", Status: "on_scene", Lat: &lat, Lon: &lon, At: at, Open: &openCase{AssignedAt: longAgo, ArrivedAt: &longAgo}},
		{ID: "route", Kind: "field", Status: "en_route", Lat: &lat, Lon: &lon, At: at, Open: &openCase{AssignedAt: at, Lat: &lat, Lon: &lon}},
		{ID: "unknown", Kind: "field", Status: "assigned", Lat: &lat, Lon: &lon, At: at},
	}
	doc := requestDoc(t, engineCase("c-inputs"), states, at)
	tm, _ := doc["travel_model"].(map[string]any)
	if tm["average_speed_kmh"] != 30.0 || tm["detour_factor"] == nil {
		t.Fatalf("travel_model = %v", tm)
	}
	got := map[string]map[string]any{}
	for _, c := range doc["candidates"].([]any) {
		m := c.(map[string]any)
		got[m["agent_id"].(string)] = m
	}
	if got["free"]["shift_end_at"] != "2026-09-14T12:00:00+03:00" || got["free"]["busy_until"] != nil {
		t.Fatalf("free: %v", got["free"])
	}
	want := map[string]any{"scene": "2026-09-14T09:15:00+03:00", "late": "2026-09-14T09:05:00+03:00", "route": "2026-09-14T09:20:00+03:00", "unknown": nil}
	for id, w := range want {
		if got[id]["busy_until"] != w {
			t.Fatalf("%s busy_until = %v, want %v", id, got[id]["busy_until"], w)
		}
	}
	if _, ok := got["unknown"]["shift_end_at"]; ok {
		t.Fatal("shift_end_at sent with no roster line")
	}
}
