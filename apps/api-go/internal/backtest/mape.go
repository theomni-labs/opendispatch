// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"fmt"
	"math"
	"sort"
	"time"
)

// SpecMAPETarget: client target, zone x day
const SpecMAPETarget = 0.15

const (
	SpecMeets      = "meets"
	SpecNotMet     = "does_not_meet"
	SpecNoValue    = "no_value"
	specGrainLabel = "zone x day"
)

// MAPENote: how MAPE is built
const MAPENote = "MAPE = mean of |forecast - actual| / actual over cells with actual > 0; cells with actual 0 are excluded and counted. " +
	"Zone x day cell = one zone's (dispatch center) daily total for one scored day and origin; zone x hour cell = one zone's count in one hour of one day. " +
	"MAPE on small counts is unstable (one case off in a cell of 2 is 50%), so WAPE is shown beside it at the same grain. " +
	"The spec check is informational; the gate stays on WAPE against the baseline"

// MAPEMetrics: MAPE and WAPE over cells
type MAPEMetrics struct {
	Cells       int      `json:"cells"`
	Excluded    int      `json:"excluded_zero_actual"`
	MAPE        *float64 `json:"mape"`
	WAPE        *float64 `json:"wape"`
	ActualTotal float64  `json:"actual_total"`
}

// MAPERow: one row of a MAPE table
type MAPERow struct {
	ZoneID    string `json:"zone_id,omitempty"`
	Hour      *int   `json:"hour,omitempty"`
	DayOfWeek string `json:"day_of_week,omitempty"`
	MAPEMetrics
}

// MAPEReport: one method's MAPE at every grain
type MAPEReport struct {
	ZoneDay         MAPEMetrics `json:"zone_day"`
	ZoneHour        MAPEMetrics `json:"zone_hour"`
	ByZone          []MAPERow   `json:"by_zone"`
	ByHour          []MAPERow   `json:"by_hour"`
	ByDayOfWeek     []MAPERow   `json:"by_day_of_week"`
	ByZoneHour      []MAPERow   `json:"by_zone_hour"`
	ByZoneDayOfWeek []MAPERow   `json:"by_zone_day_of_week"`
}

// SpecCheck: MAPE against the client's target
type SpecCheck struct {
	Arm          string   `json:"arm"`
	Grain        string   `json:"grain"`
	Target       float64  `json:"target"`
	MAPE         *float64 `json:"mape"`
	Result       string   `json:"result"`
	Illustrative bool     `json:"illustrative"`
	Note         string   `json:"note"`
}

type mapeAcc struct {
	n, zero       int
	ape, abs, act float64
}

func (m *mapeAcc) add(forecast, actual float64) {
	e := math.Abs(forecast - actual)
	m.abs += e
	m.act += actual
	if actual <= 0 {
		m.zero++
		return
	}
	m.n++
	m.ape += e / actual
}

func (m *mapeAcc) metrics() MAPEMetrics {
	out := MAPEMetrics{Cells: m.n + m.zero, Excluded: m.zero, ActualTotal: round(m.act, 2)}
	if m.n > 0 {
		out.MAPE = ptr(round(m.ape/float64(m.n), 4))
	}
	if m.act > 0 {
		out.WAPE = ptr(round(m.abs/m.act, 4))
	}
	return out
}

type zoneDate struct {
	zone, date string
}

type zoneDow struct {
	zone string
	dow  time.Weekday
}

// mapeArm gathers one method's MAPE cells.
type mapeArm struct {
	zoneDay, zoneHour mapeAcc
	byZone            map[string]*mapeAcc
	byHour            [24]mapeAcc
	byDow             [7]mapeAcc
	byZoneHour        map[zoneHour]*mapeAcc
	byZoneDow         map[zoneDow]*mapeAcc
	day               map[zoneDate]*[2]float64
	dayOrder          []zoneDate
	dayWeekday        map[zoneDate]time.Weekday
}

func newMAPEArm() *mapeArm {
	return &mapeArm{byZone: map[string]*mapeAcc{}, byZoneHour: map[zoneHour]*mapeAcc{}, byZoneDow: map[zoneDow]*mapeAcc{}}
}

func accOf[K comparable](m map[K]*mapeAcc, k K) *mapeAcc {
	a := m[k]
	if a == nil {
		a = &mapeAcc{}
		m[k] = a
	}
	return a
}

