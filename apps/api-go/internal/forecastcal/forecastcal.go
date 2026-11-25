// SPDX-License-Identifier: AGPL-3.0-only

// Package forecastcal derives the forecaster's calendar features.
package forecastcal

import (
	"fmt"
	"sort"
	"time"

	hijri "github.com/hablullah/go-hijri"
)

const (
	KeyPaydayDay    = "forecast.payday_day"
	KeySchoolTerms  = "forecast.school_terms"
	KeySeasonEvents = "forecast.season_events"
	KeyUmrahWindows = "forecast.umrah_windows"

	KeyPlanningMode   = "forecast.planning_mode"
	KeyGateMinImprove = "forecast.gate_min_improvement"
	KeyGateWorseZones = "forecast.gate_max_worse_zones"
	KeyGateBaseline   = "forecast.gate_baseline"

	// The customer's segment average.
	DefaultGateBaseline = "segment"

	// The engine meets the customer's segment shape.
	KeyShapeShare = "forecast.segment_shape_share"
	KeySmallZone  = "forecast.small_zone_cases_per_day"
	// Special days on their own shape.
	KeyDayTypes = "forecast.day_type_shapes"

	KeyHorizonDays      = "forecast.horizon_days"
	KeyHorizonChunkDays = "forecast.horizon_chunk_days"

	// The spec's planning horizon: 7 to 30 days.
	DefaultHorizonDays = 10
	MinHorizonDays     = 7
	MaxHorizonDays     = 30
	// One forecaster call covers at most 30 days.
	DefaultHorizonChunkDays = 10
	MaxHorizonChunkDays     = 30

	// An ASSUMPTION, to confirm with the customer.
	DefaultPaydayDay = 27
	// The customer's Salary Week: the 25th to month end.
	DefaultSalaryWindowStart = 25
	maxEvents                = 8
)

// Descriptions say what each setting means.
var Descriptions = map[string]string{
	KeyPaydayDay:    "ASSUMPTION, to confirm with the customer: the day of the month salaries are paid (default 27; 0 turns it off). A month shorter than this day uses its last day. No weekend shift.",
	KeySchoolTerms:  "School term date ranges [{start,end,name}]. Empty means unknown: the forecaster is not told. Never filled in by us.",
	KeySeasonEvents: "Riyadh Season and other event date ranges [{start,end,name}]. Empty means none known.",
	KeyUmrahWindows: "Umrah window date ranges [{start,end,name}]. Empty means unknown.",
	KeyNoticeEvents: "Events saved from a pasted notice, each with its zones and expected impact [{start,end,name,type,zone_ids,impact,...}]. Sent to the forecaster as season_event or other with their zone ids.",

	KeyPlanningMode:   "central plans staffing on the expected forecast; high on the high end of the range (default central).",
	KeyGateMinImprove: "Backtest gate: the engine's WAPE must beat the gate baseline's by at least this share (default 0.10).",
	KeyGateBaseline:   "Backtest gate baseline: segment (the customer's segment-average method, default) or naive (same hour last week)..",
	KeyGateWorseZones: "Backtest gate: the engine may be worse than the baseline in at most this share of zones (default 0.25).",

	KeyHorizonDays:      "Planning horizon: the forecast covers this many days from today, per 15-minute interval. Whole number from 7 to 30 (default 10).",
	KeyHorizonChunkDays: "Days per forecaster call: a longer horizon is asked for in consecutive pieces of at most this many days, each with all zones and the full history, and stored as one run. Whole number from 1 to 30 (default 10; smaller pieces use less memory).",
}

// Range is an inclusive date range with a label.
type Range struct {
	Start string `json:"start"`
	End   string `json:"end"`
	Name  string `json:"name,omitempty"`
}

// Config is what the settings say.
type Config struct {
	PaydayDay int
	// SalaryWindowStart: 0 turns the salary window off.
	SalaryWindowStart int
	SchoolTerms       []Range
	SeasonEvents      []Range
	UmrahWindows      []Range
	// NoticeEvents carry their own zones.
	NoticeEvents []NoticeRange
}

// Event is one calendar event of a day.
type Event struct {
	Type    string   `json:"type"`
	Name    string   `json:"name,omitempty"`
	ZoneIDs []string `json:"zone_ids,omitempty"`
	// Cities scope an event before zone ids are known.
	Cities []string `json:"-"`
}

// Extras are optional day fields sent to the engine.
type Extras struct {
	SalaryWindow         *bool             `json:"salary_window,omitempty"`
	SchoolPeriod         string            `json:"school_period,omitempty"`
	SchoolPeriodByRegion map[string]string `json:"school_period_by_region,omitempty"`
}

// Hijri is an Umm al-Qura date.
type Hijri struct {
	Year  int `json:"year"`
	Month int `json:"month"`
	Day   int `json:"day"`
}

// Features of one day; nil or empty is unknown.
type Features struct {
	Hijri           *Hijri
	IsRamadan       bool
	IsPayday        *bool
	SchoolInSession *bool
	Events          []Event
	Extras
}

func (r Range) valid() bool {
	s, e := parse(r.Start), parse(r.End)
	return !s.IsZero() && !e.IsZero() && !e.Before(s) && len(r.Name) <= 120
}

func parse(d string) time.Time {
	t, err := time.Parse("2006-01-02", d)
	if err != nil {
		return time.Time{}
	}
	return t
}

