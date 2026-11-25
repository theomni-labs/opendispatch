// SPDX-License-Identifier: AGPL-3.0-only

// Ask's forecast and gap summaries (tools).
package business

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func hourOf(rfc string) int {
	t, err := time.Parse(time.RFC3339, rfc)
	if err != nil {
		return -1
	}
	return t.In(riyadhZone).Hour()
}

// zoneLabels: each zone's English name.
func zoneLabels(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) map[string]string {
	out := map[string]string{}
	if conn == nil {
		return out
	}
	zones, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return out
	}
	for _, z := range zones {
		out[z.ID] = z.NameEn
	}
	return out
}

func labelOf(labels map[string]string, id string) string {
	if n, ok := labels[id]; ok && n != "" {
		return n
	}
	return "zone " + id[:min(8, len(id))]
}

// askForecastFacts: one zone's forecast day.
var askForecastFacts = func(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, zoneID, date string) (map[string]any, error) {
	tl, err := GetForecastTimeline(rc, ForecastTimelineQuery{ZoneID: zoneID, Date: date})
	if err != nil {
		return nil, err
	}
	var total, low, high, field, remote float64
	hours := make([]float64, 24)
	for _, iv := range tl.Intervals {
		total += iv.Expected
		low += iv.Low
		high += iv.High
		field += iv.FieldExpected
		remote += iv.RemoteInferredExpected
		if h := hourOf(iv.IntervalStart); h >= 0 {
			hours[h] += iv.Expected
		}
	}
	peak := 0
	for h := range hours {
		hours[h] = round1(hours[h])
		if hours[h] > hours[peak] {
			peak = h
		}
	}
	facts := map[string]any{
		"zone": labelOf(zoneLabels(ctx, conn, rc), zoneID), "date": date,
		"expected_cases": round1(total), "low": round1(low), "high": round1(high),
		"field_expected": round1(field), "remote_inferred_expected": round1(remote),
		"peak_hour":   fmt.Sprintf("%02d:00", peak),
		"data_source": tl.DataSource, "illustrative": true,
	}
	if ex, err := GetForecastExplanation(rc, ForecastExplanationQuery{ZoneID: zoneID, Date: date}); err == nil {
		drivers := make([]map[string]any, 0, len(ex.Drivers))
		for _, d := range ex.Drivers {
			drivers = append(drivers, map[string]any{"driver": d.Driver, "label": driverLabel(d.Driver, date, "en"), "multiplier": math.Round(d.Multiplier*100) / 100})
		}
		facts["base_cases"] = round1(ex.Base)
		facts["drivers"] = drivers
		facts["model_version"] = ex.ModelVersion
	}
	return facts, nil
}

type gapZoneFacts struct {
	Zone             string         `json:"zone"`
	GapIntervals     int            `json:"gap_intervals"`
	SurplusIntervals int            `json:"surplus_intervals"`
	ShortHours       float64        `json:"agent_hours_short"`
	ExtraHours       float64        `json:"agent_hours_extra"`
	WorstGap         string         `json:"worst_gap,omitempty"`
	Causes           map[string]int `json:"gap_causes,omitempty"`
	MeanReach        *float64       `json:"mean_10_min_reach_share,omitempty"`
}

// askGapFacts: gap and surplus per zone.
func askGapFacts(view GapSurplusView, labels map[string]string) map[string]any {
	byZone := map[string]*gapZoneFacts{}
	worst := map[string]int{}
	reachSum, reachN := map[string]float64{}, map[string]int{}
	var order []string
	for _, c := range view.Cells {
		z, ok := byZone[c.ZoneID]
		if !ok {
			z = &gapZoneFacts{Zone: labelOf(labels, c.ZoneID), Causes: map[string]int{}}
			byZone[c.ZoneID] = z
			order = append(order, c.ZoneID)
		}
		switch {
		case c.Kind == "gap":
			z.GapIntervals++
			z.ShortHours += float64(-c.Delta) / 4
			if c.Delta < worst[c.ZoneID] {
				worst[c.ZoneID] = c.Delta
				z.WorstGap = fmt.Sprintf("%s short %d", intervalTime(c.IntervalIndex), -c.Delta)
			}
			if c.Cause != nil {
				z.Causes[*c.Cause]++
			}
		case c.Kind == "surplus":
			z.SurplusIntervals++
			z.ExtraHours += float64(c.Delta) / 4
		}
		if c.ReachShare != nil {
			reachSum[c.ZoneID] += *c.ReachShare
			reachN[c.ZoneID]++
		}
	}
	zones := make([]gapZoneFacts, 0, len(order))
	gaps, surplus := 0, 0
	for _, id := range order {
		z := byZone[id]
		z.ShortHours, z.ExtraHours = round2(z.ShortHours), round2(z.ExtraHours)
		if reachN[id] > 0 {
			m := math.Round(reachSum[id]/float64(reachN[id])*100) / 100
			z.MeanReach = &m
		}
		if len(z.Causes) == 0 {
			z.Causes = nil
		}
		gaps += z.GapIntervals
		surplus += z.SurplusIntervals
		zones = append(zones, *z)
	}
	sort.SliceStable(zones, func(i, j int) bool { return zones[i].ShortHours > zones[j].ShortHours })
	return map[string]any{
		"date": view.RosterDate, "interval_minutes": 15,
		"gap_intervals": gaps, "surplus_intervals": surplus, "zones": zones,
		"data_source": view.DataSource, "illustrative": true,
	}
}
