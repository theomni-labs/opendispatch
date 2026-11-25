// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

func buildWithOptimizer(t *testing.T, w engineWorld, optimizer ...string) Roster {
	t.Helper()
	ctx := context.Background()
	script := []enginetest.Behavior{{Kind: enginetest.Answer, Body: w.forecasterAnswer()}}
	for _, o := range optimizer {
		script = append(script, enginetest.Behavior{Kind: enginetest.Answer, Body: o})
	}
	w.srv.Script(script...)
	_, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	roster, err := BuildRoster(ctx, w.conn, w.actors.Roster, map[string]any{"zone_id": w.zoneID, "roster_date": w.tomorrow, "forecast_run_id": nil})
	check(t, err)
	return roster
}

func rosterLinesOf(t *testing.T, w engineWorld, rosterID string) []RosterAssignment {
	t.Helper()
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	page, err := ListRosterAssignments(context.Background(), w.conn, rc, rosterID, datactx.PageQuery{})
	check(t, err)
	return page.Items
}

func TestEngineRosterLinesAreTheOptimizersLines(t *testing.T) {
	w := newEngineWorld(t)
	roster := buildWithOptimizer(t, w, w.optimizerAnswer())
	lines := rosterLinesOf(t, w, roster.ID)
	if len(lines) != 2 {
		t.Fatalf("got %d lines, want the optimizer's 2", len(lines))
	}
	for _, l := range lines {
		if l.BreakStartAt == nil || *l.BreakStartAt != w.tomorrow+"T10:00:00+03:00" || *l.BreakEndAt != w.tomorrow+"T10:30:00+03:00" ||
			l.StartAt != w.tomorrow+"T06:00:00+03:00" || l.EndAt != w.tomorrow+"T14:00:00+03:00" ||
			l.StandbyPointID == nil || *l.StandbyPointID != w.fx.pointID || l.ShiftPatternID == nil || *l.ShiftPatternID != w.fx.patternID || l.IsOverride {
			t.Fatalf("got %+v, want the optimizer's shift, break and standby point", l)
		}
	}
	withVehicle := 0
	for _, l := range lines {
		if l.VehicleID != nil && *l.VehicleID == w.fx.vehicleID && l.AgentID == w.fx.agent1 {
			withVehicle++
		}
	}
	if withVehicle != 1 {
		t.Fatalf("got %d lines with the optimizer's vehicle on agent 1, want 1", withVehicle)
	}
	if roster.OptimizerStatus == nil || *roster.OptimizerStatus != "feasible" {
		t.Fatalf("got %v, want the optimizer's status", roster.OptimizerStatus)
	}
	stored, err := oneRoster(context.Background(), w.conn, w.tenantID, roster.ID)
	check(t, err)
	if !strPtrIs(roster.OptimizerSource, "optimizer") || roster.FallbackReason != nil || stored == nil || !strPtrIs(stored.OptimizerSource, "optimizer") || stored.FallbackReason != nil {
		t.Fatalf("got %v and %v, stored %+v, want optimizer and no reason, kept", roster.OptimizerSource, roster.FallbackReason, stored)
	}
}

func strPtrIs(p *string, want string) bool { return p != nil && *p == want }

func TestEngineRosterOutsideTheForecastWindowSaysNoForecastForDay(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()})
	_, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	far := shiftDateBy(w.today, forecastcal.DefaultHorizonDays+3)
	roster, err := BuildRoster(ctx, w.conn, w.actors.Roster, map[string]any{"zone_id": w.zoneID, "roster_date": far, "forecast_run_id": nil})
	check(t, err)
	stored, err := oneRoster(ctx, w.conn, w.tenantID, roster.ID)
	check(t, err)
	if !strPtrIs(roster.OptimizerSource, "fallback") || !strPtrIs(roster.FallbackReason, "no_forecast_for_day") || stored == nil || !strPtrIs(stored.FallbackReason, "no_forecast_for_day") {
		t.Fatalf("got %v and %v, want fallback and no_forecast_for_day, kept", roster.OptimizerSource, roster.FallbackReason)
	}
}