// Valid keeps the usable ranges, by start date.
func Valid(rs []Range) []Range {
	var out []Range
	for _, r := range rs {
		if r.valid() {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}

func (r Range) has(d string) bool { return d >= r.Start && d <= r.End }

// HijriOf: Umm al-Qura date, nil when unknown.
func HijriOf(date string) *Hijri {
	t := parse(date)
	if t.IsZero() {
		return nil
	}
	uq, err := hijri.CreateUmmAlQuraDate(t)
	if err != nil {
		return nil
	}
	return &Hijri{Year: int(uq.Year), Month: int(uq.Month), Day: int(uq.Day)}
}

func isPayday(t time.Time, day int) bool {
	last := time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	return t.Day() == min(day, last)
}

// For derives the features of one date.
func (c Config) For(date string) Features {
	var f Features
	t := parse(date)
	if t.IsZero() {
		return f
	}
	if c.PaydayDay >= 1 && c.PaydayDay <= 31 {
		p := isPayday(t, c.PaydayDay)
		f.IsPayday = &p
	}
	if c.SalaryWindowStart >= 1 {
		w := inSalaryWindow(t, c.SalaryWindowStart)
		f.SalaryWindow = &w
	}
	f.Hijri = HijriOf(date)
	if h := f.Hijri; h != nil {
		f.IsRamadan = h.Month == 9
		f.Events = append(f.Events, hijriEvents(h, false)...)
	}
	f.Events = append(f.Events, gregorianEvents(t)...)
	for _, r := range Valid(c.SeasonEvents) {
		if r.has(date) {
			f.Events = append(f.Events, Event{Type: "season_event", Name: r.Name})
		}
	}
	for _, r := range Valid(c.UmrahWindows) {
		if r.has(date) {
			f.Events = append(f.Events, Event{Type: "umrah", Name: r.Name})
		}
	}
	f.Events = append(f.Events, c.noticeEvents(date)...)
	f.SchoolInSession = c.school(date)
	if len(f.Events) > maxEvents {
		f.Events = f.Events[:maxEvents]
	}
	return f
}

// school is known only inside the listed terms' span.
func (c Config) school(date string) *bool {
	terms := Valid(c.SchoolTerms)
	if len(terms) == 0 {
		return nil
	}
	first, last := terms[0].Start, terms[0].End
	in := false
	for _, r := range terms {
		first, last = min(first, r.Start), max(last, r.End)
		in = in || r.has(date)
	}
	if date < first || date > last {
		return nil
	}
	return &in
}

// IsEvent tells whether a day carries any event.
func (f Features) IsEvent() bool { return len(f.Events) > 0 }

func asRanges(key string, value any) ([]Range, error) {
	if rs, ok := value.([]Range); ok {
		value = toAny(rs)
	}
	list, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("%s must be a list of {start, end, name}", key)
	}
	out := make([]Range, 0, len(list))
	for i, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%s item %d must be an object", key, i+1)
		}
		name, _ := m["name"].(string)
		start, _ := m["start"].(string)
		end, _ := m["end"].(string)
		r := Range{start, end, name}
		if !r.valid() {
			return nil, fmt.Errorf("%s item %d needs start and end dates (YYYY-MM-DD, end not before start) and a name up to 120 characters", key, i+1)
		}
		out = append(out, r)
	}
	return out, nil
}

func toAny(rs []Range) []any {
	out := make([]any, len(rs))
	for i, r := range rs {
		out[i] = map[string]any{"start": r.Start, "end": r.End, "name": r.Name}
	}
	return out
}

// ValidateSetting checks a forecast.* value on write.
func ValidateSetting(key string, value any) error {
	if ok, err := validLocationSetting(key, value); ok {
		return err
	}
	if ok, err := validAccuracySetting(key, value); ok {
		return err
	}
	switch key {
	case KeyPaydayDay:
		return wholeIn(key, value, 0, 31)
	case KeyHorizonDays:
		return wholeIn(key, value, MinHorizonDays, MaxHorizonDays)
	case KeyHorizonChunkDays:
		return wholeIn(key, value, 1, MaxHorizonChunkDays)
	case KeySchoolTerms, KeySeasonEvents, KeyUmrahWindows:
		_, err := asRanges(key, value)
		return err
	case KeyNoticeEvents:
		_, err := asNotices(value)
		return err
	case KeyPlanningMode:
		if v, _ := value.(string); v != "central" && v != "high" {
			return fmt.Errorf("%s must be central or high", key)
		}
	case KeyGateBaseline:
		if v, _ := value.(string); v != "naive" && v != "segment" {
			return fmt.Errorf("%s must be naive or segment", key)
		}
	case KeyGateMinImprove, KeyGateWorseZones:
		n, ok := value.(float64)
		if !ok || n < 0 || n > 1 {
			return fmt.Errorf("%s must be a number from 0 to 1", key)
		}
	}
	return nil
}

// wholeIn checks a whole number from lo to hi.
func wholeIn(key string, value any, lo, hi int) error {
	n, ok := value.(float64)
	if i, isInt := value.(int); isInt {
		n, ok = float64(i), true
	}
	if !ok || n != float64(int(n)) || n < float64(lo) || n > float64(hi) {
		return fmt.Errorf("%s must be a whole number from %d to %d", key, lo, hi)
	}
	return nil
}
