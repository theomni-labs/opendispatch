// SPDX-License-Identifier: AGPL-3.0-only

package leaveoutlook

import (
	"math"
	"sort"
)

// Smaller driver effects are not named.
const minNamed = 0.02

// maxDrivers named per week.
const maxDrivers = 3

// Driver: one driver's effect on a week.
type Driver struct {
	Code   string
	Effect float64
}

// WeekDemand: a week's field demand.
type WeekDemand struct {
	Expected float64
	Normal   float64
	Change   float64
	Drivers  []Driver
}

// Week: days from start, against its own level.
func (f Fit) Week(start string, days int, tags Tags) WeekDemand {
	t0 := parse(start)
	var w WeekDemand
	if t0.IsZero() || days < 1 {
		return w
	}
	dates := make([]string, days)
	dayTags := make([][]string, days)
	seen := map[string]bool{}
	var codes []string
	for i := range dates {
		t := t0.AddDate(0, 0, i)
		dates[i] = t.Format("2006-01-02")
		dayTags[i] = tags(dates[i])
		w.Expected += f.Day(dates[i], dayTags[i], "")
		w.Normal += f.Level(dates[i]) * f.Weekday[int(t.Weekday())]
		for _, tg := range dayTags[i] {
			if _, ok := f.Effects[tg]; ok && !seen[tg] {
				seen[tg] = true
				codes = append(codes, tg)
			}
		}
	}
	if w.Normal > 0 {
		w.Change = w.Expected/w.Normal - 1
	}
	for _, tg := range codes {
		without := 0.0
		for i := range dates {
			without += f.Day(dates[i], dayTags[i], tg)
		}
		if without <= 0 {
			continue
		}
		if d := w.Expected/without - 1; math.Abs(d) >= minNamed {
			w.Drivers = append(w.Drivers, Driver{Code: tg, Effect: d})
		}
	}
	sort.SliceStable(w.Drivers, func(i, j int) bool {
		return math.Abs(w.Drivers[i].Effect) > math.Abs(w.Drivers[j].Effect)
	})
	if len(w.Drivers) > maxDrivers {
		w.Drivers = w.Drivers[:maxDrivers]
	}
	return w
}

// Capacity: a zone's people in one week.
type Capacity struct {
	Agents       int
	Share        float64
	ApprovedDays int
	Days         int
	Blackout     bool
	// Sick: expected people off sick a day.
	Sick float64
}

// Thresholds: shares of normal demand.
type Thresholds struct {
	GrantBelow    float64
	RestrictAbove float64
}

// Verdict: a week's class and leave room.
type Verdict struct {
	Status    string
	Room      int
	Limit     int
	LeaveFull bool
}

// Classify: grant, normal or restrict.
func Classify(change float64, c Capacity, th Thresholds) Verdict {
	h := float64(c.Agents)
	limit := int(math.Floor(h*c.Share + 1e-9))
	days := c.Days
	if days < 1 {
		days = 7
	}
	away := float64(c.ApprovedDays) / float64(days)
	needed := h * (1 - c.Share) * (1 + change)
	sick := math.Max(0, c.Sick)
	room := int(math.Floor(math.Min(h-needed-away-sick, float64(limit)-away) + 1e-9))
	room = max(room, 0)
	v := Verdict{Status: "normal", Room: room, Limit: limit}
	v.LeaveFull = c.Agents > 0 && c.ApprovedDays > 0 && room == 0
	switch {
	case c.Blackout || v.LeaveFull || change >= th.RestrictAbove-1e-9:
		v.Status = "restrict"
	case change <= -th.GrantBelow+1e-9 && (c.Agents == 0 || room >= 1):
		v.Status = "grant"
	}
	return v
}
