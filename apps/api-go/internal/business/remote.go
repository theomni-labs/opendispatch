// SPDX-License-Identifier: AGPL-3.0-only

// Ports remote.ts (ops.remote_queue): the queue of
// remote_inferred cases, assigning a reviewer, and
// remote staffing per 15-minute interval.
package business

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

var remoteStatuses = []string{"waiting", "in_review", "done"}
var remoteStatusOrder = map[string]int{"waiting": 0, "in_review": 1, "done": 2}
var remoteWeekdays = [7]string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}

const (
	remoteDayMs      = 86_400_000
	remoteIntervalMs = 15 * 60_000
	// mean of review (8-25) + paperwork (8-22) min.
	remoteMeanHandlingMinutes = 31.5
	// calibration: reviewers_per_remote_agent.
	remoteReviewerShare = 0.34
)

// round2 mirrors Math.round(x*100)/100 (half toward
// +Infinity, unlike Go's math.Round, so it matches
// TS exactly for the negative deltas this sees too).
func round2(x float64) float64 { return math.Floor(x*100+0.5) / 100 }

// RemoteQueueItem mirrors the contract type.
type RemoteQueueItem struct {
	CaseID             string  `json:"case_id"`
	CaseNumber         string  `json:"case_number"`
	ZoneID             string  `json:"zone_id"`
	RegisteredAt       string  `json:"registered_at"`
	Status             string  `json:"status"`
	AssignedReviewerID *string `json:"assigned_reviewer_id"`
	ReviewStartedAt    *string `json:"review_started_at"`
	ReviewFinishedAt   *string `json:"review_finished_at"`
	// Classification: set for a live case.
	Classification *LiveClassification `json:"classification,omitempty"`
	// AISuggestion: latest, brief; never routes
	AISuggestion *AssistantCaseSuggestionSummary `json:"ai_suggestion,omitempty"`
	DataSource   string                          `json:"data_source"`
}

// remoteReview: a stored assignment, by case id.
type remoteReview struct {
	datactx.BaseRecord
	CaseID          string
	ReviewerID      string
	ReviewStartedAt string
}

var (
	remoteReviewMu    sync.Mutex
	remoteReviewStore []remoteReview
)

// ResetRemoteReviewsForTest clears the review store.
func ResetRemoteReviewsForTest() {
	remoteReviewMu.Lock()
	remoteReviewStore = nil
	remoteReviewMu.Unlock()
}

func upsertRemoteReviewMemory(r remoteReview) {
	remoteReviewMu.Lock()
	defer remoteReviewMu.Unlock()
	for i, x := range remoteReviewStore {
		if x.CaseID == r.CaseID {
			remoteReviewStore[i] = r
			return
		}
	}
	remoteReviewStore = append(remoteReviewStore, r)
}

func remoteReviewsByCaseMemory() map[string]remoteReview {
	remoteReviewMu.Lock()
	rows := append([]remoteReview(nil), remoteReviewStore...)
	remoteReviewMu.Unlock()
	out := make(map[string]remoteReview, len(rows))
	for _, r := range rows {
		out[r.CaseID] = r
	}
	return out
}

// -------------------------------------------------
// The demo clock (Live Dispatch Board's replay
// clock) and the queue day.
// -------------------------------------------------

// replayStored mirrors ReplayStored. Status "" means
// nothing is stored yet (a real status is never "").
type replayStored struct {
	Status       string  `json:"status"`
	ReplayAt     string  `json:"replay_at"`
	Speed        float64 `json:"speed"`
	AnchorWallMs *int64  `json:"anchor_wall_ms"`
}

type replayScriptDoc struct {
	DefaultStartAt string `json:"default_start_at"`
	ReplayDate     string `json:"replay_date"`
}

func nowMs() int64 { return time.Now().UnixMilli() }

func timeFromMs(ms int64) time.Time { return time.UnixMilli(ms) }

