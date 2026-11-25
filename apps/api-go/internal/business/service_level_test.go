// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func TestServiceLevelTargetShare(t *testing.T) {
	settingsstore.ResetForTest()
	t.Cleanup(settingsstore.ReloadForTest)
	const tenant = "t"
	if got := getServiceLevelTargetShare(context.Background(), tenant); got != 0.95 {
		t.Fatalf("default: got %v, want 0.95", got)
	}
	cases := []struct {
		value any
		want  float64
	}{
		{0.9, 0.9},
		{1, 1},
		{0, 0.95},
		{-0.1, 0.95},
		{1.5, 0.95},
		{"high", 0.95},
	}
	for _, c := range cases {
		if err := settingsstore.Put(context.Background(), tenant, serviceLevelTargetShareKey, c.value); err != nil {
			t.Fatal(err)
		}
		if got := getServiceLevelTargetShare(context.Background(), tenant); got != c.want {
			t.Errorf("value %v: got %v, want %v", c.value, got, c.want)
		}
	}
}

func TestSettingsSnapshotCarriesTheTargetShare(t *testing.T) {
	reloadSettings()
	t.Cleanup(reloadSettings)
	rc, _ := adminCtx(t)
	snap, err := GetSettingsSnapshot(rc)
	check(t, err)
	if snap.TargetShare != 0.95 {
		t.Fatalf("default: got %v, want 0.95", snap.TargetShare)
	}
	check(t, settingsstore.Put(context.Background(), rc.CustomerID, serviceLevelTargetShareKey, 0.9))
	snap, err = GetSettingsSnapshot(rc)
	check(t, err)
	if snap.TargetShare != 0.9 {
		t.Fatalf("got %v, want 0.9", snap.TargetShare)
	}
}

func TestTenMinuteThresholdReusesSetting(t *testing.T) {
	settingsstore.ResetForTest()
	t.Cleanup(settingsstore.ReloadForTest)
	if got := getTenMinuteThresholdSeconds(context.Background(), "t"); got != 600 {
		t.Fatalf("default: got %d, want 600", got)
	}
	if err := settingsstore.Put(context.Background(), "t", "ten_minute_threshold_seconds", 900); err != nil {
		t.Fatal(err)
	}
	if got := getTenMinuteThresholdSeconds(context.Background(), "t"); got != 900 {
		t.Fatalf("got %d, want 900", got)
	}
}
