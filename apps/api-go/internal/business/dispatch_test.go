// SPDX-License-Identifier: AGPL-3.0-only

// Pure tests for dispatch.go: no live Postgres, no
// real internal/synthetic implementation needed.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func resetDispatchDeps() {
	ResetReplayCasesForTest()
	ResetDispatchAssignmentsForTest()
	ResetDispatchEngineOutputsForTest()
	ResetZoneStagesForTest()
	ResetSettingsZonesForTest()
	settingsstore.ResetForTest()
}

func TestDispatchFallbackAt_ReflectsCommittedFeedOutageWindow(t *testing.T) {
	resetDispatchDeps()
	// Real fixture: case_feed down 15:20-15:32, 13 Sep.
	before, err := dispatchFallbackAt(context.Background(), "", mustMs(t, "2026-09-13T15:15:00+03:00"))
	check(t, err)
	if before.Active {
		t.Fatalf("got active, want armed before the outage")
	}
	during, err := dispatchFallbackAt(context.Background(), "", mustMs(t, "2026-09-13T15:25:00+03:00"))
	check(t, err)
	if !during.Active || during.Reason != "feed_outage" || !during.OutageActive {
		t.Fatalf("got %+v, want an active feed_outage", during)
	}
	after, err := dispatchFallbackAt(context.Background(), "", mustMs(t, "2026-09-13T15:35:00+03:00"))
	check(t, err)
	if after.Active {
		t.Fatalf("got %+v, want armed again after the outage clears", after)
	}
}

func TestDispatchFallbackAt_ManualMaintenanceOverridesOutage(t *testing.T) {
	resetDispatchDeps()
	_ = dispatchAppendFallbackEvent(context.Background(), "", DispatchFallbackEvent{At: "2026-09-13T15:22:00+03:00", Kind: "maintenance", Active: true})
	view, err := dispatchFallbackAt(context.Background(), "", mustMs(t, "2026-09-13T15:25:00+03:00"))
	check(t, err)
	if view.Reason != "maintenance" || !view.Maintenance {
		t.Fatalf("got %+v, want maintenance to take precedence over the outage", view)
	}
}

func mustMs(t *testing.T, iso string) int64 {
	t.Helper()
	tm, err := datactx.EpochOf(iso)
	check(t, err)
	return tm.UnixMilli()
}