// replayTimeOfDayMs: ms since midnight (Riyadh) of
// the replay clock, capped to one day.
func replayTimeOfDayMs(ctx context.Context, tenant string) (int64, error) {
	stored, err := readSettingStrict(ctx, tenant, "dispatch.replay", replayStored{})
	if err != nil {
		return 0, err
	}
	var script replayScriptDoc
	_, _ = fixtures.Object("ReplayScript", &script)
	baseIso := script.DefaultStartAt
	if stored.Status != "" {
		baseIso = stored.ReplayAt
	}
	if baseIso == "" {
		baseIso = "2026-09-13T07:00:00+03:00"
	}
	baseT, err := datactx.EpochOf(baseIso)
	if err != nil {
		return 0, err
	}
	base := baseT.UnixMilli()
	at := base
	if stored.Status == "playing" && stored.AnchorWallMs != nil {
		at = base + int64(float64(nowMs()-*stored.AnchorWallMs)*stored.Speed)
	}
	var dayStart int64
	if script.ReplayDate == "" {
		dayStart = ((base+3*3_600_000)/remoteDayMs)*remoteDayMs - 3*3_600_000
	} else {
		startT, err := datactx.EpochOf(script.ReplayDate + "T00:00:00+03:00")
		if err != nil {
			return 0, err
		}
		dayStart = startT.UnixMilli()
	}
	tod := at - dayStart
	if tod < 0 {
		tod = 0
	}
	if tod > remoteDayMs {
		tod = remoteDayMs
	}
	return tod, nil
}

// queueDay: the latest date with a remote case.
func queueDay() string {
	latest := ""
	for _, c := range allCasesSnapshot() {
		if c.Handling != "remote_inferred" {
			continue
		}
		day := dateOnly(c.RegisteredAt)
		if latest == "" || day > latest {
			latest = day
		}
	}
	return latest
}

func startOfDayMs(date string) (int64, error) {
	t, err := datactx.EpochOf(date + "T00:00:00+03:00")
	if err != nil {
		return 0, err
	}
	return t.UnixMilli(), nil
}

// handlingMs: a deterministic handling time for a
// case, 8-25 min review plus 8-22 min paperwork.
func handlingMs(caseID string) int64 {
	var h uint32
	for i := 0; i < len(caseID); i++ {
		h = h*31 + uint32(caseID[i])
	}
	review := int64(8 + h%18)
	paperwork := int64(8 + (h>>8)%15)
	return (review + paperwork) * 60_000
}

func itemOf(c Case, asOfMs int64, stored map[string]remoteReview) (*RemoteQueueItem, error) {
	regT, err := datactx.EpochOf(c.RegisteredAt)
	if err != nil {
		return nil, err
	}
	if regT.UnixMilli() > asOfMs {
		return nil, nil
	}
	base := RemoteQueueItem{CaseID: c.ID, CaseNumber: c.CaseNumber, ZoneID: c.ZoneID, RegisteredAt: c.RegisteredAt, DataSource: c.DataSource, AISuggestion: suggestionSummary(c)}
	if mine, ok := stored[c.ID]; ok {
		startT, err := datactx.EpochOf(mine.ReviewStartedAt)
		if err != nil {
			return nil, err
		}
		if startT.UnixMilli() <= asOfMs {
			finishedMs := startT.UnixMilli() + handlingMs(c.ID)
			done := finishedMs <= asOfMs
			item := base
			item.Status = "in_review"
			reviewerID := mine.ReviewerID
			item.AssignedReviewerID = &reviewerID
			startedAt := mine.ReviewStartedAt
			item.ReviewStartedAt = &startedAt
			if done {
				item.Status = "done"
				finished := isoAtMs(finishedMs)
				item.ReviewFinishedAt = &finished
			}
			return &item, nil
		}
	}
	item := base
	item.Status = "waiting"
	if c.ClosedAt != nil {
		closedT, err := datactx.EpochOf(*c.ClosedAt)
		if err != nil {
			return nil, err
		}
		if closedT.UnixMilli() <= asOfMs {
			item.Status = "done"
			item.ReviewStartedAt = c.RemoteReviewAt
			item.ReviewFinishedAt = c.ClosedAt
			return &item, nil
		}
	}
	if c.RemoteReviewAt != nil {
		startT, err := datactx.EpochOf(*c.RemoteReviewAt)
		if err != nil {
			return nil, err
		}
		if startT.UnixMilli() <= asOfMs {
			item.Status = "in_review"
			item.ReviewStartedAt = c.RemoteReviewAt
			return &item, nil
		}
	}
	return &item, nil
}

func isoAtMs(ms int64) string {
	return datactx.ToRiyadhISO(timeFromMs(ms))
}

