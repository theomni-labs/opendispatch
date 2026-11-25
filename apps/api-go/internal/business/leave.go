// SPDX-License-Identifier: AGPL-3.0-only

// Ports leave.ts: leave requests, coverage
// effect, decide (a zone-scoped edit, not a second-
// person approval - the only guard is nobody decides
// their own request), leave windows. LeaveRequest is
// Postgres, so is the Zone list for windows.
// Agent lookups by id stay demo-store (TS's own
// comment) - a stale snapshot, like identity.go's.
package business

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

var leaveTypes = []string{"annual", "sick", "emergency", "other"}
var leaveStatuses = []string{"requested", "approved", "declined"}

const maxLeaveDays = 60
const maxEffectDays = 21
const maxWindowWeeks = 12
const defaultWindowWeeks = 4

// leaveAgentRows: the stale agentOf snapshot.
var (
	leaveAgentMu     sync.Mutex
	leaveAgentRows   []Agent
	leaveAgentSeeded bool
)

// ResetLeaveAgentsForTest clears the snapshot.
func ResetLeaveAgentsForTest() {
	leaveAgentMu.Lock()
	leaveAgentRows = nil
	leaveAgentSeeded = false
	leaveAgentMu.Unlock()
}

// SeedLeaveAgentsForTest sets the stale snapshot.
func SeedLeaveAgentsForTest(rows []Agent) {
	leaveAgentMu.Lock()
	leaveAgentRows = append([]Agent(nil), rows...)
	leaveAgentSeeded = true
	leaveAgentMu.Unlock()
}

// ensureLeaveAgentsSeeded: lazy, from fixtures, once
// (mirrors SeedUsersFromFixtures). A test that wants its
// own rows calls SeedLeaveAgentsForTest first, which
// this then leaves alone.
func ensureLeaveAgentsSeeded() {
	leaveAgentMu.Lock()
	seeded := leaveAgentSeeded
	leaveAgentMu.Unlock()
	if seeded {
		return
	}
	rows, err := fixtures.Records[Agent]("Agent")
	leaveAgentMu.Lock()
	if !leaveAgentSeeded {
		if err == nil {
			leaveAgentRows = rows
		}
		leaveAgentSeeded = true
	}
	leaveAgentMu.Unlock()
}

func leaveAgentOf(id string) *Agent {
	ensureLeaveAgentsSeeded()
	leaveAgentMu.Lock()
	defer leaveAgentMu.Unlock()
	for i := range leaveAgentRows {
		if leaveAgentRows[i].ID == id {
			row := leaveAgentRows[i]
			return &row
		}
	}
	return nil
}

// leaveZoneOfRequest: the agent's home zone,
// nil for the remote pool.
func leaveZoneOfRequest(r LeaveRequest) *string {
	s := leaveAgentOf(r.AgentID)
	if s == nil {
		return nil
	}
	return s.HomeZoneID
}

func leaveVisible(rc reqctx.RequestContext, r LeaveRequest) bool {
	return reqctx.CanReadZone(rc, leaveZoneOfRequest(r))
}

func requireLeaveRequest(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (LeaveRequest, error) {
	if _, err := importutil.RequireID(id, "Leave request"); err != nil {
		return LeaveRequest{}, err
	}
	all, err := allLeaveRequests(ctx, conn, rc.CustomerID)
	if err != nil {
		return LeaveRequest{}, err
	}
	for _, r := range all {
		if r.ID == id && leaveVisible(rc, r) {
			return r, nil
		}
	}
	return LeaveRequest{}, dataerr.NotFound("Leave request not found.")
}

func upsertLeaveRequestTx(ctx context.Context, tx pgx.Tx, l LeaveRequest) error {
	_, err := tx.Exec(ctx, `INSERT INTO leave_requests (tenant_id, id, data_source, created_at, updated_at, created_by, agent_id, start_date, end_date, leave_type, status, requested_at, decided_at, decided_by_user_id, decision_note, note)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, agent_id=$7, start_date=$8, end_date=$9, leave_type=$10, status=$11, requested_at=$12, decided_at=$13, decided_by_user_id=$14, decision_note=$15, note=$16`,
		l.TenantID, l.ID, l.DataSource, l.CreatedAt, l.UpdatedAt, l.CreatedBy, l.AgentID, l.StartDate, l.EndDate, l.LeaveType, l.Status, l.RequestedAt, l.DecidedAt, l.DecidedByUserID, l.DecisionNote, l.Note)
	return err
}

func upsertLeaveRequest(ctx context.Context, conn *tenancy.Connection, tenantID string, l LeaveRequest) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, upsertLeaveRequestTx(ctx, tx, l)
	})
	return err
}

