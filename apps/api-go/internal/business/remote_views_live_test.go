// SPDX-License-Identifier: AGPL-3.0-only

// Live tests: remote roster, capacity, productivity, handling.
package business

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

type remoteViewsFixture struct {
	remoteFixture
	a, b, c string
	day     string
}

// seedRemoteViews: three remote agents; A and B rostered on day, B on leave, C on home shift only.
func seedRemoteViews(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, tenantID string) remoteViewsFixture {
	t.Helper()
	resetRemoteDeps()
	ResetFieldShareForTest()
	ResetForecastValuesForTest()
	ResetForecastRunsForTest()
	settingsstore.ResetForTest()
	fx := seedRemoteZoneFixture(t, ctx, conn, rc)
	SeedFieldShareZonesForTest([]string{fx.zoneID})
	SeedRemoteZonesForTest([]remoteZoneRow{{ID: fx.zoneID, Code: fx.code}})
	UpsertForecastRunForTest(ForecastRun{
		BaseRecord: datactx.NewRecord(rc, "", datactx.NowISO()), ModelVersion: "v1", Status: "succeeded",
		HorizonStartDate: remoteQueueClockDay, HorizonDays: 2, RangeCoverage: 0.8, Illustrative: true,
		InputDataSources: []string{"SYNTHETIC"},
	})
	rule, err := CreateBreakRule(ctx, conn, rc, map[string]any{"code": "BRK-R", "name_en": "Rule R", "break_minutes": 30.0, "after_consecutive_hours": 5.0})
	check(t, err)
	pattern, err := CreateShiftPattern(ctx, conn, rc, map[string]any{
		"code": "RMT-DAY", "name_en": "Remote day", "kind": "remote", "status": "active", "break_rule_id": rule.ID,
		"normal":  map[string]any{"applies": true, "start_time": "08:00", "end_time": "16:00"},
		"ramadan": map[string]any{"applies": true, "start_time": "10:00", "end_time": "16:00"},
	})
	check(t, err)
	mk := func(code string, daysOff []any) string {
		s, err := CreateAgent(ctx, conn, rc, map[string]any{"code": code, "name_en": code, "kind": "remote",
			"extra": map[string]any{"home_shift": "rmt_day", "pool_zone_code": fx.code, "days_off": daysOff}})
		check(t, err)
		return s.ID
	}
	// 2026-09-21 is a Monday: A is off then.
	a, b, c := mk("SUR-VA", []any{"Monday"}), mk("SUR-VB", []any{}), mk("SUR-VC", []any{})
	day := remoteQueueClockDay
	roster := Roster{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenantID, DataSource: "SYNTHETIC", CreatedAt: datactx.NowISO(), UpdatedAt: datactx.NowISO()}, ZoneID: fx.zoneID, RosterDate: day, Status: "draft", PlanningLevel: "zone"}
	check(t, upsertRoster(ctx, conn, tenantID, roster))
	line := func(agent string) RosterAssignment {
		l := remoteDayRangeAssignment(datactx.NewID(), tenantID, roster.ID, agent, fx.zoneID, day)
		l.StartAt, l.EndAt, l.ShiftPatternID = day+"T07:00:00+03:00", day+"T15:00:00+03:00", &pattern.ID
		return l
	}
	la := line(a)
	bs, be := day+"T11:00:00+03:00", day+"T12:00:00+03:00"
	la.BreakStartAt, la.BreakEndAt = &bs, &be
	check(t, upsertRosterAssignments(ctx, conn, tenantID, []RosterAssignment{la, line(b)}))
	at := datactx.NowISO()
	check(t, upsertLeaveRequest(ctx, conn, tenantID, LeaveRequest{
		BaseRecord: datactx.NewRecord(rc, "", at), AgentID: b, StartDate: day, EndDate: day,
		LeaveType: "annual", Status: "approved", RequestedAt: at,
	}))
	return remoteViewsFixture{remoteFixture: fx, a: a, b: b, c: c, day: day}
}

