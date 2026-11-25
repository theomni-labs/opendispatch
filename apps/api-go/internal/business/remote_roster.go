// SPDX-License-Identifier: AGPL-3.0-only

// Remote roster, capacity and the one-day core.
package business

import (
	"context"
	"sort"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const remoteMaxDays = 31

// RemoteRosterLine mirrors the contract type.
type RemoteRosterLine struct {
	AgentID      string  `json:"agent_id"`
	Code         string  `json:"code"`
	NameEn       string  `json:"name_en"`
	NameAr       *string `json:"name_ar"`
	PoolZoneCode *string `json:"pool_zone_code"`
	ShiftCode    *string `json:"shift_code"`
	StartAt      string  `json:"start_at"`
	EndAt        string  `json:"end_at"`
	BreakStartAt *string `json:"break_start_at"`
	BreakEndAt   *string `json:"break_end_at"`
	OnLeave      bool    `json:"on_leave"`
	Source       string  `json:"source"`
}

// RemoteShiftLoad mirrors the contract type.
type RemoteShiftLoad struct {
	ShiftCode      *string  `json:"shift_code"`
	StartAt        *string  `json:"start_at"`
	EndAt          *string  `json:"end_at"`
	Scheduled      int      `json:"scheduled"`
	OnLeave        int      `json:"on_leave"`
	AvailableHours float64  `json:"available_hours"`
	CapacityHours  float64  `json:"capacity_hours"`
	DemandHours    float64  `json:"demand_hours"`
	Utilization    *float64 `json:"utilization"`
	GapHours       float64  `json:"gap_hours"`
}

// RemoteDayLoad mirrors the contract type.
type RemoteDayLoad struct {
	Date           string            `json:"date"`
	Source         string            `json:"source"`
	Scheduled      int               `json:"scheduled"`
	OnLeave        int               `json:"on_leave"`
	Off            int               `json:"off"`
	AvailableHours float64           `json:"available_hours"`
	CapacityHours  float64           `json:"capacity_hours"`
	DemandHours    float64           `json:"demand_hours"`
	Utilization    *float64          `json:"utilization"`
	GapHours       float64           `json:"gap_hours"`
	Shifts         []RemoteShiftLoad `json:"shifts"`
}

// RemoteRoster mirrors the contract type.
type RemoteRoster struct {
	Date          string                   `json:"date"`
	Fte           int                      `json:"fte"`
	Day           RemoteDayLoad            `json:"day"`
	Lines         []RemoteRosterLine       `json:"lines"`
	Intervals     []RemoteStaffingInterval `json:"intervals"`
	Handling      RemoteHandling           `json:"handling"`
	ReviewerShare float64                  `json:"reviewer_share"`
	Illustrative  bool                     `json:"illustrative"`
	DataSource    string                   `json:"data_source"`
}

// RemoteCapacityWeek mirrors RemoteCapacity.weeks[].
type RemoteCapacityWeek struct {
	WeekStart       string   `json:"week_start"`
	Days            int      `json:"days"`
	ScheduledShifts int      `json:"scheduled_shifts"`
	AvailableHours  float64  `json:"available_hours"`
	CapacityHours   float64  `json:"capacity_hours"`
	DemandHours     float64  `json:"demand_hours"`
	Utilization     *float64 `json:"utilization"`
	GapHours        float64  `json:"gap_hours"`
}

// RemoteCapacity mirrors the contract type.
type RemoteCapacity struct {
	DateFrom      string               `json:"date_from"`
	DateTo        string               `json:"date_to"`
	Fte           int                  `json:"fte"`
	Days          []RemoteDayLoad      `json:"days"`
	Weeks         []RemoteCapacityWeek `json:"weeks"`
	Handling      RemoteHandling       `json:"handling"`
	ReviewerShare float64              `json:"reviewer_share"`
	Illustrative  bool                 `json:"illustrative"`
	DataSource    string               `json:"data_source"`
}

// remoteLine: a line with its instants in ms.
type remoteLine struct {
	RemoteRosterLine
	startMs, endMs           int64
	breakStartMs, breakEndMs int64
}

func (l remoteLine) hasBreak() bool { return l.breakEndMs > l.breakStartMs }

// hours: shift length less the break.
func (l remoteLine) hours() float64 {
	ms := l.endMs - l.startMs
	if l.hasBreak() {
		ms -= l.breakEndMs - l.breakStartMs
	}
	if ms < 0 {
		return 0
	}
	return float64(ms) / 3_600_000
}

func (l remoteLine) workingAt(atMs int64) bool {
	if l.OnLeave || atMs < l.startMs || atMs >= l.endMs {
		return false
	}
	return !(l.hasBreak() && atMs >= l.breakStartMs && atMs < l.breakEndMs)
}

// remoteScope: what every day of a request shares.
type remoteScope struct {
	zones      []remoteZoneRow
	agents     []Agent
	byID       map[string]Agent
	patternsID map[string]ShiftPattern
	patternsCd map[string]ShiftPattern
	usable     map[string]bool
	leave      []LeaveRequest
}

func (s *remoteScope) zoneIDs() []string {
	ids := make([]string, 0, len(s.zones))
	for _, z := range s.zones {
		ids = append(ids, z.ID)
	}
	return ids
}

func loadRemoteScope(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) (*remoteScope, error) {
	s := &remoteScope{byID: map[string]Agent{}, patternsID: map[string]ShiftPattern{}, patternsCd: map[string]ShiftPattern{}, usable: map[string]bool{}}
	codes := map[string]bool{}
	for _, z := range allRemoteZoneRows() {
		zid := z.ID
		if !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		s.zones = append(s.zones, z)
		if z.Code != "" {
			codes[z.Code] = true
		}
	}
	rows, err := allAgents(ctx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	for _, sv := range rows {
		if sv.Kind != "remote" || !sv.IsActive {
			continue
		}
		if rc.ZoneScope.Kind == access.ScopeAssignedZones {
			pool, _ := sv.Extra["pool_zone_code"].(string)
			if pool == "" || !codes[pool] {
				continue
			}
		}
		s.agents = append(s.agents, sv)
		s.byID[sv.ID] = sv
	}
	sort.SliceStable(s.agents, func(i, j int) bool { return s.agents[i].Code < s.agents[j].Code })
	patterns, err := allShiftPatterns(ctx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	for _, p := range patterns {
		s.patternsID[p.ID] = p
		s.patternsCd[p.Code] = p
	}
	rosters, err := allRosters(ctx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	for _, r := range rosters {
		if r.Status != "rejected" && r.Status != "superseded" {
			s.usable[r.ID] = true
		}
	}
	if s.leave, err = allLeaveRequests(ctx, conn, rc.CustomerID); err != nil {
		return nil, err
	}
	return s, nil
}

func strOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (s *remoteScope) baseLine(sv Agent, date, source string) RemoteRosterLine {
	pool, _ := sv.Extra["pool_zone_code"].(string)
	return RemoteRosterLine{AgentID: sv.ID, Code: sv.Code, NameEn: sv.NameEn, NameAr: sv.NameAr, PoolZoneCode: strOrNil(pool), OnLeave: approvedLeaveIn(s.leave, sv.ID, date), Source: source}
}

func msOf(iso string) (int64, bool) {
	t, err := datactx.EpochOf(iso)
	if err != nil {
		return 0, false
	}
	return t.UnixMilli(), true
}

// linesOn: roster lines, else home shifts.
func (s *remoteScope) linesOn(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, date string) ([]remoteLine, string, error) {
	all, err := rosterAssignmentsOnDate(ctx, conn, rc.CustomerID, date)
	if err != nil {
		return nil, "", err
	}
	var lines []remoteLine
	for _, a := range all {
		sv, ok := s.byID[a.AgentID]
		if !ok || a.RosterDate != date || !s.usable[a.RosterID] {
			continue
		}
		start, ok1 := msOf(a.StartAt)
		end, ok2 := msOf(a.EndAt)
		if !ok1 || !ok2 {
			continue
		}
		l := remoteLine{RemoteRosterLine: s.baseLine(sv, date, "roster"), startMs: start, endMs: end}
		l.StartAt, l.EndAt = a.StartAt, a.EndAt
		if a.ShiftPatternID != nil {
			if p, ok := s.patternsID[*a.ShiftPatternID]; ok {
				l.ShiftCode = strOrNil(p.Code)
			}
		}
		if a.BreakStartAt != nil && a.BreakEndAt != nil {
			bs, ok1 := msOf(*a.BreakStartAt)
			be, ok2 := msOf(*a.BreakEndAt)
			if ok1 && ok2 {
				l.BreakStartAt, l.BreakEndAt, l.breakStartMs, l.breakEndMs = a.BreakStartAt, a.BreakEndAt, bs, be
			}
		}
		lines = append(lines, l)
	}
	if len(lines) > 0 {
		sortRemoteLines(lines)
		return lines, "roster", nil
	}
	ramadan, err := IsRamadan(rc, date)
	if err != nil {
		return nil, "", err
	}
	dayStart, err := startOfDayMs(date)
	if err != nil {
		return nil, "", err
	}
	weekday := remoteWeekdays[weekdayOfDate(date)]
	for _, sv := range s.agents {
		if hasDayOff(sv, weekday) {
			continue
		}
		code := ""
		if hs, ok := sv.Extra["home_shift"].(string); ok {
			code = strings.ToUpper(strings.ReplaceAll(hs, "_", "-"))
		}
		p, ok := s.patternsCd[code]
		if !ok {
			continue
		}
		hours := p.Normal
		if ramadan {
			hours = p.Ramadan
		}
		start, end, ok := homeWindow(hours, dayStart)
		if !ok {
			continue
		}
		l := remoteLine{RemoteRosterLine: s.baseLine(sv, date, "home_shift"), startMs: start, endMs: end}
		l.StartAt, l.EndAt, l.ShiftCode = isoAtMs(start), isoAtMs(end), strOrNil(p.Code)
		lines = append(lines, l)
	}
	if len(lines) == 0 {
		return nil, "none", nil
	}
	sortRemoteLines(lines)
	return lines, "home_shifts", nil
}

func hasDayOff(sv Agent, weekday string) bool {
	daysOff, _ := sv.Extra["days_off"].([]any)
	for _, d := range daysOff {
		if s, ok := d.(string); ok && s == weekday {
			return true
		}
	}
	return false
}

// homeWindow: a pattern's hours on a day, in ms.
func homeWindow(h ShiftHours, dayStart int64) (int64, int64, bool) {
	if !h.Applies || h.StartTime == nil || h.EndTime == nil {
		return 0, 0, false
	}
	start := dayStart + int64(minutesOfTime(*h.StartTime))*60_000
	end := dayStart + int64(minutesOfTime(*h.EndTime))*60_000
	if end <= start {
		end += remoteDayMs
	}
	return start, end, true
}

func sortRemoteLines(lines []remoteLine) {
	sort.SliceStable(lines, func(i, j int) bool {
		if lines[i].startMs != lines[j].startMs {
			return lines[i].startMs < lines[j].startMs
		}
		return lines[i].Code < lines[j].Code
	})
}

// remoteDemand: per interval, expected cases and minutes.
type remoteDemand struct {
	expected [Intervals]float64
	minutes  [Intervals]float64
}

func (s *remoteScope) demandOn(rc reqctx.RequestContext, date string, h RemoteHandling) (remoteDemand, error) {
	var d remoteDemand
	for _, z := range s.zones {
		timeline, err := GetForecastTimeline(rc, ForecastTimelineQuery{ZoneID: z.ID, Date: date})
		if err != nil {
			return d, err
		}
		per := h.minutesFor(z.ID)
		for _, iv := range timeline.Intervals {
			if iv.IntervalIndex < 0 || iv.IntervalIndex >= Intervals {
				continue
			}
			d.expected[iv.IntervalIndex] += iv.RemoteInferredExpected
			d.minutes[iv.IntervalIndex] += iv.RemoteInferredExpected * per
		}
	}
	return d, nil
}

// remoteIntervals: the 96 staffing intervals (pure).
func remoteIntervals(dayStart int64, lines []remoteLine, d remoteDemand, share float64) []RemoteStaffingInterval {
	out := make([]RemoteStaffingInterval, Intervals)
	for i := 0; i < Intervals; i++ {
		at := dayStart + int64(i)*remoteIntervalMs
		working := 0
		for _, l := range lines {
			if l.workingAt(at) {
				working++
			}
		}
		required := round2(d.minutes[i] / 15)
		planned := round2(float64(working) * share)
		on := working
		out[i] = RemoteStaffingInterval{
			IntervalStart: isoAtMs(at), IntervalIndex: i, ExpectedCases: round3(d.expected[i]),
			RequiredReviewers: required, PlannedReviewers: planned, Delta: round2(planned - required), OnShift: &on,
		}
	}
	return out
}

func ratio(num, den float64) *float64 {
	if den <= 0 {
		return nil
	}
	v := round4(num / den)
	return &v
}

// remoteShiftLoads: per shift code, then the rest (pure).
func remoteShiftLoads(lines []remoteLine, d remoteDemand, dayStart int64, share float64) []RemoteShiftLoad {
	type window struct {
		code             string
		from, to         int64
		scheduled, leave int
		available        float64
		demandMin        float64
	}
	byCode := map[string]*window{}
	var order []*window
	for _, l := range lines {
		code := ""
		if l.ShiftCode != nil {
			code = *l.ShiftCode
		}
		w, ok := byCode[code]
		if !ok {
			w = &window{code: code, from: l.startMs, to: l.endMs}
			byCode[code] = w
			order = append(order, w)
		}
		if l.startMs < w.from {
			w.from = l.startMs
		}
		if l.endMs > w.to {
			w.to = l.endMs
		}
		if l.OnLeave {
			w.leave++
			continue
		}
		w.scheduled++
		w.available += l.hours()
	}
	sort.SliceStable(order, func(i, j int) bool {
		if order[i].from != order[j].from {
			return order[i].from < order[j].from
		}
		return order[i].code < order[j].code
	})
	outside := 0.0
	for i := 0; i < Intervals; i++ {
		at := dayStart + int64(i)*remoteIntervalMs
		hit := false
		for _, w := range order {
			if at >= w.from && at < w.to {
				w.demandMin += d.minutes[i]
				hit = true
				break
			}
		}
		if !hit {
			outside += d.minutes[i]
		}
	}
	out := []RemoteShiftLoad{}
	for _, w := range order {
		demand := w.demandMin / 60
		capacity := w.available * share
		from, to := isoAtMs(w.from), isoAtMs(w.to)
		out = append(out, RemoteShiftLoad{
			ShiftCode: strOrNil(w.code), StartAt: &from, EndAt: &to, Scheduled: w.scheduled, OnLeave: w.leave,
			AvailableHours: round2(w.available), CapacityHours: round2(capacity), DemandHours: round2(demand),
			Utilization: ratio(demand, w.available), GapHours: round2(capacity - demand),
		})
	}
	if outside > 0 {
		out = append(out, RemoteShiftLoad{DemandHours: round2(outside / 60), GapHours: round2(-outside / 60)})
	}
	return out
}

// remoteDayLoad: one date's sums (pure).
func remoteDayLoad(date, source string, lines []remoteLine, d remoteDemand, dayStart int64, share float64, fte, onLeave int) RemoteDayLoad {
	scheduled, available, demandMin := 0, 0.0, 0.0
	for _, l := range lines {
		if !l.OnLeave {
			scheduled++
			available += l.hours()
		}
	}
	for i := 0; i < Intervals; i++ {
		demandMin += d.minutes[i]
	}
	off := fte - scheduled - onLeave
	if off < 0 {
		off = 0
	}
	demand, capacity := demandMin/60, available*share
	return RemoteDayLoad{
		Date: date, Source: source, Scheduled: scheduled, OnLeave: onLeave, Off: off,
		AvailableHours: round2(available), CapacityHours: round2(capacity), DemandHours: round2(demand),
		Utilization: ratio(demand, available), GapHours: round2(capacity - demand),
		Shifts: remoteShiftLoads(lines, d, dayStart, share),
	}
}

// remoteDay: the one-day core.
type remoteDay struct {
	load      RemoteDayLoad
	lines     []remoteLine
	intervals []RemoteStaffingInterval
}

func (s *remoteScope) day(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, date string, h RemoteHandling, withDemand bool) (remoteDay, error) {
	lines, source, err := s.linesOn(ctx, conn, rc, date)
	if err != nil {
		return remoteDay{}, err
	}
	dayStart, err := startOfDayMs(date)
	if err != nil {
		return remoteDay{}, err
	}
	var d remoteDemand
	if withDemand {
		if d, err = s.demandOn(rc, date, h); err != nil {
			return remoteDay{}, err
		}
	}
	onLeave := 0
	for _, sv := range s.agents {
		if approvedLeaveIn(s.leave, sv.ID, date) {
			onLeave++
		}
	}
	return remoteDay{
		load:      remoteDayLoad(date, source, lines, d, dayStart, remoteReviewerShare, len(s.agents), onLeave),
		lines:     lines,
		intervals: remoteIntervals(dayStart, lines, d, remoteReviewerShare),
	}, nil
}

// GetRemoteRoster mirrors getRemoteRoster.
func GetRemoteRoster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, date string) (RemoteRoster, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsRemoteQueue, access.AccessView); err != nil {
		return RemoteRoster{}, err
	}
	validated, err := datactx.Date(datactx.Obj{"date": date}, "date")
	if err != nil {
		return RemoteRoster{}, err
	}
	scope, err := loadRemoteScope(ctx, conn, rc)
	if err != nil {
		return RemoteRoster{}, err
	}
	h, err := remoteHandlingFor(ctx, conn, rc, scope.zoneIDs(), validated)
	if err != nil {
		return RemoteRoster{}, err
	}
	day, err := scope.day(ctx, conn, rc, validated, h, true)
	if err != nil {
		return RemoteRoster{}, err
	}
	lines := make([]RemoteRosterLine, 0, len(day.lines))
	for _, l := range day.lines {
		lines = append(lines, l.RemoteRosterLine)
	}
	return RemoteRoster{
		Date: validated, Fte: len(scope.agents), Day: day.load, Lines: lines, Intervals: day.intervals,
		Handling: h, ReviewerShare: remoteReviewerShare, Illustrative: true, DataSource: "SYNTHETIC",
	}, nil
}

// remoteRange: 1 to 31 dates, from to to.
func remoteRange(from, to string) ([]string, error) {
	f, err := localDate(from, "date_from")
	if err != nil {
		return nil, err
	}
	t, err := localDate(to, "date_to")
	if err != nil {
		return nil, err
	}
	if t.Before(f) {
		return nil, dataerr.Invalid("date_to must not be before date_from.")
	}
	var out []string
	for d := f; !d.After(t); d = d.AddDate(0, 0, 1) {
		if len(out) == remoteMaxDays {
			return nil, dataerr.Invalid("The period is at most 31 dates.")
		}
		out = append(out, d.Format("2006-01-02"))
	}
	return out, nil
}

// remoteWeeks: runs of 7 dates from the first (pure).
func remoteWeeks(days []RemoteDayLoad) []RemoteCapacityWeek {
	out := []RemoteCapacityWeek{}
	for i := 0; i < len(days); i += 7 {
		end := i + 7
		if end > len(days) {
			end = len(days)
		}
		w := RemoteCapacityWeek{WeekStart: days[i].Date, Days: end - i}
		for _, d := range days[i:end] {
			w.ScheduledShifts += d.Scheduled
			w.AvailableHours += d.AvailableHours
			w.CapacityHours += d.CapacityHours
			w.DemandHours += d.DemandHours
		}
		w.AvailableHours, w.CapacityHours, w.DemandHours = round2(w.AvailableHours), round2(w.CapacityHours), round2(w.DemandHours)
		w.Utilization = ratio(w.DemandHours, w.AvailableHours)
		w.GapHours = round2(w.CapacityHours - w.DemandHours)
		out = append(out, w)
	}
	return out
}

// GetRemoteCapacity mirrors getRemoteCapacity.
func GetRemoteCapacity(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, from, to string) (RemoteCapacity, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsRemoteQueue, access.AccessView); err != nil {
		return RemoteCapacity{}, err
	}
	dates, err := remoteRange(from, to)
	if err != nil {
		return RemoteCapacity{}, err
	}
	scope, err := loadRemoteScope(ctx, conn, rc)
	if err != nil {
		return RemoteCapacity{}, err
	}
	h, err := remoteHandlingFor(ctx, conn, rc, scope.zoneIDs(), from)
	if err != nil {
		return RemoteCapacity{}, err
	}
	days := make([]RemoteDayLoad, 0, len(dates))
	for _, date := range dates {
		day, err := scope.day(ctx, conn, rc, date, h, true)
		if err != nil {
			return RemoteCapacity{}, err
		}
		days = append(days, day.load)
	}
	return RemoteCapacity{
		DateFrom: from, DateTo: to, Fte: len(scope.agents), Days: days, Weeks: remoteWeeks(days),
		Handling: h, ReviewerShare: remoteReviewerShare, Illustrative: true, DataSource: "SYNTHETIC",
	}, nil
}
