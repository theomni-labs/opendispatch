// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

const intervalsPerDay = 96

type ZoneSpec struct {
	ZoneID   string
	SubZones []string
}

type HistoryRecord struct {
	SubZoneID string
	Start     time.Time
	Total     int
	Field     int
}

type ForecastRequest struct {
	Origin   time.Time
	Days     int
	Zones    []ZoneSpec
	History  []HistoryRecord
	Coverage float64
}

type ForecastValue struct {
	ZoneID    string
	SubZoneID string
	Start     time.Time
	Low       float64
	Expected  float64
	High      float64
	// Field is field_expected, set when HasField
	Field    float64
	HasField bool
}

// Forecaster sees history before Origin only.
type Forecaster func(context.Context, ForecastRequest) ([]ForecastValue, error)

type ForecastConfig struct {
	Horizon        int
	MinHistoryDays int
	Coverage       float64
	Candidate      Forecaster
	CandidateName  string
	Baseline       Forecaster
	BaselineName   string
	// HeldOutDays: score only the last days (0: all)
	HeldOutDays int
	Calendar    forecastcal.Config
	WeakestN    int
	Gate        *GateOptions
	// OriginStepDays: 0 means every day
	OriginStepDays int
	// Segmenter adds the customer's segment-average arm (nil: none)
	Segmenter Segmenter
	// GateBaseline: naive (default) or segment
	GateBaseline string
	// GatePoint: median (default) or expected
	GatePoint string
	// Blend: reshape the candidate toward the segment
	Blend *ShapeBlend
}

// EngineCalls: request size, trim and time.
type EngineCalls struct {
	Requests           int     `json:"requests"`
	MeanMs             float64 `json:"mean_ms_per_origin"`
	MaxMs              float64 `json:"max_ms"`
	MaxRecords         int     `json:"max_records_sent"`
	MaxAggregated      int     `json:"max_aggregated_sent,omitempty"`
	TrimmedRequests    int     `json:"requests_trimmed_to_cap"`
	HistoryDaysAsked   int     `json:"history_days_before_trim"`
	HistoryDaysSentMin int     `json:"history_days_sent_min"`
}

type Metrics struct {
	Cells       int      `json:"cells"`
	MAE         float64  `json:"mae"`
	RMSE        float64  `json:"rmse"`
	WAPE        *float64 `json:"wape"`
	Coverage    float64  `json:"range_coverage"`
	ActualTotal float64  `json:"actual_total"`
}

type ZoneMetrics struct {
	ZoneID string `json:"zone_id"`
	Metrics
}

type ForecastArm struct {
	Name    string        `json:"name"`
	Overall Metrics       `json:"overall"`
	ByZone  []ZoneMetrics `json:"by_zone"`

	ByHour       []HourMetrics     `json:"by_hour"`
	ByZoneHour   []ZoneHourMetrics `json:"by_zone_hour"`
	EventDays    Metrics           `json:"event_days"`
	OrdinaryDays Metrics           `json:"ordinary_days"`

	// ByHalfHour: the 48 windows, 06:00 first
	ByHalfHour []HalfHourMetrics `json:"by_half_hour,omitempty"`
	// Grains: 15-minute and half-hour scores together
	Grains *Grains `json:"grains,omitempty"`
	// Split: field and remote scored apart
	Split *SplitMetrics `json:"split,omitempty"`
	// MAPE: zone x day and zone x hour, with WAPE
	MAPE *MAPEReport `json:"mape,omitempty"`
}

