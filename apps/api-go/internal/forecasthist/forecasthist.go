// SPDX-License-Identifier: AGPL-3.0-only

// Package forecasthist shapes forecaster history.
package forecasthist

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
)

// Settings keys; defaults are assumptions.
const (
	KeyDetailWeeks = "forecast.history_detail_weeks"
	KeyYears       = "forecast.history_years"
	KeyAggMinutes  = "forecast.history_aggregate_minutes"

	DefaultDetailWeeks = 12
	DefaultYears       = 3
	DefaultAggMinutes  = 1440
	maxDetailWeeks     = 52
	maxYears           = 5
)

// Descriptions say what each setting means.
var Descriptions = map[string]string{
	KeyDetailWeeks: "Weeks of history sent to the forecaster at 15 minutes (default 12, 1 to 52).",
	KeyYears:       "Years of history sent in all; older than the 15-minute weeks goes as totals (default 3, 0 to 5; 0 sends no totals).",
	KeyAggMinutes:  "Grain of the older totals: 1440 (daily, default) or 60 (hourly).",
}

var riyadh = time.FixedZone("Asia/Riyadh", 3*3600)

const isoZ = "2006-01-02T15:04:05-07:00"

// ErrTooLarge: not even one day of history fits.
var ErrTooLarge = errors.New("the forecaster request is over the size limit even with one day of history")

// Settings: how much history and at which grain.
type Settings struct {
	DetailWeeks int
	Years       int
	AggMinutes  int
}

// Defaults are the settings' defaults.
func Defaults() Settings {
	return Settings{DetailWeeks: DefaultDetailWeeks, Years: DefaultYears, AggMinutes: DefaultAggMinutes}
}

// Normalized: out-of-range values become defaults.
func (s Settings) Normalized() Settings {
	if s.DetailWeeks < 1 || s.DetailWeeks > maxDetailWeeks {
		s.DetailWeeks = DefaultDetailWeeks
	}
	if s.Years < 0 || s.Years > maxYears {
		s.Years = DefaultYears
	}
	if s.AggMinutes != 60 && s.AggMinutes != 1440 {
		s.AggMinutes = DefaultAggMinutes
	}
	return s
}

// DetailDays is the 15-minute window in days.
func (s Settings) DetailDays() int { return s.Normalized().DetailWeeks * 7 }

// Windows: where totals start and 15 minutes start.
func (s Settings) Windows(origin time.Time) (aggFrom, detailFrom time.Time) {
	n := s.Normalized()
	o := midnight(origin)
	detailFrom = o.AddDate(0, 0, -n.DetailWeeks*7)
	aggFrom = o.AddDate(-n.Years, 0, 0)
	if !aggFrom.Before(detailFrom) {
		aggFrom = detailFrom
	}
	return aggFrom, detailFrom
}

// Bin is the start of the period holding t.
func (s Settings) Bin(t time.Time) time.Time {
	l := t.In(riyadh)
	if s.Normalized().AggMinutes == 60 {
		return time.Date(l.Year(), l.Month(), l.Day(), l.Hour(), 0, 0, 0, riyadh)
	}
	return midnight(l)
}

func midnight(t time.Time) time.Time {
	l := t.In(riyadh)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, riyadh)
}

// ValidateSetting checks our keys on write.
func ValidateSetting(key string, value any) error {
	n, ok := value.(float64)
	if i, isInt := value.(int); isInt {
		n, ok = float64(i), true
	}
	whole := ok && n == float64(int(n))
	switch key {
	case KeyDetailWeeks:
		if !whole || n < 1 || n > maxDetailWeeks {
			return fmt.Errorf("%s must be a whole number from 1 to %d", key, maxDetailWeeks)
		}
	case KeyYears:
		if !whole || n < 0 || n > maxYears {
			return fmt.Errorf("%s must be a whole number from 0 to %d", key, maxYears)
		}
	case KeyAggMinutes:
		if !whole || (n != 60 && n != 1440) {
			return fmt.Errorf("%s must be 60 or 1440", key)
		}
	}
	return nil
}

// Record is one 15-minute count.
type Record struct {
	SubZoneID     string `json:"sub_zone_id"`
	IntervalStart string `json:"interval_start"`
	CasesTotal    int    `json:"cases_total"`
	CasesField    int    `json:"cases_field"`
}

// Aggregate is one hourly or daily total.
type Aggregate struct {
	SubZoneID     string `json:"sub_zone_id"`
	PeriodStart   string `json:"period_start"`
	PeriodMinutes int    `json:"period_minutes"`
	CasesTotal    int    `json:"cases_total"`
	CasesField    int    `json:"cases_field"`
}

// History is the request's history object.
type History struct {
	Records    []Record    `json:"records"`
	Aggregated []Aggregate `json:"aggregated_records,omitempty"`
}