func TestGetRemoteRoster_RosterLinesThenHomeShifts(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	fx := seedRemoteViews(t, ctx, conn, rc, tenantID)

	lead := roleCtx(tenantID, datactx.NewID(), access.RoleRemoteTeamLead)
	got, err := GetRemoteRoster(ctx, conn, lead, fx.day)
	check(t, err)
	if got.Fte != 3 || got.Day.Source != "roster" || len(got.Lines) != 2 || len(got.Intervals) != 96 {
		t.Fatalf("got fte %d source %s lines %d intervals %d, want 3, roster, 2, 96", got.Fte, got.Day.Source, len(got.Lines), len(got.Intervals))
	}
	if got.Day.Scheduled != 1 || got.Day.OnLeave != 1 || got.Day.Off != 1 || got.Day.AvailableHours != 7 {
		t.Fatalf("got %+v, want 1 scheduled (7 h less break), 1 on leave, 1 off", got.Day)
	}
	for _, l := range got.Lines {
		if (l.AgentID == fx.b) != l.OnLeave || l.Source != "roster" || l.ShiftCode == nil || *l.ShiftCode != "RMT-DAY" {
			t.Fatalf("got line %+v", l)
		}
	}
	if on := got.Intervals[36].OnShift; on == nil || *on != 1 {
		t.Fatalf("got on_shift %v at 09:00, want 1", on)
	}
	if on := got.Intervals[44].OnShift; *on != 0 {
		t.Fatalf("got on_shift %d at 11:00 (A on a break), want 0", *on)
	}
	if got.ReviewerShare != remoteReviewerShare || !got.Illustrative || got.Handling.Minutes != remoteMeanHandlingMinutes {
		t.Fatalf("got share %v illustrative %v handling %+v", got.ReviewerShare, got.Illustrative, got.Handling)
	}

	next, err := GetRemoteRoster(ctx, conn, lead, shiftDateBy(fx.day, 1))
	check(t, err)
	if next.Day.Source != "home_shifts" || len(next.Lines) != 2 || next.Day.Scheduled != 2 || next.Day.Off != 1 {
		t.Fatalf("got %s %d lines %+v, want B and C on their home shift and A off", next.Day.Source, len(next.Lines), next.Day)
	}
	if next.Lines[0].Source != "home_shift" || next.Lines[0].StartAt != shiftDateBy(fx.day, 1)+"T08:00:00+03:00" {
		t.Fatalf("got %+v, want the 08:00 home shift", next.Lines[0])
	}

	dispatcher := roleCtx(tenantID, datactx.NewID(), access.RoleDispatcher)
	if _, err := GetRemoteRoster(ctx, conn, dispatcher, fx.day); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden for a dispatcher", err)
	}
	if _, err := GetRemoteRoster(ctx, conn, lead, "2026-9-20"); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid for a bad date", err)
	}
}

func TestGetRemoteCapacity_DaysAndWeeks(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	fx := seedRemoteViews(t, ctx, conn, rc, tenantID)

	lead := roleCtx(tenantID, datactx.NewID(), access.RoleRemoteTeamLead)
	got, err := GetRemoteCapacity(ctx, conn, lead, fx.day, shiftDateBy(fx.day, 1))
	check(t, err)
	if len(got.Days) != 2 || len(got.Weeks) != 1 || got.Weeks[0].Days != 2 || got.Fte != 3 {
		t.Fatalf("got %+v", got)
	}
	if got.Days[0].Source != "roster" || got.Days[1].Source != "home_shifts" || got.Weeks[0].ScheduledShifts != 3 {
		t.Fatalf("got sources %s %s, scheduled %d", got.Days[0].Source, got.Days[1].Source, got.Weeks[0].ScheduledShifts)
	}
	if got.Weeks[0].AvailableHours != 23 || got.Days[1].CapacityHours != round2(16*remoteReviewerShare) {
		t.Fatalf("got week available %v day 2 capacity %v", got.Weeks[0].AvailableHours, got.Days[1].CapacityHours)
	}
	if _, err := GetRemoteCapacity(ctx, conn, lead, fx.day, shiftDateBy(fx.day, 31)); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid for 32 dates", err)
	}
}