type ForecastReport struct {
	Level          string       `json:"level"`
	HorizonDays    int          `json:"horizon_days"`
	MinHistoryDays int          `json:"min_history_days"`
	Origins        int          `json:"origins"`
	FirstOrigin    string       `json:"first_origin"`
	LastOrigin     string       `json:"last_origin"`
	RangeTarget    float64      `json:"range_target"`
	RangeNote      string       `json:"range_note"`
	Baseline       ForecastArm  `json:"baseline"`
	Candidate      *ForecastArm `json:"candidate,omitempty"`
	// CandidateMedian: the candidate scored by its median
	CandidateMedian *ForecastArm `json:"candidate_median,omitempty"`
	// SegmentBaseline: The customer's current method
	SegmentBaseline *ForecastArm  `json:"segment_baseline,omitempty"`
	Staffing        []StaffingArm `json:"staffing,omitempty"`
	StaffingNote    string        `json:"staffing_note,omitempty"`
	// StaffingHalfHour: all zones, per window
	StaffingHalfHour     []StaffingArm `json:"staffing_half_hour,omitempty"`
	StaffingHalfHourNote string        `json:"staffing_half_hour_note,omitempty"`
	HalfHourNote         string        `json:"half_hour_note,omitempty"`
	SplitNote            string        `json:"split_note,omitempty"`
	MAPENote             string        `json:"mape_note,omitempty"`
	// SpecCheck: informational, not the gate
	SpecCheck *SpecCheck `json:"spec_check,omitempty"`
	// Blend: how the candidate met the segment shape
	Blend     *ShapeBlend `json:"blend,omitempty"`
	BlendNote string      `json:"blend_note,omitempty"`

	ModelVersion string     `json:"model_version,omitempty"`
	ModelInfo    *ModelInfo `json:"model_info,omitempty"`
	// MaxRequestBytes: the largest request sent to the engine.
	MaxRequestBytes int `json:"max_request_bytes,omitempty"`
	// MaxWireBytes: that request after gzip
	MaxWireBytes int `json:"max_request_wire_bytes,omitempty"`
	// Calls: what the engine was sent
	Calls *EngineCalls `json:"engine_calls,omitempty"`

	HeldOut  HeldOut  `json:"held_out"`
	Gate     *Gate    `json:"gate,omitempty"`
	Weakest  *Weakest `json:"weakest,omitempty"`
	Warnings []string `json:"warnings"`
}

type acc struct {
	n, in        int
	abs, act, sq float64
}

func (a *acc) add(exp, low, high, actual float64) {
	a.n++
	a.abs += math.Abs(exp - actual)
	a.sq += (exp - actual) * (exp - actual)
	a.act += actual
	if actual >= low-1e-9 && actual <= high+1e-9 {
		a.in++
	}
}

func (a *acc) metrics() Metrics {
	m := Metrics{Cells: a.n, ActualTotal: round(a.act, 2)}
	if a.n == 0 {
		return m
	}
	m.MAE = round(a.abs/float64(a.n), 4)
	m.RMSE = round(math.Sqrt(a.sq/float64(a.n)), 4)
	m.Coverage = round(float64(a.in)/float64(a.n), 4)
	if a.act > 0 {
		w := round(a.abs/a.act, 4)
		m.WAPE = &w
	}
	return m
}

type zoneHour struct {
	zone string
	hour int
}

type armAcc struct {
	all        acc
	byZone     map[string]*acc
	byHour     map[int]*acc
	byZoneHour map[zoneHour]*acc
	event      acc
	ordinary   acc
	grain      grainAcc
	split      splitAcc
	mape       *mapeArm
}

func newArmAcc() *armAcc {
	return &armAcc{byZone: map[string]*acc{}, byHour: map[int]*acc{}, byZoneHour: map[zoneHour]*acc{}, mape: newMAPEArm()}
}

func (a *armAcc) add(zone string, hour int, isEvent bool, exp, low, high, actual float64) {
	a.all.add(exp, low, high, actual)
	if isEvent {
		a.event.add(exp, low, high, actual)
	} else {
		a.ordinary.add(exp, low, high, actual)
	}
	z := a.byZone[zone]
	if z == nil {
		z = &acc{}
		a.byZone[zone] = z
	}
	z.add(exp, low, high, actual)
	h := a.byHour[hour]
	if h == nil {
		h = &acc{}
		a.byHour[hour] = h
	}
	h.add(exp, low, high, actual)
	k := zoneHour{zone, hour}
	zh := a.byZoneHour[k]
	if zh == nil {
		zh = &acc{}
		a.byZoneHour[k] = zh
	}
	zh.add(exp, low, high, actual)
}