func TestDispatchLiveCase_StoredDecisionWins(t *testing.T) {
	c := Case{ID: "c1", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-13T09:00:00+03:00", DataSource: "SYNTHETIC"}
	env := DispatchEnvironment{
		AtMs: mustMs(t, "2026-09-13T09:10:00+03:00"), Stages: map[string]string{"z1": "automatic"},
		Stored: map[string]Assignment{"c1": {CaseID: "c1", AgentID: "s1", Source: "MANUAL", State: "assigned"}},
	}
	lc, err := dispatchLiveCase(c, env, map[string]AssignmentEngineOutput{})
	check(t, err)
	if lc.State != "overridden" || lc.AssignedAgentID == nil || *lc.AssignedAgentID != "s1" {
		t.Fatalf("got %+v, want overridden (MANUAL source) assigned to s1", lc)
	}
}

func TestDispatchLiveCase_ShadowStageShowsCustomerWhenAssigned(t *testing.T) {
	assignedAt := "2026-09-13T09:05:00+03:00"
	agent := "customer-agent"
	c := Case{ID: "c1", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-13T09:00:00+03:00", AssignedAt: &assignedAt, AgentID: &agent, DataSource: "SYNTHETIC"}
	env := DispatchEnvironment{AtMs: mustMs(t, "2026-09-13T09:10:00+03:00"), Stages: map[string]string{"z1": "shadow"}}
	lc, err := dispatchLiveCase(c, env, map[string]AssignmentEngineOutput{})
	check(t, err)
	if lc.State != "assigned" || lc.AssignmentSource == nil || *lc.AssignmentSource != "CUSTOMER_FALLBACK" {
		t.Fatalf("got %+v, want assigned via CUSTOMER_FALLBACK in shadow stage", lc)
	}
}

func TestDispatchLiveCase_ShadowStageWaitingWhenCustomerHasNotAssignedYet(t *testing.T) {
	c := Case{ID: "c1", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-13T09:00:00+03:00", DataSource: "SYNTHETIC"}
	env := DispatchEnvironment{AtMs: mustMs(t, "2026-09-13T09:10:00+03:00"), Stages: map[string]string{"z1": "shadow"}}
	lc, err := dispatchLiveCase(c, env, map[string]AssignmentEngineOutput{})
	check(t, err)
	if lc.State != "waiting" {
		t.Fatalf("got %+v, want waiting", lc)
	}
}

func TestDispatchLiveCase_AutomaticStageAssignsFromRecommendation(t *testing.T) {
	c := Case{ID: "c1", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-13T09:00:00+03:00", DataSource: "SYNTHETIC"}
	env := DispatchEnvironment{AtMs: mustMs(t, "2026-09-13T09:10:00+03:00"), Stages: map[string]string{"z1": "automatic"}, DeadlineMs: 60_000}
	output := AssignmentEngineOutput{CaseID: "c1", Status: "ranked", DecisionTimeMs: 500, Ranking: []AssignmentEngineRanked{{AgentID: "s1", EstimatedTravelSeconds: 300, EstimatedArrivalAt: "2026-09-13T09:15:00+03:00", ReasonCodes: []string{"NEAREST_BY_TRAVEL_TIME"}, ReasonText: "closest"}}}
	lc, err := dispatchLiveCase(c, env, map[string]AssignmentEngineOutput{"c1": output})
	check(t, err)
	if lc.State != "assigned" || lc.AssignmentSource == nil || *lc.AssignmentSource != "OPENDISPATCH" || lc.AssignedAgentID == nil || *lc.AssignedAgentID != "s1" {
		t.Fatalf("got %+v, want assigned to s1 via OpenDispatch", lc)
	}
}

func TestDispatchLiveCase_RecommendStageWaitsForADispatcher(t *testing.T) {
	c := Case{ID: "c1", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-13T09:00:00+03:00", DataSource: "SYNTHETIC"}
	env := DispatchEnvironment{AtMs: mustMs(t, "2026-09-13T09:10:00+03:00"), Stages: map[string]string{"z1": "recommend"}, DeadlineMs: 60_000}
	output := AssignmentEngineOutput{CaseID: "c1", Status: "ranked", DecisionTimeMs: 500, Ranking: []AssignmentEngineRanked{{AgentID: "s1", EstimatedArrivalAt: "2026-09-13T09:15:00+03:00", ReasonCodes: []string{"NEAREST_BY_TRAVEL_TIME"}, ReasonText: "closest"}}}
	lc, err := dispatchLiveCase(c, env, map[string]AssignmentEngineOutput{"c1": output})
	check(t, err)
	if lc.State != "recommended" || lc.Recommendation == nil || lc.Recommendation.AgentID != "s1" {
		t.Fatalf("got %+v, want recommended with s1's recommendation", lc)
	}
}

func TestDispatchLiveCase_FallsBackWhenOpenDispatchMissesTheDeadline(t *testing.T) {
	c := Case{ID: "c1", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-13T09:00:00+03:00", DataSource: "SYNTHETIC"}
	env := DispatchEnvironment{AtMs: mustMs(t, "2026-09-13T09:10:00+03:00"), Stages: map[string]string{"z1": "automatic"}, DeadlineMs: 1000}
	output := AssignmentEngineOutput{CaseID: "c1", Status: "ranked", DecisionTimeMs: 5000, Ranking: []AssignmentEngineRanked{{AgentID: "s1", EstimatedArrivalAt: "2026-09-13T09:15:00+03:00", ReasonCodes: []string{"NEAREST_BY_TRAVEL_TIME"}, ReasonText: "closest"}}}
	lc, err := dispatchLiveCase(c, env, map[string]AssignmentEngineOutput{"c1": output})
	check(t, err)
	if lc.State != "fallback_assigned" {
		t.Fatalf("got %+v, want fallback_assigned when the engine misses OpenDispatch's decision deadline", lc)
	}
}

func TestDecisionDeadlineMs_IsTheSettingElseTheEngineDeadlineNeverCustomersTimer(t *testing.T) {
	resetDispatchDeps()
	UseFixtureEngines()
	ctx := context.Background()
	check(t, settingsstore.Put(ctx, "", "fallback_timeout_seconds", 1))
	if got := decisionDeadlineMs(ctx, ""); got != 2000 {
		t.Fatalf("got %d, want the engine's 2000 ms deadline, not the customer's timer", got)
	}
	check(t, settingsstore.Put(ctx, "", "decision_deadline_ms", 300))
	if got := decisionDeadlineMs(ctx, ""); got != 300 {
		t.Fatalf("got %d, want the decision_deadline_ms setting", got)
	}
}

func customerAssignedCase(assignedAt string) Case {
	agent := "customer-s9"
	return Case{ID: "c1", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-13T09:00:00+03:00", AssignedAt: &assignedAt, AgentID: &agent, DataSource: "SYNTHETIC"}
}

func rankedS1() map[string]AssignmentEngineOutput {
	return map[string]AssignmentEngineOutput{"c1": {CaseID: "c1", Status: "ranked", DecisionTimeMs: 50, Ranking: []AssignmentEngineRanked{{AgentID: "s1", EstimatedArrivalAt: "2026-09-13T09:15:00+03:00", ReasonCodes: []string{"NEAREST_BY_TRAVEL_TIME"}, ReasonText: "closest"}}}}
}

func TestDispatchLiveCase_CustomerAssignmentIsFinalAtEveryNonShadowStage(t *testing.T) {
	for _, stage := range []string{"recommend", "automatic"} {
		env := DispatchEnvironment{AtMs: mustMs(t, "2026-09-13T14:00:00+03:00"), Stages: map[string]string{"z1": stage}, DeadlineMs: 60_000}
		lc, err := dispatchLiveCase(customerAssignedCase("2026-09-13T09:05:00+03:00"), env, rankedS1())
		check(t, err)
		if lc.State != "fallback_assigned" || lc.AssignmentSource == nil || *lc.AssignmentSource != "CUSTOMER_FALLBACK" ||
			lc.AssignedAgentID == nil || *lc.AssignedAgentID != "customer-s9" || lc.AssignmentID != nil {
			t.Fatalf("%s: got %+v, want the customer's agent with source CUSTOMER_FALLBACK, never OpenDispatch", stage, lc)
		}
	}
}

func TestDispatchLiveCase_AutomaticStageIsOpenDispatchUntilCustomerAssigns(t *testing.T) {
	env := DispatchEnvironment{AtMs: mustMs(t, "2026-09-13T09:03:00+03:00"), Stages: map[string]string{"z1": "automatic"}, DeadlineMs: 60_000}
	lc, err := dispatchLiveCase(customerAssignedCase("2026-09-13T09:05:00+03:00"), env, rankedS1())
	check(t, err)
	if lc.State != "assigned" || *lc.AssignmentSource != "OPENDISPATCH" || lc.CustomerAgentID != nil {
		t.Fatalf("got %+v, want OpenDispatch before the customer's assignment arrives", lc)
	}
}

func TestAcceptRecommendation_RefusedWhenCustomerAssignedTheCase(t *testing.T) {
	resetDispatchDeps()
	auditlog.ResetForTest()
	_, tenantID := adminCtx(t)
	dispatcher := roleCtx(tenantID, "00000000-0000-4000-8000-000000000841", access.RoleDispatchSupervisor)
	caseID := "00000000-0000-4000-8000-000000000843"
	assignedAt, customer := "2026-09-13T06:35:00+03:00", "00000000-0000-4000-8000-000000000844"
	SeedReplayCasesForTest([]Case{{ID: caseID, CaseNumber: "RD-7", ZoneID: "z1", RegisteredAt: "2026-09-13T06:30:00+03:00", AssignedAt: &assignedAt, AgentID: &customer, DataSource: "SYNTHETIC"}})
	_, err := ControlReplay(dispatcher, map[string]any{"action": "seek", "replay_at": "2026-09-13T07:00:00+03:00"})
	check(t, err)
	SeedSettingsZonesForTest([]string{"z1"}, datactx.NowISO())
	PutZoneStageForTest(ZoneStage{ZoneID: "z1", Stage: "recommend", DataSource: "SYNTHETIC"})
	auditlog.ResetForTest()

	_, err = AcceptRecommendation(dispatcher, caseID, map[string]any{"agent_id": "00000000-0000-4000-8000-000000000842"})
	if errCode(err) != dataerr.CodeConflict || !strings.Contains(err.Error(), "CUSTOMER_ASSIGNED") {
		t.Fatalf("got %v, want the CUSTOMER_ASSIGNED conflict", err)
	}
	if stored, _ := loadAssignments(context.Background(), tenantID); len(stored) != 0 {
		t.Fatalf("got %+v, want nothing stored for a Customer-assigned case", stored)
	}
	got := auditlog.AllEvents()
	if len(got) != 1 || got[0].Outcome != "denied" || got[0].Action != "assignment.accepted" || got[0].Detail["reason"] != "CUSTOMER_ASSIGNED" || got[0].Detail["case_id"] != caseID {
		t.Fatalf("got %+v, want one denied assignment.accepted with reason CUSTOMER_ASSIGNED", got)
	}
}

func TestDispatchMedian_EvenAndOdd(t *testing.T) {
	if got := dispatchMedian(nil); got != nil {
		t.Fatalf("got %v, want nil for no values", got)
	}
	if got := dispatchMedian([]float64{1, 2, 3}); got == nil || *got != 2 {
		t.Fatalf("got %v, want 2", got)
	}
	if got := dispatchMedian([]float64{1, 2, 3, 4}); got == nil || *got != 2.5 {
		t.Fatalf("got %v, want 2.5", got)
	}
}

func TestDispatchReadingOf_NullShareWithNoKnownFlags(t *testing.T) {
	r := dispatchReadingOf([]*bool{nil, nil})
	if r.Share != nil || r.CaseCount != 0 {
		t.Fatalf("got %+v, want a nil share with no known flags", r)
	}
	yes, no := true, false
	r2 := dispatchReadingOf([]*bool{&yes, &no, &yes})
	if r2.CaseCount != 3 || r2.WithinCount != 2 || r2.Share == nil || *r2.Share != 0.6667 {
		t.Fatalf("got %+v, want 2/3 rounded to 0.6667", r2)
	}
}

func TestReadDispatchClock_DefaultsToScriptStart(t *testing.T) {
	resetDispatchDeps()
	clock, err := readDispatchClock(context.Background(), "")
	check(t, err)
	if clock.Status != "stopped" || clock.AtMs != mustMs(t, "2026-09-13T07:00:00+03:00") {
		t.Fatalf("got %+v, want stopped at the script's default_start_at", clock)
	}
}

func TestControlReplay_PlayPauseStopSeek(t *testing.T) {
	resetDispatchDeps()
	_, tenantID := adminCtx(t)
	rc := roleCtx(tenantID, "00000000-0000-4000-8000-000000000811", access.RoleDispatchSupervisor)

	_, err := ControlReplay(rc, map[string]any{"action": "play", "speed": 120.0})
	check(t, err)
	clock, err := readDispatchClock(context.Background(), "")
	check(t, err)
	if clock.Status != "playing" || clock.Speed != 120 {
		t.Fatalf("got %+v, want playing at speed 120", clock)
	}

	_, err = ControlReplay(rc, map[string]any{"action": "pause"})
	check(t, err)
	clock, err = readDispatchClock(context.Background(), "")
	check(t, err)
	if clock.Status != "paused" {
		t.Fatalf("got %+v, want paused", clock)
	}

	_, err = ControlReplay(rc, map[string]any{"action": "seek", "replay_at": "2026-09-13T10:00:00+03:00"})
	check(t, err)
	clock, err = readDispatchClock(context.Background(), "")
	check(t, err)
	if clock.AtMs != mustMs(t, "2026-09-13T10:00:00+03:00") {
		t.Fatalf("got %+v, want the clock at 10:00", clock)
	}

	_, err = ControlReplay(rc, map[string]any{"action": "stop"})
	check(t, err)
	clock, err = readDispatchClock(context.Background(), "")
	check(t, err)
	if clock.Status != "stopped" || clock.AtMs != mustMs(t, "2026-09-13T07:00:00+03:00") {
		t.Fatalf("got %+v, want stopped back at the start", clock)
	}
}

func TestControlReplay_DenialIsAuditedAndChangesNothing(t *testing.T) {
	resetDispatchDeps()
	auditlog.ResetForTest()
	_, tenantID := adminCtx(t)
	before, err := readDispatchClock(context.Background(), tenantID)
	check(t, err)
	roles := []access.Role{access.RolePlanner, access.RoleViewerAuditor}
	for i, role := range roles {
		rc := roleCtx(tenantID, fmt.Sprintf("00000000-0000-4000-8000-00000000082%d", i), role)
		_, err := ControlReplay(rc, "not even an object")
		if errCode(err) != dataerr.CodeForbidden {
			t.Fatalf("%s: got %v, want Forbidden before the body is read", role, err)
		}
	}
	after, err := readDispatchClock(context.Background(), tenantID)
	check(t, err)
	if after != before {
		t.Fatalf("got %+v, want the clock unchanged %+v", after, before)
	}
	events := auditlog.AllEvents()
	if len(events) != len(roles) {
		t.Fatalf("got %d audit events, want one denied event per role", len(events))
	}
	for i, e := range events {
		if e.Outcome != "denied" || e.Action != "replay.controlled" || e.EntityType != "replay" || e.ActorUserID == nil || *e.ActorUserID != fmt.Sprintf("00000000-0000-4000-8000-00000000082%d", i) {
			t.Fatalf("got %+v, want a denied replay.controlled event for the caller", e)
		}
	}
	ok := roleCtx(tenantID, "00000000-0000-4000-8000-000000000829", access.RoleDispatchSupervisor)
	_, err = ControlReplay(ok, map[string]any{"action": "pause"})
	check(t, err)
	if n := len(auditlog.AllEvents()); n != len(roles) {
		t.Fatalf("got %d audit events, want no event for an allowed replay control", n)
	}
}

func TestControlReplay_SeekOutsideReplayDayIsInvalid(t *testing.T) {
	resetDispatchDeps()
	_, tenantID := adminCtx(t)
	rc := roleCtx(tenantID, "00000000-0000-4000-8000-000000000812", access.RoleDispatchSupervisor)
	_, err := ControlReplay(rc, map[string]any{"action": "seek", "replay_at": "2026-09-20T10:00:00+03:00"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid for a replay_at outside the replay day", err)
	}
}

func TestGetLiveBoard_ReflectsSeededReplayCaseAndZoneStage(t *testing.T) {
	resetDispatchDeps()
	_, tenantID := adminCtx(t)
	rc := roleCtx(tenantID, "00000000-0000-4000-8000-000000000813", access.RoleDispatchSupervisor)
	PutZoneStageForTest(ZoneStage{ZoneID: "z1", Stage: "automatic", DataSource: "SYNTHETIC"})
	SeedReplayCasesForTest([]Case{{ID: "c1", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-13T06:30:00+03:00", DataSource: "SYNTHETIC"}})
	_, err := ControlReplay(rc, map[string]any{"action": "seek", "replay_at": "2026-09-13T07:00:00+03:00"})
	check(t, err)

	board, err := GetLiveBoard(rc, LiveBoardQuery{})
	check(t, err)
	if len(board.Cases) != 1 || board.Cases[0].CaseID != "c1" {
		t.Fatalf("got %+v, want the seeded case on the board", board.Cases)
	}
}

func TestListLiveCases_FiltersByZoneAndState(t *testing.T) {
	resetDispatchDeps()
	_, tenantID := adminCtx(t)
	rc := roleCtx(tenantID, "00000000-0000-4000-8000-000000000814", access.RoleDispatchSupervisor)
	SeedReplayCasesForTest([]Case{
		{ID: "c1", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-13T06:30:00+03:00", DataSource: "SYNTHETIC"},
		{ID: "c2", CaseNumber: "RD-2", ZoneID: "z2", RegisteredAt: "2026-09-13T06:31:00+03:00", DataSource: "SYNTHETIC"},
	})
	_, err := ControlReplay(rc, map[string]any{"action": "seek", "replay_at": "2026-09-13T07:00:00+03:00"})
	check(t, err)
	page, err := ListLiveCases(rc, LiveCaseQuery{ZoneID: "z1"})
	check(t, err)
	if len(page.Items) != 1 || page.Items[0].ZoneID != "z1" {
		t.Fatalf("got %+v, want only z1's case", page.Items)
	}
}

func TestAcceptRecommendation_RefusedInShadowStage(t *testing.T) {
	resetDispatchDeps()
	_, tenantID := adminCtx(t)
	planner := roleCtx(tenantID, "00000000-0000-4000-8000-000000000801", access.RoleDispatchSupervisor)
	caseID := "00000000-0000-4000-8000-000000000803"
	SeedReplayCasesForTest([]Case{{ID: caseID, CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-13T06:30:00+03:00", DataSource: "SYNTHETIC"}})
	_, err := ControlReplay(planner, map[string]any{"action": "seek", "replay_at": "2026-09-13T07:00:00+03:00"})
	check(t, err)
	_, err = AcceptRecommendation(planner, caseID, map[string]any{"agent_id": "00000000-0000-4000-8000-000000000802"})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict: shadow stage sends nothing", err)
	}
}

func TestAcceptRecommendation_RefusalOfAnAssignedCaseIsAudited(t *testing.T) {
	resetDispatchDeps()
	auditlog.ResetForTest()
	_, tenantID := adminCtx(t)
	dispatcher := roleCtx(tenantID, "00000000-0000-4000-8000-000000000831", access.RoleDispatchSupervisor)
	caseID := "00000000-0000-4000-8000-000000000833"
	SeedReplayCasesForTest([]Case{{ID: caseID, CaseNumber: "RD-9", ZoneID: "z1", RegisteredAt: "2026-09-13T06:30:00+03:00", DataSource: "SYNTHETIC"}})
	_, err := ControlReplay(dispatcher, map[string]any{"action": "seek", "replay_at": "2026-09-13T07:00:00+03:00"})
	check(t, err)
	SeedSettingsZonesForTest([]string{"z1"}, datactx.NowISO())
	PutZoneStageForTest(ZoneStage{ZoneID: "z1", Stage: "recommend", DataSource: "SYNTHETIC"})
	manual, events := decision(tenantID, caseID, "assigned")
	manual.Source, manual.AgentID = "MANUAL", "00000000-0000-4000-8000-000000000834"
	check(t, saveDecision(context.Background(), tenantID, []Assignment{manual}, events))
	auditlog.ResetForTest()

	_, err = AcceptRecommendation(dispatcher, caseID, map[string]any{"agent_id": "00000000-0000-4000-8000-000000000832"})
	if errCode(err) != dataerr.CodeConflict || !strings.Contains(err.Error(), "ALREADY_ASSIGNED") {
		t.Fatalf("got %v, want the ALREADY_ASSIGNED conflict", err)
	}
	stored, err := loadAssignments(context.Background(), tenantID)
	check(t, err)
	if len(stored) != 1 || stored[0].ID != manual.ID || stored[0].Source != "MANUAL" {
		t.Fatalf("got %+v, want the MANUAL assignment alone, unchanged", stored)
	}
	got := auditlog.AllEvents()
	if len(got) != 1 {
		t.Fatalf("got %d audit events, want one denied event", len(got))
	}
	e := got[0]
	if e.Outcome != "denied" || e.Action != "assignment.accepted" || e.EntityType != "case" || e.EntityID == nil || *e.EntityID != caseID ||
		e.Detail["reason"] != "ALREADY_ASSIGNED" || e.Detail["case_id"] != caseID || !strings.Contains(e.SummaryEn, "RD-9") ||
		e.ActorUserID == nil || *e.ActorUserID != dispatcher.UserID {
		t.Fatalf("got %+v, want a denied assignment.accepted for the case with the reason", e)
	}

	// Other refusals keep their own handling.
	auditlog.ResetForTest()
	_, err = AcceptRecommendation(dispatcher, caseID, "not an object")
	if err == nil || len(auditlog.AllEvents()) != 0 {
		t.Fatalf("got %v and %d events, want an invalid body unaudited", err, len(auditlog.AllEvents()))
	}
}

func jsonKeys(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	check(t, err)
	var m map[string]any
	check(t, json.Unmarshal(raw, &m))
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return strings.Join(keys, ",")
}

func TestDispatchJSON_KeysMatchContract(t *testing.T) {
	cases := map[string]struct {
		v    any
		want string
	}{
		"LiveCase":                {LiveCase{}, "assigned_agent_id,assignment_id,assignment_source,case_id,case_number,customer_agent_id,data_source,estimated_arrival_at,latitude,longitude,parties_involved,recommendation,registered_at,stage,state,sub_zone_id,zone_id"},
		"FallbackState":           {FallbackState{}, "data_source,fallback_assigned_count,last_signal,last_signal_at,opendispatch_healthy,reason,since,state,timeout_seconds"},
		"ReplayState":             {ReplayState{}, "data_source,delivered_cases,feed_outage_active,replay_at,replay_date,speed,status,total_cases"},
		"AgentStatus":             {AgentStatus{}, "agent_id,created_at,created_by,current_case_id,data_source,id,latitude,longitude,position_at,status,tenant_id,updated_at,vehicle_id,zone_id"},
		"Assignment":              {Assignment{}, "agent_id,case_id,created_at,created_by,data_source,decided_at,decided_by_user_id,estimated_arrival_at,estimated_travel_seconds,extra,id,model_version,reason_code,source,stage,state,tenant_id,updated_at"},
		"ShadowComparisonSummary": {ShadowComparisonSummary{}, "cases_compared,customer,data_source,differed_count,from,illustrative,opendispatch,to,zone_id"},
		"TenMinuteReading":        {TenMinuteReading{}, "from_assignment_seconds,from_registration_seconds,threshold_seconds,within_from_assignment,within_from_registration"},
	}
	for name, c := range cases {
		if got := jsonKeys(t, c.v); got != c.want {
			t.Errorf("%s keys:\n got  %s\n want %s", name, got, c.want)
		}
	}
}

func TestGetLiveBoard_EmptyListsAreArraysNotNull(t *testing.T) {
	resetDispatchDeps()
	_, tenantID := adminCtx(t)
	rc := roleCtx(tenantID, "00000000-0000-4000-8000-000000000831", access.RoleDispatchSupervisor)
	SeedReplayCasesForTest(nil)
	board, err := GetLiveBoard(rc, LiveBoardQuery{ZoneID: "no-such-zone"})
	check(t, err)
	raw, err := json.Marshal(board)
	check(t, err)
	if strings.Contains(string(raw), `"stages":null`) || strings.Contains(string(raw), `"cases":null`) {
		t.Fatalf("got %s, want [] for empty stages and cases", raw)
	}
}
