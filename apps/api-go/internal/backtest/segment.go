// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

// Segmenter names the planning segment of a date (YYYY-MM-DD).
type Segmenter func(date string) string

const (
	GateBaselineNaive   = "naive"
	GateBaselineSegment = "segment"

	SegmentBaselineName = "segment-average (the customer's method)"
	NaiveBaselineName   = "seasonal-naive-same-hour-last-week"
)

func weekdayGroup(t time.Time) string {
	switch t.Weekday() {
	case time.Thursday:
		return "Thursday"
	case time.Friday:
		return "Friday"
	case time.Saturday:
		return "Saturday"
	}
	return "Weekdays"
}

// SegmentFromCalendar: day group x school or event.
func SegmentFromCalendar(c forecastcal.Config) Segmenter {
	return func(date string) string {
		t, err := time.Parse("2006-01-02", date)
		if err != nil {
			return "Unknown-Unknown"
		}
		f := c.For(date)
		period := "SchoolUnknown"
		switch {
		case f.IsRamadan:
			period = "Ramadan"
		case len(f.Events) > 0:
			period = f.Events[0].Type
		case f.SchoolInSession != nil && *f.SchoolInSession:
			period = "School"
		case f.SchoolInSession != nil:
			period = "Break"
		}
		return weekdayGroup(t) + "-" + period
	}
}

type segKey struct {
	seg  string
	slot int
}

// SegmentAverage predicts the training mean of the same
// segment and 15-minute slot, as the customer's plan sheet does.
func SegmentAverage(raw Segmenter) Forecaster {
	memo := map[string]string{}
	seg := func(d string) string {
		if l, ok := memo[d]; ok {
			return l
		}
		l := raw(d)
		memo[d] = l
		return l
	}
	return func(_ context.Context, req ForecastRequest) ([]ForecastValue, error) {
		sums := map[string]map[segKey]float64{}
		daysOf := map[string]int{}
		group := func(s string) string { return strings.SplitN(s, "-", 2)[0] }
		if len(req.History) > 0 {
			first := localDay(req.History[0].Start)
			for d := first; d.Before(req.Origin); d = addDays(d, 1) {
				l := seg(d.Format("2006-01-02"))
				daysOf[l]++
				daysOf[group(l)+"-*"]++
			}
		}
		for _, r := range req.History {
			if !r.Start.Before(req.Origin) {
				continue
			}
			st := r.Start.In(loc)
			slot := st.Hour()*4 + st.Minute()/15
			l := seg(localDay(st).Format("2006-01-02"))
			m := sums[r.SubZoneID]
			if m == nil {
				m = map[segKey]float64{}
				sums[r.SubZoneID] = m
			}
			m[segKey{l, slot}] += float64(r.Total)
			m[segKey{group(l) + "-*", slot}] += float64(r.Total)
		}
		return forecastEach(req, func(_ histIndex, sub string, t time.Time) float64 {
			tt := t.In(loc)
			slot := tt.Hour()*4 + tt.Minute()/15
			l := seg(localDay(tt).Format("2006-01-02"))
			if daysOf[l] == 0 {
				l = group(l) + "-*"
			}
			if daysOf[l] == 0 {
				return 0
			}
			return sums[sub][segKey{l, slot}] / float64(daysOf[l])
		}), nil
	}
}

// StaffingArm: needed staff (ceil of cases per window).
type StaffingArm struct {
	Name         string   `json:"name"`
	Windows      int      `json:"windows"`
	Under        int      `json:"under"`
	Over         int      `json:"over"`
	Exact        int      `json:"exact"`
	UnderShare   *float64 `json:"under_share"`
	OverShare    *float64 `json:"over_share"`
	ExactShare   *float64 `json:"exact_share"`
	NeededActual int      `json:"needed_staff_actual"`
	NeededMethod int      `json:"needed_staff_method"`
}

// StaffingNote says how the table is built.
const StaffingNote = "needed staff = ceil of cases per zone and 30-minute window, as in the customer's plan sheet; windows with no cases and no forecast are left out"

type staffAcc struct {
	n, under, over, exact int
	actual, method        int
}

func ceilNeed(v float64) int { return int(math.Ceil(v - 1e-9)) }

func (s *staffAcc) add(forecast, actual float64) {
	a, m := ceilNeed(actual), ceilNeed(forecast)
	if a == 0 && m == 0 {
		return
	}
	s.n++
	s.actual += a
	s.method += m
	switch {
	case m < a:
		s.under++
	case m > a:
		s.over++
	default:
		s.exact++
	}
}

func (s *staffAcc) arm(name string) StaffingArm {
	out := StaffingArm{Name: name, Windows: s.n, Under: s.under, Over: s.over, Exact: s.exact, NeededActual: s.actual, NeededMethod: s.method}
	if s.n > 0 {
		sh := func(v int) *float64 { return ptr(round(float64(v)/float64(s.n), 4)) }
		out.UnderShare, out.OverShare, out.ExactShare = sh(s.under), sh(s.over), sh(s.exact)
	}
	return out
}
