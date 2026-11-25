// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"regexp"
	"sort"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecasthist"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/traffic"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// ErrEngineInput: request data is missing.
var ErrEngineInput = errors.New("engine request: missing or invalid input")

func inputErr(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrEngineInput, fmt.Sprintf(format, args...))
}

func needUUID(what, id string) error {
	if !uuidPattern.MatchString(id) {
		return inputErr("%s is not a uuid", what)
	}
	return nil
}

var sourceRank = map[string]int{"SYNTHETIC": 0, "IMPORTED": 1, "LIVE": 2}

// sourcesOf: distinct sources and the most real.
func sourcesOf(all []string) (primary string, distinct []string, err error) {
	seen := map[string]bool{}
	for _, s := range all {
		if _, ok := sourceRank[s]; !ok {
			return "", nil, inputErr("unknown data_source %q", s)
		}
		seen[s] = true
	}
	for s := range seen {
		distinct = append(distinct, s)
	}
	if len(distinct) == 0 {
		return "", nil, inputErr("no data_source on the inputs")
	}
	sort.Slice(distinct, func(i, j int) bool { return sourceRank[distinct[i]] < sourceRank[distinct[j]] })
	return distinct[len(distinct)-1], distinct, nil
}

type engineHeader struct {
	SchemaVersion string   `json:"schema_version"`
	RequestID     string   `json:"request_id"`
	RequestedAt   string   `json:"requested_at"`
	DataSource    string   `json:"data_source"`
	InputSources  []string `json:"input_data_sources"`
}

func newHeader(now time.Time, sources []string) (engineHeader, error) {
	primary, distinct, err := sourcesOf(sources)
	if err != nil {
		return engineHeader{}, err
	}
	return engineHeader{SchemaVersion: "1.0", RequestID: datactx.NewID(), RequestedAt: datactx.ToRiyadhISO(now), DataSource: primary, InputSources: distinct}, nil
}

func validDate(what, d string) error {
	if _, err := time.Parse("2006-01-02", d); err != nil {
		return inputErr("%s is not a date", what)
	}
	return nil
}

func prayerOf(p *PrayerTime) map[string]string {
	if p == nil || p.Fajr == "" || p.Dhuhr == "" || p.Asr == "" || p.Maghrib == "" || p.Isha == "" {
		return nil
	}
	return map[string]string{"fajr": p.Fajr, "dhuhr": p.Dhuhr, "asr": p.Asr, "maghrib": p.Maghrib, "isha": p.Isha}
}

// ---- forecaster ----

type forecastDay struct {
	Date        string
	HolidayName string
	IsHoliday   bool
	IsRamadan   bool
	Prayer      *PrayerTime
	Payday      *bool
	School      *bool
	Events      []forecastcal.Event
	Hijri       *forecastcal.Hijri
	Extras      forecastcal.Extras
}

type historyRow struct {
	SubZoneID     string
	IntervalStart time.Time
	Total, Field  int
	// Minutes: 0 for 15 minutes, else 60 or 1440
	Minutes int
}

type forecasterSource struct {
	Now            time.Time
	StartDate      string
	Days           int
	ModelVersion   string
	RangeCoverage  float64
	RuleSetVersion string
	Zones          []Zone
	SubZones       []SubZone
	Calendar       []forecastDay
	History        []historyRow
	// Aggregated: older history as totals.
	Aggregated []historyRow
	Sources    []string
	// Weather is empty when no source is set.
	Weather []weather.Day
	// Traffic is empty when no source is set.
	Traffic []traffic.Day
	// Locations: case counts per micro-cell.
	Locations []fcLocationRecord
}

