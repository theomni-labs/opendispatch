// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"fmt"
	"sort"
	"time"
)

const (
	GatePass             = "pass"
	GateFail             = "fail"
	GateNotEnoughHistory = "not_enough_history"

	// MinTrainingDays is 8 weeks before the first held-out origin.
	MinTrainingDays = 56
	// YearDays: the history a year of Ramadan and Eid needs.
	YearDays = 364

	DefaultWeakestN          = 10
	DefaultMinImprovement    = 0.10
	DefaultMaxWorseZoneShare = 0.25

	// GatePointMedian: the candidate's median per cell
	GatePointMedian   = "median"
	GatePointExpected = "expected"
)

// MedianNote: how the median arm is built
const MedianNote = "Poisson median of the summed expected cases in the cell; of 23 Oct 2026"

// GateOptions: the champion and challenger thresholds.
type GateOptions struct {
	MinImprovement    float64 `json:"min_improvement"`
	MaxWorseZoneShare float64 `json:"max_worse_zone_share"`
}

// DefaultGate is.
func DefaultGate() GateOptions {
	return GateOptions{MinImprovement: DefaultMinImprovement, MaxWorseZoneShare: DefaultMaxWorseZoneShare}
}

type HourMetrics struct {
	Hour int `json:"hour"`
	Metrics
}

type ZoneHourMetrics struct {
	ZoneID string `json:"zone_id"`
	Hour   int    `json:"hour"`
	Metrics
}

// HeldOut describes the scored period and what came before it.
type HeldOut struct {
	From         string `json:"from"`
	To           string `json:"to"`
	Days         int    `json:"days"`
	TrainingDays int    `json:"training_days_before_first_origin"`
	DataDays     int    `json:"data_days"`
	EventDays    int    `json:"event_days"`
}

// Gate is the verdict of the candidate against the baseline.
type Gate struct {
	Result            string   `json:"result"`
	MinImprovement    float64  `json:"min_improvement"`
	MaxWorseZoneShare float64  `json:"max_worse_zone_share"`
	BaselineWAPE      *float64 `json:"baseline_wape"`
	CandidateWAPE     *float64 `json:"candidate_wape"`
	Improvement       *float64 `json:"improvement"`
	WorseZones        int      `json:"worse_zones"`
	ComparedZones     int      `json:"compared_zones"`
	WorseZoneShare    *float64 `json:"worse_zone_share"`
	Reasons           []string `json:"reasons"`

	// BaselineName: the arm the gate compared with.
	BaselineName string `json:"baseline_name,omitempty"`
	// Point: the candidate scored by median or expected
	Point string `json:"point,omitempty"`
	// Improvement over each baseline, whichever one the gate used.
	ImprovementOverNaive   *float64 `json:"improvement_over_naive,omitempty"`
	ImprovementOverSegment *float64 `json:"improvement_over_segment,omitempty"`
}

// GateArm: the candidate as the gate scored it
func (r *ForecastReport) GateArm() *ForecastArm {
	if r.Gate != nil && r.Gate.Point == GatePointMedian && r.CandidateMedian != nil {
		return r.CandidateMedian
	}
	return r.Candidate
}

func improvement(base, cand ForecastArm) *float64 {
	if base.Overall.WAPE == nil || cand.Overall.WAPE == nil {
		return nil
	}
	if *base.Overall.WAPE <= 0 {
		return ptr(0)
	}
	return ptr(round((*base.Overall.WAPE-*cand.Overall.WAPE) / *base.Overall.WAPE, 4))
}

// WeakLocation is a zone, or a zone and hour, with its numbers.
type WeakLocation struct {
	ZoneID       string   `json:"zone_id"`
	Hour         *int     `json:"hour,omitempty"`
	Cells        int      `json:"cells"`
	ActualTotal  float64  `json:"actual_total"`
	MAE          float64  `json:"mae"`
	RMSE         float64  `json:"rmse"`
	WAPE         *float64 `json:"wape"`
	BaselineWAPE *float64 `json:"baseline_wape,omitempty"`
}