// addHour adds one zone-hour cell of one origin.
func (m *mapeArm) addHour(zone string, t time.Time, forecast, actual float64) {
	lt := t.In(loc)
	h := lt.Hour()
	m.zoneHour.add(forecast, actual)
	m.byHour[h].add(forecast, actual)
	accOf(m.byZoneHour, zoneHour{zone, h}).add(forecast, actual)
	if m.day == nil {
		m.day, m.dayWeekday = map[zoneDate]*[2]float64{}, map[zoneDate]time.Weekday{}
	}
	k := zoneDate{zone, lt.Format("2006-01-02")}
	d := m.day[k]
	if d == nil {
		d = &[2]float64{}
		m.day[k] = d
		m.dayOrder = append(m.dayOrder, k)
		m.dayWeekday[k] = lt.Weekday()
	}
	d[0] += forecast
	d[1] += actual
}

// endOrigin: one origin's days as zone-day cells
func (m *mapeArm) endOrigin() {
	for _, k := range m.dayOrder {
		d, dow := m.day[k], m.dayWeekday[k]
		m.zoneDay.add(d[0], d[1])
		accOf(m.byZone, k.zone).add(d[0], d[1])
		m.byDow[dow].add(d[0], d[1])
		accOf(m.byZoneDow, zoneDow{k.zone, dow}).add(d[0], d[1])
	}
	m.day, m.dayOrder, m.dayWeekday = nil, nil, nil
}

func dowLabel(d time.Weekday) string { return d.String()[:3] }

func (m *mapeArm) report() *MAPEReport {
	out := &MAPEReport{ZoneDay: m.zoneDay.metrics(), ZoneHour: m.zoneHour.metrics(),
		ByZone: []MAPERow{}, ByHour: []MAPERow{}, ByDayOfWeek: []MAPERow{}, ByZoneHour: []MAPERow{}, ByZoneDayOfWeek: []MAPERow{}}
	ids := make([]string, 0, len(m.byZone))
	for z := range m.byZone {
		ids = append(ids, z)
	}
	sort.Strings(ids)
	for _, z := range ids {
		out.ByZone = append(out.ByZone, MAPERow{ZoneID: z, MAPEMetrics: m.byZone[z].metrics()})
	}
	for h := 0; h < 24; h++ {
		hh := h
		out.ByHour = append(out.ByHour, MAPERow{Hour: &hh, MAPEMetrics: m.byHour[h].metrics()})
	}
	for d := time.Sunday; d <= time.Saturday; d++ {
		out.ByDayOfWeek = append(out.ByDayOfWeek, MAPERow{DayOfWeek: dowLabel(d), MAPEMetrics: m.byDow[d].metrics()})
	}
	zs := map[string]bool{}
	for k := range m.byZoneHour {
		zs[k.zone] = true
	}
	hz := make([]string, 0, len(zs))
	for z := range zs {
		hz = append(hz, z)
	}
	sort.Strings(hz)
	for _, z := range hz {
		for h := 0; h < 24; h++ {
			if a := m.byZoneHour[zoneHour{z, h}]; a != nil {
				hh := h
				out.ByZoneHour = append(out.ByZoneHour, MAPERow{ZoneID: z, Hour: &hh, MAPEMetrics: a.metrics()})
			}
		}
	}
	for _, z := range ids {
		for d := time.Sunday; d <= time.Saturday; d++ {
			if a := m.byZoneDow[zoneDow{z, d}]; a != nil {
				out.ByZoneDayOfWeek = append(out.ByZoneDayOfWeek, MAPERow{ZoneID: z, DayOfWeek: dowLabel(d), MAPEMetrics: a.metrics()})
			}
		}
	}
	return out
}

// CheckSpec judges an arm's zone x day MAPE.
func CheckSpec(a ForecastArm, illustrative bool) *SpecCheck {
	s := &SpecCheck{Arm: a.Name, Grain: specGrainLabel, Target: SpecMAPETarget, Illustrative: illustrative, Result: SpecNoValue}
	if a.MAPE != nil {
		s.MAPE = a.MAPE.ZoneDay.MAPE
	}
	switch {
	case s.MAPE == nil:
	case *s.MAPE <= SpecMAPETarget+1e-9:
		s.Result = SpecMeets
	default:
		s.Result = SpecNotMet
	}
	s.Note = "informational; the gate is unchanged"
	if illustrative {
		s.Note = "ILLUSTRATIVE: synthetic data, not a measured accuracy; " + s.Note
	}
	return s
}

// Line is the report's spec check sentence.
func (s *SpecCheck) Line() string {
	verdict := map[string]string{SpecMeets: "MEETS", SpecNotMet: "DOES NOT MEET", SpecNoValue: "NO VALUE"}[s.Result]
	l := fmt.Sprintf("Spec target MAPE <= %s (%s, rolling window): %s -> %s (%s)", pct(s.Target), s.Grain, wapeP(s.MAPE), verdict, s.Arm)
	if s.Illustrative {
		l = "ILLUSTRATIVE " + l + "; synthetic data, not a measured accuracy"
	}
	return l
}
