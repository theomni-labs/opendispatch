// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

const (
	// DefaultShapeShare: the engine's half of the shape
	DefaultShapeShare = 0.5
	// DefaultSmallZone: cases a day; below, totals average
	DefaultSmallZone = 50.0
	// SmallZoneDays: the window the zone volume reads
	SmallZoneDays = 84
)

// BlendNote says how a blended candidate is built.
const BlendNote = "per zone and day the engine's total, averaged with the customer's segment average in zones under the small-zone volume, spread by the engine's share of its own shape and the rest by the customer's three-year segment shape"

// DayTypesNote: what day types add.
const DayTypesNote = "with day types: Ramadan (school or break), Eid and national days take the three-year shape of their own kind alone; on other days the engine's share shrinks when under half of its 84-day window had the day's school status"

// ShapeBlend: how the engine meets the customer's segment average.
type ShapeBlend struct {
	// Share: the engine's share of the day's shape
	Share float64 `json:"share"`
	// SmallZone: cases a day in the last 84 days
	SmallZone float64 `json:"small_zone_cases_per_day"`
	// DayTypes: special days on their own shape
	DayTypes bool `json:"day_types"`
}

// DefaultBlend: half and half, small under 50 a day.
func DefaultBlend() ShapeBlend {
	return ShapeBlend{Share: DefaultShapeShare, SmallZone: DefaultSmallZone, DayTypes: true}
}

// Note says how this blend is built.
func (o ShapeBlend) Note() string {
	if o.DayTypes {
		return BlendNote + "; " + DayTypesNote
	}
	return BlendNote
}

// ZoneDay: a zone and a local day (midnight, Unix).
type ZoneDay struct {
	Zone string
	Day  int64
}

// SegmentDays: The customer's segment average per zone-day slot.
type SegmentDays map[ZoneDay]*[intervalsPerDay]float64

func slotOf(t time.Time) int {
	lt := t.In(loc)
	return lt.Hour()*4 + lt.Minute()/15
}

// SegmentDaysOf sums segment-average values by zone.
func SegmentDaysOf(values []ForecastValue) SegmentDays {
	out := SegmentDays{}
	for _, v := range values {
		k := ZoneDay{v.ZoneID, localDay(v.Start).Unix()}
		if out[k] == nil {
			out[k] = &[intervalsPerDay]float64{}
		}
		out[k][slotOf(v.Start)] += v.Expected
	}
	return out
}

// SegmentProfile: case sums by zone, segment and slot.
type SegmentProfile struct {
	// Sums: zone, then segment label, then slot
	Sums map[string]map[string]*[intervalsPerDay]float64
	// First: the first history day (local midnight)
	First time.Time
}

// Days: the segment average for each horizon zone-day.
func (p SegmentProfile) Days(origin time.Time, days int, zones []string, seg Segmenter) SegmentDays {
	group := func(s string) string { return strings.SplitN(s, "-", 2)[0] + "-*" }
	n := map[string]int{}
	for d := localDay(p.First); d.Before(origin); d = addDays(d, 1) {
		l := seg(d.Format("2006-01-02"))
		n[l]++
		n[group(l)]++
	}
	sums := map[string]map[string]*[intervalsPerDay]float64{}
	for z, byLabel := range p.Sums {
		m := map[string]*[intervalsPerDay]float64{}
		for l, a := range byLabel {
			for _, k := range []string{l, group(l)} {
				if m[k] == nil {
					m[k] = &[intervalsPerDay]float64{}
				}
				for i := range a {
					m[k][i] += a[i]
				}
			}
		}
		sums[z] = m
	}
	out := SegmentDays{}
	for d := 0; d < days; d++ {
		day := addDays(origin, d)
		l := seg(day.Format("2006-01-02"))
		if n[l] == 0 {
			l = group(l)
		}
		if n[l] == 0 {
			continue
		}
		for _, z := range zones {
			a := sums[z][l]
			if a == nil {
				continue
			}
			v := &[intervalsPerDay]float64{}
			for i := range a {
				v[i] = a[i] / float64(n[l])
			}
			out[ZoneDay{z, day.Unix()}] = v
		}
	}
	return out
}

