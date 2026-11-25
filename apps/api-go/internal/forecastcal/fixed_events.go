// SPDX-License-Identifier: AGPL-3.0-only

package forecastcal

import "time"

// fixedRule is one event on fixed days of a month.
type fixedRule struct {
	Type, Name string
	Month      int
	From, To   int
	// ListOnly events are shown, not sent to the model.
	ListOnly bool
}

// Umm al-Qura events (The customer, 20 Oct 2026).
var hijriRules = []fixedRule{
	{"eid", "Eid al-Fitr", 10, 1, 4, false},
	{"eid", "Eid al-Adha", 12, 10, 13, false},
	{"hajj", "Arafah Day", 12, 9, 9, false},
	{"hajj", "Hajj", 12, 8, 13, false},
	{"hajj", "Hajj Pre-Season", 12, 1, 7, true},
	{"hajj", "Hajj Post-Season", 12, 14, 15, true},
}

// Gregorian events (The customer, 20 Oct 2026).
var gregorianRules = []fixedRule{
	{"national_day", "National Day", 9, 23, 23, false},
	{"national_day", "Founding Day", 2, 22, 22, false},
}

func (r fixedRule) has(month, day int) bool {
	return r.Month == month && day >= r.From && day <= r.To
}

func hijriEvents(h *Hijri, listed bool) []Event {
	var out []Event
	for _, r := range hijriRules {
		if r.has(h.Month, h.Day) && (listed || !r.ListOnly) {
			out = append(out, Event{Type: r.Type, Name: r.Name})
		}
	}
	return out
}

func gregorianEvents(t time.Time) []Event {
	var out []Event
	for _, r := range gregorianRules {
		if r.has(int(t.Month()), t.Day()) {
			out = append(out, Event{Type: r.Type, Name: r.Name})
		}
	}
	return out
}

func isGregorianEvent(name string) bool {
	for _, r := range gregorianRules {
		if r.Name == name {
			return true
		}
	}
	return false
}

// inSalaryWindow: from start to the month's end.
func inSalaryWindow(t time.Time, start int) bool {
	last := time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	return t.Day() >= min(start, last)
}