// NewRecord formats a count in Riyadh time.
func NewRecord(sub string, start time.Time, total, field int) Record {
	return Record{sub, start.In(riyadh).Format(isoZ), total, field}
}

// NewAggregate formats a total in Riyadh time.
func NewAggregate(sub string, start time.Time, minutes, total, field int) Aggregate {
	return Aggregate{sub, start.In(riyadh).Format(isoZ), minutes, total, field}
}

// Aggregator sums 15-minute counts into periods.
type Aggregator struct {
	s     Settings
	index map[aggKey]int
	out   []Aggregate
}

type aggKey struct {
	sub string
	at  int64
}

// NewAggregator sums at the settings' grain.
func NewAggregator(s Settings) *Aggregator {
	return &Aggregator{s: s.Normalized(), index: map[aggKey]int{}}
}

// Add counts one interval.
func (a *Aggregator) Add(sub string, t time.Time, total, field int) {
	b := a.s.Bin(t)
	k := aggKey{sub, b.Unix()}
	i, ok := a.index[k]
	if !ok {
		i = len(a.out)
		a.index[k] = i
		a.out = append(a.out, NewAggregate(sub, b, a.s.AggMinutes, 0, 0))
	}
	a.out[i].CasesTotal += total
	a.out[i].CasesField += field
}

// Result is sorted by period, then sub-zone.
func (a *Aggregator) Result() []Aggregate {
	sort.SliceStable(a.out, func(i, j int) bool {
		if a.out[i].PeriodStart != a.out[j].PeriodStart {
			return a.out[i].PeriodStart < a.out[j].PeriodStart
		}
		return a.out[i].SubZoneID < a.out[j].SubZoneID
	})
	return a.out
}

// Limits: the request budget.
type Limits struct {
	Wire, Raw int
	// Records caps each list.
	Records int
}

// First is the oldest day kept, "" when none.
func (h History) First() string {
	f := ""
	if len(h.Aggregated) > 0 {
		f = h.Aggregated[0].PeriodStart[:10]
	}
	if len(h.Records) > 0 && (f == "" || h.Records[0].IntervalStart[:10] < f) {
		f = h.Records[0].IntervalStart[:10]
	}
	return f
}

// Days counts the distinct days of each list.
func (h History) Days() (detail, aggregated int) {
	return len(dayStarts(len(h.Records), func(i int) string { return h.Records[i].IntervalStart[:10] })),
		len(dayStarts(len(h.Aggregated), func(i int) string { return h.Aggregated[i].PeriodStart[:10] }))
}

func dayStarts(n int, day func(int) string) []int {
	var out []int
	for i := 0; i < n; i++ {
		if i == 0 || day(i) != day(i-1) {
			out = append(out, i)
		}
	}
	return out
}

// Fit drops the fewest oldest days that fit.
func Fit(h History, lim Limits, marshal func(History) ([]byte, error)) ([]byte, History, error) {
	body, err := marshal(h)
	if err != nil {
		return nil, h, err
	}
	under := func(x History) bool { return len(x.Records) <= lim.Records && len(x.Aggregated) <= lim.Records }
	if ok, err := engines.FitsRequest(body, lim.Wire, lim.Raw); err != nil || (ok && under(h)) {
		return body, h, err
	}
	sort.SliceStable(h.Records, func(i, j int) bool { return h.Records[i].IntervalStart < h.Records[j].IntervalStart })
	sort.SliceStable(h.Aggregated, func(i, j int) bool { return h.Aggregated[i].PeriodStart < h.Aggregated[j].PeriodStart })
	seen := map[string]bool{}
	var days []string
	for _, a := range h.Aggregated {
		if d := a.PeriodStart[:10]; !seen[d] {
			seen[d] = true
			days = append(days, d)
		}
	}
	for _, r := range h.Records {
		if d := r.IntervalStart[:10]; !seen[d] {
			seen[d] = true
			days = append(days, d)
		}
	}
	sort.Strings(days)
	if len(days) == 0 {
		return nil, h, ErrTooLarge
	}
	keep := func(drop int) History {
		cut := days[drop]
		a := sort.Search(len(h.Aggregated), func(i int) bool { return h.Aggregated[i].PeriodStart[:10] >= cut })
		r := sort.Search(len(h.Records), func(i int) bool { return h.Records[i].IntervalStart[:10] >= cut })
		return History{Records: h.Records[r:], Aggregated: h.Aggregated[a:]}
	}
	drop, ok, err := engines.MinDrop(len(days)-1, func(drop int) (bool, error) {
		k := keep(drop)
		if !under(k) {
			return false, nil
		}
		b, err := marshal(k)
		if err != nil {
			return false, err
		}
		return engines.FitsRequest(b, lim.Wire, lim.Raw)
	})
	if err != nil {
		return nil, h, err
	}
	if !ok {
		return nil, h, ErrTooLarge
	}
	k := keep(drop)
	body, err = marshal(k)
	return body, k, err
}
