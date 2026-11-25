// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecasthist"
)

// Caller has the engines.Engine shape.
type Caller interface {
	Call(ctx context.Context, request []byte) ([]byte, error)
}

const isoZ = "2006-01-02T15:04:05-07:00"

// DefaultRequestCap is the compressed size limit.
const DefaultRequestCap = engines.MaxWireRequest

// ModelInfo is what the engine says about its training.
type ModelInfo struct {
	FeatureSet    []string `json:"feature_set"`
	TrainingStart string   `json:"training_start"`
	TrainingEnd   string   `json:"training_end"`
	HistoryDays   int      `json:"history_days"`
}

// EngineOptions: how the backtest asks the forecaster.
type EngineOptions struct {
	ModelVersion string
	Source       string
	Calendar     forecastcal.Config
	// RequestCap: compressed bytes (0: DefaultRequestCap)
	RequestCap int
	// RawCap: raw JSON bytes (0: engines.MaxRawRequest)
	RawCap int
	// HistoryDays: days of history sent per request (0: all)
	HistoryDays int
	// ZoneCity: city name by zone, for weather and traffic.
	ZoneCity map[string]string
	// Holiday says whether a date is a public holiday, and its name.
	Holiday func(date string) (bool, string)
	// Long: older history as totals (nil: none).
	Long *forecasthist.Settings
	// Weather is sent when set.
	Weather WeatherFunc
	// ZoneCityID: city id by zone, for weather.
	ZoneCityID map[string]string
	// PerfectWeather: horizon weather too (opt-in)
	PerfectWeather bool
	// ActiveSubZoneDays: send live sub-zones only
	ActiveSubZoneDays int
}

// EngineCandidate is a forecaster that keeps the engine's own words.
type EngineCandidate struct {
	e    Caller
	opt  EngineOptions
	mu   sync.Mutex
	meta EngineMeta
}

// EngineMeta is the last answer's model facts and the biggest request.
type EngineMeta struct {
	ModelVersion    string
	ModelInfo       *ModelInfo
	Requests        int
	MaxRequestBytes int
	// MaxWireBytes: the compressed size of that request
	MaxWireBytes    int
	MaxRecords      int
	MaxAggregated   int
	TrimmedRequests int
	// span in days of history before the origin
	MaxSpanDays int
	MinSpanSent int
	CallTotal   time.Duration
	CallMax     time.Duration
	// Mismatched: answers naming another model
	Mismatched int
}

// Meta returns what the last answer said.
func (c *EngineCandidate) Meta() EngineMeta {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.meta
}

// NewEngineCandidate adapts a forecaster engine.
func NewEngineCandidate(e Caller, o EngineOptions) *EngineCandidate {
	return &EngineCandidate{e: e, opt: o}
}

// EngineForecaster adapts a forecaster engine.
func EngineForecaster(e Caller, modelVersion, source string) Forecaster {
	return NewEngineCandidate(e, EngineOptions{ModelVersion: modelVersion, Source: source}).Forecast
}

type calItem struct {
	Date        string              `json:"date"`
	IsHoliday   bool                `json:"is_holiday"`
	HolidayName string              `json:"holiday_name,omitempty"`
	IsRamadan   bool                `json:"is_ramadan"`
	IsPayday    *bool               `json:"is_payday,omitempty"`
	School      *bool               `json:"school_in_session,omitempty"`
	Events      []forecastcal.Event `json:"events"`
	Hijri       *forecastcal.Hijri  `json:"hijri_date,omitempty"`
	forecastcal.Extras
}

// calendarFor covers the history window and the horizon.
func (c *EngineCandidate) calendarFor(origin time.Time, days, history int) []calItem {
	var out []calItem
	for d := -history; d < days; d++ {
		date := addDays(origin, d).Format("2006-01-02")
		f := c.opt.Calendar.For(date)
		it := calItem{Date: date, IsRamadan: f.IsRamadan, IsPayday: f.IsPayday, School: f.SchoolInSession, Events: forecastcal.SendEvents(f.Events), Hijri: f.Hijri, Extras: f.Extras}
		if c.opt.Holiday != nil {
			it.IsHoliday, it.HolidayName = c.opt.Holiday(date)
		}
		out = append(out, it)
	}
	return out
}

