// SPDX-License-Identifier: AGPL-3.0-only

// Planning measures for Management Dashboards.
package business

import (
	"context"
	"math"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// maxMeasureDays bounds one period.
const maxMeasureDays = 31

// PeriodQuery: date_from, date_to, zone_id.
type PeriodQuery struct {
	DateFrom, DateTo, ZoneID string
}

// measurePeriod checks the query; its dates.
func measurePeriod(rc reqctx.RequestContext, q PeriodQuery) ([]string, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsManagementDashboards, access.AccessView); err != nil {
		return nil, err
	}
	from, err := localDate(q.DateFrom, "date_from")
	if err != nil {
		return nil, err
	}
	to, err := localDate(q.DateTo, "date_to")
	if err != nil {
		return nil, err
	}
	if to.Before(from) {
		return nil, dataerr.Invalid("date_to must not be before date_from.")
	}
	if to.Sub(from) >= maxMeasureDays*24*time.Hour {
		return nil, dataerr.Invalid("The period is at most 31 days.")
	}
	if q.ZoneID != "" {
		if _, err := importutil.RequireID(q.ZoneID, "Zone"); err != nil {
			return nil, err
		}
	}
	var days []string
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		days = append(days, d.Format("2006-01-02"))
	}
	return days, nil
}

// measureZones: readable active zones.
func measureZones(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, only string) ([]Zone, error) {
	all, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	var out []Zone
	for _, z := range all {
		zid := z.ID
		if !z.IsActive || !reqctx.CanReadZone(rc, &zid) || (only != "" && z.ID != only) {
			continue
		}
		out = append(out, z)
	}
	if only != "" && len(out) == 0 {
		return nil, dataerr.NotFound("Zone not found.")
	}
	return out, nil
}

// OverCapacityWindow: one contiguous surplus run.
type OverCapacityWindow struct {
	StartAt           string  `json:"start_at"`
	EndAt             string  `json:"end_at"`
	Minutes           int     `json:"minutes"`
	PeakSurplus       int     `json:"peak_surplus"`
	SurplusAgentHours float64 `json:"surplus_agent_hours"`
}

// OverCapacityZone: one zone's windows.
type OverCapacityZone struct {
	ZoneID            string               `json:"zone_id"`
	WindowCount       int                  `json:"window_count"`
	LongestMinutes    int                  `json:"longest_minutes"`
	PeakSurplus       int                  `json:"peak_surplus"`
	SurplusAgentHours float64              `json:"surplus_agent_hours"`
	GapIntervals      int                  `json:"gap_intervals"`
	ShortAgentHours   float64              `json:"short_agent_hours"`
	Windows           []OverCapacityWindow `json:"windows"`
}

// countGaps: intervals short, and hours short.
func (z *OverCapacityZone) countGaps(cells []GapCell) {
	short := 0
	for _, c := range cells {
		if c.Kind == "gap" && c.Delta < 0 {
			z.GapIntervals++
			short -= c.Delta
		}
	}
	z.ShortAgentHours = round2(float64(short) / 4)
}

// OverCapacityReport mirrors the contract.
type OverCapacityReport struct {
	DateFrom     string             `json:"date_from"`
	DateTo       string             `json:"date_to"`
	Zones        []OverCapacityZone `json:"zones"`
	Illustrative bool               `json:"illustrative"`
	DataSource   string             `json:"data_source"`
}

// surplusWindows: runs of surplus cells.
func surplusWindows(cells []GapCell) []OverCapacityWindow {
	out := []OverCapacityWindow{}
	var cur *OverCapacityWindow
	last := ""
	for _, c := range cells {
		at, err := time.Parse(time.RFC3339, c.IntervalStart)
		if err != nil {
			continue
		}
		end := at.Add(15 * time.Minute).In(riyadhZone).Format(time.RFC3339)
		if c.Kind != "surplus" || c.Delta <= 0 {
			cur, last = nil, ""
			continue
		}
		if cur == nil || last != c.IntervalStart {
			out = append(out, OverCapacityWindow{StartAt: c.IntervalStart})
			cur = &out[len(out)-1]
		}
		cur.EndAt, cur.Minutes = end, cur.Minutes+15
		cur.PeakSurplus = max(cur.PeakSurplus, c.Delta)
		cur.SurplusAgentHours += float64(c.Delta) / 4
		last = end
	}
	for i := range out {
		out[i].SurplusAgentHours = round2(out[i].SurplusAgentHours)
	}
	return out
}