// LeaveRequestQuery: listLeaveRequests' query.
type LeaveRequestQuery struct {
	Limit    int
	Cursor   string
	ZoneID   string
	DateFrom string
	DateTo   string
	Status   string
	AgentID  string
}

func validateDateString(date string) error {
	_, err := datactx.Date(datactx.Obj{"date": date}, "date")
	return err
}

// ListLeaveRequests mirrors listLeaveRequests.
func ListLeaveRequests(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query LeaveRequestQuery) (datactx.PageResult[LeaveRequest], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLeavePlanner, access.AccessView); err != nil {
		return datactx.PageResult[LeaveRequest]{}, err
	}
	if query.Status != "" && !containsStr(leaveStatuses, query.Status) {
		return datactx.PageResult[LeaveRequest]{}, dataerr.Invalid("status must be one of " + strings.Join(leaveStatuses, ", ") + ".")
	}
	if query.DateFrom != "" {
		if err := validateDateString(query.DateFrom); err != nil {
			return datactx.PageResult[LeaveRequest]{}, err
		}
	}
	if query.DateTo != "" {
		if err := validateDateString(query.DateTo); err != nil {
			return datactx.PageResult[LeaveRequest]{}, err
		}
	}
	all, err := allLeaveRequests(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[LeaveRequest]{}, err
	}
	var rows []LeaveRequest
	for _, r := range all {
		if !leaveVisible(rc, r) {
			continue
		}
		if query.ZoneID != "" {
			z := leaveZoneOfRequest(r)
			if z == nil || *z != query.ZoneID {
				continue
			}
		}
		if query.Status != "" && r.Status != query.Status {
			continue
		}
		if query.AgentID != "" && r.AgentID != query.AgentID {
			continue
		}
		if query.DateFrom != "" && r.EndDate < query.DateFrom {
			continue
		}
		if query.DateTo != "" && r.StartDate > query.DateTo {
			continue
		}
		rows = append(rows, r)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].StartDate != rows[j].StartDate {
			return rows[i].StartDate < rows[j].StartDate
		}
		if rows[i].RequestedAt != rows[j].RequestedAt {
			return rows[i].RequestedAt < rows[j].RequestedAt
		}
		return rows[i].ID < rows[j].ID
	})
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// GetLeaveRequest mirrors getLeaveRequest.
func GetLeaveRequest(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (LeaveRequest, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLeavePlanner, access.AccessView); err != nil {
		return LeaveRequest{}, err
	}
	return requireLeaveRequest(ctx, conn, rc, id)
}

// CreateLeaveRequest mirrors createLeaveRequest.
func CreateLeaveRequest(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (LeaveRequest, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsLeavePlanner}, auditlog.WriteMeta{Action: "leave.requested", EntityType: "leave_request"}, func(ctx context.Context) (auditlog.AuditedWrite[LeaveRequest], error) {
		input, err := datactx.Object(body, "Leave request", []string{"agent_id", "start_date", "end_date", "leave_type", "note"})
		if err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		agentID, err := datactx.UUID(input, "agent_id")
		if err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		start, err := datactx.Date(input, "start_date")
		if err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		end, err := datactx.Date(input, "end_date")
		if err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		leaveType, err := datactx.EnumOf(input, "leave_type", leaveTypes)
		if err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		note, err := datactx.NullableString(input, "note", datactx.StrOpts{HasMax: true, Max: 500})
		if err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		agent := leaveAgentOf(agentID)
		if agent == nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, dataerr.NotFound("Agent not found.")
		}
		if err := reqctx.RequireWriteZone(rc, agent.HomeZoneID); err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		if !agent.IsActive {
			return auditlog.AuditedWrite[LeaveRequest]{}, dataerr.Invalid("Leave request: the agent is not active.")
		}
		if end < start {
			return auditlog.AuditedWrite[LeaveRequest]{}, dataerr.Invalid("Leave request: end_date must not be before start_date.")
		}
		if shiftDateBy(start, maxLeaveDays) < end {
			return auditlog.AuditedWrite[LeaveRequest]{}, dataerr.Invalid(fmt.Sprintf("Leave request: at most %d days.", maxLeaveDays))
		}
		all, err := allLeaveRequests(ctx, conn, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		for _, r := range all {
			if r.AgentID == agentID && r.Status != "declined" && r.StartDate <= end && start <= r.EndDate {
				return auditlog.AuditedWrite[LeaveRequest]{}, dataerr.Conflict(fmt.Sprintf("The agent already has leave from %s to %s.", r.StartDate, r.EndDate))
			}
		}
		at := datactx.NowISO()
		created := LeaveRequest{
			BaseRecord: datactx.NewRecord(rc, "", at), AgentID: agentID, StartDate: start, EndDate: end,
			LeaveType: leaveType, Status: "requested", RequestedAt: at, Note: note,
		}
		if err := upsertLeaveRequest(ctx, conn, rc.CustomerID, created); err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		id := created.ID
		return auditlog.AuditedWrite[LeaveRequest]{
			Result: created, EntityID: &id,
			SummaryEn: fmt.Sprintf("Leave requested for %s: %s to %s (%s).", agent.NameEn, start, end, leaveType),
			Detail:    map[string]any{"agent_id": agentID, "start_date": start, "end_date": end, "leave_type": leaveType},
		}, nil
	})
}

