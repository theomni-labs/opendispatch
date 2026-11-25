// SPDX-License-Identifier: AGPL-3.0-only

// Net availability by zone and shift.
package business

import (
	"context"
	"math"
	"sort"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// NetAvailabilityRow: contract NetAvailabilityRow.
type NetAvailabilityRow struct {
	ZoneID         string  `json:"zone_id"`
	ShiftPatternID string  `json:"shift_pattern_id"`
	Agents         int     `json:"agents"`
	ShiftHours     float64 `json:"shift_hours"`
	LeaveHours     float64 `json:"leave_hours"`
	RestHours      float64 `json:"rest_hours"`
	BreakHours     float64 `json:"break_hours"`
	PrayerHours    float64 `json:"prayer_hours"`
	SickHours      float64 `json:"sick_hours"`
	NetHours       float64 `json:"net_hours"`
}

// NetAvailability: contract NetAvailability.
type NetAvailability struct {
	WeekStart     string               `json:"week_start"`
	Days          int                  `json:"days"`
	Rows          []NetAvailabilityRow `json:"rows"`
	SickShare     float64              `json:"sick_share"`
	PrayerWindow  int                  `json:"prayer_window_minutes"`
	PrayerPolicy  string               `json:"prayer_policy"`
	Illustrative  bool                 `json:"illustrative"`
	DataSource    string               `json:"data_source"`
	DataSourceAll []string             `json:"data_sources"`
}

// availDay: one agent's day, in minutes.
type availDay struct {
	shift, leave, rest, brk, prayer int
}

// prayerOverlap: prayer time inside [start, end).
func prayerOverlap(prayers []PrayerMinute, start, end, window int) (total, count int) {
	for _, p := range prayers {
		a, b := max(start, p.Minute), min(end, p.Minute+window)
		if b > a {
			total += b - a
			count++
		}
	}
	return total, count
}

// dayPrayers: date's and the next morning's.
func dayPrayers(plan *PlanReader, zoneID, date string) []PrayerMinute {
	out, err := plan.Prayers(zoneID, date)
	if err != nil {
		return nil
	}
	return out
}

// availabilityOf: one agent-day on pattern p.
func availabilityOf(plan *PlanReader, s Agent, p ShiftPattern, date string, ramadan, rostered bool, policy PrayerPolicy) (availDay, bool) {
	start, end, ok := patternHours(p, ramadan)
	if !ok {
		return availDay{}, false
	}
	length, brk := netShiftMinutes(plan, p, ramadan)
	d := availDay{shift: length}
	switch {
	case onLeave(plan, s.ID, date):
		d.leave = length
	case !rostered && restDay(s, date):
		d.rest = length
	default:
		d.brk = brk
		if s.HomeZoneID != nil {
			w := policy.window()
			total, n := prayerOverlap(dayPrayers(plan, *s.HomeZoneID, date), start, end, w)
			if policy.linedUp() && n > 0 && brk > 0 {
				total -= min(brk, w)
			}
			d.prayer = max(0, min(total, length-brk))
		}
	}
	return d, true
}

// GetNetAvailability: net agent-hours of a week.
func GetNetAvailability(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, weekStart, zoneID string) (NetAvailability, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsFieldPlanner, access.AccessView); err != nil {
		return NetAvailability{}, err
	}
	start, err := validWeekStart(ctx, rc.CustomerID, weekStart)
	if err != nil {
		return NetAvailability{}, err
	}
	if zoneID != "" {
		if _, err := importutil.RequireID(zoneID, "Zone"); err != nil {
			return NetAvailability{}, err
		}
		if !reqctx.CanReadZone(rc, &zoneID) {
			return NetAvailability{}, dataerr.NotFound("Zone not found.")
		}
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return NetAvailability{}, err
	}
	policy := plan.PrayerPolicy()
	sick := 1 - plan.Demand().settings.availableShare()
	byID := map[string]ShiftPattern{}
	byCode := map[string]ShiftPattern{}
	for _, p := range plan.Patterns {
		if p.Status == ShiftStatusActive && p.Kind == "field" {
			byID[p.ID], byCode[p.Code] = p, p
		}
	}
	type key struct{ zone, pattern string }
	type acc struct {
		people map[string]bool
		sum    availDay
	}
	rows := map[key]*acc{}
	var sources []string
	for _, d := range weekDays(start) {
		ramadan, err := plan.Ramadan(d)
		if err != nil {
			return NetAvailability{}, err
		}
		rostered := map[string]string{}
		for _, l := range currentLines(plan, d) {
			if l.ShiftPatternID != nil {
				rostered[l.AgentID] = *l.ShiftPatternID
			}
		}
		for _, s := range plan.Agents {
			if s.Kind != "field" || !s.IsActive || s.HomeZoneID == nil || (zoneID != "" && *s.HomeZoneID != zoneID) {
				continue
			}
			p, ok := byID[rostered[s.ID]]
			if !ok {
				if p, ok = fallbackPattern(s, byCode); !ok {
					continue
				}
			}
			day, ok := availabilityOf(plan, s, p, d, ramadan, rostered[s.ID] != "", policy)
			if !ok {
				continue
			}
			k := key{*s.HomeZoneID, p.ID}
			a := rows[k]
			if a == nil {
				a = &acc{people: map[string]bool{}}
				rows[k] = a
			}
			a.people[s.ID] = true
			a.sum.shift += day.shift
			a.sum.leave += day.leave
			a.sum.rest += day.rest
			a.sum.brk += day.brk
			a.sum.prayer += day.prayer
			sources = append(sources, s.DataSource)
		}
	}
	out := NetAvailability{WeekStart: start, Days: 7, Rows: []NetAvailabilityRow{}, SickShare: math.Round(sick*1e4) / 1e4,
		PrayerWindow: policy.window(), PrayerPolicy: policy.Mode, Illustrative: true, DataSource: "SYNTHETIC", DataSourceAll: []string{"SYNTHETIC"}}
	if primary, all, err := sourcesOf(sources); err == nil {
		out.DataSource, out.DataSourceAll = primary, all
	}
	for k, a := range rows {
		h := func(m int) float64 { return float64(m) / 60 }
		worked := h(a.sum.shift - a.sum.leave - a.sum.rest - a.sum.brk - a.sum.prayer)
		sickH := math.Max(0, worked*sick)
		out.Rows = append(out.Rows, NetAvailabilityRow{
			ZoneID: k.zone, ShiftPatternID: k.pattern, Agents: len(a.people),
			ShiftHours: round1(h(a.sum.shift)), LeaveHours: round1(h(a.sum.leave)), RestHours: round1(h(a.sum.rest)),
			BreakHours: round1(h(a.sum.brk)), PrayerHours: round1(h(a.sum.prayer)), SickHours: round1(sickH),
			NetHours: round1(math.Max(0, worked-sickH)),
		})
	}
	sort.Slice(out.Rows, func(i, j int) bool {
		a, b := out.Rows[i], out.Rows[j]
		if a.ZoneID != b.ZoneID {
			return a.ZoneID < b.ZoneID
		}
		return byID[a.ShiftPatternID].Code < byID[b.ShiftPatternID].Code
	})
	return out, nil
}
