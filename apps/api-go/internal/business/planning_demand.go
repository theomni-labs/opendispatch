// SPDX-License-Identifier: AGPL-3.0-only

// Demand method and sick leave.
package business

import (
	"context"
	"fmt"
	"log"
	"math"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	demandMethodKey      = "planning.demand_method"
	demandRateCasesKey   = "planning.cases_per_agent_per_interval"
	demandTravelKey      = "planning.travel_minutes"
	demandOnSceneKey     = "planning.on_scene_minutes"
	demandAdminKey       = "planning.admin_minutes"
	sickLeaveDaysKey     = "planning.sick_leave_days_per_fte_year"
	workingDaysKey       = "planning.working_days_per_fte_year"
	durationDaysKey      = "planning.duration_history_days"
	demandRate           = "rate_convention"
	demandDuration       = "duration"
	defaultDemandMethod  = demandDuration
	defaultCustomerCases = 0.5
	defaultAdminMinutes  = 10.0
	defaultSickDays      = 5.0
	defaultWorkingDays   = 230.0
	fallbackTravelMin    = 20.0
	fallbackOnSceneMin   = 30.0
	demandHistoryDays    = 90
	minDurationDays      = 7
	maxDurationDays      = 365
	intervalMinutes      = 15.0
	maxCaseMinutes       = 600.0
	minAvailableShare    = 0.5
)

// Fixture capacity: 0.55 h a case, 50% busy.
const fixtureCasesPerInterval = 0.25 * 0.5 / 0.55

// demandSettings: the planning.* settings.
type demandSettings struct {
	Method        string
	CustomerCases float64
	Travel        *float64
	OnScene       *float64
	Admin         float64
	AdminSet      bool
	SickDays      float64
	WorkingDays   float64
	HistoryDays   int
}

// minutesSetting: nil when unset or out of range.
func minutesSetting(ctx context.Context, tenant, key string) *float64 {
	v := readSetting[*float64](ctx, tenant, key, nil)
	if v == nil || math.IsNaN(*v) || *v < 0 || *v > maxCaseMinutes {
		return nil
	}
	return v
}

func getDemandSettings(ctx context.Context, tenant string) demandSettings {
	d := demandSettings{Method: defaultDemandMethod, CustomerCases: defaultCustomerCases, Admin: defaultAdminMinutes, SickDays: defaultSickDays, WorkingDays: defaultWorkingDays}
	if v := readSetting(ctx, tenant, demandMethodKey, defaultDemandMethod); v == demandRate || v == demandDuration {
		d.Method = v
	}
	if v := readSetting(ctx, tenant, demandRateCasesKey, defaultCustomerCases); v > 0 && v <= 10 {
		d.CustomerCases = v
	}
	d.Travel, d.OnScene = minutesSetting(ctx, tenant, demandTravelKey), minutesSetting(ctx, tenant, demandOnSceneKey)
	if v := minutesSetting(ctx, tenant, demandAdminKey); v != nil {
		d.Admin, d.AdminSet = *v, true
	}
	d.HistoryDays = demandHistoryDays
	if v := readSetting(ctx, tenant, durationDaysKey, float64(demandHistoryDays)); v >= minDurationDays && v <= maxDurationDays {
		d.HistoryDays = int(v)
	}
	if v := readSetting(ctx, tenant, sickLeaveDaysKey, defaultSickDays); v >= 0 && v <= 60 {
		d.SickDays = v
	}
	if v := readSetting(ctx, tenant, workingDaysKey, defaultWorkingDays); v >= 100 && v <= 366 {
		d.WorkingDays = v
	}
	return d
}

// availableShare: expected share not off sick.
func (d demandSettings) availableShare() float64 {
	return math.Max(minAvailableShare, 1-d.SickDays/d.WorkingDays)
}

// zoneDurations: minutes per field case.
type zoneDurations struct {
	Travel           float64
	OnScene          float64
	Admin            float64
	Cases            int
	FromHistory      bool
	AdminFromHistory bool
}

// casesPerInterval: cases per agent-quarter.
func (d demandSettings) casesPerInterval(z zoneDurations) float64 {
	if d.Method == demandDuration {
		return intervalMinutes / math.Max(1, z.Travel+z.OnScene+z.Admin)
	}
	return d.CustomerCases
}

// requestCases: for the optimizer; nil: default.
func (d demandSettings) requestCases(z zoneDurations) *float64 {
	return d.requestCasesAt(z, d.availableShare())
}

// requestCasesAt: with that day's sick share.
func (d demandSettings) requestCasesAt(z zoneDurations, share float64) *float64 {
	v := math.Round(d.casesPerInterval(z)*share*1e6) / 1e6
	if v == 1 {
		return nil
	}
	return &v
}

