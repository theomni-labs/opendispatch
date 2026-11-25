// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"encoding/json"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestBreakPrayer_DefaultsToClearOf30(t *testing.T) {
	reloadSettings()
	rc, _ := adminCtx(t)
	snap, err := GetSettingsSnapshot(rc)
	check(t, err)
	if snap.BreakPrayerPolicy != PolicyClear || snap.PrayerWindowMinutes != 30 {
		t.Fatalf("got %q %d, want clear_of_prayer 30", snap.BreakPrayerPolicy, snap.PrayerWindowMinutes)
	}
}

func TestUpdateBreakPrayerPolicy_ValidatesStoresAndAudits(t *testing.T) {
	reloadSettings()
	rc, _ := adminCtx(t)
	for _, bad := range []map[string]any{{}, {"prayer_policy": "whenever"}, {"prayer_window_minutes": float64(4)}, {"prayer_window_minutes": float64(91)}, {"prayer_window_minutes": 12.5}} {
		if _, err := UpdateBreakPrayerPolicy(rc, bad); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("%v: got %v, want Invalid", bad, err)
		}
	}
	snap, err := UpdateBreakPrayerPolicy(rc, map[string]any{"prayer_policy": PolicyLinedUp, "prayer_window_minutes": float64(45)})
	check(t, err)
	if snap.BreakPrayerPolicy != PolicyLinedUp || snap.PrayerWindowMinutes != 45 {
		t.Fatalf("got %+v, want lined up, 45", snap)
	}
	if ok, _ := auditActions(t, rc, "settings.break_prayer_changed"); ok != 1 {
		t.Fatalf("got %d audit rows, want 1", ok)
	}
	planner := roleCtx(rc.CustomerID, "u2", access.RolePlanner)
	if _, err := UpdateBreakPrayerPolicy(planner, map[string]any{"prayer_policy": PolicyClear}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden for a planner", err)
	}
	for key, bad := range map[string]any{prayerPolicyKey: "whenever", prayerWindowKey: float64(100)} {
		if err := PutRawSetting(rc, key, bad); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("%s=%v: got %v, want Invalid", key, bad, err)
		}
	}
	reloadSettings()
}

func TestOptimizerRequestCarriesThePrayerWindow(t *testing.T) {
	src := testOptimizerSource()
	src.PrayerWindow = 45
	raw, err := buildOptimizerRequest(src)
	check(t, err)
	checkRequest(t, "optimizer", raw)
	var sent struct {
		Window int `json:"prayer_window_minutes"`
	}
	check(t, json.Unmarshal(raw, &sent))
	if sent.Window != 45 {
		t.Fatalf("got %d, want 45", sent.Window)
	}
	src.PrayerWindow = 120
	if _, err := buildOptimizerRequest(src); err == nil {
		t.Fatal("want an input error for a window out of range")
	}
}