// Coverage effect

// withLeaveApproved mirrors withLeave: a fresh
// PlanReader (not a struct copy - it holds mutexes)
// with the request added to or removed from leave.
func withLeaveApproved(plan *PlanReader, request LeaveRequest, approved bool) *PlanReader {
	var others []LeaveRequest
	for _, l := range plan.ApprovedLeave {
		if l.ID != request.ID {
			others = append(others, l)
		}
	}
	approvedLeave := others
	if approved {
		copyReq := request
		copyReq.Status = "approved"
		approvedLeave = append(append([]LeaveRequest{}, others...), copyReq)
	}
	return &PlanReader{
		Rosters: plan.Rosters, LinesByRoster: plan.LinesByRoster, ApprovedLeave: approvedLeave,
		Factor: plan.Factor, Baseline: plan.Baseline, dated: plan.dated, Patterns: plan.Patterns, BreakRules: plan.BreakRules,
		Agents: plan.Agents, Vehicles: plan.Vehicles, Points: plan.Points,
		rc: plan.rc, goCtx: plan.goCtx, conn: plan.conn,
		prayerMemo: map[string][]PrayerMinute{}, ramadanMemo: map[string]bool{},
	}
}

// projectedLinesFor: projectedLines, minus the
// WeakMap memoization - pure CPU once plan is
// loaded, not a store call, so cheap to redo.
func projectedLinesFor(rc reqctx.RequestContext, plan *PlanReader, zoneID, date string) ([]RosterAssignment, error) {
	lines, err := projectLines(rc, plan, zoneID, date)
	if err != nil {
		return nil, err
	}
	out := make([]RosterAssignment, len(lines))
	for i, l := range lines {
		l.ID = fmt.Sprintf("projected:%s:%s:%d", zoneID, date, i)
		l.RosterID = ""
		out[i] = l
	}
	return out, nil
}

// linesOnDuty: the roster's lines, or the projected
// roster when the day has none yet.
func linesOnDuty(rc reqctx.RequestContext, plan *PlanReader, zoneID, date string) ([]RosterAssignment, error) {
	var own []RosterAssignment
	if rosterFor(plan, zoneID, date) == nil {
		lines, err := projectedLinesFor(rc, plan, zoneID, date)
		if err != nil {
			return nil, err
		}
		own = lines
	} else {
		for _, l := range dutyLines(plan, zoneID, date) {
			if l.RosterDate == date {
				own = append(own, l)
			}
		}
	}
	prevDate := shiftDateBy(date, -1)
	var carry []RosterAssignment
	if rosterFor(plan, zoneID, prevDate) == nil {
		lines, err := projectedLinesFor(rc, plan, zoneID, prevDate)
		if err != nil {
			return nil, err
		}
		carry = lines
	} else {
		for _, l := range dutyLines(plan, zoneID, date) {
			if l.RosterDate != date {
				carry = append(carry, l)
			}
		}
	}
	out := make([]RosterAssignment, 0, len(carry)+len(own))
	for _, l := range carry {
		if l.RosterDate == date {
			continue
		}
		endMin, err := MinutesOf(date, l.EndAt)
		if err != nil {
			continue
		}
		if endMin > 0 {
			out = append(out, l)
		}
	}
	out = append(out, own...)
	return out, nil
}

