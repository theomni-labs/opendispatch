// SPDX-License-Identifier: AGPL-3.0-only

// Week of rosters: view, build, submit, publish.
package business

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// weekBuildWorkers: zones built at once.
const weekBuildWorkers = 4

// RosterWeekCell: contract RosterWeekCell.
type RosterWeekCell struct {
	RosterDate string  `json:"roster_date"`
	Roster     *Roster `json:"roster"`
	Agents     int     `json:"agents"`
	State      string  `json:"state"`
}

// RosterWeekZone: contract RosterWeekZone.
type RosterWeekZone struct {
	ZoneID string           `json:"zone_id"`
	Cells  []RosterWeekCell `json:"cells"`
}

// RosterWeek: contract RosterWeek.
type RosterWeek struct {
	WeekStart    string           `json:"week_start"`
	Days         []string         `json:"days"`
	Zones        []RosterWeekZone `json:"zones"`
	Limits       WeeklyLimits     `json:"limits"`
	Illustrative bool             `json:"illustrative"`
}

// RosterWeekSkip: contract RosterWeekSkip.
type RosterWeekSkip struct {
	ZoneID     string  `json:"zone_id"`
	RosterDate string  `json:"roster_date"`
	Reason     string  `json:"reason"`
	Message    *string `json:"message,omitempty"`
}

// RosterWeekResult: contract RosterWeekResult.
type RosterWeekResult struct {
	WeekStart string           `json:"week_start"`
	Done      []Roster         `json:"done"`
	Skipped   []RosterWeekSkip `json:"skipped"`
	Stub      *bool            `json:"stub,omitempty"`
	ElapsedMs int64            `json:"elapsed_ms"`
}

func weekDays(start string) []string {
	out := make([]string, 7)
	for i := range out {
		out[i] = shiftDateBy(start, i)
	}
	return out
}

// validWeekStart: the first day of v's week.
func validWeekStart(ctx context.Context, tenant, v string) (string, error) {
	d, err := datactx.Date(datactx.Obj{"week_start": v}, "week_start")
	if err != nil {
		return "", err
	}
	return weekStartOf(d, getLocalization(ctx, tenant).FirstDayOfWeek), nil
}

// cellState: what Build week does with a cell.
func cellState(r *Roster, date, today string) string {
	switch {
	case date < today:
		return "passed"
	case date > shiftDateBy(today, maxBuildDaysAhead):
		return "too_far"
	case r == nil || r.Status == "draft" || r.Status == "rejected":
		return "buildable"
	}
	return "kept"
}

// sortedZones: readable zones by name.
func sortedZones(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, write bool) ([]Zone, error) {
	zones, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	var out []Zone
	for _, z := range zones {
		zid := z.ID
		if !reqctx.CanReadZone(rc, &zid) || (write && reqctx.RequireWriteZone(rc, &zid) != nil) {
			continue
		}
		out = append(out, z)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].NameEn < out[j].NameEn || out[i].NameEn == out[j].NameEn && out[i].ID < out[j].ID
	})
	return out, nil
}

// GetRosterWeek: zones by days of one week.
func GetRosterWeek(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, weekStart string) (RosterWeek, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsFieldPlanner, access.AccessView); err != nil {
		return RosterWeek{}, err
	}
	start, err := validWeekStart(ctx, rc.CustomerID, weekStart)
	if err != nil {
		return RosterWeek{}, err
	}
	zones, err := sortedZones(ctx, conn, rc, false)
	if err != nil {
		return RosterWeek{}, err
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return RosterWeek{}, err
	}
	today := demoToday(ctx, rc.CustomerID)
	days := weekDays(start)
	out := RosterWeek{WeekStart: start, Days: days, Zones: []RosterWeekZone{}, Limits: plan.weeklyLimits(), Illustrative: true}
	for _, z := range zones {
		row := RosterWeekZone{ZoneID: z.ID, Cells: make([]RosterWeekCell, 0, 7)}
		for _, d := range days {
			cell := RosterWeekCell{RosterDate: d}
			if r := rosterFor(plan, z.ID, d); r != nil {
				counted := withCounts(ctx, rc, plan, *r)
				cell.Roster = &counted
				for _, l := range plan.LinesByRoster[r.ID] {
					if l.ZoneID != nil && *l.ZoneID == z.ID {
						cell.Agents++
					}
				}
			}
			cell.State = cellState(cell.Roster, d, today)
			row.Cells = append(row.Cells, cell)
		}
		out.Zones = append(out.Zones, row)
	}
	return out, nil
}