func (a *armAcc) arm(name string) ForecastArm {
	out := ForecastArm{ByHalfHour: a.grain.windows(), Grains: a.grain.grains(), Split: a.split.metrics(), Name: name, Overall: a.all.metrics(), ByZone: []ZoneMetrics{}, ByHour: []HourMetrics{}, ByZoneHour: []ZoneHourMetrics{},
		EventDays: a.event.metrics(), OrdinaryDays: a.ordinary.metrics(), MAPE: a.mape.report()}
	ids := make([]string, 0, len(a.byZone))
	for z := range a.byZone {
		ids = append(ids, z)
	}
	sort.Strings(ids)
	for _, z := range ids {
		out.ByZone = append(out.ByZone, ZoneMetrics{ZoneID: z, Metrics: a.byZone[z].metrics()})
	}
	for h := 0; h < 24; h++ {
		if x := a.byHour[h]; x != nil {
			out.ByHour = append(out.ByHour, HourMetrics{Hour: h, Metrics: x.metrics()})
		}
	}
	for _, z := range ids {
		for h := 0; h < 24; h++ {
			if x := a.byZoneHour[zoneHour{z, h}]; x != nil {
				out.ByZoneHour = append(out.ByZoneHour, ZoneHourMetrics{ZoneID: z, Hour: h, Metrics: x.metrics()})
			}
		}
	}
	return out
}

func buildHistory(cases []Case) []HistoryRecord {
	type key struct {
		sub string
		t   int64
	}
	idx := map[key]*HistoryRecord{}
	for _, c := range cases {
		st := c.RegisteredAt.In(loc).Truncate(15 * time.Minute)
		k := key{c.subZone(), st.Unix()}
		r := idx[k]
		if r == nil {
			r = &HistoryRecord{SubZoneID: k.sub, Start: st}
			idx[k] = r
		}
		r.Total++
		if c.Handling == "field" {
			r.Field++
		}
	}
	out := make([]HistoryRecord, 0, len(idx))
	for _, r := range idx {
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].Start.Equal(out[j].Start) {
			return out[i].Start.Before(out[j].Start)
		}
		return out[i].SubZoneID < out[j].SubZoneID
	})
	return out
}

func zoneSpecs(ds *Dataset) []ZoneSpec {
	ids := make([]string, 0, len(ds.ZoneSubs))
	for z := range ds.ZoneSubs {
		ids = append(ids, z)
	}
	sort.Strings(ids)
	out := make([]ZoneSpec, 0, len(ids))
	for _, z := range ids {
		out = append(out, ZoneSpec{ZoneID: z, SubZones: ds.ZoneSubs[z]})
	}
	return out
}

// ErrNoOrigin: no origin has enough history and a full horizon.
var ErrNoOrigin = errors.New("no origin has enough history and a full horizon")