// LeaveCoverageCell: one LeaveCoverageEffect cell.
type LeaveCoverageCell struct {
	IntervalStart string `json:"interval_start"`
	Required      int    `json:"required"`
	PlannedBefore int    `json:"planned_before"`
	PlannedAfter  int    `json:"planned_after"`
}

// LeaveCoverageEffect mirrors the contract type.
type LeaveCoverageEffect struct {
	LeaveRequestID  string              `json:"leave_request_id"`
	ZoneID          *string             `json:"zone_id"`
	Cells           []LeaveCoverageCell `json:"cells"`
	NewGapIntervals int                 `json:"new_gap_intervals"`
	SummaryEn       string              `json:"summary_en"`
	Illustrative    bool                `json:"illustrative"`
	DataSource      string              `json:"data_source"`
}

// effectOf mirrors effectOf.
func effectOf(rc reqctx.RequestContext, request LeaveRequest, plan *PlanReader) (LeaveCoverageEffect, error) {
	zoneID := leaveZoneOfRequest(request)
	base := LeaveCoverageEffect{LeaveRequestID: request.ID, ZoneID: zoneID, Cells: []LeaveCoverageCell{}, Illustrative: true, DataSource: "SYNTHETIC"}
	if zoneID == nil {
		base.SummaryEn = "Remote pool agent: leave does not change field coverage."
		return base, nil
	}
	without := withLeaveApproved(plan, request, false)
	withIt := withLeaveApproved(plan, request, true)
	var days []string
	for d := request.StartDate; d <= request.EndDate && len(days) < maxEffectDays; d = shiftDateBy(d, 1) {
		days = append(days, d)
	}
	cells := []LeaveCoverageCell{}
	newGaps := 0
	daysHit := 0
	for _, date := range days {
		beforeLines, err := linesOnDuty(rc, without, *zoneID, date)
		if err != nil {
			return LeaveCoverageEffect{}, err
		}
		afterLines, err := linesOnDuty(rc, withIt, *zoneID, date)
		if err != nil {
			return LeaveCoverageEffect{}, err
		}
		before := coverageSeries(beforeLines, date).WithVehicle
		after := coverageSeries(afterLines, date).WithVehicle
		required := requiredSeries(plan, *zoneID, date)
		hit := false
		for i := 0; i < 96; i++ {
			b, a := before[i], after[i]
			if a == b {
				continue
			}
			hit = true
			need := required[i]
			cells = append(cells, LeaveCoverageCell{
				IntervalStart: fmt.Sprintf("%sT%02d:%02d:00+03:00", date, i/4, (i%4)*15),
				Required:      need, PlannedBefore: b, PlannedAfter: a,
			})
			if a < need && b >= need {
				newGaps++
			}
		}
		if hit {
			daysHit++
		}
	}
	base.Cells, base.NewGapIntervals = cells, newGaps
	if len(cells) == 0 {
		base.SummaryEn = "This leave does not change the roster: the agent is not scheduled on those days."
	} else {
		base.SummaryEn = fmt.Sprintf("On %d day(s) planned staffing falls by one agent; %d interval(s) drop below the required staffing.", daysHit, newGaps)
	}
	return base, nil
}

// GetLeaveCoverageEffect: mirrors the TS function.
func GetLeaveCoverageEffect(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (LeaveCoverageEffect, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLeavePlanner, access.AccessView); err != nil {
		return LeaveCoverageEffect{}, err
	}
	request, err := requireLeaveRequest(ctx, conn, rc, id)
	if err != nil {
		return LeaveCoverageEffect{}, err
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return LeaveCoverageEffect{}, err
	}
	return effectOf(rc, request, plan)
}

// GetLeaveCoverageEffects: the batch form, one
// shared loadPlan instead of one per request (the
// N+1 pattern CONTRIBUTING.md and TS itself both flag).
func GetLeaveCoverageEffects(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, ids []string) ([]LeaveCoverageEffect, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLeavePlanner, access.AccessView); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []LeaveCoverageEffect{}, nil
	}
	all, err := allLeaveRequests(ctx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	byID := map[string]LeaveRequest{}
	for _, r := range all {
		byID[r.ID] = r
	}
	requests := make([]LeaveRequest, 0, len(ids))
	for _, id := range ids {
		if _, err := importutil.RequireID(id, "Leave request"); err != nil {
			return nil, err
		}
		r, ok := byID[id]
		if !ok || !leaveVisible(rc, r) {
			return nil, dataerr.NotFound("Leave request not found.")
		}
		requests = append(requests, r)
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return nil, err
	}
	out := make([]LeaveCoverageEffect, len(requests))
	for i, r := range requests {
		effect, err := effectOf(rc, r, plan)
		if err != nil {
			return nil, err
		}
		out[i] = effect
	}
	return out, nil
}