type weekBody struct {
	start  string
	zones  map[string]bool
	runID  any
	hasRun bool
}

func parseWeekBody(ctx context.Context, tenant string, body any, build bool) (weekBody, error) {
	keys := []string{"week_start"}
	if build {
		keys = append(keys, "zone_ids", "forecast_run_id")
	}
	input, err := datactx.Object(body, "Roster week", keys)
	if err != nil {
		return weekBody{}, err
	}
	start, err := validWeekStart(ctx, tenant, fmt.Sprint(input["week_start"]))
	if err != nil {
		return weekBody{}, err
	}
	out := weekBody{start: start}
	if build && datactx.Has(input, "zone_ids") {
		ids, err := datactx.UUIDList(input, "zone_ids", false)
		if err != nil {
			return weekBody{}, err
		}
		if len(ids) == 0 || len(ids) > 200 {
			return weekBody{}, dataerr.Invalid("Roster week: zone_ids needs 1 to 200 zones.")
		}
		out.zones = map[string]bool{}
		for _, id := range ids {
			out.zones[id] = true
		}
	}
	if build {
		if _, err := datactx.NullableUUID(input, "forecast_run_id"); err != nil {
			return weekBody{}, err
		}
		out.runID, out.hasRun = input["forecast_run_id"], true
	}
	return out, nil
}

func skipOf(zoneID, date, reason string, err error) RosterWeekSkip {
	s := RosterWeekSkip{ZoneID: zoneID, RosterDate: date, Reason: reason}
	if err != nil {
		msg := truncateStr(err.Error(), 300)
		s.Message = &msg
	}
	return s
}

// weekSummary: one audit entry for the week.
func weekSummary(ctx context.Context, rc reqctx.RequestContext, action, verb string, res RosterWeekResult) (RosterWeekResult, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsFieldPlanner}, auditlog.WriteMeta{Action: action, EntityType: "roster_week"}, func(context.Context) (auditlog.AuditedWrite[RosterWeekResult], error) {
		return auditlog.AuditedWrite[RosterWeekResult]{
			Result:    res,
			SummaryEn: fmt.Sprintf("Week from %s %s: %d rosters, %d skipped (Illustrative).", res.WeekStart, verb, len(res.Done), len(res.Skipped)),
			Detail:    map[string]any{"week_start": res.WeekStart, "done": len(res.Done), "skipped": len(res.Skipped), "elapsed_ms": res.ElapsedMs},
		}, nil
	})
}