// RunForecast scores rolling origins by day.
func RunForecast(ctx context.Context, ds *Dataset, cfg ForecastConfig) (*ForecastReport, error) {
	if cfg.Horizon < 1 {
		cfg.Horizon = 1
	}
	if cfg.MinHistoryDays < 1 {
		cfg.MinHistoryDays = 7
	}
	if cfg.Coverage <= 0 || cfg.Coverage >= 1 {
		cfg.Coverage = 0.8
	}
	if cfg.Baseline == nil {
		cfg.Baseline, cfg.BaselineName = SeasonalNaive, "seasonal-naive-same-hour-last-week"
	}
	blend := cfg.Blend != nil && cfg.Candidate != nil && cfg.Segmenter != nil
	if blend {
		cfg.Candidate = Blended(cfg.Candidate, cfg.Segmenter, cfg.Calendar, *cfg.Blend)
	}
	hist := ds.Intervals
	if hist == nil {
		hist = buildHistory(ds.Cases)
	}
	daySet := map[int64]time.Time{}
	for _, h := range hist {
		d := localDay(h.Start)
		daySet[d.Unix()] = d
	}
	days := make([]time.Time, 0, len(daySet))
	for _, d := range daySet {
		days = append(days, d)
	}
	sort.Slice(days, func(i, j int) bool { return days[i].Before(days[j]) })
	zones := zoneSpecs(ds)
	subZone := map[string]string{}
	for _, z := range zones {
		for _, s := range z.SubZones {
			subZone[s] = z.ZoneID
		}
	}
	type cell struct {
		zone string
		t    int64
	}
	actual := map[cell]float64{}
	for _, h := range hist {
		actual[cell{subZone[h.SubZoneID], h.Start.Truncate(time.Hour).Unix()}] += float64(h.Total)
	}
	actual30 := map[cell]float64{}
	actual15 := map[halfCell]float64{}
	actualField15 := map[halfCell]float64{}
	for _, h := range hist {
		actualField15[halfCell{subZone[h.SubZoneID], h.Start.Truncate(15 * time.Minute).Unix()}] += float64(h.Field)
		actual30[cell{subZone[h.SubZoneID], h.Start.Truncate(30 * time.Minute).Unix()}] += float64(h.Total)
		actual15[halfCell{subZone[h.SubZoneID], h.Start.Truncate(15 * time.Minute).Unix()}] += float64(h.Total)
	}
	base, cand, segArm, candMed := newArmAcc(), newArmAcc(), newArmAcc(), newArmAcc()
	var baseStaff, candStaff, segStaff staffAcc
	var baseAll, candAll, segAll staffAcc
	rep := &ForecastReport{
		Level: "zone x hour", HorizonDays: cfg.Horizon, MinHistoryDays: cfg.MinHistoryDays,
		RangeTarget: cfg.Coverage,
		RangeNote:   "zone-hour range is the sum of sub-zone interval ranges, so it is wider than a true range",
	}
	if blend {
		b := *cfg.Blend
		rep.Blend, rep.BlendNote = &b, b.Note()
	}
	events := map[string]bool{}
	scored := map[string]bool{}
	var firstOrigin time.Time
	firstIdx := -1
	for i, origin := range days {
		if i < cfg.MinHistoryDays || (cfg.HeldOutDays > 0 && i < len(days)-cfg.HeldOutDays) {
			continue
		}
		if firstIdx < 0 {
			firstIdx = i
		}
		if cfg.OriginStepDays > 1 && (i-firstIdx)%cfg.OriginStepDays != 0 {
			continue
		}
		last := addDays(origin, cfg.Horizon-1)
		if last.After(days[len(days)-1]) {
			break
		}
		n := sort.Search(len(hist), func(k int) bool { return !hist[k].Start.Before(origin) })
		req := ForecastRequest{Origin: origin, Days: cfg.Horizon, Zones: zones, History: hist[:n], Coverage: cfg.Coverage}
		bv, err := cfg.Baseline(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("baseline at %s: %w", origin.Format("2006-01-02"), err)
		}
		var cv []ForecastValue
		if cfg.Candidate != nil {
			if cv, err = cfg.Candidate(ctx, req); err != nil {
				return nil, fmt.Errorf("candidate at %s: %w", origin.Format("2006-01-02"), err)
			}
		}
		var sv []ForecastValue
		if cfg.Segmenter != nil {
			if sv, err = SegmentAverage(cfg.Segmenter)(ctx, req); err != nil {
				return nil, fmt.Errorf("segment average at %s: %w", origin.Format("2006-01-02"), err)
			}
		}
		end := addDays(origin, cfg.Horizon)
		for d := 0; d < cfg.Horizon; d++ {
			date := addDays(origin, d).Format("2006-01-02")
			scored[date] = true
			if _, ok := events[date]; !ok {
				events[date] = cfg.Calendar.For(date).IsEvent()
			}
		}
		type sum struct{ e, l, h float64 }
		agg := func(vs []ForecastValue) map[cell]*sum {
			m := map[cell]*sum{}
			for _, v := range vs {
				if v.Start.Before(origin) || !v.Start.Before(end) {
					continue
				}
				k := cell{v.ZoneID, v.Start.Truncate(time.Hour).Unix()}
				if m[k] == nil {
					m[k] = &sum{}
				}
				m[k].e += v.Expected
				m[k].l += v.Low
				m[k].h += v.High
			}
			return m
		}
		bm, cm, sm := agg(bv), agg(cv), agg(sv)
		half := func(vs []ForecastValue) map[cell]float64 {
			m := map[cell]float64{}
			for _, v := range vs {
				if !v.Start.Before(origin) && v.Start.Before(end) {
					m[cell{v.ZoneID, v.Start.Truncate(30 * time.Minute).Unix()}] += v.Expected
				}
			}
			return m
		}
		bh, ch, sh := half(bv), half(cv), half(sv)
		// a nil staff: grains only, by point
		scoreGrains := func(a *armAcc, vs []ForecastValue, staff *staffAcc, point func(float64) float64) {
			q, h := sumAt(vs, origin, end, 15*time.Minute), sumAt(vs, origin, end, 30*time.Minute)
			if staff != nil {
				a.split.score(vs, origin, end, zones, actual15, actualField15)
			}
			for _, z := range zones {
				for t := origin; t.Before(end); t = t.Add(15 * time.Minute) {
					k := halfCell{z.ZoneID, t.Unix()}
					a.grain.addQuarter(point(q[k]), actual15[k])
				}
				for t := origin; t.Before(end); t = t.Add(30 * time.Minute) {
					k := halfCell{z.ZoneID, t.Unix()}
					a.grain.addHalf(t, point(h[k]), actual15[k]+actual15[halfCell{z.ZoneID, t.Add(15 * time.Minute).Unix()}])
				}
			}
			if staff == nil {
				return
			}
			for t := origin; t.Before(end); t = t.Add(30 * time.Minute) {
				var f, act float64
				for _, z := range zones {
					f += h[halfCell{z.ZoneID, t.Unix()}]
					act += actual15[halfCell{z.ZoneID, t.Unix()}] + actual15[halfCell{z.ZoneID, t.Add(15 * time.Minute).Unix()}]
				}
				staff.add(f, act)
			}
		}
		same := func(v float64) float64 { return v }
		scoreGrains(base, bv, &baseAll, same)
		if cfg.Candidate != nil {
			scoreGrains(cand, cv, &candAll, same)
			scoreGrains(candMed, cv, nil, poissonMedian)
		}
		if cfg.Segmenter != nil {
			scoreGrains(segArm, sv, &segAll, same)
		}
		for _, z := range zones {
			for t := origin; t.Before(end); t = t.Add(30 * time.Minute) {
				k := cell{z.ZoneID, t.Unix()}
				baseStaff.add(bh[k], actual30[k])
				if cfg.Candidate != nil {
					candStaff.add(ch[k], actual30[k])
				}
				if cfg.Segmenter != nil {
					segStaff.add(sh[k], actual30[k])
				}
			}
		}
		for _, z := range zones {
			for t := origin; t.Before(end); t = t.Add(time.Hour) {
				k := cell{z.ZoneID, t.Unix()}
				hour, isEvent := t.In(loc).Hour(), events[t.In(loc).Format("2006-01-02")]
				a := actual[k]
				b := bm[k]
				if b == nil {
					b = &sum{}
				}
				base.add(z.ZoneID, hour, isEvent, b.e, b.l, b.h, a)
				base.mape.addHour(z.ZoneID, t, b.e, a)
				if cfg.Segmenter != nil {
					c := sm[k]
					if c == nil {
						c = &sum{}
					}
					segArm.add(z.ZoneID, hour, isEvent, c.e, c.l, c.h, a)
					segArm.mape.addHour(z.ZoneID, t, c.e, a)
				}
				if cfg.Candidate != nil {
					c := cm[k]
					if c == nil {
						c = &sum{}
					}
					cand.add(z.ZoneID, hour, isEvent, c.e, c.l, c.h, a)
					cand.mape.addHour(z.ZoneID, t, c.e, a)
					candMed.add(z.ZoneID, hour, isEvent, poissonMedian(c.e), c.l, c.h, a)
				}
			}
		}
		for _, x := range []*armAcc{base, cand, segArm} {
			x.mape.endOrigin()
		}
		rep.Origins++
		if rep.FirstOrigin == "" {
			firstOrigin = origin
			rep.FirstOrigin = origin.Format("2006-01-02")
		}
		rep.LastOrigin = origin.Format("2006-01-02")
	}
	if rep.Origins == 0 {
		return nil, fmt.Errorf("%w: lower min history or horizon", ErrNoOrigin)
	}
	rep.Baseline = base.arm(cfg.BaselineName)
	rep.Staffing = []StaffingArm{baseStaff.arm(cfg.BaselineName)}
	if cfg.Candidate != nil {
		a := cand.arm(cfg.CandidateName)
		rep.Candidate = &a
		rep.Staffing = append([]StaffingArm{candStaff.arm(cfg.CandidateName)}, rep.Staffing...)
		// MAPE sums hours to days: expected only
		m := candMed.arm(cfg.CandidateName + " (median)")
		m.MAPE, m.Split = nil, nil
		rep.CandidateMedian = &m
	}
	if cfg.Segmenter != nil {
		a := segArm.arm(SegmentBaselineName)
		rep.SegmentBaseline = &a
		rep.Staffing = append(rep.Staffing, segStaff.arm(SegmentBaselineName))
	}
	rep.StaffingNote = StaffingNote
	rep.StaffingHalfHour = []StaffingArm{baseAll.arm(cfg.BaselineName)}
	if cfg.Candidate != nil {
		rep.StaffingHalfHour = append([]StaffingArm{candAll.arm(cfg.CandidateName)}, rep.StaffingHalfHour...)
	}
	if cfg.Segmenter != nil {
		rep.StaffingHalfHour = append(rep.StaffingHalfHour, segAll.arm(SegmentBaselineName))
	}
	rep.StaffingHalfHourNote, rep.HalfHourNote, rep.SplitNote = StaffingHalfHourNote, HalfHourNote, SplitNote
	if cfg.GateBaseline == GateBaselineSegment && cfg.Segmenter == nil {
		return nil, errors.New("gate baseline segment needs a segmenter")
	}
	finishForecast(rep, cfg, days[0], firstOrigin, days[len(days)-1], scored, events)
	rep.MAPENote = MAPENote
	if rep.Candidate != nil {
		rep.SpecCheck = CheckSpec(*rep.Candidate, ds.Illustrative())
	}
	return rep, nil
}

