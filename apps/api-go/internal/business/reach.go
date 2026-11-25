// SPDX-License-Identifier: AGPL-3.0-only

// Service-level reach in time.
package business

import (
	"context"
	"log"
	"math"
	"time"
)

const quartersPerDay = 96

// reachInputs: what one request reads once.
type reachInputs struct {
	tenant    string
	model     travelModel
	threshold int
	runID     string
	index     *StoredIndex
}

func newReachInputs(ctx context.Context, tenant string) *reachInputs {
	in := &reachInputs{tenant: tenant, model: getTravelModel(ctx, tenant), threshold: getTenMinuteThresholdSeconds(ctx, tenant)}
	run, err := loadLatestForecastRun(ctx, tenant, false)
	if err == nil && run != nil {
		in.runID = run.ID
		in.index, err = indexStored(ctx, tenant)
	}
	if err != nil {
		log.Printf("reach: no forecast weights, equal per sub-zone: %v", err)
		in.index = nil
	}
	return in
}

// radius: straight metres reached in the threshold.
func (in *reachInputs) radius() float64 { return in.model.reachMetres(in.threshold) }

// demand: field demand by sub-zone, per day and quarter.
func (in *reachInputs) demand(zoneID, date string) (map[string]float64, []map[string]float64) {
	day := map[string]float64{}
	quarters := make([]map[string]float64, quartersPerDay)
	if in.index == nil {
		return day, quarters
	}
	rows, err := in.index.Rows(in.runID, zoneID, date)
	if err != nil {
		log.Printf("reach: forecast rows: %v", err)
		return day, quarters
	}
	base, err := time.Parse(time.RFC3339, date+"T00:00:00+03:00")
	if err != nil {
		return day, quarters
	}
	idx := make([]int, len(rows))
	seen := map[int]bool{}
	for i, r := range rows {
		idx[i] = quarterIndex(r.IntervalStart, base)
		seen[idx[i]] = true
	}
	step := quarterStep(seen)
	for i, r := range rows {
		if r.FieldExpected <= 0 {
			continue
		}
		day[r.SubZoneID] += r.FieldExpected
		for q := idx[i]; q < idx[i]+step; q++ {
			if q < 0 || q >= quartersPerDay {
				continue
			}
			if quarters[q] == nil {
				quarters[q] = map[string]float64{}
			}
			quarters[q][r.SubZoneID] += r.FieldExpected / float64(step)
		}
	}
	return day, quarters
}

// quarterStep: the rows' spacing (hourly rows: 4).
func quarterStep(seen map[int]bool) int {
	step := 0
	prev := -1
	for q := 0; q < quartersPerDay; q++ {
		if !seen[q] {
			continue
		}
		if prev >= 0 && (step == 0 || q-prev < step) {
			step = q - prev
		}
		prev = q
	}
	if step < 1 {
		return 1
	}
	return step
}

// reachShare: weighted share of sub-zones reached.
func reachShare(subs []standbySubZone, staffed []standbyPoint, weights map[string]float64, radius float64) *float64 {
	if len(subs) == 0 {
		return nil
	}
	total, reached := 0.0, 0.0
	equal := true
	for _, s := range subs {
		if weights[s.ID] > 0 {
			equal = false
		}
	}
	for _, s := range subs {
		w := weights[s.ID]
		if equal {
			w = 1
		}
		total += w
		for _, p := range staffed {
			if distanceMeters(p.Latitude, p.Longitude, s.Latitude, s.Longitude) <= radius {
				reached += w
				break
			}
		}
	}
	if total <= 0 {
		return nil
	}
	v := math.Round(reached/total*10000) / 10000
	return &v
}

// staffedByQuarter: points with someone on duty.
func staffedByQuarter(lines []RosterAssignment, date string) []map[string]bool {
	out := make([]map[string]bool, quartersPerDay)
	base, err := time.Parse(time.RFC3339, date+"T00:00:00+03:00")
	if err != nil {
		return out
	}
	for _, l := range lines {
		if l.StandbyPointID == nil {
			continue
		}
		away := map[int]bool{}
		if l.BreakStartAt != nil && l.BreakEndAt != nil {
			for q := quarterIndex(*l.BreakStartAt, base); q < quarterIndex(*l.BreakEndAt, base); q++ {
				away[q] = true
			}
		}
		for q := max(0, quarterIndex(l.StartAt, base)); q < min(quartersPerDay, quarterIndex(l.EndAt, base)); q++ {
			if away[q] {
				continue
			}
			if out[q] == nil {
				out[q] = map[string]bool{}
			}
			out[q][*l.StandbyPointID] = true
		}
	}
	return out
}

// addReach sets reach_share on a zone's cells.
func addReach(ctx context.Context, in *reachInputs, cells []GapCell, zoneID, date string, lines []RosterAssignment) []GapCell {
	d, err := loadStandby(ctx, in.tenant, zoneID)
	if err != nil {
		log.Printf("reach: standby data: %v", err)
		return cells
	}
	subs, points := d.subZonesOf(zoneID), d.activePoints(zoneID)
	if len(subs) == 0 {
		return cells
	}
	_, quarters := in.demand(zoneID, date)
	forecast := false
	for _, q := range quarters {
		if len(q) > 0 {
			forecast = true
		}
	}
	staffed := staffedByQuarter(lines, date)
	for i := range cells {
		q := cells[i].IntervalIndex
		if q < 0 || q >= quartersPerDay || cells[i].ZoneID != zoneID || (forecast && len(quarters[q]) == 0) {
			continue
		}
		var on []standbyPoint
		for _, p := range points {
			if staffed[q][p.ID] {
				on = append(on, p)
			}
		}
		cells[i].ReachShare = reachShare(subs, on, quarters[q], in.radius())
	}
	return cells
}