// Weakest lists the worst locations by WAPE; none are hidden.
type Weakest struct {
	Arm       string         `json:"arm"`
	N         int            `json:"n"`
	Zones     []WeakLocation `json:"zones"`
	ZoneHours []WeakLocation `json:"zone_hours"`
	Unscored  int            `json:"unscored_locations"`
}

func ptr(v float64) *float64 { return &v }

// Judge applies the gate. trainingDays is the history before the first origin.
func Judge(base, cand ForecastArm, trainingDays int, o GateOptions) Gate {
	g := Gate{MinImprovement: o.MinImprovement, MaxWorseZoneShare: o.MaxWorseZoneShare, Reasons: []string{},
		BaselineWAPE: base.Overall.WAPE, CandidateWAPE: cand.Overall.WAPE}
	bz := map[string]Metrics{}
	for _, z := range base.ByZone {
		bz[z.ZoneID] = z.Metrics
	}
	for _, z := range cand.ByZone {
		b, ok := bz[z.ZoneID]
		if !ok || b.WAPE == nil || z.WAPE == nil {
			continue
		}
		g.ComparedZones++
		if *z.WAPE > *b.WAPE {
			g.WorseZones++
		}
	}
	if g.ComparedZones > 0 {
		g.WorseZoneShare = ptr(round(float64(g.WorseZones)/float64(g.ComparedZones), 4))
	}
	if g.BaselineWAPE != nil && g.CandidateWAPE != nil {
		imp := 0.0
		if *g.BaselineWAPE > 0 {
			imp = (*g.BaselineWAPE - *g.CandidateWAPE) / *g.BaselineWAPE
		}
		g.Improvement = ptr(round(imp, 4))
	}
	if trainingDays < MinTrainingDays {
		g.Result = GateNotEnoughHistory
		g.Reasons = append(g.Reasons, fmt.Sprintf("%d day(s) of history before the first held-out origin; at least %d (8 weeks) are needed", trainingDays, MinTrainingDays))
		return g
	}
	if g.Improvement == nil {
		g.Result = GateNotEnoughHistory
		g.Reasons = append(g.Reasons, "no held-out cases to score against")
		return g
	}
	g.Result = GatePass
	if *g.Improvement < o.MinImprovement-1e-9 {
		g.Result = GateFail
		g.Reasons = append(g.Reasons, fmt.Sprintf("WAPE improvement %s is below the required %s", pct(*g.Improvement), pct(o.MinImprovement)))
	}
	if g.WorseZoneShare != nil && *g.WorseZoneShare > o.MaxWorseZoneShare+1e-9 {
		g.Result = GateFail
		g.Reasons = append(g.Reasons, fmt.Sprintf("worse than the baseline in %d of %d zones (%s); at most %s allowed", g.WorseZones, g.ComparedZones, pct(*g.WorseZoneShare), pct(o.MaxWorseZoneShare)))
	}
	if g.Result == GatePass {
		g.Reasons = append(g.Reasons, fmt.Sprintf("WAPE improvement %s, worse in %d of %d zones", pct(*g.Improvement), g.WorseZones, g.ComparedZones))
	}
	return g
}

func weakOrder(a, b WeakLocation) bool {
	if *a.WAPE != *b.WAPE {
		return *a.WAPE > *b.WAPE
	}
	if a.ActualTotal != b.ActualTotal {
		return a.ActualTotal > b.ActualTotal
	}
	if a.ZoneID != b.ZoneID {
		return a.ZoneID < b.ZoneID
	}
	ah, bh := -1, -1
	if a.Hour != nil {
		ah = *a.Hour
	}
	if b.Hour != nil {
		bh = *b.Hour
	}
	return ah < bh
}

func weakList(all []WeakLocation, n int) ([]WeakLocation, int) {
	scored := make([]WeakLocation, 0, len(all))
	for _, w := range all {
		if w.WAPE != nil {
			scored = append(scored, w)
		}
	}
	sort.SliceStable(scored, func(i, j int) bool { return weakOrder(scored[i], scored[j]) })
	if len(scored) > n {
		scored = scored[:n]
	}
	return scored, len(all) - countScored(all)
}

func countScored(all []WeakLocation) int {
	n := 0
	for _, w := range all {
		if w.WAPE != nil {
			n++
		}
	}
	return n
}