type histIndex map[string]map[int64]int

func indexHistory(h []HistoryRecord) histIndex {
	m := histIndex{}
	for _, r := range h {
		if m[r.SubZoneID] == nil {
			m[r.SubZoneID] = map[int64]int{}
		}
		m[r.SubZoneID][r.Start.Unix()] += r.Total
	}
	return m
}

func (h histIndex) at(sub string, t time.Time) float64 {
	return float64(h[sub][t.Unix()])
}

// poissonMedian: the point of least absolute error
func poissonMedian(mean float64) float64 {
	if mean <= 0 {
		return 0
	}
	if mean > 500 {
		return math.Floor(mean + 1.0/3 - 0.02/mean)
	}
	p := math.Exp(-mean)
	cdf, k := p, 0
	for cdf < 0.5 {
		k++
		p *= mean / float64(k)
		cdf += p
	}
	return float64(k)
}

// poissonRange is the central interval at cover.
func poissonRange(mean, cover float64) (float64, float64) {
	if mean <= 0 {
		return 0, 0
	}
	tail := (1 - cover) / 2
	p := math.Exp(-mean)
	cdf := p
	low, high := -1, -1
	for k := 0; k < 10000 && (low < 0 || high < 0); k++ {
		if low < 0 && cdf > tail {
			low = k
		}
		if high < 0 && cdf >= 1-tail {
			high = k
		}
		p *= mean / float64(k+1)
		cdf += p
	}
	return float64(low), float64(high)
}