// Blended wraps a forecaster with the customer's segment average.
func Blended(cand Forecaster, seg Segmenter, cal forecastcal.Config, o ShapeBlend) Forecaster {
	shape := seg
	if o.DayTypes {
		shape = DayTypes(seg, cal)
	}
	avg := SegmentAverage(shape)
	return func(ctx context.Context, req ForecastRequest) ([]ForecastValue, error) {
		cv, err := cand(ctx, req)
		if err != nil {
			return nil, err
		}
		sv, err := avg(ctx, req)
		if err != nil {
			return nil, err
		}
		return BlendDays(cv, SegmentDaysOf(sv), SmallZones(req, o.SmallZone), o.Shares(cal, shape, req.Origin)), nil
	}
}

// SmallZones: zones under the volume before the origin.
func SmallZones(req ForecastRequest, limit float64) map[string]bool {
	out := map[string]bool{}
	if limit <= 0 || len(req.History) == 0 {
		return out
	}
	from := addDays(req.Origin, -SmallZoneDays)
	if first := localDay(req.History[0].Start); first.After(from) {
		from = first
	}
	days := dayCount(from, req.Origin) - 1
	if days < 1 {
		return out
	}
	zoneOf := map[string]string{}
	for _, z := range req.Zones {
		for _, s := range z.SubZones {
			zoneOf[s] = z.ZoneID
		}
	}
	n := map[string]float64{}
	i := sort.Search(len(req.History), func(k int) bool { return !req.History[k].Start.Before(from) })
	for _, r := range req.History[i:] {
		if r.Start.Before(req.Origin) {
			n[zoneOf[r.SubZoneID]] += float64(r.Total)
		}
	}
	for _, z := range req.Zones {
		out[z.ZoneID] = n[z.ZoneID] < limit*float64(days)
	}
	return out
}

// BlendWithSegment reshapes the engine toward the segment average.
func BlendWithSegment(engine []ForecastValue, seg SegmentDays, small map[string]bool, share float64) []ForecastValue {
	return BlendDays(engine, seg, small, func(time.Time) float64 { return share })
}

// BlendDays: BlendWithSegment, a share per day.
func BlendDays(engine []ForecastValue, seg SegmentDays, small map[string]bool, shareOf func(day time.Time) float64) []ForecastValue {
	byDay := map[ZoneDay]*[intervalsPerDay]float64{}
	subDay, subField := map[ZoneDay]map[string]float64{}, map[ZoneDay]map[string]float64{}
	for _, v := range engine {
		k := ZoneDay{v.ZoneID, localDay(v.Start).Unix()}
		if byDay[k] == nil {
			byDay[k], subDay[k], subField[k] = &[intervalsPerDay]float64{}, map[string]float64{}, map[string]float64{}
		}
		byDay[k][slotOf(v.Start)] += v.Expected
		subDay[k][v.SubZoneID] += v.Expected
		subField[k][v.SubZoneID] += v.Field
	}
	target := map[ZoneDay]*[intervalsPerDay]float64{}
	for k, e := range byDay {
		s := seg[k]
		if s == nil {
			continue
		}
		var te, ts float64
		for i := 0; i < intervalsPerDay; i++ {
			te += e[i]
			ts += s[i]
		}
		total := te
		if small[k.Zone] && ts > 0 {
			total = 0.5*te + 0.5*ts
		}
		share := shareOf(time.Unix(k.Day, 0).In(loc))
		t := &[intervalsPerDay]float64{}
		for i := 0; i < intervalsPerDay; i++ {
			switch {
			case te > 0 && ts > 0:
				t[i] = total * (share*e[i]/te + (1-share)*s[i]/ts)
			case te > 0:
				t[i] = total * e[i] / te
			case ts > 0:
				t[i] = total * s[i] / ts
			}
		}
		target[k] = t
	}
	out := make([]ForecastValue, len(engine))
	for i, v := range engine {
		k := ZoneDay{v.ZoneID, localDay(v.Start).Unix()}
		sl, e, t := slotOf(v.Start), byDay[k], target[k]
		switch {
		case t == nil:
		case e[sl] > 0:
			f := t[sl] / e[sl]
			v.Expected, v.Low, v.High, v.Field = v.Expected*f, v.Low*f, v.High*f, v.Field*f
		case t[sl] > 0:
			// a slot the engine left empty: its day split
			var te float64
			for _, x := range subDay[k] {
				te += x
			}
			w := 1.0 / float64(len(subDay[k]))
			if te > 0 {
				w = subDay[k][v.SubZoneID] / te
			}
			fs := 0.0
			if x := subDay[k][v.SubZoneID]; x > 0 {
				fs = subField[k][v.SubZoneID] / x
			}
			add := t[sl] * w
			v.Expected, v.High, v.Field = add, v.High+add, add*fs
		}
		out[i] = v
	}
	return out
}