func weakOf(zone string, hour *int, m Metrics, base *Metrics) WeakLocation {
	w := WeakLocation{ZoneID: zone, Hour: hour, Cells: m.Cells, ActualTotal: m.ActualTotal, MAE: m.MAE, RMSE: m.RMSE, WAPE: m.WAPE}
	if base != nil {
		w.BaselineWAPE = base.WAPE
	}
	return w
}

// WeakestOf ranks the arm's locations; other is the arm to compare with.
func WeakestOf(arm ForecastArm, other *ForecastArm, n int) *Weakest {
	if n < 1 {
		n = DefaultWeakestN
	}
	oz := map[string]Metrics{}
	ozh := map[zoneHour]Metrics{}
	if other != nil {
		for _, z := range other.ByZone {
			oz[z.ZoneID] = z.Metrics
		}
		for _, z := range other.ByZoneHour {
			ozh[zoneHour{z.ZoneID, z.Hour}] = z.Metrics
		}
	}
	var zones, zhs []WeakLocation
	for _, z := range arm.ByZone {
		var b *Metrics
		if m, ok := oz[z.ZoneID]; ok {
			b = &m
		}
		zones = append(zones, weakOf(z.ZoneID, nil, z.Metrics, b))
	}
	for _, z := range arm.ByZoneHour {
		var b *Metrics
		if m, ok := ozh[zoneHour{z.ZoneID, z.Hour}]; ok {
			b = &m
		}
		h := z.Hour
		zhs = append(zhs, weakOf(z.ZoneID, &h, z.Metrics, b))
	}
	w := &Weakest{Arm: arm.Name, N: n}
	var u1, u2 int
	w.Zones, u1 = weakList(zones, n)
	w.ZoneHours, u2 = weakList(zhs, n)
	w.Unscored = u1 + u2
	return w
}

func dayCount(a, b time.Time) int { return int(localDay(b).Sub(localDay(a)).Hours()/24+0.5) + 1 }

func finishForecast(rep *ForecastReport, cfg ForecastConfig, firstDay, firstOrigin, lastDay time.Time, scored, events map[string]bool) {
	dates := make([]string, 0, len(scored))
	nEvents := 0
	for d := range scored {
		dates = append(dates, d)
		if events[d] {
			nEvents++
		}
	}
	sort.Strings(dates)
	rep.HeldOut = HeldOut{From: dates[0], To: dates[len(dates)-1], Days: len(dates), EventDays: nEvents,
		TrainingDays: dayCount(firstDay, firstOrigin) - 1, DataDays: dayCount(firstDay, lastDay)}
	rep.Warnings = []string{}
	if rep.HeldOut.DataDays < YearDays {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("Only %d day(s) of history, under 52 weeks: Ramadan, Eid and other yearly effects cannot be judged.", rep.HeldOut.DataDays))
	}
	if nEvents == 0 {
		rep.Warnings = append(rep.Warnings, "No event day in the held-out period: the event-day figures are empty.")
	}
	opts := DefaultGate()
	if cfg.Gate != nil {
		opts = *cfg.Gate
	}
	arm, other := rep.Baseline, (*ForecastArm)(nil)
	if rep.Candidate != nil {
		gb := &rep.Baseline
		if cfg.GateBaseline == GateBaselineSegment && rep.SegmentBaseline != nil {
			gb = rep.SegmentBaseline
		}
		cand, point := rep.Candidate, GatePointExpected
		if cfg.GatePoint != GatePointExpected && rep.CandidateMedian != nil {
			cand, point = rep.CandidateMedian, GatePointMedian
		}
		g := Judge(*gb, *cand, rep.HeldOut.TrainingDays, opts)
		g.BaselineName, g.Point = gb.Name, point
		g.ImprovementOverNaive = improvement(rep.Baseline, *cand)
		if rep.SegmentBaseline != nil {
			g.ImprovementOverSegment = improvement(*rep.SegmentBaseline, *cand)
		}
		rep.Gate = &g
		arm, other = *cand, gb
		if g.Result == GateNotEnoughHistory {
			rep.Warnings = append(rep.Warnings, "Not enough history for a verdict: "+g.Reasons[0]+".")
		}
	}
	rep.Weakest = WeakestOf(arm, other, cfg.WeakestN)
}
