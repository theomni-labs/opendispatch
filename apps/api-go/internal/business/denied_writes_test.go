// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

type deniedWrite struct {
	action, entityType string
	call               func() error
}

// expectDenied: forbidden plus one denied event.
func expectDenied(t *testing.T, cases []deniedWrite) {
	t.Helper()
	for _, c := range cases {
		auditlog.ResetForTest()
		if err := c.call(); errCode(err) != dataerr.CodeForbidden {
			t.Fatalf("%s: got %v, want Forbidden", c.action, err)
		}
		events := auditlog.AllEvents()
		if len(events) != 1 || events[0].Outcome != "denied" || events[0].Action != c.action || events[0].EntityType != c.entityType {
			t.Fatalf("%s: got %+v", c.action, events)
		}
	}
}

const junkID = "not-an-id"

func TestDeniedWrites_BreaksAuditedByGo(t *testing.T) {
	ctx, rc := context.Background(), viewer()
	expectDenied(t, []deniedWrite{
		{"break.plan_generated", "roster", func() error { _, err := GenerateBreakPlan(ctx, nil, rc, "x"); return err }},
		{"break.slot_moved", "roster_assignment", func() error { _, err := UpdateBreakSlot(ctx, nil, rc, junkID, 12.0); return err }},
	})
}

func TestDeniedWrites_ScenariosAuditedByGo(t *testing.T) {
	ctx, rc := context.Background(), viewer()
	expectDenied(t, []deniedWrite{
		{"scenario.created", "scenario", func() error { _, err := CreateScenario(ctx, nil, rc, "x"); return err }},
		{"scenario.updated", "scenario", func() error { _, err := UpdateScenario(ctx, nil, rc, junkID, 12.0); return err }},
		{"scenario.deleted", "scenario", func() error { return DeleteScenario(rc, junkID) }},
		{"scenario.run", "scenario", func() error { _, err := RunScenario(ctx, nil, rc, junkID); return err }},
	})
}

func TestDeniedWrites_SimulationAuditedByGo(t *testing.T) {
	expectDenied(t, []deniedWrite{
		{"simulation.run", "simulation_run", func() error { _, err := RunSimulation(context.Background(), nil, viewer(), "x"); return err }},
	})
}

func TestDeniedWrites_ModelsAuditedByGo(t *testing.T) {
	rc := viewer()
	expectDenied(t, []deniedWrite{
		{"model.version_switched", "model_version", func() error { _, err := SwitchModelVersion(rc, junkID, "x"); return err }},
		{"model.paused", "model", func() error { _, err := PauseModel(rc, 12.0); return err }},
		{"model.resumed", "model", func() error { _, err := ResumeModel(rc, nil); return err }},
		{"model.retraining_schedule_changed", "model", func() error { _, err := UpdateRetrainingSchedule(rc, []any{}); return err }},
		{"forecast.run_created", "forecast_run", func() error { _, err := CreateForecastRun(context.Background(), nil, rc, "x"); return err }},
	})
}

func TestDeniedWrites_StandbyAuditedByGo(t *testing.T) {
	expectDenied(t, []deniedWrite{
		{"standby.moved", "roster", func() error { _, err := ApplyStandbyMove(viewer(), "x"); return err }},
	})
}

func TestDeniedWrites_RemoteAuditedByGo(t *testing.T) {
	expectDenied(t, []deniedWrite{
		{"remote_queue.reviewer_assigned", "case", func() error {
			_, err := AssignRemoteReviewer(context.Background(), nil, viewer(), junkID, 12.0)
			return err
		}},
	})
}

func TestDeniedWrites_ImportsAuditedByGo(t *testing.T) {
	ctx, rc := context.Background(), viewer()
	expectDenied(t, []deniedWrite{
		{"data_quality.issue_updated", "data_quality_issue", func() error { _, err := UpdateDataQualityIssue(ctx, nil, rc, junkID, "x"); return err }},
		{"import.uploaded", "import_job", func() error { _, err := UploadImport(ctx, nil, rc, 12.0); return err }},
		{"import.validated", "import_job", func() error { _, err := ValidateImport(ctx, nil, rc, junkID); return err }},
		{"import.compared", "import_job", func() error { _, err := CompareImport(ctx, nil, rc, junkID); return err }},
		{"import.dry_run", "import_job", func() error { _, err := DryRunCutover(ctx, nil, rc, junkID); return err }},
		{"import.cut_over", "import_job", func() error { _, err := ExecuteCutover(ctx, nil, rc, junkID); return err }},
		{"import.rolled_back", "import_job", func() error { _, err := RollbackImport(ctx, nil, rc, junkID); return err }},
	})
}

func TestGapSurplus_RefusesCraftedIDsBeforeReading(t *testing.T) {
	rc := roleCtx("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", access.RolePlanner)
	for _, q := range []GapQuery{{RosterID: junkID}, {ScenarioID: "toString"}, {ZoneID: "../x"}} {
		if _, err := GetGapSurplus(context.Background(), nil, rc, q); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("%+v: got %v, want Invalid", q, err)
		}
	}
}

func viewer() reqctx.RequestContext {
	return roleCtx("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", access.RoleViewerAuditor)
}

func TestDeniedWrites_RostersAuditedByGoForAnyIDOrBody(t *testing.T) {
	ctx, rc, junk := context.Background(), viewer(), junkID
	expectDenied(t, []deniedWrite{
		{"roster.built", "roster", func() error { _, err := BuildRoster(ctx, nil, rc, "not an object"); return err }},
		{"roster.submitted", "roster", func() error { _, err := SubmitRoster(ctx, nil, rc, junk); return err }},
		{"roster.approved", "roster", func() error { _, err := ApproveRoster(ctx, nil, rc, junk, 12.0); return err }},
		{"roster.rejected", "roster", func() error { _, err := RejectRoster(ctx, nil, rc, junk, nil); return err }},
		{"roster.publish_stub", "roster", func() error { _, err := PublishRoster(ctx, nil, rc, junk); return err }},
		{"override.created", "roster", func() error { _, err := CreateOverride(ctx, nil, rc, junk, "not an object"); return err }},
		{"override.approved", "override", func() error { _, err := ApproveOverride(ctx, nil, rc, junk, 12.0); return err }},
		{"override.rejected", "override", func() error { _, err := RejectOverride(ctx, nil, rc, junk, []any{}); return err }},
	})
}
