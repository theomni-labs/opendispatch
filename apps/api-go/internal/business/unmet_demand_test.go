// SPDX-License-Identifier: AGPL-3.0-only

// Pure tests for unmet_demand.go.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func ranked(caseID, agentID string, travel int) AssignmentEngineOutput {
	return AssignmentEngineOutput{CaseID: caseID, Status: "ranked", Ranking: []AssignmentEngineRanked{{Rank: 1, AgentID: agentID, EstimatedTravelSeconds: travel}}}
}

func TestUnmetCauseOf_GeographyPeopleOrWithin(t *testing.T) {
	far, near := ranked("c", "s1", 601), ranked("c", "s1", 600)
	none := AssignmentEngineOutput{Status: "no_eligible_agent"}
	taken := AssignmentEngineOutput{Status: "already_assigned"}
	if cause, id, travel := unmetCauseOf(&far, 600); cause != unmetCauseGeography || id == nil || *id != "s1" || travel == nil || *travel != 601 {
		t.Fatalf("far: %q %v %v", cause, id, travel)
	}
	if cause, _, _ := unmetCauseOf(&near, 600); cause != "" {
		t.Fatalf("exactly the threshold is within reach, got %q", cause)
	}
	if cause, id, travel := unmetCauseOf(&none, 600); cause != unmetCausePeople || id != nil || travel != nil {
		t.Fatalf("nobody ranked: %q %v %v", cause, id, travel)
	}
	if cause, _, _ := unmetCauseOf(&taken, 600); cause != "" {
		t.Fatalf("already assigned: %q", cause)
	}
	if cause, _, _ := unmetCauseOf(nil, 600); cause != "" {
		t.Fatalf("no output: %q", cause)
	}
}

func TestUnmetRows_FieldCasesOfTheDayOnTheBoardNewestFirst(t *testing.T) {
	cases := []Case{
		{ID: "a", CaseNumber: "RD-A", ZoneID: "z1", RegisteredAt: "2026-09-13T08:00:00+03:00", Handling: "field", DataSource: "SYNTHETIC"},
		{ID: "b", CaseNumber: "RD-B", ZoneID: "z1", RegisteredAt: "2026-09-13T09:00:00+03:00", Handling: "field", DataSource: "SYNTHETIC"},
		{ID: "r", CaseNumber: "RD-R", ZoneID: "z1", RegisteredAt: "2026-09-13T09:30:00+03:00", Handling: "remote_inferred", DataSource: "SYNTHETIC"},
		{ID: "y", CaseNumber: "RD-Y", ZoneID: "z1", RegisteredAt: "2026-09-12T23:30:00+03:00", Handling: "field", DataSource: "SYNTHETIC"},
		{ID: "u", CaseNumber: "RD-U", ZoneID: "z2", RegisteredAt: "2026-09-13T10:00:00+03:00", Handling: "field", DataSource: "SYNTHETIC"},
	}
	live := map[string]LiveCase{"a": {State: "waiting"}, "b": {State: "assigned"}, "r": {}, "y": {}}
	outputs := map[string]AssignmentEngineOutput{
		"a": ranked("a", "s1", 900), "b": {CaseID: "b", Status: "no_eligible_agent"},
		"r": ranked("r", "s1", 900), "y": ranked("y", "s1", 900), "u": ranked("u", "s1", 900),
	}
	rows := unmetRows(cases, live, outputs, "2026-09-13", 600)
	if len(rows) != 2 || rows[0].CaseID != "b" || rows[1].CaseID != "a" {
		t.Fatalf("got %+v, want b then a", rows)
	}
	if rows[0].Cause != unmetCausePeople || rows[0].State != "assigned" || rows[1].Cause != unmetCauseGeography || rows[1].ThresholdSeconds != 600 {
		t.Fatalf("got %+v", rows)
	}
	if got := unmetRows(cases, live, outputs, "2026-09-13", 900); len(got) != 1 || got[0].CaseID != "b" {
		t.Fatalf("a higher threshold keeps only the people case, got %+v", got)
	}
	if got := unmetRows(cases, live, outputs, "", 600); len(got) != 3 || got[2].CaseID != "y" {
		t.Fatalf("the board's day is every case the board holds, got %+v", got)
	}
}

func TestValidThresholdSetting_SixtyToThirtySixHundred(t *testing.T) {
	for _, ok := range []any{60, 600.0, 3600} {
		if err := validThresholdSetting(tenMinuteThresholdKey, ok); err != nil {
			t.Fatalf("%v: %v", ok, err)
		}
	}
	for _, bad := range []any{59, 3601, 600.5, "600", nil} {
		if err := validThresholdSetting(tenMinuteThresholdKey, bad); err == nil {
			t.Fatalf("%v: want refused", bad)
		}
	}
	if err := validThresholdSetting("other", "x"); err != nil {
		t.Fatal(err)
	}
}

