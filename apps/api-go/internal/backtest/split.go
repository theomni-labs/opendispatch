// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"math"
	"sort"
	"time"
)

// SplitNote: how the split is scored
const SplitNote = "field and remote cases scored apart: actual field = cases with handling field (stored at arrival), remote = the rest; forecast field = field_expected, remote = expected minus field. Baselines use the field share of their own training history per sub-zone. Share error = forecast minus actual field share per zone and day, in percentage points. The gate stays on the total"

// SplitGrains: one case kind at both grains
type SplitGrains struct {
	Quarter  GrainMetrics `json:"quarter_hour"`
	HalfHour GrainMetrics `json:"half_hour"`
}

// ShareError: field share forecast against actual
type ShareError struct {
	ZoneID        string   `json:"zone_id,omitempty"`
	Days          int      `json:"zone_days"`
	ForecastShare *float64 `json:"forecast_share"`
	ActualShare   *float64 `json:"actual_share"`
	MAEPoints     float64  `json:"mae_points"`
	BiasPoints    float64  `json:"bias_points"`
}

// SplitMetrics: one method's field and remote scores
type SplitMetrics struct {
	Field        SplitGrains  `json:"field"`
	Remote       SplitGrains  `json:"remote"`
	ShareByZone  []ShareError `json:"share_by_zone"`
	ShareOverall ShareError   `json:"share_overall"`
}

type shareAcc struct {
	days                     int
	abs, bias                float64
	predField, predTotal     float64
	actualField, actualTotal float64
}

func (s *shareAcc) addDay(pf, pt, af, at float64) {
	s.predField += pf
	s.predTotal += pt
	s.actualField += af
	s.actualTotal += at
	if pt <= 0 || at <= 0 {
		return
	}
	d := (pf/pt - af/at) * 100
	s.days++
	s.abs += math.Abs(d)
	s.bias += d
}

func (s *shareAcc) metrics(zone string) ShareError {
	out := ShareError{ZoneID: zone, Days: s.days}
	if s.predTotal > 0 {
		out.ForecastShare = ptr(round(s.predField/s.predTotal, 4))
	}
	if s.actualTotal > 0 {
		out.ActualShare = ptr(round(s.actualField/s.actualTotal, 4))
	}
	if s.days > 0 {
		out.MAEPoints = round(s.abs/float64(s.days), 2)
		out.BiasPoints = round(s.bias/float64(s.days), 2)
	}
	return out
}

type splitAcc struct {
	used           bool
	fq, fh, rq, rh gacc
	byZone         map[string]*shareAcc
	overall        shareAcc
}

func (a *splitAcc) metrics() *SplitMetrics {
	if !a.used {
		return nil
	}
	out := &SplitMetrics{
		Field:        SplitGrains{Quarter: a.fq.grain(), HalfHour: a.fh.grain()},
		Remote:       SplitGrains{Quarter: a.rq.grain(), HalfHour: a.rh.grain()},
		ShareByZone:  []ShareError{},
		ShareOverall: a.overall.metrics(""),
	}
	ids := make([]string, 0, len(a.byZone))
	for z := range a.byZone {
		ids = append(ids, z)
	}
	sort.Strings(ids)
	for _, z := range ids {
		out.ShareByZone = append(out.ShareByZone, a.byZone[z].metrics(z))
	}
	return out
}

// hasSplit: a value carries a field forecast
func hasSplit(vs []ForecastValue) bool {
	for _, v := range vs {
		if v.HasField {
			return true
		}
	}
	return false
}

// sumFieldAt: field_expected per cell
func sumFieldAt(vs []ForecastValue, from, to time.Time, step time.Duration) map[halfCell]float64 {
	m := map[halfCell]float64{}
	for _, v := range vs {
		if v.HasField && !v.Start.Before(from) && v.Start.Before(to) {
			m[halfCell{v.ZoneID, v.Start.Truncate(step).Unix()}] += v.Field
		}
	}
	return m
}

// score adds one origin's field and remote cells.
func (a *splitAcc) score(vs []ForecastValue, origin, end time.Time, zones []ZoneSpec, total15, field15 map[halfCell]float64) {
	if !hasSplit(vs) {
		return
	}
	a.used = true
	if a.byZone == nil {
		a.byZone = map[string]*shareAcc{}
	}
	pt, pf := sumAt(vs, origin, end, 15*time.Minute), sumFieldAt(vs, origin, end, 15*time.Minute)
	pt30, pf30 := sumAt(vs, origin, end, 30*time.Minute), sumFieldAt(vs, origin, end, 30*time.Minute)
	for _, z := range zones {
		zs := a.byZone[z.ZoneID]
		if zs == nil {
			zs = &shareAcc{}
			a.byZone[z.ZoneID] = zs
		}
		for day := origin; day.Before(end); day = addDays(day, 1) {
			var dpf, dpt, daf, dat float64
			stop := addDays(day, 1)
			for t := day; t.Before(stop) && t.Before(end); t = t.Add(15 * time.Minute) {
				k := halfCell{z.ZoneID, t.Unix()}
				ff, ft, af, at := pf[k], pt[k], field15[k], total15[k]
				a.fq.add(ff, af)
				a.rq.add(ft-ff, at-af)
				dpf, dpt, daf, dat = dpf+ff, dpt+ft, daf+af, dat+at
			}
			zs.addDay(dpf, dpt, daf, dat)
			a.overall.addDay(dpf, dpt, daf, dat)
		}
		for t := origin; t.Before(end); t = t.Add(30 * time.Minute) {
			k := halfCell{z.ZoneID, t.Unix()}
			k2 := halfCell{z.ZoneID, t.Add(15 * time.Minute).Unix()}
			af, at := field15[k]+field15[k2], total15[k]+total15[k2]
			a.fh.add(pf30[k], af)
			a.rh.add(pt30[k]-pf30[k], at-af)
		}
	}
}

// fieldShares: field share per sub-zone
func fieldShares(h []HistoryRecord) map[string]float64 {
	field, total := map[string]float64{}, map[string]float64{}
	for _, r := range h {
		field[r.SubZoneID] += float64(r.Field)
		total[r.SubZoneID] += float64(r.Total)
	}
	out := make(map[string]float64, len(total))
	for s, t := range total {
		if t > 0 {
			out[s] = field[s] / t
		}
	}
	return out
}