func TestEngineRosterWithTheOptimizerDownSaysEngineUnavailable(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()}, enginetest.Behavior{Kind: enginetest.Status500})
	_, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	roster, err := BuildRoster(ctx, w.conn, w.actors.Roster, map[string]any{"zone_id": w.zoneID, "roster_date": w.tomorrow, "forecast_run_id": nil})
	check(t, err)
	if !strPtrIs(roster.OptimizerSource, "fallback") || !strPtrIs(roster.FallbackReason, "engine_unavailable") {
		t.Fatalf("got %v and %v, want fallback and engine_unavailable", roster.OptimizerSource, roster.FallbackReason)
	}
}

func TestFallbackReasonClassesAreFixed(t *testing.T) {
	run := &ForecastRun{HorizonStartDate: "2026-09-13", HorizonDays: 10}
	cases := []struct {
		err  error
		run  *ForecastRun
		date string
		want string
	}{
		{ErrEngineAnswer, run, "2026-09-25", "no_forecast_for_day"},
		{inputErr("forecast run x has no values for 2026-09-21"), run, "2026-09-21", "no_forecast_for_day"},
		{inputErr("no forecast run"), nil, "2026-09-21", "no_forecast_for_day"},
		{inputErr("zone has no shift"), run, "2026-09-21", "no_answer"},
		{ErrEngineAnswer, run, "2026-09-21", "no_answer"},
		{engines.ErrInvalidResponse, run, "2026-09-21", "no_answer"},
		{engines.ErrBreakerOpen, run, "2026-09-21", "engine_unavailable"},
		{engines.ErrTimeout, run, "2026-09-22", "engine_unavailable"},
	}
	for _, c := range cases {
		if got := fallbackReason(c.err, c.run, c.date); got != c.want {
			t.Errorf("%v on %s: got %s, want %s", c.err, c.date, got, c.want)
		}
	}
}

func TestEngineRosterShowsPartialAndKeepsGaps(t *testing.T) {
	w := newEngineWorld(t)
	roster := buildWithOptimizer(t, w, w.optimizerAnswerWith("partial", w.optimizerLines()[:1]))
	if roster.OptimizerStatus == nil || *roster.OptimizerStatus != "partial" || !roster.Illustrative {
		t.Fatalf("got %+v, want partial and Illustrative", roster)
	}
	if roster.GapCount == nil || *roster.GapCount == 0 {
		t.Fatalf("got %v gaps, want the gaps kept, not hidden", roster.GapCount)
	}
	if n := len(rosterLinesOf(t, w, roster.ID)); n != 1 {
		t.Fatalf("got %d lines, want the optimizer's 1", n)
	}
}

func TestEngineRosterInfeasibleHasNoLinesAndSaysSo(t *testing.T) {
	w := newEngineWorld(t)
	roster := buildWithOptimizer(t, w, w.optimizerAnswerWith("infeasible", []map[string]any{}))
	if roster.OptimizerStatus == nil || *roster.OptimizerStatus != "infeasible" || len(rosterLinesOf(t, w, roster.ID)) != 0 {
		t.Fatalf("got %+v, want infeasible with no lines", roster)
	}
}