// Deciding

func decideLeave(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any, decision string) (LeaveRequest, error) {
	action, verb := "leave.approved", "approve"
	if decision != "approved" {
		action, verb = "leave.declined", "decline"
	}
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsLeavePlanner}, auditlog.WriteMeta{Action: action, EntityType: "leave_request", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[LeaveRequest], error) {
		if _, err := importutil.RequireID(id, "Leave request"); err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		note, err := parseRosterDecision(body)
		if err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		all, err := allLeaveRequests(ctx, conn, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		var request *LeaveRequest
		for i := range all {
			if all[i].ID == id {
				request = &all[i]
				break
			}
		}
		if request == nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, dataerr.NotFound("Leave request not found.")
		}
		zoneID := leaveZoneOfRequest(*request)
		if err := reqctx.RequireWriteZone(rc, zoneID); err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		requesterID := fmt.Sprintf("agent:%s", request.AgentID)
		if request.CreatedBy != nil {
			requesterID = *request.CreatedBy
		}
		check := access.CheckApproval(access.ApprovalRequest{
			Role: rc.Role, RequesterUserID: requesterID, ApproverUserID: rc.UserID,
			Kind: access.ApprovalLeave, InstallMode: rc.InstallMode, HasInstallMode: true,
		})
		if !check.Allowed {
			return auditlog.AuditedWrite[LeaveRequest]{}, dataerr.Forbidden(fmt.Sprintf("%s may not %s this leave request (%s).", rc.Role, verb, check.Reason))
		}
		if request.Status != "requested" {
			return auditlog.AuditedWrite[LeaveRequest]{}, dataerr.Conflict(fmt.Sprintf("The leave request is already %s.", request.Status))
		}
		plan, err := loadPlan(ctx, conn, rc)
		if err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		effect, err := effectOf(rc, *request, plan)
		if err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		at := datactx.NowISO()
		userID := rc.UserID
		next := *request
		next.Status, next.UpdatedAt = decision, at
		next.DecidedAt, next.DecidedByUserID, next.DecisionNote = &at, &userID, note
		if err := upsertLeaveRequest(ctx, conn, rc.CustomerID, next); err != nil {
			return auditlog.AuditedWrite[LeaveRequest]{}, err
		}
		name := "an agent"
		if s := leaveAgentOf(request.AgentID); s != nil {
			name = s.NameEn
		}
		return auditlog.AuditedWrite[LeaveRequest]{
			Result: next, EntityID: &request.ID,
			SummaryEn: fmt.Sprintf("Leave of %s (%s to %s) %s.", name, request.StartDate, request.EndDate, decision),
			Detail:    map[string]any{"agent_id": request.AgentID, "new_gap_intervals": effect.NewGapIntervals, "note": derefAny(note)},
		}, nil
	})
}