// BuildRosterWeek: every zone's seven days, days in order.
func BuildRosterWeek(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (RosterWeekResult, error) {
	meta := auditlog.WriteMeta{Action: "roster.week_built", EntityType: "roster_week"}
	if err := auditlog.GuardWithAudit(rc, auditlog.Guard{ModuleID: access.ModuleOpsFieldPlanner}, meta); err != nil {
		return RosterWeekResult{}, err
	}
	in, err := parseWeekBody(ctx, rc.CustomerID, body, true)
	if err != nil {
		return RosterWeekResult{}, err
	}
	began := time.Now()
	zones, err := sortedZones(ctx, conn, rc, true)
	if err != nil {
		return RosterWeekResult{}, err
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return RosterWeekResult{}, err
	}
	today := demoToday(ctx, rc.CustomerID)
	days := weekDays(in.start)
	type zoneOut struct {
		done    []Roster
		skipped []RosterWeekSkip
	}
	results := make([]zoneOut, len(zones))
	sem := make(chan struct{}, weekBuildWorkers)
	var wg sync.WaitGroup
	for i, z := range zones {
		if in.zones != nil && !in.zones[z.ID] {
			continue
		}
		wg.Add(1)
		go func(i int, z Zone) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			var out zoneOut
			for _, d := range days {
				if st := cellState(rosterFor(plan, z.ID, d), d, today); st != "buildable" {
					out.skipped = append(out.skipped, skipOf(z.ID, d, st, nil))
					continue
				}
				r, err := buildRoster(ctx, conn, rc, map[string]any{"zone_id": z.ID, "roster_date": d, "forecast_run_id": in.runID}, nil)
				if err != nil {
					reason := "failed"
					if errCodeOf(err) == dataerr.CodeConflict {
						reason = "kept"
					}
					out.skipped = append(out.skipped, skipOf(z.ID, d, reason, err))
					continue
				}
				out.done = append(out.done, r)
			}
			results[i] = out
		}(i, z)
	}
	wg.Wait()
	res := RosterWeekResult{WeekStart: in.start, Done: []Roster{}, Skipped: []RosterWeekSkip{}}
	for _, r := range results {
		res.Done = append(res.Done, r.done...)
		res.Skipped = append(res.Skipped, r.skipped...)
	}
	res.ElapsedMs = time.Since(began).Milliseconds()
	return weekSummary(ctx, rc, meta.Action, "built", res)
}

// weekEach: act on each current roster of the week.
func weekEach(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any, action, verb, want, skipReason string, act func(Roster) (Roster, error)) (RosterWeekResult, error) {
	meta := auditlog.WriteMeta{Action: action, EntityType: "roster_week"}
	if err := auditlog.GuardWithAudit(rc, auditlog.Guard{ModuleID: access.ModuleOpsFieldPlanner}, meta); err != nil {
		return RosterWeekResult{}, err
	}
	in, err := parseWeekBody(ctx, rc.CustomerID, body, false)
	if err != nil {
		return RosterWeekResult{}, err
	}
	began := time.Now()
	zones, err := sortedZones(ctx, conn, rc, true)
	if err != nil {
		return RosterWeekResult{}, err
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return RosterWeekResult{}, err
	}
	res := RosterWeekResult{WeekStart: in.start, Done: []Roster{}, Skipped: []RosterWeekSkip{}}
	for _, z := range zones {
		for _, d := range weekDays(in.start) {
			r := rosterFor(plan, z.ID, d)
			if r == nil {
				continue
			}
			if r.Status != want && !(want == "draft" && r.Status == "rejected") {
				res.Skipped = append(res.Skipped, skipOf(z.ID, d, skipReason, nil))
				continue
			}
			next, err := act(*r)
			if err != nil {
				res.Skipped = append(res.Skipped, skipOf(z.ID, d, "failed", err))
				continue
			}
			res.Done = append(res.Done, next)
		}
	}
	res.ElapsedMs = time.Since(began).Milliseconds()
	return weekSummary(ctx, rc, action, verb, res)
}

// SubmitRosterWeek: each draft roster, for approval.
func SubmitRosterWeek(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (RosterWeekResult, error) {
	return weekEach(ctx, conn, rc, body, "roster.week_submitted", "submitted", "draft", "not_draft", func(r Roster) (Roster, error) {
		return SubmitRoster(ctx, conn, rc, r.ID)
	})
}

// PublishRosterWeek: LABELLED STUB, as PublishRoster.
func PublishRosterWeek(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (RosterWeekResult, error) {
	res, err := weekEach(ctx, conn, rc, body, "roster.week_publish_stub", "publish requested (stub, nothing sent)", "approved", "not_approved", func(r Roster) (Roster, error) {
		_, err := PublishRoster(ctx, conn, rc, r.ID)
		return r, err
	})
	if err == nil {
		stub := true
		res.Stub = &stub
	}
	return res, err
}