func TestEngineRebuildKeepsLockedLinesAndSendsThemAsFixed(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	admin, _ := adminCtx(t)
	admin.CustomerID = w.tenantID
	s3, err := CreateAgent(ctx, w.conn, admin, map[string]any{
		"code": "SUR-3", "name_en": "Agent Three", "kind": "field", "home_zone_id": w.zoneID,
		"extra": map[string]any{"home_shift": "day_a", "standby_point_id": w.fx.pointID},
	})
	check(t, err)
	first := w.optimizerAnswer()
	again := w.optimizerAnswerWith("feasible", append(w.optimizerLines()[1:], map[string]any{"agent_id": s3.ID, "shift_pattern_id": w.fx.patternID, "zone_id": w.zoneID,
		"roster_date": w.tomorrow, "start_at": w.tomorrow + "T06:00:00+03:00", "end_at": w.tomorrow + "T14:00:00+03:00"}))
	roster := buildWithOptimizer(t, w, first, again)

	var target RosterAssignment
	for _, l := range rosterLinesOf(t, w, roster.ID) {
		if l.AgentID == w.fx.agent1 {
			target = l
		}
	}
	override, err := CreateOverride(ctx, w.conn, w.actors.Roster, roster.ID, map[string]any{
		"roster_assignment_id": target.ID, "change_type": "replace_agent", "reason_code": "agent_unavailable", "agent_id": s3.ID})
	check(t, err)
	supervisor := roleCtx(w.tenantID, "00000000-0000-4000-8000-000000000202", access.RoleDispatchSupervisor)
	_, err = ApproveOverride(ctx, w.conn, supervisor, override.ID, nil)
	check(t, err)

	rebuilt, err := BuildRoster(ctx, w.conn, w.actors.Roster, map[string]any{"zone_id": w.zoneID, "roster_date": w.tomorrow, "forecast_run_id": nil})
	check(t, err)
	lines := rosterLinesOf(t, w, rebuilt.ID)
	byAgent := map[string]RosterAssignment{}
	for _, l := range lines {
		byAgent[l.AgentID] = l
	}
	if len(lines) != 2 || len(byAgent) != 2 || !byAgent[s3.ID].IsOverride || byAgent[w.fx.agent2].IsOverride {
		t.Fatalf("got %+v, want the locked line of agent 3 and the optimizer's line of agent 2", lines)
	}
	reqs := w.srv.Requests()
	var sent struct {
		Fixed []map[string]any `json:"fixed_assignments"`
	}
	check(t, json.Unmarshal([]byte(reqs[len(reqs)-1].Body), &sent))
	if len(sent.Fixed) != 1 || sent.Fixed[0]["agent_id"] != s3.ID || sent.Fixed[0]["zone_id"] != w.zoneID {
		t.Fatalf("got %v, want the locked line sent as fixed", sent.Fixed)
	}
	checkRequest(t, "optimizer", []byte(reqs[len(reqs)-1].Body))
}

func TestEngineAnswerWithAnUnknownAgentFallsBackAndSaysStale(t *testing.T) {
	w := newEngineWorld(t)
	bad := w.optimizerAnswerWith("feasible", []map[string]any{{"agent_id": datactx.NewID(), "shift_pattern_id": w.fx.patternID, "zone_id": w.zoneID, "roster_date": w.tomorrow,
		"start_at": w.tomorrow + "T06:00:00+03:00", "end_at": w.tomorrow + "T14:00:00+03:00"}})
	roster := buildWithOptimizer(t, w, bad)
	if !strPtrIs(roster.OptimizerSource, "fallback") || !strPtrIs(roster.FallbackReason, "no_answer") {
		t.Fatalf("got %v and %v, want fallback and no_answer", roster.OptimizerSource, roster.FallbackReason)
	}
	for _, l := range rosterLinesOf(t, w, roster.ID) {
		if l.BreakStartAt == nil || l.AgentID != w.fx.agent1 && l.AgentID != w.fx.agent2 {
			t.Fatalf("got %+v, want the placeholder lines of the zone's own agents", l)
		}
	}
}