// insertTimedRemoteCase: a remote case with review and close.
func insertTimedRemoteCase(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, fx remoteFixture, number string, reg time.Time, waitMin, completeMin int) string {
	t.Helper()
	id := datactx.NewID()
	review, closed := reg.Add(time.Duration(waitMin)*time.Minute), reg.Add(time.Duration(waitMin+completeMin)*time.Minute)
	_, err := tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, id, data_source, case_number, registered_at, city_id, zone_id, handling, external_id, remote_review_at, closed_at)
			VALUES ($1,$2,'SYNTHETIC',$3,$4,$5,$6,'remote_inferred',$3,$7,$8)`, rc.CustomerID, id, number, reg, fx.cityID, fx.zoneID, review, closed)
		return struct{}{}, err
	})
	check(t, err)
	return id
}

func TestGetRemoteProductivity_ReviewerFromRemoteReviews(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	fx := seedRemoteViews(t, ctx, conn, rc, tenantID)
	UsePostgresRemoteReviews(conn)
	t.Cleanup(UseMemoryRemoteReviews)

	reg, err := time.Parse(time.RFC3339, fx.day+"T08:00:00+03:00")
	check(t, err)
	first := insertTimedRemoteCase(t, ctx, conn, rc, fx.remoteFixture, "PV-1", reg, 10, 30)
	insertTimedRemoteCase(t, ctx, conn, rc, fx.remoteFixture, "PV-2", reg.Add(time.Hour), 20, 40)
	started := fx.day + "T08:05:00+03:00"
	check(t, saveRemoteReview(ctx, tenantID, remoteReview{BaseRecord: datactx.NewRecord(rc, "", started), CaseID: first, ReviewerID: fx.a, ReviewStartedAt: started}))

	lead := roleCtx(tenantID, datactx.NewID(), access.RoleRemoteTeamLead)
	got, err := GetRemoteProductivity(ctx, conn, lead, fx.day, fx.day)
	check(t, err)
	if got.Overall.Cases != 2 || got.Handled != 2 || got.UnattributedCases != 1 || len(got.Reviewers) != 1 {
		t.Fatalf("got %+v", got)
	}
	r := got.Reviewers[0]
	if r.AgentID != fx.a || r.AvailableHours != 7 || r.Durations.Cases != 1 || *r.Durations.MedianWaitSeconds != 300 {
		t.Fatalf("got reviewer %+v, want A with 7 available hours and a 5 min wait", r)
	}
	if got.AvailableHours != 7 || got.Overall.MedianPostCloseAdminSeconds != nil || len(got.Hours) != 24 || got.Hours[8].Received != 1 {
		t.Fatalf("got available %v hours %+v", got.AvailableHours, got.Hours[8])
	}
	if len(got.DataSources) != 1 || got.DataSources[0] != "SYNTHETIC" || !got.Illustrative {
		t.Fatalf("got data sources %v", got.DataSources)
	}
}

func TestRemoteHandling_MeasuredFeedsStaffingAndTheSettingIsAudited(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	fx := seedRemoteViews(t, ctx, conn, rc, tenantID)

	// 30 cases over the last 28 days, 20 min each to complete.
	base, err := time.Parse(time.RFC3339, fx.day+"T09:00:00+03:00")
	check(t, err)
	for i := 0; i < remoteHandlingMinCases; i++ {
		insertTimedRemoteCase(t, ctx, conn, rc, fx.remoteFixture, fmt.Sprintf("HM-%d", i), base.AddDate(0, 0, -1-i%27), 5, 20)
	}
	staffing, err := GetRemoteStaffing(ctx, conn, rc, fx.day)
	check(t, err)
	h := staffing.Handling
	if h == nil || h.Source != "measured" || h.Minutes != 20 || h.Cases != remoteHandlingMinCases || h.minutesFor(fx.zoneID) != 20 {
		t.Fatalf("got %+v, want 20 measured minutes over 30 cases", h)
	}

	snap, err := UpdateRemoteHandling(rc, map[string]any{"handling_source": "fixed", "handling_fixed_minutes": 40.0})
	check(t, err)
	if snap.RemoteHandlingSource != "fixed" || snap.RemoteHandlingFixedMin == nil || *snap.RemoteHandlingFixedMin != 40 {
		t.Fatalf("got %+v, want fixed 40", snap)
	}
	staffing, err = GetRemoteStaffing(ctx, conn, rc, fx.day)
	check(t, err)
	if staffing.Handling.Source != "fixed" || staffing.Handling.Minutes != 40 || staffing.Handling.Setting != "fixed" {
		t.Fatalf("got %+v, want the fixed 40 minutes", staffing.Handling)
	}
	if ok, _ := auditActions(t, rc, "settings.remote_handling_changed"); ok != 1 {
		t.Fatalf("got %d audit rows, want 1", ok)
	}
	planner := roleCtx(tenantID, datactx.NewID(), access.RolePlanner)
	if _, err := UpdateRemoteHandling(planner, map[string]any{"handling_source": "measured"}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden for a planner", err)
	}
	for _, bad := range []map[string]any{{}, {"handling_fixed_minutes": 4.0}, {"handling_source": "auto"}, {"other": 1.0}} {
		if _, err := UpdateRemoteHandling(rc, bad); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("got %v for %v, want Invalid", err, bad)
		}
	}
}