type remoteQueueSnapshot struct {
	Items []RemoteQueueItem
	AsOf  int64
	Day   string
	// LiveAsOf: the live clock, for live items.
	LiveAsOf int64
}

func queueItems(ctx context.Context, rc reqctx.RequestContext) (*remoteQueueSnapshot, error) {
	stored, err := loadRemoteReviews(ctx, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	live, liveAsOf, err := liveRemoteItems(ctx, rc, stored)
	if err != nil {
		return nil, err
	}
	day := queueDay()
	if day == "" && len(live) == 0 {
		return nil, nil
	}
	var asOfMs int64
	if day != "" {
		dayStart, err := startOfDayMs(day)
		if err != nil {
			return nil, err
		}
		todMs, err := replayTimeOfDayMs(ctx, rc.CustomerID)
		if err != nil {
			return nil, err
		}
		asOfMs = dayStart + todMs
	}
	items := []RemoteQueueItem{}
	for _, c := range allCasesSnapshot() {
		zid := c.ZoneID
		if day == "" || c.Handling != "remote_inferred" || !strings.HasPrefix(c.RegisteredAt, day) || !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		item, err := itemOf(c, asOfMs, stored)
		if err != nil {
			return nil, err
		}
		if item != nil {
			items = append(items, *item)
		}
	}
	seen := make(map[string]bool, len(items))
	for _, item := range items {
		seen[item.CaseID] = true
	}
	for _, item := range live {
		if !seen[item.CaseID] {
			items = append(items, item)
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if remoteStatusOrder[items[i].Status] != remoteStatusOrder[items[j].Status] {
			return remoteStatusOrder[items[i].Status] < remoteStatusOrder[items[j].Status]
		}
		ti, _ := datactx.EpochOf(items[i].RegisteredAt)
		tj, _ := datactx.EpochOf(items[j].RegisteredAt)
		if !ti.Equal(tj) {
			return ti.Before(tj)
		}
		return items[i].CaseID < items[j].CaseID
	})
	return &remoteQueueSnapshot{Items: items, AsOf: asOfMs, Day: day, LiveAsOf: liveAsOf}, nil
}

// RemoteQueueQuery mirrors listRemoteQueue's query.
type RemoteQueueQuery struct {
	Limit  int
	Cursor string
	ZoneID string
	Status string
}

// ListRemoteQueue mirrors listRemoteQueue.
func ListRemoteQueue(rc reqctx.RequestContext, query RemoteQueueQuery) (datactx.PageResult[RemoteQueueItem], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsRemoteQueue, access.AccessView); err != nil {
		return datactx.PageResult[RemoteQueueItem]{}, err
	}
	if query.Status != "" && !containsStr(remoteStatuses, query.Status) {
		return datactx.PageResult[RemoteQueueItem]{}, dataerr.Invalid("status must be one of " + strings.Join(remoteStatuses, ", ") + ".")
	}
	queue, err := queueItems(context.Background(), rc)
	if err != nil {
		return datactx.PageResult[RemoteQueueItem]{}, err
	}
	var rows []RemoteQueueItem
	if queue != nil {
		for _, item := range queue.Items {
			if query.ZoneID != "" && item.ZoneID != query.ZoneID {
				continue
			}
			if query.Status != "" && item.Status != query.Status {
				continue
			}
			rows = append(rows, item)
		}
	}
	page, err := datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
	if err == nil {
		fillQueueSuggestions(context.Background(), rc.CustomerID, page.Items)
	}
	return page, err
}

// RemoteQueueClock mirrors the (non-contract) type.
type RemoteQueueClock struct {
	Date string `json:"date"`
	AsOf string `json:"as_of"`
	// LiveAsOf: the live board's clock.
	LiveAsOf *string `json:"live_as_of,omitempty"`
}

// GetRemoteQueueClock mirrors getRemoteQueueClock: a
// Demo helper, not a contract operation.
func GetRemoteQueueClock(rc reqctx.RequestContext) (*RemoteQueueClock, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsRemoteQueue, access.AccessView); err != nil {
		return nil, err
	}
	day := queueDay()
	if day == "" {
		return nil, nil
	}
	dayStart, err := startOfDayMs(day)
	if err != nil {
		return nil, err
	}
	todMs, err := replayTimeOfDayMs(context.Background(), rc.CustomerID)
	if err != nil {
		return nil, err
	}
	out := &RemoteQueueClock{Date: day, AsOf: isoAtMs(dayStart + todMs)}
	if clock, err := readDispatchClock(context.Background(), rc.CustomerID); err == nil {
		live := isoAtMs(clock.AtMs)
		out.LiveAsOf = &live
	}
	return out, nil
}

