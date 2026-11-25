// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors models.ts's admin.forecast_model tests.
// Pure: entirely in-memory, no live Postgres.
package business

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func resetModelDeps() {
	ResetModelVersionsForTest()
	ResetForecastRunsForTest()
	ResetNotificationsForTest()
	ResetFieldShareForTest()
	ResetZoneStagesForTest()
	ResetSettingsZonesForTest()
	settingsstore.ResetForTest()
}

func newModelVersion(rc reqctx.RequestContext, version, status string) ModelVersion {
	return ModelVersion{BaseRecord: datactx.NewRecord(rc, "", datactx.NowISO()), Version: version, Status: status}
}

func TestListModelVersions_RequiresViewAccess(t *testing.T) {
	resetModelDeps()
	rc, _ := adminCtx(t)
	dispatcher := roleCtx(rc.CustomerID, "u1", access.RoleDispatcher)
	if _, err := ListModelVersions(dispatcher, datactx.PageQuery{}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden for a role with no access", err)
	}
	if _, err := ListModelVersions(rc, datactx.PageQuery{}); err != nil {
		t.Fatalf("Administrator should have view access: %v", err)
	}
}

func TestSwitchModelVersion_PreviousRetiredTargetActiveNotified(t *testing.T) {
	resetModelDeps()
	rc, _ := adminCtx(t)
	prev := newModelVersion(rc, "v1", "active")
	next := newModelVersion(rc, "v2", "candidate")
	SeedModelVersionsForTest(prev)
	SeedModelVersionsForTest(next)

	state, err := SwitchModelVersion(rc, next.ID, map[string]any{"reason": "better accuracy"})
	check(t, err)
	if state.ActiveVersion != "v2" {
		t.Fatalf("got %+v, want v2 active", state)
	}
	if oneModelVersionRow(prev.ID).Status != "retired" {
		t.Fatalf("got %+v, want v1 retired", oneModelVersionRow(prev.ID))
	}
	if oneModelVersionRow(next.ID).Status != "active" {
		t.Fatalf("got %+v, want v2 active", oneModelVersionRow(next.ID))
	}
	notes := allNotificationsMemory()
	if len(notes) != 2 {
		t.Fatalf("got %d notifications, want 2 (administrator, planner fallback)", len(notes))
	}

	// Re-switching to the active version is a conflict.
	_, err = SwitchModelVersion(rc, next.ID, map[string]any{"reason": "again"})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict", err)
	}
}

func TestPauseModel_ThenResume(t *testing.T) {
	resetModelDeps()
	rc, _ := adminCtx(t)

	state, err := PauseModel(rc, map[string]any{"reason": "bad inputs"})
	check(t, err)
	if !state.IsPaused || state.PauseReason == nil || *state.PauseReason != "bad inputs" {
		t.Fatalf("got %+v, want paused with reason", state)
	}
	if _, err := PauseModel(rc, map[string]any{"reason": "again"}); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict pausing twice", err)
	}

	state, err = ResumeModel(rc, map[string]any{"reason": "fixed"})
	check(t, err)
	if state.IsPaused || state.PauseReason != nil {
		t.Fatalf("got %+v, want resumed", state)
	}
	if _, err := ResumeModel(rc, map[string]any{"reason": "again"}); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict resuming twice", err)
	}
}