// withSettings: set minutes win over history.
func (d demandSettings) withSettings(z zoneDurations) zoneDurations {
	if d.Travel != nil {
		z.Travel, z.FromHistory = *d.Travel, false
	}
	if d.OnScene != nil {
		z.OnScene, z.FromHistory = *d.OnScene, false
	}
	if d.AdminSet || !z.AdminFromHistory {
		z.Admin, z.AdminFromHistory = d.Admin, false
	}
	return z
}

// caseDurations: mean minutes by zone and all.
func caseDurations(ctx context.Context, conn *tenancy.Connection, tenant, today string, days ...int) (map[string]zoneDurations, zoneDurations, error) {
	all := zoneDurations{Travel: fallbackTravelMin, OnScene: fallbackOnSceneMin}
	if conn == nil {
		return map[string]zoneDurations{}, all, nil
	}
	to, err := riyadhMidnight(today)
	if err != nil {
		return nil, all, err
	}
	window := demandHistoryDays
	if len(days) > 0 && days[0] >= minDurationDays {
		window = days[0]
	}
	from := to.AddDate(0, 0, -window)
	type row struct {
		zone                   *string
		travel, onScene, admin *float64
		n                      int
	}
	rows, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]row, error) {
		rs, err := tx.Query(ctx, `SELECT zone_id::text, avg(extract(epoch FROM arrived_at - assigned_at)) / 60,
				avg(extract(epoch FROM on_scene_completed_at - arrived_at)) / 60,
				avg(extract(epoch FROM closed_at - on_scene_completed_at)) FILTER (WHERE closed_at >= on_scene_completed_at) / 60, count(*)
			FROM cases WHERE handling = 'field' AND zone_id IS NOT NULL AND registered_at >= $1 AND registered_at < $2
				AND assigned_at IS NOT NULL AND arrived_at >= assigned_at AND on_scene_completed_at >= arrived_at
			GROUP BY GROUPING SETS ((zone_id), ())`, from, to)
		if err != nil {
			return nil, err
		}
		defer rs.Close()
		var out []row
		for rs.Next() {
			var r row
			if err := rs.Scan(&r.zone, &r.travel, &r.onScene, &r.admin, &r.n); err != nil {
				return nil, err
			}
			out = append(out, r)
		}
		return out, rs.Err()
	})
	if err != nil {
		return nil, all, fmt.Errorf("case durations: %w", err)
	}
	byZone := map[string]zoneDurations{}
	for _, r := range rows {
		if r.n == 0 || r.travel == nil || r.onScene == nil {
			continue
		}
		z := zoneDurations{Travel: round1(*r.travel), OnScene: round1(*r.onScene), Cases: r.n, FromHistory: true}
		if r.admin != nil && *r.admin <= maxCaseMinutes {
			z.Admin, z.AdminFromHistory = round1(*r.admin), true
		}
		if r.zone == nil {
			all = z
			continue
		}
		byZone[*r.zone] = z
	}
	return byZone, all, nil
}

// planDemand: settings and durations, read once.
type planDemand struct {
	settings demandSettings
	byZone   map[string]zoneDurations
	all      zoneDurations
	sick     sickModel
}

// zone: the zone's durations, settings applied.
func (p *planDemand) zone(zoneID string) zoneDurations {
	z, ok := p.byZone[zoneID]
	if !ok {
		z = p.all
	}
	return p.settings.withSettings(z)
}

// Demand: the plan's demand basis, loaded once.
func (p *PlanReader) Demand() *planDemand {
	p.demandMu.Lock()
	defer p.demandMu.Unlock()
	if p.demand != nil {
		return p.demand
	}
	tenant := p.rc.CustomerID
	ctx := p.ctx()
	d := &planDemand{settings: getDemandSettings(ctx, tenant), byZone: map[string]zoneDurations{}, all: zoneDurations{Travel: fallbackTravelMin, OnScene: fallbackOnSceneMin}}
	if d.settings.Method == demandDuration && p.conn != nil {
		byZone, all, err := caseDurations(ctx, p.conn, tenant, demoToday(ctx, tenant), d.settings.HistoryDays)
		if err != nil {
			log.Printf("planning demand: defaults used: %v", err)
		} else {
			d.byZone, d.all = byZone, all
		}
	}
	d.sick = loadSickModel(ctx, p.conn, tenant, d.settings)
	p.demand = d
	return d
}

// requiredRatio: kept need to this method's.
func (p *PlanReader) requiredRatio(baseline *OptimizerBaseline, zoneID string) float64 {
	used := 1.0
	if baseline != nil {
		if v, ok := baseline.CasesPerInterval[zoneID]; ok && v > 0 {
			used = v
		}
	}
	d := p.Demand()
	now := d.settings.casesPerInterval(d.zone(zoneID))
	if now <= 0 {
		return 1
	}
	return used / now
}