type fcSubZone struct {
	SubZoneID string  `json:"sub_zone_id"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type fcZone struct {
	ZoneID   string      `json:"zone_id"`
	CityID   string      `json:"city_id,omitempty"`
	Region   string      `json:"region,omitempty"`
	SubZones []fcSubZone `json:"sub_zones"`
}

type fcDay struct {
	Date        string              `json:"date"`
	IsHoliday   bool                `json:"is_holiday"`
	HolidayName string              `json:"holiday_name,omitempty"`
	IsRamadan   bool                `json:"is_ramadan"`
	Prayer      map[string]string   `json:"prayer_times,omitempty"`
	IsPayday    *bool               `json:"is_payday,omitempty"`
	School      *bool               `json:"school_in_session,omitempty"`
	Events      []forecastcal.Event `json:"events"`
	Hijri       *forecastcal.Hijri  `json:"hijri_date,omitempty"`
	forecastcal.Extras
}

// nonNilEvents sends [] for a day with none: absent means unknown.
func nonNilEvents(e []forecastcal.Event) []forecastcal.Event {
	if e == nil {
		return []forecastcal.Event{}
	}
	return e
}

// buildForecasterRequest: forecaster input.
func buildForecasterRequest(s forecasterSource) ([]byte, error) {
	if err := validDate("horizon start", s.StartDate); err != nil {
		return nil, err
	}
	if s.Days < 1 || s.Days > forecastcal.MaxHorizonChunkDays {
		return nil, inputErr("horizon days must be 1 to %d", forecastcal.MaxHorizonChunkDays)
	}
	if s.ModelVersion == "" || len(s.ModelVersion) > 64 {
		return nil, inputErr("no active model version")
	}
	if s.RangeCoverage <= 0 || s.RangeCoverage >= 1 {
		return nil, inputErr("range coverage must be between 0 and 1")
	}
	h, err := newHeader(s.Now, s.Sources)
	if err != nil {
		return nil, err
	}
	subsByZone := map[string][]fcSubZone{}
	inSub := map[string]bool{}
	for _, sz := range s.SubZones {
		if !sz.IsActive {
			continue
		}
		if err := needUUID("sub_zone_id", sz.ID); err != nil {
			return nil, err
		}
		subsByZone[sz.ZoneID] = append(subsByZone[sz.ZoneID], fcSubZone{SubZoneID: sz.ID, Latitude: sz.Latitude, Longitude: sz.Longitude})
		inSub[sz.ID] = true
	}
	zones := []fcZone{}
	for _, z := range s.Zones {
		if !z.IsActive || len(subsByZone[z.ID]) == 0 {
			continue
		}
		if err := needUUID("zone_id", z.ID); err != nil {
			return nil, err
		}
		city := ""
		if uuidPattern.MatchString(z.CityID) {
			city = z.CityID
		}
		zones = append(zones, fcZone{ZoneID: z.ID, CityID: city, SubZones: subsByZone[z.ID]})
	}
	if len(zones) == 0 {
		return nil, inputErr("no active zone with a sub-zone")
	}
	cal := []fcDay{}
	for _, d := range s.Calendar {
		if err := validDate("calendar date", d.Date); err != nil {
			return nil, err
		}
		cal = append(cal, fcDay{Date: d.Date, IsHoliday: d.IsHoliday, HolidayName: d.HolidayName, IsRamadan: d.IsRamadan, Prayer: prayerOf(d.Prayer),
			IsPayday: d.Payday, School: d.School, Events: forecastcal.SendEvents(d.Events), Hijri: d.Hijri, Extras: d.Extras})
	}
	if len(cal) == 0 {
		return nil, inputErr("no calendar days")
	}
	hist := forecasthist.History{Records: []forecasthist.Record{}}
	ok := func(r historyRow) bool {
		return inSub[r.SubZoneID] && r.Total >= 0 && r.Field >= 0 && r.Field <= r.Total
	}
	for _, r := range s.History {
		if ok(r) {
			hist.Records = append(hist.Records, forecasthist.NewRecord(r.SubZoneID, r.IntervalStart, r.Total, r.Field))
		}
	}
	for _, r := range s.Aggregated {
		if ok(r) && (r.Minutes == 60 || r.Minutes == 1440) {
			hist.Aggregated = append(hist.Aggregated, forecasthist.NewAggregate(r.SubZoneID, r.IntervalStart, r.Minutes, r.Total, r.Field))
		}
	}
	if len(hist.Records) == 0 {
		return nil, inputErr("no case history in the window")
	}
	wx := weatherFor(zones, s.Weather)
	if len(wx) > 0 {
		lo, hi := wx[0].Date, wx[0].Date
		for _, d := range wx {
			lo, hi = min(lo, d.Date), max(hi, d.Date)
		}
		log.Printf("engines: forecaster request carries %d weather days, %s to %s", len(wx), lo, hi)
	}
	tr := trafficFor(zones, s.Traffic)
	if len(tr) > 0 {
		log.Printf("engines: forecaster request carries %d traffic days", len(tr))
	}
	marshal := func(hs forecasthist.History, days []fcDay) ([]byte, error) {
		return json.Marshal(struct {
			engineHeader
			Horizon        map[string]any `json:"horizon"`
			Model          map[string]any `json:"model"`
			RuleSetVersion string         `json:"rule_set_version,omitempty"`
			Zones          []fcZone       `json:"zones"`
			Calendar       []fcDay        `json:"calendar"`
			History        fcHistory      `json:"history"`
			Weather        []weather.Day  `json:"weather,omitempty"`
			Traffic        []traffic.Day  `json:"traffic,omitempty"`
		}{h, map[string]any{"start_date": s.StartDate, "days": s.Days}, map[string]any{"model_version": s.ModelVersion, "range_coverage": s.RangeCoverage},
			truncate(s.RuleSetVersion, 64), zones, days, fcHistory{hs, s.Locations}, wx, tr})
	}
	return fitForecastRequest(hist, cal, s.StartDate, marshal)
}

// forecastRequestCap is the compressed size limit.
var forecastRequestCap = engines.MaxWireRequest

// forecastRawCap is the raw JSON size limit.
var forecastRawCap = engines.MaxRawRequest

// fitForecastRequest trims to the budget.
func fitForecastRequest(hist forecasthist.History, cal []fcDay, start string, marshal func(forecasthist.History, []fcDay) ([]byte, error)) ([]byte, error) {
	whole := len(hist.Records) + len(hist.Aggregated)
	body, kept, err := forecasthist.Fit(hist, forecasthist.Limits{Wire: forecastRequestCap, Raw: forecastRawCap, Records: engines.MaxHistoryRecords},
		func(h forecasthist.History) ([]byte, error) {
			if len(h.Records)+len(h.Aggregated) == whole {
				return marshal(h, cal)
			}
			first, days := h.First(), cal[:0:0]
			for _, d := range cal {
				if d.Date >= first || d.Date >= start {
					days = append(days, d)
				}
			}
			return marshal(h, days)
		})
	if errors.Is(err, forecasthist.ErrTooLarge) {
		return nil, inputErr("%s", err.Error())
	}
	if err == nil {
		d, a := kept.Days()
		wire, _ := engines.WireSize(body)
		log.Printf("engines: forecaster request: %d 15-minute records (%d days), %d totals (%d days), %d bytes raw, %d sent",
			len(kept.Records), d, len(kept.Aggregated), a, len(body), wire)
	}
	return body, err
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// ---- optimizer ----

type optimizerSource struct {
	Now           time.Time
	Date          string
	ZoneID        string
	PlanningLevel string
	// DemandQuantile: expected (central) or high
	DemandQuantile string
	Ramadan        bool
	ForecastRef    string
	Forecast       []ForecastValue
	Agents         []Agent
	Skills         map[string][]string
	OnLeave        map[string]bool
	// Unavail: rest day or weekly limit, by agent
	Unavail    map[string]string
	Vehicles   []Vehicle
	Patterns   []ShiftPattern
	BreakRules []BreakRule
	Prayer     *PrayerTime
	Points     []StandbyPoint
	Fixed      []RosterAssignment
	Sources    []string
	// ServiceLevel: nil sends no reach objective
	ServiceLevel *optServiceLevel
	// CasesPerInterval: nil sends none (default 1)
	CasesPerInterval *float64
	Travel           *travelModel
	SubZones         []SubZone

	// Home, DeployLimitKm: the distance limit
	Home          *Zone
	DeployLimitKm float64
	// Down: vehicles in maintenance that day
	Down map[string]bool
	// SkillReqs: objective.skill_requirements
	SkillReqs []optSkillReq
	// Scenario: scenario_adjustments, if any
	Scenario *optScenario
	// ModelVersion: objective.model_version, if set
	ModelVersion string
	// PrayerWindow: prayer_window_minutes, 0 is none
	PrayerWindow int
	// MaxRunSeconds: objective.max_run_seconds; 0: 30
	MaxRunSeconds int
}

// optServiceLevel: objective.service_level.
type optServiceLevel struct {
	ThresholdSeconds int         `json:"threshold_seconds"`
	TargetShare      float64     `json:"target_share"`
	Centres          []optCentre `json:"sub_zone_centres"`
}

type optCentre struct {
	SubZoneID string  `json:"sub_zone_id"`
	ZoneID    string  `json:"zone_id"`
	Lat       float64 `json:"latitude"`
	Lon       float64 `json:"longitude"`
}

type optHours struct {
	Applies   bool    `json:"applies"`
	StartTime *string `json:"start_time,omitempty"`
	EndTime   *string `json:"end_time,omitempty"`
}

func hoursOf(h ShiftHours) optHours {
	return optHours{Applies: h.Applies, StartTime: h.StartTime, EndTime: h.EndTime}
}

type optAgent struct {
	AgentID         string   `json:"agent_id"`
	Kind            string   `json:"kind"`
	HomeZoneID      *string  `json:"home_zone_id"`
	Skills          []string `json:"skills"`
	DefaultVehicle  *string  `json:"default_vehicle_id"`
	Available       bool     `json:"available"`
	Unavailable     string   `json:"unavailable_reason,omitempty"`
	EligiblePattern []string `json:"eligible_shift_pattern_ids,omitempty"`
}

type optValue struct {
	ZoneID        string  `json:"zone_id"`
	SubZoneID     string  `json:"sub_zone_id"`
	IntervalStart string  `json:"interval_start"`
	Low           float64 `json:"low"`
	Expected      float64 `json:"expected"`
	High          float64 `json:"high"`
	Field         float64 `json:"field_expected"`
	Remote        float64 `json:"remote_inferred_expected"`
}

type optVehicle struct {
	VehicleID string `json:"vehicle_id"`
	ZoneID    string `json:"zone_id"`
	Available bool   `json:"available"`
}

type optPattern struct {
	ID          string   `json:"shift_pattern_id"`
	Code        string   `json:"code"`
	Kind        string   `json:"kind"`
	Normal      optHours `json:"normal"`
	Ramadan     optHours `json:"ramadan"`
	BreakRuleID string   `json:"break_rule_id"`
}

type optBreakRule struct {
	ID    string  `json:"break_rule_id"`
	Mins  int     `json:"break_minutes"`
	After float64 `json:"after_consecutive_hours"`
}

type optPoint struct {
	ID     string  `json:"standby_point_id"`
	ZoneID string  `json:"zone_id"`
	Lat    float64 `json:"latitude"`
	Lon    float64 `json:"longitude"`
	Radius int     `json:"coverage_radius_m,omitempty"`
}

type optFixed struct {
	AgentID   string  `json:"agent_id"`
	PatternID string  `json:"shift_pattern_id"`
	ZoneID    string  `json:"zone_id"`
	VehicleID *string `json:"vehicle_id"`
}

var planningLevels = map[string]bool{"zone": true, "sub_zone": true, "city": true}

// fixedOf: the planner's locked lines.
func fixedOf(s optimizerSource) []optFixed {
	var out []optFixed
	for _, l := range s.Fixed {
		if l.ShiftPatternID != nil {
			out = append(out, optFixed{l.AgentID, *l.ShiftPatternID, s.ZoneID, l.VehicleID})
		}
	}
	return out
}

// buildOptimizerRequest: optimizer input.
func buildOptimizerRequest(s optimizerSource) ([]byte, error) {
	if err := validDate("roster date", s.Date); err != nil {
		return nil, err
	}
	if err := needUUID("zone_id", s.ZoneID); err != nil {
		return nil, err
	}
	if !planningLevels[s.PlanningLevel] {
		return nil, inputErr("planning level %q", s.PlanningLevel)
	}
	if s.ForecastRef == "" || len(s.ForecastRef) > 64 {
		return nil, inputErr("no forecast run to plan from")
	}
	if len(s.Forecast) == 0 {
		return nil, inputErr("the forecast run has no values for the zone and day")
	}
	h, err := newHeader(s.Now, s.Sources)
	if err != nil {
		return nil, err
	}
	values := make([]optValue, 0, len(s.Forecast))
	for _, v := range s.Forecast {
		if err := needUUID("forecast sub_zone_id", v.SubZoneID); err != nil {
			return nil, err
		}
		values = append(values, optValue{v.ZoneID, v.SubZoneID, v.IntervalStart, v.Low, v.Expected, v.High, v.FieldExpected, v.RemoteInferredExpected})
	}
	patternIDs := map[string][]string{}
	patterns := []optPattern{}
	usedRules := map[string]bool{}
	for _, p := range s.Patterns {
		if p.Status != ShiftStatusActive {
			continue
		}
		if err := needUUID("shift_pattern_id", p.ID); err != nil {
			return nil, err
		}
		if p.BreakRuleID == nil {
			return nil, inputErr("shift pattern %s has no break rule", p.Code)
		}
		patterns = append(patterns, optPattern{p.ID, truncate(p.Code, 32), string(p.Kind), hoursOf(p.Normal), hoursOf(p.Ramadan), *p.BreakRuleID})
		usedRules[*p.BreakRuleID] = true
		patternIDs[string(p.Kind)] = append(patternIDs[string(p.Kind)], p.ID)
	}
	if len(patterns) == 0 {
		return nil, inputErr("no active shift pattern")
	}
	if s.PrayerWindow != 0 && !validPrayerWindow(s.PrayerWindow) {
		return nil, inputErr("prayer window %d minutes", s.PrayerWindow)
	}
	rules := []optBreakRule{}
	for _, r := range s.BreakRules {
		if usedRules[r.ID] {
			rules = append(rules, optBreakRule{r.ID, r.BreakMinutes, r.AfterConsecutiveHours})
			delete(usedRules, r.ID)
		}
	}
	if len(usedRules) > 0 {
		return nil, inputErr("a shift pattern names a break rule that does not exist")
	}
	agents := []optAgent{}
	locked := map[string]bool{}
	for _, l := range s.Fixed {
		locked[l.AgentID] = true
	}
	for _, sv := range s.Agents {
		if !sv.IsActive || (sv.Kind == "field" && (sv.HomeZoneID == nil || *sv.HomeZoneID != s.ZoneID)) ||
			(sv.Kind == "remote" && sv.HomeZoneID != nil && *sv.HomeZoneID != s.ZoneID) {
			continue
		}
		if err := needUUID("agent_id", sv.ID); err != nil {
			return nil, err
		}
		skills := append([]string{}, s.Skills[sv.ID]...)
		sort.Strings(skills)
		o := optAgent{AgentID: sv.ID, Kind: sv.Kind, HomeZoneID: sv.HomeZoneID, Skills: skills, DefaultVehicle: sv.DefaultVehicleID, Available: !s.OnLeave[sv.ID],
			EligiblePattern: eligibleIDs(patternIDs[sv.Kind], sv.EligibleShiftPatternIDs)}
		switch {
		case s.OnLeave[sv.ID]:
			o.Unavailable = "approved leave"
		case locked[sv.ID]:
		case s.Unavail[sv.ID] != "":
			o.Available, o.Unavailable = false, s.Unavail[sv.ID]
		case len(o.EligiblePattern) == 0:
			o.Available, o.Unavailable = false, "no eligible shift pattern"
		}
		agents = append(agents, o)
	}
	if len(agents) == 0 {
		return nil, inputErr("no agents for the zone")
	}
	vehicles := []optVehicle{}
	for _, v := range s.Vehicles {
		if v.ZoneID != nil && *v.ZoneID == s.ZoneID {
			vehicles = append(vehicles, optVehicle{v.ID, *v.ZoneID, v.IsActive && !s.Down[v.ID]})
		}
	}
	points := []optPoint{}
	for _, p := range s.Points {
		if p.IsActive && p.ZoneID == s.ZoneID {
			pt := optPoint{ID: p.ID, ZoneID: p.ZoneID, Lat: p.Latitude, Lon: p.Longitude}
			if p.CoverageRadiusM >= 100 {
				pt.Radius = p.CoverageRadiusM
			}
			points = append(points, pt)
		}
	}
	mode := "normal"
	if s.Ramadan {
		mode = "ramadan"
	}
	budget := 30
	if s.MaxRunSeconds > 0 {
		budget = s.MaxRunSeconds
	}
	objective := map[string]any{"demand_quantile": quantileOrExpected(s.DemandQuantile), "max_run_seconds": budget, "seed": 1}
	if c := s.CasesPerInterval; c != nil {
		if !(*c > 0) || math.IsInf(*c, 0) {
			return nil, inputErr("cases per agent per interval %v", *c)
		}
		objective["cases_per_agent_per_interval"] = *c
	}
	if sl, err := reachObjectiveOf(s); err != nil {
		return nil, err
	} else if sl != nil {
		objective["service_level"] = sl
	}
	if s.ModelVersion != "" {
		objective["model_version"] = s.ModelVersion
	}
	if len(s.SkillReqs) > 0 {
		objective["skill_requirements"] = s.SkillReqs
	}
	centres := dispatchCentresOf(s)
	if centres != nil {
		objective["max_deploy_distance_km"] = s.DeployLimitKm
	}
	return json.Marshal(struct {
		engineHeader
		RosterDate    string            `json:"roster_date"`
		ZoneIDs       []string          `json:"zone_ids"`
		PlanningLevel string            `json:"planning_level"`
		CalendarMode  string            `json:"calendar_mode"`
		Objective     map[string]any    `json:"objective"`
		Forecast      map[string]any    `json:"forecast"`
		Agents        []optAgent        `json:"agents"`
		Vehicles      []optVehicle      `json:"vehicles"`
		Patterns      []optPattern      `json:"shift_patterns"`
		BreakRules    []optBreakRule    `json:"break_rules"`
		Prayer        map[string]string `json:"prayer_times,omitempty"`
		Points        []optPoint        `json:"standby_points"`
		Fixed         []optFixed        `json:"fixed_assignments,omitempty"`
		Travel        *travelModel      `json:"travel_model,omitempty"`
		Centres       []optHome         `json:"dispatch_centres,omitempty"`
		PrayerWindow  int               `json:"prayer_window_minutes,omitempty"`
		Scenario      *optScenario      `json:"scenario_adjustments,omitempty"`
	}{h, s.Date, []string{s.ZoneID}, s.PlanningLevel, mode, objective,
		map[string]any{"forecast_run_ref": s.ForecastRef, "values": values}, agents, vehicles, patterns, rules, prayerOf(s.Prayer), points, fixedOf(s), s.Travel, centres, s.PrayerWindow, s.Scenario})
}

// eligibleIDs: the kind's active ids it allows.
func eligibleIDs(active, allowed []string) []string {
	if allowed == nil {
		return active
	}
	ok := map[string]bool{}
	for _, id := range allowed {
		ok[id] = true
	}
	out := []string{}
	for _, id := range active {
		if ok[id] {
			out = append(out, id)
		}
	}
	return out
}

// reachObjectiveOf: the reach objective, with the zone's centres.
func reachObjectiveOf(s optimizerSource) (*optServiceLevel, error) {
	if s.ServiceLevel == nil {
		return nil, nil
	}
	sl := *s.ServiceLevel
	if sl.ThresholdSeconds < 1 || sl.ThresholdSeconds > 7200 || !(sl.TargetShare > 0 && sl.TargetShare <= 1) {
		return nil, inputErr("service level %d s, %v", sl.ThresholdSeconds, sl.TargetShare)
	}
	sl.Centres = []optCentre{}
	for _, z := range s.SubZones {
		if !z.IsActive || z.ZoneID != s.ZoneID {
			continue
		}
		if err := needUUID("sub_zone_id", z.ID); err != nil {
			return nil, err
		}
		sl.Centres = append(sl.Centres, optCentre{z.ID, z.ZoneID, z.Latitude, z.Longitude})
	}
	return &sl, nil
}

// ---- simulator ----

type simDayCase struct {
	ID, RegisteredAt, ZoneID, SubZoneID, Handling string
	Latitude, Longitude                           float64
	Parties, OnSceneSeconds                       *int
	ActualAssignedAt, ActualAgentID               *string
	DataSource                                    string
}

type simulatorSource struct {
	Now              time.Time
	ClockStart       string
	ThresholdSeconds int
	Policy           string
	Cases            []simDayCase
	RosterRef        string
	Lines            []RosterAssignment
	Points           []StandbyPoint
	Sources          []string
	Dropped          int
	Travel           *travelModel
}

type simCase struct {
	CaseID     string  `json:"case_id"`
	Registered string  `json:"registered_at"`
	ZoneID     string  `json:"zone_id"`
	SubZoneID  string  `json:"sub_zone_id,omitempty"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
	Handling   string  `json:"handling"`
	Parties    *int    `json:"parties_involved,omitempty"`
	OnScene    *int    `json:"on_scene_seconds,omitempty"`
	AssignedAt *string `json:"actual_assigned_at,omitempty"`
	AgentID    *string `json:"actual_agent_id,omitempty"`
}