func TestUpdateRetrainingSchedule_WeeklyRequiresDayOfWeek(t *testing.T) {
	resetModelDeps()
	rc, _ := adminCtx(t)

	_, err := UpdateRetrainingSchedule(rc, map[string]any{"cadence": "weekly", "day_of_week": nil, "time_of_day": "03:00"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid without day_of_week", err)
	}

	state, err := UpdateRetrainingSchedule(rc, map[string]any{"cadence": "weekly", "day_of_week": 2.0, "time_of_day": "03:00"})
	check(t, err)
	if state.RetrainingSchedule.DayOfWeek == nil || *state.RetrainingSchedule.DayOfWeek != 2 {
		t.Fatalf("got %+v, want day_of_week 2", state.RetrainingSchedule)
	}

	state, err = UpdateRetrainingSchedule(rc, map[string]any{"cadence": "manual", "day_of_week": nil, "time_of_day": "03:00"})
	check(t, err)
	if state.RetrainingSchedule.DayOfWeek != nil {
		t.Fatalf("got %+v, want day_of_week cleared for manual", state.RetrainingSchedule)
	}
}

func TestGetSettingsSnapshot_ReflectsClockStartAndPlanningLevel(t *testing.T) {
	resetModelDeps()
	rc, _ := adminCtx(t)
	SeedSettingsZonesForTest([]string{"00000000-0000-4000-8000-000000000401"}, "2026-09-01T00:00:00+03:00")

	snap, err := UpdateClockStart(rc, map[string]any{"clock_start": "registration"})
	check(t, err)
	if snap.ClockStart != "registration" {
		t.Fatalf("got %+v, want clock_start registration", snap)
	}
	if len(snap.LiveAssignmentStages) != 1 || snap.LiveAssignmentStages[0].Stage != "shadow" {
		t.Fatalf("got %+v, want one zone defaulted to shadow", snap.LiveAssignmentStages)
	}

	snap, err = UpdatePlanningLevel(rc, map[string]any{"planning_level": "city"})
	check(t, err)
	if snap.PlanningLevel != "city" || snap.ClockStart != "registration" {
		t.Fatalf("got %+v, want planning_level city, clock_start still registration", snap)
	}

	viewer := roleCtx(rc.CustomerID, "u2", access.RoleViewerAuditor)
	if _, err := UpdateClockStart(viewer, map[string]any{"clock_start": "assignment"}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden for a viewer", err)
	}
}

func TestSwitchModelVersion_PlaceholderRefusedAndAuditedInEngineMode(t *testing.T) {
	resetModelDeps()
	auditlog.ResetForTest()
	rc, _ := adminCtx(t)
	prev := newModelVersion(rc, "v1", "active")
	next := newModelVersion(rc, "v2", "candidate")
	next.IsPlaceholder = true
	SeedModelVersionsForTest(prev)
	SeedModelVersionsForTest(next)
	useMockEngines(t, time.Second)

	_, err := SwitchModelVersion(rc, next.ID, map[string]any{"reason": "try"})
	var de *dataerr.DataError
	if !errors.As(err, &de) || de.Code != dataerr.CodeConflict || de.Message != "placeholder_not_allowed" {
		t.Fatalf("got %v, want Conflict placeholder_not_allowed", err)
	}
	if oneModelVersionRow(prev.ID).Status != "active" || oneModelVersionRow(next.ID).Status != "candidate" {
		t.Fatal("statuses must not change")
	}
	events := auditlog.AllEvents()
	if len(events) != 1 || events[0].Action != "model.version_switched" || events[0].Outcome != "denied" {
		t.Fatalf("got %+v, want one denied model.version_switched", events)
	}
}

func TestSwitchModelVersion_PlaceholderAllowedInFixtureMode(t *testing.T) {
	resetModelDeps()
	auditlog.ResetForTest()
	rc, _ := adminCtx(t)
	SeedModelVersionsForTest(newModelVersion(rc, "v1", "active"))
	next := newModelVersion(rc, "v2", "candidate")
	next.IsPlaceholder = true
	SeedModelVersionsForTest(next)
	state, err := SwitchModelVersion(rc, next.ID, map[string]any{"reason": "ok"})
	check(t, err)
	if state.ActiveVersion != "v2" {
		t.Fatalf("got %+v", state)
	}
	events := auditlog.AllEvents()
	if len(events) != 1 || events[0].Outcome == "denied" {
		t.Fatalf("got %+v, want one success event", events)
	}
}

func TestActiveForecastModel_ActiveRowElseChampion(t *testing.T) {
	resetModelDeps()
	rc, _ := adminCtx(t)
	if got, err := activeForecastModel(context.Background(), rc.CustomerID); err != nil || got != DefaultChampionModel {
		t.Fatalf("no rows: got %q %v, want the champion", got, err)
	}
	SeedModelVersionsForTest(newModelVersion(rc, "ensemble-3", "retired"))
	SeedModelVersionsForTest(newModelVersion(rc, "ensemble-4", "active"))
	if got, err := activeForecastModel(context.Background(), rc.CustomerID); err != nil || got != "ensemble-4" {
		t.Fatalf("got %q %v, want the active row", got, err)
	}
}

func TestModelVersionFixtures_OnlyRealEngineModels(t *testing.T) {
	ReloadModelVersionsForTest()
	t.Cleanup(ReloadModelVersionsForTest)
	for _, v := range allModelVersionRows() {
		if v.IsPlaceholder || strings.HasPrefix(v.Version, "placeholder") {
			t.Fatalf("fixture seeds a placeholder model: %+v", v)
		}
	}
	rc, _ := adminCtx(t)
	if got, _ := activeForecastModel(context.Background(), rc.CustomerID); got != DefaultChampionModel {
		t.Fatalf("active fixture model %q, want %q", got, DefaultChampionModel)
	}
}