func TestEngineRosterLinesBreaksUpWithPrayerWhenAsked(t *testing.T) {
	w := newEngineWorld(t)
	admin, _ := adminCtx(t)
	admin.CustomerID = w.tenantID
	zones, err := allZones(context.Background(), w.conn, w.tenantID)
	check(t, err)
	for _, z := range zones {
		if z.ID == w.zoneID {
			_, err = UpdateZone(context.Background(), w.conn, admin, z.ID, map[string]any{"city_id": z.CityID, "name_en": z.NameEn, "latitude": 24.7, "longitude": 46.7})
			check(t, err)
		}
	}
	_, err = UpdateBreakPrayerPolicy(admin, map[string]any{"prayer_policy": PolicyLinedUp, "prayer_window_minutes": float64(20)})
	check(t, err)
	t.Cleanup(func() {
		_, _ = UpdateBreakPrayerPolicy(admin, map[string]any{"prayer_policy": PolicyClear, "prayer_window_minutes": float64(30)})
	})
	roster := buildWithOptimizer(t, w, w.optimizerAnswer())
	reqs := w.srv.Requests()
	var sent struct {
		Window int `json:"prayer_window_minutes"`
	}
	check(t, json.Unmarshal([]byte(reqs[len(reqs)-1].Body), &sent))
	if sent.Window != 20 {
		t.Fatalf("got %d, want the 20-minute window sent", sent.Window)
	}
	prayers, err := PrayerMinutesFor(context.Background(), w.conn, w.tenantID, w.zoneID, w.tomorrow)
	check(t, err)
	pol := PrayerPolicy{Mode: PolicyLinedUp, Window: 20}
	if len(prayers) == 0 {
		t.Fatal("want the zone's prayer times")
	}
	linedUp := 0
	for _, l := range rosterLinesOf(t, w, roster.ID) {
		s, _ := MinutesOf(w.tomorrow, *l.BreakStartAt)
		e, _ := MinutesOf(w.tomorrow, *l.BreakEndAt)
		if PrayerConflictOf(s, e, prayers, pol) != nil {
			t.Fatalf("break %s-%s cuts a prayer of %v", *l.BreakStartAt, *l.BreakEndAt, prayers)
		}
		if linesUpWithPrayer(s, e, prayers, pol) {
			linedUp++
		}
	}
	if linedUp != 1 {
		t.Fatalf("got %d breaks on dhuhr, want 1 (the share allows one away at a time)", linedUp)
	}
	page, err := ListAuditEvents(admin, AuditFilter{ActionPrefix: "roster.built"})
	check(t, err)
	if len(page.Items) == 0 || page.Items[0].Detail["breaks_lined_up"] == nil {
		t.Fatalf("want breaks_lined_up in the audit detail, got %+v", page.Items)
	}
}

func TestEngineRosterSendsTheChosenModelAndKeepsItsProof(t *testing.T) {
	w := newEngineWorld(t)
	admin, _ := adminCtx(t)
	admin.CustomerID = w.tenantID
	_, err := UpdateOptimizerModel(admin, map[string]any{"optimizer_model": "cpsat-1"})
	check(t, err)
	t.Cleanup(func() { _, _ = UpdateOptimizerModel(admin, map[string]any{"optimizer_model": defaultOptimizerModel}) })
	var answer map[string]any
	check(t, json.Unmarshal([]byte(w.optimizerAnswer()), &answer))
	answer["model_version"], answer["solver_status"] = "cpsat-1", "optimal"
	body, err := json.Marshal(answer)
	check(t, err)
	roster := buildWithOptimizer(t, w, string(body))
	reqs := w.srv.Requests()
	var sent struct {
		Objective map[string]any `json:"objective"`
	}
	check(t, json.Unmarshal([]byte(reqs[len(reqs)-1].Body), &sent))
	if sent.Objective["model_version"] != "cpsat-1" {
		t.Fatalf("got %v, want cpsat-1 sent", sent.Objective["model_version"])
	}
	stored, err := oneRoster(context.Background(), w.conn, w.tenantID, roster.ID)
	check(t, err)
	if !strPtrIs(roster.OptimizerModel, "cpsat-1") || !strPtrIs(roster.SolverStatus, "optimal") || stored == nil || !strPtrIs(stored.OptimizerModel, "cpsat-1") || !strPtrIs(stored.SolverStatus, "optimal") {
		t.Fatalf("got %v %v, stored %+v, want cpsat-1 optimal", roster.OptimizerModel, roster.SolverStatus, stored)
	}
}