// -------------------------------------------------
// Duty, leave and assigning a reviewer.
// -------------------------------------------------

func approvedLeaveOn(ctx context.Context, conn *tenancy.Connection, tenantID, agentID, date string) (bool, error) {
	rows, err := allLeaveRequests(ctx, conn, tenantID)
	if err != nil {
		return false, err
	}
	return approvedLeaveIn(rows, agentID, date), nil
}

// approvedLeaveIn: approvedLeaveOn on loaded rows.
func approvedLeaveIn(rows []LeaveRequest, agentID, date string) bool {
	for _, l := range rows {
		if l.AgentID == agentID && l.Status == "approved" && l.StartDate <= date && date <= l.EndDate {
			return true
		}
	}
	return false
}

func minutesOfTime(t string) int {
	if len(t) < 5 {
		return 0
	}
	h, m := 0, 0
	fmt.Sscanf(t[:2], "%d", &h)
	fmt.Sscanf(t[3:5], "%d", &m)
	return h*60 + m
}

func inHours(hours ShiftHours, todMinutes int) bool {
	if !hours.Applies || hours.StartTime == nil || hours.EndTime == nil {
		return false
	}
	start := minutesOfTime(*hours.StartTime)
	end := minutesOfTime(*hours.EndTime)
	if end == 0 {
		return todMinutes >= start
	}
	if end > start {
		return todMinutes >= start && todMinutes < end
	}
	return todMinutes >= start || todMinutes < end
}

func onBreakAt(a RosterAssignment, atMs int64) bool {
	if a.BreakStartAt == nil || a.BreakEndAt == nil {
		return false
	}
	startT, err1 := datactx.EpochOf(*a.BreakStartAt)
	endT, err2 := datactx.EpochOf(*a.BreakEndAt)
	if err1 != nil || err2 != nil {
		return false
	}
	return startT.UnixMilli() <= atMs && atMs < endT.UnixMilli()
}