// ApproveLeaveRequest mirrors approveLeaveRequest.
func ApproveLeaveRequest(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (LeaveRequest, error) {
	return decideLeave(ctx, conn, rc, id, body, "approved")
}

// DeclineLeaveRequest mirrors declineLeaveRequest.
func DeclineLeaveRequest(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (LeaveRequest, error) {
	return decideLeave(ctx, conn, rc, id, body, "declined")
}

// Leave windows

// LeaveWindow mirrors the contract type.
type LeaveWindow struct {
	ZoneID        string  `json:"zone_id"`
	StartDate     string  `json:"start_date"`
	EndDate       string  `json:"end_date"`
	DemandIndex   float64 `json:"demand_index"`
	SpareCapacity int     `json:"spare_capacity"`
	Recommended   bool    `json:"recommended"`
}

// LeaveWindowQuery mirrors listLeaveWindows' query.
type LeaveWindowQuery struct {
	Limit    int
	Cursor   string
	ZoneID   string
	DateFrom string
	DateTo   string
}

type leaveWeek struct{ start, end string }

type leaveDayStat struct{ required, planned int }

func leaveMean(values []int) float64 {
	if len(values) == 0 {
		return 0
	}
	sum := 0
	for _, v := range values {
		sum += v
	}
	return float64(sum) / float64(len(values))
}

// ListLeaveWindows mirrors listLeaveWindows.
func ListLeaveWindows(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query LeaveWindowQuery) (datactx.PageResult[LeaveWindow], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLeavePlanner, access.AccessView); err != nil {
		return datactx.PageResult[LeaveWindow]{}, err
	}
	if query.DateFrom != "" {
		if err := validateDateString(query.DateFrom); err != nil {
			return datactx.PageResult[LeaveWindow]{}, err
		}
	}
	if query.DateTo != "" {
		if err := validateDateString(query.DateTo); err != nil {
			return datactx.PageResult[LeaveWindow]{}, err
		}
	}
	from := query.DateFrom
	if from == "" {
		from = demoToday(ctx, rc.CustomerID)
	}
	to := query.DateTo
	if to == "" {
		to = shiftDateBy(from, defaultWindowWeeks*7-1)
	}
	if to < from {
		return datactx.PageResult[LeaveWindow]{}, dataerr.Invalid("date_to must not be before date_from.")
	}
	if shiftDateBy(from, maxWindowWeeks*7) < to {
		return datactx.PageResult[LeaveWindow]{}, dataerr.Invalid(fmt.Sprintf("At most %d weeks.", maxWindowWeeks))
	}
	allZonesRows, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[LeaveWindow]{}, err
	}
	var zones []Zone
	for _, z := range allZonesRows {
		zid := z.ID
		if !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		if query.ZoneID != "" && z.ID != query.ZoneID {
			continue
		}
		zones = append(zones, z)
	}
	sort.SliceStable(zones, func(i, j int) bool { return zones[i].NameEn < zones[j].NameEn })
	if query.ZoneID != "" && len(zones) == 0 {
		return datactx.PageResult[LeaveWindow]{}, dataerr.NotFound("Zone not found.")
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return datactx.PageResult[LeaveWindow]{}, err
	}
	var weeks []leaveWeek
	for start := from; start <= to; start = shiftDateBy(start, 7) {
		end := shiftDateBy(start, 6)
		if end > to {
			end = to
		}
		weeks = append(weeks, leaveWeek{start, end})
	}

	var windows []LeaveWindow
	for _, zone := range zones {
		perDay := map[string]leaveDayStat{}
		for _, w := range weeks {
			for d := w.start; d <= w.end; d = shiftDateBy(d, 1) {
				required := requiredSeries(plan, zone.ID, d)
				lines, err := linesOnDuty(rc, plan, zone.ID, d)
				if err != nil {
					return datactx.PageResult[LeaveWindow]{}, err
				}
				planned := coverageSeries(lines, d).WithVehicle
				sumReq, sumPlanned := 0, 0
				for _, n := range required {
					sumReq += n
				}
				for _, n := range planned {
					sumPlanned += n
				}
				perDay[d] = leaveDayStat{required: sumReq, planned: sumPlanned}
			}
		}
		var allReqValues []int
		for _, d := range perDay {
			allReqValues = append(allReqValues, d.required)
		}
		allRequired := leaveMean(allReqValues)
		for _, w := range weeks {
			var reqValues []int
			spareSum, n := 0.0, 0
			for d, stat := range perDay {
				if d < w.start || d > w.end {
					continue
				}
				reqValues = append(reqValues, stat.required)
				spareSum += float64(stat.planned-stat.required) / 96
				n++
			}
			demand := leaveMean(reqValues)
			spare := 0.0
			if n > 0 {
				spare = spareSum / float64(n)
			}
			demandIndex := 0.0
			if allRequired != 0 {
				demandIndex = math.Round((demand/allRequired)*1000) / 1000
			}
			spareCapacity := int(math.Round(spare))
			windows = append(windows, LeaveWindow{
				ZoneID: zone.ID, StartDate: w.start, EndDate: w.end, DemandIndex: demandIndex,
				SpareCapacity: spareCapacity, Recommended: spareCapacity >= 1 && demandIndex <= 1,
			})
		}
	}
	var filtered []LeaveWindow
	for _, w := range windows {
		if datactx.InDateRange(w.StartDate, from, to) {
			filtered = append(filtered, w)
		}
	}
	return datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}