// Forecast asks the engine for one origin.
func (c *EngineCandidate) Forecast(ctx context.Context, r ForecastRequest) ([]ForecastValue, error) {
	type sub struct {
		ID string `json:"sub_zone_id"`
	}
	type zone struct {
		ID     string `json:"zone_id"`
		Region string `json:"region,omitempty"`
		City   string `json:"city_id,omitempty"`
		Subs   []sub  `json:"sub_zones"`
	}
	var zones []zone
	r.Zones = activeZones(r, c.opt.ActiveSubZoneDays)
	var zoneIDs []string
	for _, z := range r.Zones {
		zz := zone{ID: z.ZoneID}
		if c.opt.Weather != nil {
			zz.City = c.opt.ZoneCityID[z.ZoneID]
		}
		zoneIDs = append(zoneIDs, z.ZoneID)
		for _, s := range z.SubZones {
			zz.Subs = append(zz.Subs, sub{s})
		}
		zones = append(zones, zz)
	}
	hist := r.History
	detailDays := c.opt.HistoryDays
	var aggFrom time.Time
	if c.opt.Long != nil {
		var detailFrom time.Time
		aggFrom, detailFrom = c.opt.Long.Windows(r.Origin)
		detailDays = dayCount(detailFrom, r.Origin) - 1
	}
	if detailDays > 0 {
		from := addDays(r.Origin, -detailDays)
		hist = hist[sort.Search(len(hist), func(k int) bool { return !hist[k].Start.Before(from) }):]
	}
	h := forecasthist.History{Records: make([]forecasthist.Record, 0, len(hist))}
	for _, x := range hist {
		h.Records = append(h.Records, forecasthist.NewRecord(x.SubZoneID, x.Start, x.Total, x.Field))
	}
	if c.opt.Long != nil {
		a := forecasthist.NewAggregator(*c.opt.Long)
		old := r.History[:len(r.History)-len(hist)]
		for _, x := range old[sort.Search(len(old), func(k int) bool { return !old[k].Start.Before(aggFrom) }):] {
			a.Add(x.SubZoneID, x.Start, x.Total, x.Field)
		}
		h.Aggregated = a.Result()
	}
	limit := c.opt.RequestCap
	if limit == 0 {
		limit = DefaultRequestCap
	}
	rawLimit := c.opt.RawCap
	if rawLimit == 0 {
		rawLimit = engines.MaxRawRequest
	}
	span := func(x forecasthist.History) int {
		f := x.First()
		if f == "" {
			return 0
		}
		t, _ := time.ParseInLocation("2006-01-02", f, loc)
		return dayCount(t, r.Origin) - 1
	}
	days := c.opt.HistoryDays
	if c.opt.Long != nil || (days == 0 && len(r.History) > 0) {
		days = span(h)
	}
	asked, nrec, nagg := span(h), len(h.Records), len(h.Aggregated)
	build := func(x forecasthist.History) ([]byte, error) {
		d := days
		if len(x.Records) < nrec || len(x.Aggregated) < nagg {
			d = min(d, span(x))
		}
		req := map[string]any{
			"schema_version": "1.0", "request_id": requestID(r.Origin), "requested_at": r.Origin.Format(isoZ),
			"data_source": c.opt.Source, "horizon": map[string]any{"start_date": r.Origin.Format("2006-01-02"), "days": r.Days},
			"model": map[string]any{"model_version": c.opt.ModelVersion, "range_coverage": r.Coverage},
			"zones": zones, "calendar": c.calendarFor(r.Origin, r.Days, d), "history": x,
		}
		if wx := c.weatherDays(zoneIDs, r.Origin, r.Days, d); len(wx) > 0 {
			req["weather"] = wx
		}
		return json.Marshal(req)
	}
	body, kept, err := forecasthist.Fit(h, forecasthist.Limits{Wire: limit, Raw: rawLimit, Records: engines.MaxHistoryRecords}, build)
	if err != nil {
		return nil, err
	}
	wire, _ := engines.WireSize(body)
	began := time.Now()
	resp, err := c.e.Call(ctx, body)
	took := time.Since(began)
	if err != nil {
		return nil, err
	}
	var out struct {
		ModelVersion string     `json:"model_version"`
		ModelInfo    *ModelInfo `json:"model_info"`
		Values       []struct {
			Zone     string   `json:"zone_id"`
			Sub      string   `json:"sub_zone_id"`
			Start    string   `json:"interval_start"`
			Low      float64  `json:"low"`
			Expected float64  `json:"expected"`
			High     float64  `json:"high"`
			Field    *float64 `json:"field_expected"`
		} `json:"values"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return nil, fmt.Errorf("forecaster response: %w", err)
	}
	c.mu.Lock()
	c.meta.Requests++
	if len(body) > c.meta.MaxRequestBytes {
		c.meta.MaxRequestBytes, c.meta.MaxWireBytes = len(body), wire
	}
	c.meta.MaxRecords = max(c.meta.MaxRecords, len(kept.Records))
	c.meta.MaxAggregated = max(c.meta.MaxAggregated, len(kept.Aggregated))
	c.meta.CallTotal += took
	c.meta.CallMax = max(c.meta.CallMax, took)
	c.meta.MaxSpanDays = max(c.meta.MaxSpanDays, asked)
	if sent := span(kept); c.meta.Requests == 1 || sent < c.meta.MinSpanSent {
		c.meta.MinSpanSent = sent
	}
	if len(kept.Records) < nrec || len(kept.Aggregated) < nagg {
		c.meta.TrimmedRequests++
	}
	c.meta.ModelVersion, c.meta.ModelInfo = out.ModelVersion, out.ModelInfo
	if c.opt.ModelVersion != "" && out.ModelVersion != c.opt.ModelVersion {
		c.meta.Mismatched++
	}
	c.mu.Unlock()
	vs := make([]ForecastValue, 0, len(out.Values))
	for _, v := range out.Values {
		t, err := time.Parse(time.RFC3339, v.Start)
		if err != nil {
			return nil, fmt.Errorf("forecaster interval_start: %w", err)
		}
		fv := ForecastValue{ZoneID: v.Zone, SubZoneID: v.Sub, Start: t, Low: v.Low, Expected: v.Expected, High: v.High}
		if v.Field != nil {
			fv.Field, fv.HasField = *v.Field, true
		}
		vs = append(vs, fv)
	}
	return vs, nil
}

// activeZones keeps sub-zones with recent cases.
func activeZones(r ForecastRequest, days int) []ZoneSpec {
	if days <= 0 {
		return r.Zones
	}
	from := addDays(r.Origin, -days)
	live := map[string]bool{}
	for k := len(r.History) - 1; k >= 0 && !r.History[k].Start.Before(from); k-- {
		if r.History[k].Total > 0 {
			live[r.History[k].SubZoneID] = true
		}
	}
	var out []ZoneSpec
	for _, z := range r.Zones {
		var subs []string
		for _, s := range z.SubZones {
			if live[s] {
				subs = append(subs, s)
			}
		}
		if len(subs) > 0 {
			out = append(out, ZoneSpec{ZoneID: z.ZoneID, SubZones: subs})
		}
	}
	return out
}

// EngineAssigner adapts an assignment engine.
func EngineAssigner(e Caller, source string, deadlineMs int) Assigner {
	return func(ctx context.Context, r AssignRequest) (AssignDecision, error) {
		type cand struct {
			ID    string   `json:"agent_id"`
			State string   `json:"status"`
			Lat   float64  `json:"latitude"`
			Lon   float64  `json:"longitude"`
			At    string   `json:"position_at"`
			Skill []string `json:"skills"`
			Veh   bool     `json:"has_vehicle"`
		}
		var cs []cand
		for _, c := range r.Candidates {
			cs = append(cs, cand{c.AgentID, "available", c.Pos.Lat, c.Pos.Lon, c.PositionAt.Format(isoZ), []string{}, true})
		}
		req := map[string]any{
			"schema_version": "1.0", "request_id": r.CaseID, "requested_at": r.Now.Format(isoZ),
			"data_source": source, "now": r.Now.Format(isoZ), "stage": "shadow", "decision_deadline_ms": deadlineMs, "top_n": 1,
			"case": map[string]any{
				"case_id": r.CaseID, "registered_at": r.RegisteredAt.Format(isoZ), "zone_id": r.ZoneID,
				"latitude": r.Pos.Lat, "longitude": r.Pos.Lon, "handling": "field",
			},
			"candidates":   cs,
			"travel_model": map[string]any{"average_speed_kmh": r.SpeedKmh, "detour_factor": 1},
		}
		body, _ := json.Marshal(req)
		resp, err := e.Call(ctx, body)
		if err != nil {
			return AssignDecision{}, err
		}
		var out struct {
			DecisionMs float64 `json:"decision_time_ms"`
			Ranking    []struct {
				AgentID string `json:"agent_id"`
			} `json:"ranking"`
		}
		if err := json.Unmarshal(resp, &out); err != nil {
			return AssignDecision{}, fmt.Errorf("assignment response: %w", err)
		}
		if len(out.Ranking) == 0 {
			return AssignDecision{}, fmt.Errorf("assignment returned no ranking for case %s", r.CaseID)
		}
		return AssignDecision{AgentID: out.Ranking[0].AgentID, DecisionTime: time.Duration(out.DecisionMs * float64(time.Millisecond))}, nil
	}
}

func requestID(t time.Time) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", t.Unix()%1_000_000_000_000)
}

// nonNilEvents sends [] for a day with none: absent means unknown.
func nonNilEvents(e []forecastcal.Event) []forecastcal.Event {
	if e == nil {
		return []forecastcal.Event{}
	}
	return e
}