func remoteAssignmentsOn(ctx context.Context, conn *tenancy.Connection, tenantID, date string) ([]RosterAssignment, error) {
	rosters, err := allRosters(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	usable := map[string]bool{}
	for _, r := range rosters {
		if r.Status != "rejected" && r.Status != "superseded" {
			usable[r.ID] = true
		}
	}
	agents, err := allAgents(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	remote := map[string]bool{}
	for _, s := range agents {
		if s.Kind == "remote" {
			remote[s.ID] = true
		}
	}
	all, err := rosterAssignmentsOnDate(ctx, conn, tenantID, date)
	if err != nil {
		return nil, err
	}
	var out []RosterAssignment
	for _, a := range all {
		if a.RosterDate == date && remote[a.AgentID] && usable[a.RosterID] {
			out = append(out, a)
		}
	}
	return out, nil
}

// unavailableReason: why a reviewer cannot take a
// case at a moment, or "" when they can.
func unavailableReason(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, agent Agent, date string, atMs int64) (string, error) {
	onLeave, err := approvedLeaveOn(ctx, conn, rc.CustomerID, agent.ID, date)
	if err != nil {
		return "", err
	}
	if onLeave {
		return "is on approved leave", nil
	}
	dayAssignments, err := remoteAssignmentsOn(ctx, conn, rc.CustomerID, date)
	if err != nil {
		return "", err
	}
	if len(dayAssignments) > 0 {
		for _, a := range dayAssignments {
			if a.AgentID != agent.ID {
				continue
			}
			startT, err1 := datactx.EpochOf(a.StartAt)
			endT, err2 := datactx.EpochOf(a.EndAt)
			if err1 == nil && err2 == nil && startT.UnixMilli() <= atMs && atMs < endT.UnixMilli() && !onBreakAt(a, atMs) {
				return "", nil
			}
		}
		return "is not on shift", nil
	}
	dayT, err := datactx.EpochOf(date + "T12:00:00Z")
	if err != nil {
		return "", err
	}
	weekday := remoteWeekdays[dayT.UTC().Weekday()]
	daysOff, _ := agent.Extra["days_off"].([]any)
	for _, d := range daysOff {
		if s, ok := d.(string); ok && s == weekday {
			return "is off duty today", nil
		}
	}
	code := ""
	if s, ok := agent.Extra["home_shift"].(string); ok {
		code = strings.ToUpper(strings.ReplaceAll(s, "_", "-"))
	}
	patterns, err := allShiftPatterns(ctx, conn, rc.CustomerID)
	if err != nil {
		return "", err
	}
	var pattern *ShiftPattern
	for i := range patterns {
		if patterns[i].Code == code {
			pattern = &patterns[i]
			break
		}
	}
	if pattern == nil {
		return "has no shift", nil
	}
	ramadan, err := IsRamadan(rc, date)
	if err != nil {
		return "", err
	}
	hours := pattern.Normal
	if ramadan {
		hours = pattern.Ramadan
	}
	dayStart, err := startOfDayMs(date)
	if err != nil {
		return "", err
	}
	if inHours(hours, int((atMs-dayStart)/60_000)) {
		return "", nil
	}
	return "is not on shift", nil
}

// AssignRemoteReviewer mirrors assignRemoteReviewer.
func AssignRemoteReviewer(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (RemoteQueueItem, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsRemoteQueue}, auditlog.WriteMeta{Action: "remote_queue.reviewer_assigned", EntityType: "case", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[RemoteQueueItem], error) {
		if _, err := importutil.RequireID(id, "Case"); err != nil {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, err
		}
		input, err := datactx.Object(body, "Remote reviewer", []string{"agent_id"})
		if err != nil {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, err
		}
		agentID, err := datactx.UUID(input, "agent_id")
		if err != nil {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, err
		}
		queuePtr, err := queueItems(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, err
		}
		queue, err := datactx.RequireFound(queuePtr, "Queued case")
		if err != nil {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, err
		}
		var item *RemoteQueueItem
		for i := range queue.Items {
			if queue.Items[i].CaseID == id {
				item = &queue.Items[i]
				break
			}
		}
		item, err = datactx.RequireFound(item, "Queued case")
		if err != nil {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, err
		}
		if rc.ZoneScope.Kind == access.ScopeAssignedZones {
			if err := reqctx.RequireWriteZone(rc, &item.ZoneID); err != nil {
				return auditlog.AuditedWrite[RemoteQueueItem]{}, err
			}
		}
		liveCase, err := oneCaseLive(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, err
		}
		c, err := datactx.RequireFound(liveCase, "Case")
		if err != nil {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, err
		}
		agentRow, err := oneAgent(ctx, conn, rc.CustomerID, agentID)
		if err != nil {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, err
		}
		agent, err := datactx.RequireFound(agentRow, "Agent")
		if err != nil {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, err
		}
		if agent.Kind != "remote" || !agent.IsActive {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, dataerr.Invalid("Remote reviewer: choose an active remote agent.")
		}
		if item.Status != "waiting" {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, dataerr.Conflict(fmt.Sprintf("ALREADY_ASSIGNED: %s is %s, only a waiting case can be assigned.", c.CaseNumber, strings.ReplaceAll(item.Status, "_", " ")))
		}
		selfUserID, _ := agent.Extra["user_id"].(string)
		if (c.AgentID != nil && *c.AgentID == agent.ID) || agent.ID == rc.UserID || selfUserID == rc.UserID {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, dataerr.Conflict("SELF_ASSIGNMENT: a reviewer cannot take their own case.")
		}
		day, at := queue.Day, queue.AsOf
		if item.Classification != nil {
			at = queue.LiveAsOf
			day = dateOnly(isoAtMs(at))
		}
		problem, err := unavailableReason(ctx, conn, rc, *agent, day, at)
		if err != nil {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, err
		}
		if problem != "" {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, dataerr.Conflict(fmt.Sprintf("%s %s.", agent.Code, problem))
		}
		startedAt := isoAtMs(at)
		record := remoteReview{BaseRecord: datactx.NewRecord(rc, "", startedAt), CaseID: id, ReviewerID: agent.ID, ReviewStartedAt: startedAt}
		if err := saveRemoteReview(ctx, rc.CustomerID, record); err != nil {
			return auditlog.AuditedWrite[RemoteQueueItem]{}, err
		}
		result := *item
		result.Status = "in_review"
		reviewerID := agent.ID
		result.AssignedReviewerID = &reviewerID
		result.ReviewStartedAt = &startedAt
		result.ReviewFinishedAt = nil
		return auditlog.AuditedWrite[RemoteQueueItem]{
			Result:    result,
			SummaryEn: fmt.Sprintf("Remote reviewer %s assigned to %s.", agent.Code, c.CaseNumber),
			Detail:    map[string]any{"case_id": id, "agent_id": agent.ID, "review_started_at": startedAt},
		}, nil
	})
}

// -------------------------------------------------
// Staffing.
// -------------------------------------------------

// remoteZoneRow: another stale-snapshot copy, like
// field_share.go's demoZoneRow (TS reads Zone from
// the demo store here too, not store-api), but this
// module also needs each zone's code.
type remoteZoneRow struct {
	ID   string
	Code string
}

var (
	remoteZoneMu     sync.Mutex
	remoteZoneRows   []remoteZoneRow
	remoteZoneSeeded bool
)

// ResetRemoteZonesForTest clears the zone snapshot.
func ResetRemoteZonesForTest() {
	remoteZoneMu.Lock()
	remoteZoneRows, remoteZoneSeeded = nil, true
	remoteZoneMu.Unlock()
}

// SeedRemoteZonesForTest sets the zone snapshot.
func SeedRemoteZonesForTest(rows []remoteZoneRow) {
	remoteZoneMu.Lock()
	remoteZoneRows, remoteZoneSeeded = append([]remoteZoneRow(nil), rows...), true
	remoteZoneMu.Unlock()
}

// ReloadRemoteZonesForTest: back to the fixtures.
func ReloadRemoteZonesForTest() {
	remoteZoneMu.Lock()
	remoteZoneRows, remoteZoneSeeded = nil, false
	remoteZoneMu.Unlock()
}

func allRemoteZoneRows() []remoteZoneRow {
	remoteZoneMu.Lock()
	defer remoteZoneMu.Unlock()
	if !remoteZoneSeeded {
		remoteZoneSeeded = true
		if zones, err := fixtures.Records[Zone]("Zone"); err == nil {
			for _, z := range zones {
				code, _ := z.Extra["code"].(string)
				remoteZoneRows = append(remoteZoneRows, remoteZoneRow{ID: z.ID, Code: code})
			}
		}
	}
	return append([]remoteZoneRow(nil), remoteZoneRows...)
}

// RemoteStaffingInterval mirrors the contract type.
type RemoteStaffingInterval struct {
	IntervalStart     string  `json:"interval_start"`
	IntervalIndex     int     `json:"interval_index"`
	ExpectedCases     float64 `json:"expected_cases"`
	RequiredReviewers float64 `json:"required_reviewers"`
	PlannedReviewers  float64 `json:"planned_reviewers"`
	Delta             float64 `json:"delta"`
	OnShift           *int    `json:"on_shift,omitempty"`
}

// RemoteStaffing mirrors the contract type.
type RemoteStaffing struct {
	Date         string                   `json:"date"`
	Intervals    []RemoteStaffingInterval `json:"intervals"`
	Handling     *RemoteHandling          `json:"handling,omitempty"`
	Illustrative bool                     `json:"illustrative"`
	DataSource   string                   `json:"data_source"`
}

// GetRemoteStaffing mirrors getRemoteStaffing.
func GetRemoteStaffing(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, date string) (RemoteStaffing, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsRemoteQueue, access.AccessView); err != nil {
		return RemoteStaffing{}, err
	}
	validated, err := datactx.Date(datactx.Obj{"date": date}, "date")
	if err != nil {
		return RemoteStaffing{}, err
	}
	scope, err := loadRemoteScope(ctx, conn, rc)
	if err != nil {
		return RemoteStaffing{}, err
	}
	h, err := remoteHandlingFor(ctx, conn, rc, scope.zoneIDs(), validated)
	if err != nil {
		return RemoteStaffing{}, err
	}
	day, err := scope.day(ctx, conn, rc, validated, h, true)
	if err != nil {
		return RemoteStaffing{}, err
	}
	return RemoteStaffing{Date: validated, Intervals: day.intervals, Handling: &h, Illustrative: true, DataSource: "SYNTHETIC"}, nil
}