func forecastEach(req ForecastRequest, mean func(h histIndex, sub string, t time.Time) float64) []ForecastValue {
	h := indexHistory(req.History)
	share := fieldShares(req.History)
	var out []ForecastValue
	for _, z := range req.Zones {
		for _, s := range z.SubZones {
			for d := 0; d < req.Days; d++ {
				day := addDays(req.Origin, d)
				for i := 0; i < intervalsPerDay; i++ {
					t := day.Add(time.Duration(i) * 15 * time.Minute)
					m := mean(h, s, t)
					lo, hi := poissonRange(m, req.Coverage)
					out = append(out, ForecastValue{ZoneID: z.ZoneID, SubZoneID: s, Start: t, Low: lo, Expected: m, High: hi, Field: m * share[s], HasField: true})
				}
			}
		}
	}
	return out
}

// SeasonalNaive repeats the same slot last week.
func SeasonalNaive(_ context.Context, req ForecastRequest) ([]ForecastValue, error) {
	return forecastEach(req, func(h histIndex, sub string, t time.Time) float64 {
		back := t
		for !back.Before(req.Origin) {
			back = addDays(back, -7)
		}
		return h.at(sub, back)
	}), nil
}

// SeasonalMean averages the slot over 4 weeks.
func SeasonalMean(_ context.Context, req ForecastRequest) ([]ForecastValue, error) {
	return forecastEach(req, func(h histIndex, sub string, t time.Time) float64 {
		back := t
		for !back.Before(req.Origin) {
			back = addDays(back, -7)
		}
		var sum float64
		for k := 0; k < 4; k++ {
			sum += h.at(sub, addDays(back, -7*k))
		}
		return sum / 4
	}), nil
}