func TestTenMinuteThreshold_OutOfRangeStoredValueFallsBackToDefault(t *testing.T) {
	settingsstore.ResetForTest()
	t.Cleanup(settingsstore.ReloadForTest)
	check(t, settingsstore.Put(context.Background(), "t", tenMinuteThresholdKey, 30))
	if got := getTenMinuteThresholdSeconds(context.Background(), "t"); got != 600 {
		t.Fatalf("got %d, want 600", got)
	}
}

// seedUnmetBoard: four field cases on 13 Sep.
func seedUnmetBoard(t *testing.T) {
	t.Helper()
	resetDispatchDeps()
	ResetNotificationsForTest()
	t.Cleanup(ReloadNotificationsForTest)
	t.Cleanup(ResetDispatchEngineOutputsForTest)
	SeedReplayCasesForTest([]Case{
		{ID: "c1", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-13T06:10:00+03:00", Handling: "field", DataSource: "SYNTHETIC"},
		{ID: "c2", CaseNumber: "RD-2", ZoneID: "z2", RegisteredAt: "2026-09-13T06:20:00+03:00", Handling: "field", DataSource: "SYNTHETIC"},
		{ID: "c3", CaseNumber: "RD-3", ZoneID: "z1", RegisteredAt: "2026-09-13T06:30:00+03:00", Handling: "field", DataSource: "SYNTHETIC"},
		{ID: "c4", CaseNumber: "RD-4", ZoneID: "z1", RegisteredAt: "2026-09-13T06:40:00+03:00", Handling: "field", DataSource: "SYNTHETIC"},
	})
	engineOutputsMu.Lock()
	engineOutputsCache = map[string]AssignmentEngineOutput{
		"c1": ranked("c1", "s1", 840), "c2": ranked("c2", "s2", 700),
		"c3": {CaseID: "c3", Status: "no_eligible_agent"}, "c4": ranked("c4", "s4", 300),
	}
	engineOutputsMu.Unlock()
	at := datactx.NowISO()
	UpsertNotificationRuleForTest(NotificationRule{
		BaseRecord: datactx.BaseRecord{ID: "rule-unreachable", CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
		EventType:  unreachableEvent, Channels: []string{"in_app"}, RecipientRoles: []access.Role{access.RoleDispatchSupervisor}, Severity: "warning", IsEnabled: true,
	})
}

func TestListUnmetDemand_EveryCaseOfTheDayFilteredAndPaged(t *testing.T) {
	seedUnmetBoard(t)
	_, tenantID := adminCtx(t)
	sup := roleCtx(tenantID, datactx.NewID(), access.RoleDispatchSupervisor)
	_, err := ControlReplay(sup, map[string]any{"action": "seek", "replay_at": "2026-09-13T07:00:00+03:00"})
	check(t, err)

	all, err := ListUnmetDemand(sup, UnmetDemandQuery{})
	check(t, err)
	if all.Date != "2026-09-13" || all.ThresholdSeconds != 600 || !all.Illustrative || all.DataSource != "SYNTHETIC" || len(all.Items) != 3 || all.Page.Total != 3 {
		t.Fatalf("got %+v, want the three out-of-reach cases", all)
	}
	if all.Items[0].CaseID != "c3" || all.Items[0].Cause != unmetCausePeople || all.Items[0].NearestAgentID != nil {
		t.Fatalf("newest first: got %+v", all.Items[0])
	}
	geo, err := ListUnmetDemand(sup, UnmetDemandQuery{Cause: unmetCauseGeography, ZoneID: "z1"})
	check(t, err)
	if len(geo.Items) != 1 || geo.Items[0].CaseID != "c1" || *geo.Items[0].NearestTravelSeconds != 840 {
		t.Fatalf("geography in z1: got %+v", geo.Items)
	}
	first, err := ListUnmetDemand(sup, UnmetDemandQuery{Limit: 2})
	check(t, err)
	if len(first.Items) != 2 || !first.Page.HasMore || first.Page.NextCursor == nil {
		t.Fatalf("page one: %+v", first.Page)
	}
	second, err := ListUnmetDemand(sup, UnmetDemandQuery{Limit: 2, Cursor: *first.Page.NextCursor})
	check(t, err)
	if len(second.Items) != 1 || second.Items[0].CaseID != "c1" {
		t.Fatalf("page two: %+v", second.Items)
	}
	other, err := ListUnmetDemand(sup, UnmetDemandQuery{Date: "2026-09-12"})
	check(t, err)
	if other.Date != "2026-09-12" || len(other.Items) != 0 {
		t.Fatalf("another day: %+v", other)
	}

	check(t, settingsstore.Put(context.Background(), tenantID, tenMinuteThresholdKey, 720))
	wider, err := ListUnmetDemand(sup, UnmetDemandQuery{})
	check(t, err)
	if wider.ThresholdSeconds != 720 || len(wider.Items) != 2 {
		t.Fatalf("the threshold comes from the setting: got %+v", wider)
	}
}

func TestListUnmetDemand_RefusesBadInputAndOtherModules(t *testing.T) {
	seedUnmetBoard(t)
	_, tenantID := adminCtx(t)
	sup := roleCtx(tenantID, datactx.NewID(), access.RoleDispatchSupervisor)
	if _, err := ListUnmetDemand(sup, UnmetDemandQuery{Cause: "vehicles"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("cause: got %v", err)
	}
	if _, err := ListUnmetDemand(sup, UnmetDemandQuery{Date: "13/09/2026"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("date: got %v", err)
	}
	remote := roleCtx(tenantID, datactx.NewID(), access.RoleRemoteTeamLead)
	if _, err := ListUnmetDemand(remote, UnmetDemandQuery{}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("remote team lead: got %v", err)
	}
}

func TestListUnmetDemand_AlertsSupervisorsOncePerCaseAudited(t *testing.T) {
	seedUnmetBoard(t)
	auditlog.ResetForTest()
	_, tenantID := adminCtx(t)
	sup := roleCtx(tenantID, datactx.NewID(), access.RoleDispatchSupervisor)
	_, err := ControlReplay(sup, map[string]any{"action": "seek", "replay_at": "2026-09-13T06:25:00+03:00"})
	check(t, err)
	auditlog.ResetForTest()

	unreachable := func() []Notification {
		var out []Notification
		for _, n := range AllNotificationsForTest() {
			if n.Category == "dispatch" {
				out = append(out, n)
			}
		}
		return out
	}
	_, err = ListUnmetDemand(sup, UnmetDemandQuery{Cause: unmetCausePeople})
	check(t, err)
	got := unreachable()
	if len(got) != 2 || *got[0].RecipientRole != "dispatch_supervisor" || got[0].Severity != "warning" {
		t.Fatalf("first read: got %+v, want one alert for each of c1 and c2", got)
	}
	_, err = ListUnmetDemand(sup, UnmetDemandQuery{})
	check(t, err)
	if n := len(unreachable()); n != 2 {
		t.Fatalf("a second read raised again: %d alerts", n)
	}
	_, err = ControlReplay(sup, map[string]any{"action": "seek", "replay_at": "2026-09-13T07:00:00+03:00"})
	check(t, err)
	auditlog.ResetForTest()
	n, err := CheckUnreachableCases(context.Background(), tenantID)
	check(t, err)
	if n != 1 || len(unreachable()) != 3 {
		t.Fatalf("the check flagged %d, want only c3 new", n)
	}
	events := auditlog.AllEvents()
	if len(events) != 1 || events[0].Action != "dispatch.case_unreachable_flagged" || events[0].ActorType != "system" || events[0].EntityID == nil || *events[0].EntityID != "c3" {
		t.Fatalf("audit: %+v", events)
	}
	if n, err := CheckUnreachableCases(context.Background(), tenantID); err != nil || n != 0 || len(auditlog.AllEvents()) != 1 {
		t.Fatalf("nothing new: flagged %d, %d events, %v", n, len(auditlog.AllEvents()), err)
	}
}

func TestUpdateLiveAssignmentSettings_ChangesTheThresholdAudited(t *testing.T) {
	resetDispatchDeps()
	auditlog.ResetForTest()
	rc, _ := adminCtx(t)
	snap, err := UpdateLiveAssignmentSettings(rc, map[string]any{tenMinuteThresholdKey: 900.0})
	check(t, err)
	if snap.TenMinuteThresholdS != 900 {
		t.Fatalf("snapshot: %d", snap.TenMinuteThresholdS)
	}
	events := auditlog.AllEvents()
	if len(events) != 1 || events[0].Action != "settings.live_assignment_changed" || events[0].Detail[tenMinuteThresholdKey] == nil {
		t.Fatalf("audit: %+v", events)
	}
	if _, err := UpdateLiveAssignmentSettings(rc, map[string]any{tenMinuteThresholdKey: 30.0}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("30 s: got %v", err)
	}
	if err := PutRawSetting(rc, tenMinuteThresholdKey, 5000.0); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("raw 5000 s: got %v", err)
	}
}

func TestUnmetDemandJSON_KeysMatchContract(t *testing.T) {
	if got := jsonKeys(t, UnmetDemandCase{}); got != "case_id,case_number,cause,data_source,nearest_agent_id,nearest_travel_seconds,registered_at,state,sub_zone_id,threshold_seconds,zone_id" {
		t.Fatalf("UnmetDemandCase keys: %s", got)
	}
	if got := jsonKeys(t, UnmetDemandList{}); got != "data_source,date,illustrative,items,page,threshold_seconds" {
		t.Fatalf("UnmetDemandList keys: %s", got)
	}
}