// summarise fills a zone's totals.
func (z *OverCapacityZone) summarise() {
	z.WindowCount = len(z.Windows)
	total := 0.0
	for _, w := range z.Windows {
		z.LongestMinutes = max(z.LongestMinutes, w.Minutes)
		z.PeakSurplus = max(z.PeakSurplus, w.PeakSurplus)
		total += w.SurplusAgentHours
	}
	z.SurplusAgentHours = round2(total)
}

// GetOverCapacity: surplus windows per zone.
func GetOverCapacity(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, q PeriodQuery) (OverCapacityReport, error) {
	days, err := measurePeriod(rc, q)
	if err != nil {
		return OverCapacityReport{}, err
	}
	zones, err := measureZones(ctx, conn, rc, q.ZoneID)
	if err != nil {
		return OverCapacityReport{}, err
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return OverCapacityReport{}, err
	}
	out := OverCapacityReport{DateFrom: q.DateFrom, DateTo: q.DateTo, Zones: []OverCapacityZone{}, Illustrative: true, DataSource: "SYNTHETIC"}
	for _, z := range zones {
		var cells []GapCell
		for _, d := range days {
			cells = append(cells, currentCells(ctx, rc, plan, z.ID, d)...)
		}
		row := OverCapacityZone{ZoneID: z.ID, Windows: surplusWindows(cells)}
		row.summarise()
		row.countGaps(cells)
		out.Zones = append(out.Zones, row)
	}
	return out, nil
}

// overrideTargetKey:schedule feasibility.
const overrideTargetKey = "planning.override_rate_target"

// OverrideRateRow: overridden share.
type OverrideRateRow struct {
	ZoneID      *string  `json:"zone_id"`
	Assignments int      `json:"assignments"`
	Overridden  int      `json:"overridden"`
	Share       *float64 `json:"share"`
}

// OverrideRateReport mirrors the contract.
type OverrideRateReport struct {
	DateFrom     string            `json:"date_from"`
	DateTo       string            `json:"date_to"`
	TargetShare  float64           `json:"target_share"`
	Zones        []OverrideRateRow `json:"zones"`
	Total        OverrideRateRow   `json:"total"`
	Illustrative bool              `json:"illustrative"`
	DataSource   string            `json:"data_source"`
}

func overrideTarget(ctx context.Context, tenant string) float64 {
	v := readSetting(ctx, tenant, overrideTargetKey, 0.05)
	if !(v > 0 && v <= 1) {
		return 0.05
	}
	return v
}

func (r *OverrideRateRow) setShare() {
	if r.Assignments > 0 {
		v := math.Round(float64(r.Overridden)/float64(r.Assignments)*1e4) / 1e4
		r.Share = &v
	}
}

// overrideCounts: one roster's lines, overridden.
func overrideCounts(lines []RosterAssignment, overrides []Override) (assignments, overridden int) {
	touched := map[string]bool{}
	assignments = len(lines)
	for _, o := range overrides {
		switch {
		case o.ChangeType == "add_assignment":
			overridden++
		case o.RosterAssignmentID != nil && !touched[*o.RosterAssignmentID]:
			touched[*o.RosterAssignmentID] = true
			overridden++
			if o.ChangeType == "remove_assignment" {
				assignments++
			}
		}
	}
	return assignments, overridden
}

// GetOverrideRate: approved overrides per zone.
func GetOverrideRate(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, q PeriodQuery) (OverrideRateReport, error) {
	days, err := measurePeriod(rc, q)
	if err != nil {
		return OverrideRateReport{}, err
	}
	zones, err := measureZones(ctx, conn, rc, q.ZoneID)
	if err != nil {
		return OverrideRateReport{}, err
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return OverrideRateReport{}, err
	}
	all, err := overrideStoreBackend.all(ctx, rc.CustomerID)
	if err != nil {
		return OverrideRateReport{}, err
	}
	byRoster := map[string][]Override{}
	for _, o := range all {
		if o.Status == "approved" {
			byRoster[o.RosterID] = append(byRoster[o.RosterID], o)
		}
	}
	out := OverrideRateReport{DateFrom: q.DateFrom, DateTo: q.DateTo, TargetShare: overrideTarget(ctx, rc.CustomerID), Zones: []OverrideRateRow{}, Illustrative: true, DataSource: "SYNTHETIC"}
	for _, z := range zones {
		zid := z.ID
		row := OverrideRateRow{ZoneID: &zid}
		for _, d := range days {
			r := rosterFor(plan, z.ID, d)
			if r == nil {
				continue
			}
			a, n := overrideCounts(plan.LinesByRoster[r.ID], byRoster[r.ID])
			row.Assignments += a
			row.Overridden += n
		}
		row.setShare()
		out.Total.Assignments += row.Assignments
		out.Total.Overridden += row.Overridden
		out.Zones = append(out.Zones, row)
	}
	out.Total.setShare()
	return out, nil
}