// DemandBasis mirrors RequiredStaffingBasis.
type DemandBasis struct {
	Method         string            `json:"method"`
	HistoryDays    int               `json:"duration_history_days"`
	SickMethod     string            `json:"sick_leave_method"`
	AdminMinutes   *float64          `json:"admin_minutes"`
	SickLeaveDays  float64           `json:"sick_leave_days_per_fte_year"`
	WorkingDays    float64           `json:"working_days_per_fte_year"`
	AvailableShare float64           `json:"available_share"`
	Zones          []DemandBasisZone `json:"zones"`
	Illustrative   bool              `json:"illustrative"`
}

// DemandBasisZone: one zone's minutes per case.
type DemandBasisZone struct {
	ZoneID           string   `json:"zone_id"`
	TravelMinutes    *float64 `json:"travel_minutes"`
	OnSceneMinutes   *float64 `json:"on_scene_minutes"`
	MinutesPerCase   *float64 `json:"minutes_per_case"`
	CasesPerInterval float64  `json:"cases_per_agent_per_interval"`
	FromHistory      bool     `json:"from_history"`
	AdminZone        *float64 `json:"admin_minutes"`
	AdminHistory     bool     `json:"admin_from_history"`
	AvailableShare   float64  `json:"available_share"`
	SickSource       string   `json:"sick_source"`
}

// basis: what the view says about its required.
func (p *PlanReader) basis(zoneIDs []string, date string) *DemandBasis {
	d := p.Demand()
	s := d.settings
	method, _ := sickSettings(p.ctx(), p.rc.CustomerID)
	out := &DemandBasis{Method: s.Method, HistoryDays: s.HistoryDays, SickMethod: method, SickLeaveDays: s.SickDays, WorkingDays: s.WorkingDays,
		AvailableShare: math.Round(s.availableShare()*1e4) / 1e4, Zones: []DemandBasisZone{}, Illustrative: true}
	if s.Method == demandDuration {
		admin := s.Admin
		out.AdminMinutes = &admin
	}
	for _, id := range zoneIDs {
		z := d.zone(id)
		sick, source := d.sick.share(id, date)
		row := DemandBasisZone{ZoneID: id, CasesPerInterval: math.Round(s.casesPerInterval(z)*1e4) / 1e4,
			AvailableShare: math.Round(math.Max(minAvailableShare, 1-sick)*1e4) / 1e4, SickSource: source}
		if s.Method == demandDuration {
			travel, onScene, admin, per := z.Travel, z.OnScene, z.Admin, round1(z.Travel+z.OnScene+z.Admin)
			row.TravelMinutes, row.OnSceneMinutes, row.MinutesPerCase, row.FromHistory = &travel, &onScene, &per, z.FromHistory
			row.AdminZone, row.AdminHistory = &admin, z.AdminFromHistory
		}
		out.Zones = append(out.Zones, row)
	}
	return out
}

// validPlanningSetting checks a planning.* write.
func validPlanningSetting(key string, value any) error {
	num := func(lo, hi float64) error {
		n, ok := value.(float64)
		if i, isInt := value.(int); isInt {
			n, ok = float64(i), true
		}
		if !ok || math.IsNaN(n) || n < lo || n > hi {
			return fmt.Errorf("%s must be a number from %v to %v", key, lo, hi)
		}
		return nil
	}
	switch key {
	case demandMethodKey:
		if v, _ := value.(string); v != demandRate && v != demandDuration {
			return fmt.Errorf("%s must be %s or %s", key, demandRate, demandDuration)
		}
	case demandRateCasesKey:
		if err := num(0, 10); err != nil || value == 0.0 {
			return fmt.Errorf("%s must be a number above 0, at most 10", key)
		}
	case demandTravelKey, demandOnSceneKey:
		if value == nil {
			return nil
		}
		return num(0, maxCaseMinutes)
	case demandAdminKey:
		return num(0, maxCaseMinutes)
	case overrideTargetKey:
		if err := num(0, 1); err != nil || value == 0.0 {
			return fmt.Errorf("%s must be a share above 0, at most 1", key)
		}
	case sickLeaveDaysKey:
		return num(0, 60)
	case workingDaysKey:
		return num(100, 366)
	case durationDaysKey:
		if n, _ := toFloat(value); num(minDurationDays, maxDurationDays) != nil || n != math.Trunc(n) {
			return fmt.Errorf("%s must be a whole number of days from %d to %d", key, minDurationDays, maxDurationDays)
		}
	case sickMethodKey, sickHistoryMonthsKey:
		return validSickSetting(key, value)
	}
	return nil
}
