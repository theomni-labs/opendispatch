// SPDX-License-Identifier: AGPL-3.0-only

package forecastcal

import "time"

func nextDay(d string) string {
	t, err := time.Parse("2006-01-02", d)
	if err != nil {
		return ""
	}
	return t.AddDate(0, 0, 1).Format("2006-01-02")
}

// DerivedRange is one event OpenDispatch derives itself.
type DerivedRange struct {
	Type  string
	Name  string
	Start string
	End   string
	// Hijri is false for a fixed date.
	Hijri bool
}

// DerivedRanges lists the Hijri and fixed events from..to.
func DerivedRanges(from, to string) []DerivedRange {
	var out []DerivedRange
	open := map[string]int{}
	for d := from; d != "" && d <= to; d = nextDay(d) {
		for _, e := range derivedEvents(d) {
			key := e.Type + "|" + e.Name
			if i, ok := open[key]; ok && nextDay(out[i].End) == d {
				out[i].End = d
				continue
			}
			open[key] = len(out)
			out = append(out, DerivedRange{Type: e.Type, Name: e.Name, Start: d, End: d, Hijri: !isGregorianEvent(e.Name)})
		}
	}
	return out
}

// derivedEvents: what For sends, plus the list-only events.
func derivedEvents(date string) []Event {
	t := parse(date)
	if t.IsZero() {
		return nil
	}
	var out []Event
	if h := HijriOf(date); h != nil {
		out = hijriEvents(h, true)
	}
	return append(out, gregorianEvents(t)...)
}

// SourceSettings labels a forecast run's calendar.
const SourceSettings = "derived from settings"

// SendEvents is the list sent to the engine: events scoped to cities
// are not sent; never nil.
func SendEvents(evs []Event) []Event {
	out := make([]Event, 0, len(evs))
	for _, e := range evs {
		if len(e.Cities) == 0 {
			out = append(out, e)
		}
	}
	return out
}
