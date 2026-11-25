// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"math"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

// RegimeDays: the engine's 15-minute window
const RegimeDays = 84

// dayKinds lead a day-type label.
var dayKinds = map[string]bool{"Ramadan": true, "RamadanSchool": true, "RamadanBreak": true, "Eid": true, "National": true}

// DayTypes labels Ramadan, Eid and national days.
func DayTypes(base Segmenter, cal forecastcal.Config) Segmenter {
	return func(date string) string {
		t, err := time.Parse("2006-01-02", date)
		if err != nil {
			return base(date)
		}
		k := dayType(cal.For(date))
		switch {
		case k == "":
			return base(date)
		case strings.HasPrefix(k, "Eid-"):
			return k
		}
		return k + "-" + weekdayGroup(t)
	}
}

// dayType: the kind first, so "Kind-*" pools it.
func dayType(f forecastcal.Features) string {
	h := f.Hijri
	switch {
	case f.IsRamadan && f.SchoolInSession == nil:
		return "Ramadan"
	case f.IsRamadan && *f.SchoolInSession:
		return "RamadanSchool"
	case f.IsRamadan:
		return "RamadanBreak"
	case h == nil:
	case h.Month == 10 && h.Day == 1, h.Month == 12 && h.Day == 10:
		return "Eid-Day1"
	case h.Month == 10 && h.Day <= 3, h.Month == 12 && h.Day >= 11 && h.Day <= 13:
		return "Eid-Day2"
	case h.Month == 12 && h.Day == 9:
		return "Eid-Arafah"
	}
	if f.SchoolPeriod == "vacation_national" {
		return "National"
	}
	for _, e := range f.Events {
		if e.Type == "national_day" && len(e.ZoneIDs) == 0 && len(e.Cities) == 0 {
			return "National"
		}
	}
	return ""
}

// IsDayType: a label DayTypes gave a special day.
func IsDayType(label string) bool {
	return dayKinds[strings.SplitN(label, "-", 2)[0]]
}

// Shares: the engine's shape share per local day.
func (o ShapeBlend) Shares(cal forecastcal.Config, shape Segmenter, origin time.Time) func(day time.Time) float64 {
	if !o.DayTypes {
		return func(time.Time) float64 { return o.Share }
	}
	n := map[bool]float64{}
	for d := 1; d <= RegimeDays; d++ {
		if s := cal.For(addDays(origin, -d).Format("2006-01-02")).SchoolInSession; s != nil {
			n[*s]++
		}
	}
	return func(day time.Time) float64 {
		ds := day.In(loc).Format("2006-01-02")
		if IsDayType(shape(ds)) {
			return 0
		}
		s := cal.For(ds).SchoolInSession
		if s == nil {
			return o.Share
		}
		// full share from half the window alike
		return o.Share * math.Min(1, n[*s]/(RegimeDays/2))
	}
}