type simLine struct {
	AgentID    string   `json:"agent_id"`
	PatternID  string   `json:"shift_pattern_id"`
	ZoneID     *string  `json:"zone_id"`
	StartAt    string   `json:"start_at"`
	EndAt      string   `json:"end_at"`
	BreakStart *string  `json:"break_start_at"`
	BreakEnd   *string  `json:"break_end_at"`
	StartLat   *float64 `json:"start_latitude,omitempty"`
	StartLon   *float64 `json:"start_longitude,omitempty"`
}

var engineSimPolicies = map[string]bool{"nearest": true, "scorer": true, "replay_actual": true}

// buildSimulatorRequest: simulator input.
func buildSimulatorRequest(s simulatorSource) ([]byte, error) {
	if s.ClockStart != "assignment" && s.ClockStart != "registration" {
		return nil, inputErr("clock start %q", s.ClockStart)
	}
	if s.ThresholdSeconds < 1 {
		return nil, inputErr("threshold must be at least 1 second")
	}
	if !engineSimPolicies[s.Policy] {
		return nil, inputErr("assignment policy %q", s.Policy)
	}
	if s.RosterRef == "" || len(s.RosterRef) > 64 {
		return nil, inputErr("no roster to simulate")
	}
	h, err := newHeader(s.Now, s.Sources)
	if err != nil {
		return nil, err
	}
	cases := make([]simCase, 0, len(s.Cases))
	for _, c := range s.Cases {
		for what, id := range map[string]string{"case_id": c.ID, "case zone_id": c.ZoneID} {
			if err := needUUID(what, id); err != nil {
				return nil, err
			}
		}
		if c.Handling != "field" && c.Handling != "remote_inferred" {
			return nil, inputErr("case handling %q", c.Handling)
		}
		sc := simCase{CaseID: c.ID, Registered: c.RegisteredAt, ZoneID: c.ZoneID, Latitude: c.Latitude, Longitude: c.Longitude, Handling: c.Handling,
			Parties: c.Parties, OnScene: c.OnSceneSeconds, AssignedAt: c.ActualAssignedAt, AgentID: c.ActualAgentID}
		if uuidPattern.MatchString(c.SubZoneID) {
			sc.SubZoneID = c.SubZoneID
		}
		cases = append(cases, sc)
	}
	if len(cases) == 0 {
		return nil, inputErr("no cases on the day")
	}
	at := map[string]StandbyPoint{}
	for _, p := range s.Points {
		at[p.ID] = p
	}
	lines := make([]simLine, 0, len(s.Lines))
	for _, l := range s.Lines {
		if l.ShiftPatternID == nil {
			return nil, inputErr("a roster line has no shift pattern")
		}
		if err := needUUID("roster agent_id", l.AgentID); err != nil {
			return nil, err
		}
		ln := simLine{AgentID: l.AgentID, PatternID: *l.ShiftPatternID, ZoneID: l.ZoneID, StartAt: l.StartAt, EndAt: l.EndAt, BreakStart: l.BreakStartAt, BreakEnd: l.BreakEndAt}
		if l.StandbyPointID != nil {
			if p, ok := at[*l.StandbyPointID]; ok {
				lat, lon := p.Latitude, p.Longitude
				ln.StartLat, ln.StartLon = &lat, &lon
			}
		}
		lines = append(lines, ln)
	}
	if len(lines) == 0 {
		return nil, inputErr("the roster has no assignments")
	}
	return json.Marshal(struct {
		engineHeader
		ClockStart string         `json:"clock_start_primary"`
		Threshold  int            `json:"threshold_seconds"`
		Policy     string         `json:"assignment_policy"`
		Seed       int            `json:"seed"`
		Travel     *travelModel   `json:"travel_model,omitempty"`
		Cases      []simCase      `json:"cases"`
		Roster     map[string]any `json:"roster"`
	}{h, s.ClockStart, s.ThresholdSeconds, s.Policy, 1, s.Travel, cases, map[string]any{"roster_ref": s.RosterRef, "assignments": lines}})
}

func quantileOrExpected(q string) string {
	if q == "high" {
		return "high"
	}
	return "expected"
}

// fcHistory: counts plus micro-cell counts.
type fcHistory struct {
	forecasthist.History
	Locations []fcLocationRecord `json:"location_records,omitempty"`
}
