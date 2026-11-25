// SPDX-License-Identifier: AGPL-3.0-only

// Settings: fixture seeding, zone stages, live-assignment writes.
package business

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func reloadSettings() {
	settingsstore.ReloadForTest()
	ReloadSettingsZonesForTest()
}

func TestSettings_SeededFromFixtures(t *testing.T) {
	reloadSettings()
	rc, _ := adminCtx(t)
	snap, err := GetSettingsSnapshot(rc)
	check(t, err)
	if snap.DecisionDeadlineMs == nil || *snap.DecisionDeadlineMs != 2000 {
		t.Fatalf("got %+v, want the fixture decision deadline 2000", snap.DecisionDeadlineMs)
	}
	if len(snap.LiveAssignmentStages) != 8 {
		t.Fatalf("got %d stages, want 8 zones", len(snap.LiveAssignmentStages))
	}
	recommend := 0
	for _, s := range snap.LiveAssignmentStages {
		if s.Stage == "recommend" {
			recommend++
		}
	}
	if recommend != 2 {
		t.Fatalf("got %d recommend zones, want 2 from the fixtures", recommend)
	}
}

func TestSetZoneStage_StoresAndAudits(t *testing.T) {
	reloadSettings()
	rc, _ := adminCtx(t)
	zones := allSettingsZoneRows()
	stage, err := SetZoneStage(rc, zones[2].ID, map[string]any{"stage": "automatic", "reason": "pilot"})
	check(t, err)
	if stage.Stage != "automatic" {
		t.Fatalf("got %+v, want automatic", stage)
	}
	if got, _ := GetZoneStage(rc, zones[2].ID); got != "automatic" {
		t.Fatalf("got %s, want automatic", got)
	}
	viewer := roleCtx(rc.CustomerID, "u2", access.RoleViewerAuditor)
	if _, err := SetZoneStage(viewer, zones[2].ID, map[string]any{"stage": "shadow"}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden for a viewer", err)
	}
	if _, err := SetZoneStage(rc, "00000000-0000-4000-8000-0000000000aa", map[string]any{"stage": "shadow"}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("got %v, want NotFound for an unknown zone", err)
	}
}

func TestUpdateLiveAssignmentSettings_ValidatesAndStores(t *testing.T) {
	reloadSettings()
	rc, _ := adminCtx(t)
	if _, err := UpdateLiveAssignmentSettings(rc, map[string]any{}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid when nothing changes", err)
	}
	snap, err := UpdateLiveAssignmentSettings(rc, map[string]any{"fallback_timeout_seconds": float64(9), "decision_deadline_ms": float64(1500)})
	check(t, err)
	if snap.FallbackTimeoutSeconds != 9 || snap.DecisionDeadlineMs == nil || *snap.DecisionDeadlineMs != 1500 {
		t.Fatalf("got %+v, want 9s and 1500ms", snap)
	}
}
