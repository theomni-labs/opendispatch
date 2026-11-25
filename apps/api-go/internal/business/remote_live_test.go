// SPDX-License-Identifier: AGPL-3.0-only

// Live-Postgres tests for remote.go:
// AssignRemoteReviewer (Agent/Roster/
// RosterAssignment/ShiftPattern all live) and
// GetRemoteStaffing.
package business

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

type remoteFixture struct {
	zoneID string
	cityID string
	code   string
}

func seedRemoteZoneFixture(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) remoteFixture {
	t.Helper()
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RY", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central", "extra": map[string]any{"code": "RYD"}})
	check(t, err)
	return remoteFixture{zoneID: zone.ID, cityID: city.ID, code: "RYD"}
}

func insertRemoteCase(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, fx remoteFixture, id, number string) {
	t.Helper()
	typeID := datactx.NewID()
	_, err := tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		if _, err := tx.Exec(ctx, `INSERT INTO case_types (tenant_id, id, data_source, name_en) VALUES ($1,$2,'SYNTHETIC','Collision')`, rc.CustomerID, typeID); err != nil {
			return struct{}{}, err
		}
		_, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, id, data_source, case_number, registered_at, city_id, zone_id, case_type_id, handling, external_id)
			VALUES ($1,$2,'SYNTHETIC',$3,$4,$5,$6,$7,'remote_inferred',$3)`, rc.CustomerID, id, number, remoteQueueClockDay+"T06:00:00+03:00", fx.cityID, fx.zoneID, typeID)
		return struct{}{}, err
	})
	check(t, err)
	SeedCasesForTest([]Case{{ID: id, CaseNumber: number, ZoneID: fx.zoneID, Handling: "remote_inferred", RegisteredAt: remoteQueueClockDay + "T06:00:00+03:00", DataSource: "SYNTHETIC"}})
}

// remoteQueueClockDay/remoteAsOfHour: this session's
// fixed clock (matches fixtures/replay/script.json's
// default_start_at time-of-day, any date).
const remoteQueueClockDay = "2026-09-20"

func remoteDayRangeAssignment(id, tenantID, rosterID, agentID, zoneID, date string) RosterAssignment {
	at := datactx.NowISO()
	return RosterAssignment{
		BaseRecord: datactx.BaseRecord{ID: id, TenantID: tenantID, DataSource: "SYNTHETIC", CreatedAt: at, UpdatedAt: at},
		RosterID:   rosterID, AgentID: agentID, ZoneID: &zoneID, RosterDate: date,
		StartAt: date + "T00:00:00+03:00", EndAt: date + "T23:59:00+03:00",
	}
}

func TestAssignRemoteReviewer_SuccessWhenOnRemoteShift(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRemoteDeps()
	settingsstore.ResetForTest()
	fx := seedRemoteZoneFixture(t, ctx, conn, rc)

	agent, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SUR-R1", "name_en": "Remote One", "kind": "remote"})
	check(t, err)
	roster := Roster{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenantID, DataSource: "SYNTHETIC", CreatedAt: datactx.NowISO(), UpdatedAt: datactx.NowISO()}, ZoneID: fx.zoneID, RosterDate: remoteQueueClockDay, Status: "draft", PlanningLevel: "zone"}
	check(t, upsertRoster(ctx, conn, tenantID, roster))
	check(t, upsertRosterAssignments(ctx, conn, tenantID, []RosterAssignment{remoteDayRangeAssignment(datactx.NewID(), tenantID, roster.ID, agent.ID, fx.zoneID, remoteQueueClockDay)}))

	caseID := "00000000-0000-4000-8000-000000000501"
	insertRemoteCase(t, ctx, conn, rc, fx, caseID, "RD-1")

	lead := roleCtx(tenantID, "00000000-0000-4000-8000-000000000401", access.RoleRemoteTeamLead)
	item, err := AssignRemoteReviewer(ctx, conn, lead, caseID, map[string]any{"agent_id": agent.ID})
	check(t, err)
	if item.Status != "in_review" || item.AssignedReviewerID == nil || *item.AssignedReviewerID != agent.ID {
		t.Fatalf("got %+v, want in_review assigned to %s", item, agent.ID)
	}
}

func TestAssignRemoteReviewer_AlreadyAssignedIsConflict(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRemoteDeps()
	settingsstore.ResetForTest()
	fx := seedRemoteZoneFixture(t, ctx, conn, rc)

	agent, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SUR-R2", "name_en": "Remote Two", "kind": "remote"})
	check(t, err)
	roster := Roster{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenantID, DataSource: "SYNTHETIC", CreatedAt: datactx.NowISO(), UpdatedAt: datactx.NowISO()}, ZoneID: fx.zoneID, RosterDate: remoteQueueClockDay, Status: "draft", PlanningLevel: "zone"}
	check(t, upsertRoster(ctx, conn, tenantID, roster))
	check(t, upsertRosterAssignments(ctx, conn, tenantID, []RosterAssignment{remoteDayRangeAssignment(datactx.NewID(), tenantID, roster.ID, agent.ID, fx.zoneID, remoteQueueClockDay)}))
	caseID := "00000000-0000-4000-8000-000000000502"
	insertRemoteCase(t, ctx, conn, rc, fx, caseID, "RD-2")

	lead := roleCtx(tenantID, "00000000-0000-4000-8000-000000000402", access.RoleRemoteTeamLead)
	_, err = AssignRemoteReviewer(ctx, conn, lead, caseID, map[string]any{"agent_id": agent.ID})
	check(t, err)
	_, err = AssignRemoteReviewer(ctx, conn, lead, caseID, map[string]any{"agent_id": agent.ID})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict on a re-assignment", err)
	}
}

func TestAssignRemoteReviewer_SelfAssignmentIsConflict(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRemoteDeps()
	settingsstore.ResetForTest()
	fx := seedRemoteZoneFixture(t, ctx, conn, rc)

	agent, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SUR-R3", "name_en": "Remote Three", "kind": "remote"})
	check(t, err)
	roster := Roster{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenantID, DataSource: "SYNTHETIC", CreatedAt: datactx.NowISO(), UpdatedAt: datactx.NowISO()}, ZoneID: fx.zoneID, RosterDate: remoteQueueClockDay, Status: "draft", PlanningLevel: "zone"}
	check(t, upsertRoster(ctx, conn, tenantID, roster))
	check(t, upsertRosterAssignments(ctx, conn, tenantID, []RosterAssignment{remoteDayRangeAssignment(datactx.NewID(), tenantID, roster.ID, agent.ID, fx.zoneID, remoteQueueClockDay)}))
	caseID := "00000000-0000-4000-8000-000000000503"
	insertRemoteCase(t, ctx, conn, rc, fx, caseID, "RD-3")

	// The actor's user id is the agent's own id.
	lead := roleCtx(tenantID, agent.ID, access.RoleRemoteTeamLead)
	_, err = AssignRemoteReviewer(ctx, conn, lead, caseID, map[string]any{"agent_id": agent.ID})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict for a self-assignment", err)
	}
}

func TestAssignRemoteReviewer_NoShiftIsConflict(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRemoteDeps()
	settingsstore.ResetForTest()
	fx := seedRemoteZoneFixture(t, ctx, conn, rc)

	agent, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SUR-R4", "name_en": "Remote Four", "kind": "remote"})
	check(t, err)
	// No roster assignment, no home_shift: no shift.
	caseID := "00000000-0000-4000-8000-000000000504"
	insertRemoteCase(t, ctx, conn, rc, fx, caseID, "RD-4")

	lead := roleCtx(tenantID, "00000000-0000-4000-8000-000000000404", access.RoleRemoteTeamLead)
	_, err = AssignRemoteReviewer(ctx, conn, lead, caseID, map[string]any{"agent_id": agent.ID})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict when the agent has no shift that moment", err)
	}
}

func TestGetRemoteStaffing_PlannedFromOneOnShiftRemoteAgent(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
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
		HorizonStartDate: remoteQueueClockDay, HorizonDays: 1, RangeCoverage: 0.8, Illustrative: true,
		InputDataSources: []string{"SYNTHETIC"},
	})

	agent, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SUR-R5", "name_en": "Remote Five", "kind": "remote"})
	check(t, err)
	roster := Roster{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenantID, DataSource: "SYNTHETIC", CreatedAt: datactx.NowISO(), UpdatedAt: datactx.NowISO()}, ZoneID: fx.zoneID, RosterDate: remoteQueueClockDay, Status: "draft", PlanningLevel: "zone"}
	check(t, upsertRoster(ctx, conn, tenantID, roster))
	check(t, upsertRosterAssignments(ctx, conn, tenantID, []RosterAssignment{remoteDayRangeAssignment(datactx.NewID(), tenantID, roster.ID, agent.ID, fx.zoneID, remoteQueueClockDay)}))

	staffing, err := GetRemoteStaffing(ctx, conn, rc, remoteQueueClockDay)
	check(t, err)
	if len(staffing.Intervals) != 96 {
		t.Fatalf("got %d intervals, want 96", len(staffing.Intervals))
	}
	// 07:00 = interval 28 (07:00 / 15min).
	mid := staffing.Intervals[28]
	if mid.PlannedReviewers != 0.34 {
		t.Fatalf("got planned_reviewers %v, want 0.34 (one on-shift remote agent)", mid.PlannedReviewers)
	}
	if mid.RequiredReviewers != 0 {
		t.Fatalf("got required_reviewers %v, want 0 (no forecast values seeded)", mid.RequiredReviewers)
	}
	if !staffing.Illustrative {
		t.Fatalf("got illustrative=false, want true")
	}
}
