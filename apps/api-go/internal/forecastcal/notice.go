// SPDX-License-Identifier: AGPL-3.0-only

package forecastcal

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"time"

	hijri "github.com/hablullah/go-hijri"
)

// KeyNoticeEvents: events saved from a notice.
const KeyNoticeEvents = "forecast.notice_events"

// Notice limits.
const (
	MaxNoticeEvents   = 200
	MaxNoticeDays     = 60
	MaxNoticeZones    = 100
	maxNoticeTextRune = 300
)

// NoticeTypes: the kinds of notice event.
var NoticeTypes = []string{"sports_match", "festival", "concert", "conference", "road_closure", "public_holiday", "other"}

// Impacts: expected impact levels.
var Impacts = []string{"low", "medium", "high"}

var hhmm = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

// NoticeRange is one saved notice event.
type NoticeRange struct {
	Start   string   `json:"start"`
	End     string   `json:"end"`
	Name    string   `json:"name"`
	NameAr  string   `json:"name_ar,omitempty"`
	Type    string   `json:"type"`
	ZoneIDs []string `json:"zone_ids"`
	// Cities: English names of the zones' cities.
	Cities       []string `json:"cities,omitempty"`
	StartTime    string   `json:"start_time,omitempty"`
	EndTime      string   `json:"end_time,omitempty"`
	Impact       string   `json:"impact"`
	ImpactReason string   `json:"impact_reason,omitempty"`
	Quote        string   `json:"quote,omitempty"`
	Assisted     bool     `json:"assisted,omitempty"`
}

// NoticeEventType: what the forecaster gets.
func NoticeEventType(noticeType string) string {
	switch noticeType {
	case "sports_match", "festival", "concert", "conference":
		return "season_event"
	}
	return "other"
}

func inList(s string, list []string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// Check: the notice event's own rules.
func (n NoticeRange) Check() error {
	r := Range{Start: n.Start, End: n.End, Name: n.Name}
	if !r.valid() || n.Name == "" {
		return fmt.Errorf("needs start and end dates (YYYY-MM-DD, end not before start) and a name up to 120 characters")
	}
	if days := parse(n.End).Sub(parse(n.Start)).Hours() / 24; days >= MaxNoticeDays {
		return fmt.Errorf("lasts at most %d days", MaxNoticeDays)
	}
	if len([]rune(n.NameAr)) > 120 {
		return fmt.Errorf("name_ar has at most 120 characters")
	}
	if !inList(n.Type, NoticeTypes) {
		return fmt.Errorf("type must be one of the notice types")
	}
	if !inList(n.Impact, Impacts) {
		return fmt.Errorf("impact must be low, medium or high")
	}
	for _, t := range []string{n.StartTime, n.EndTime} {
		if t != "" && !hhmm.MatchString(t) {
			return fmt.Errorf("times are HH:MM")
		}
	}
	if n.Start == n.End && n.StartTime != "" && n.EndTime != "" && n.EndTime < n.StartTime && n.EndTime != "00:00" {
		return fmt.Errorf("the end time is before the start time")
	}
	if len(n.ZoneIDs) > MaxNoticeZones {
		return fmt.Errorf("at most %d zones", MaxNoticeZones)
	}
	if len([]rune(n.ImpactReason)) > maxNoticeTextRune || len([]rune(n.Quote)) > maxNoticeTextRune {
		return fmt.Errorf("impact_reason and quote have at most %d characters", maxNoticeTextRune)
	}
	return nil
}

// ValidNotices keeps the usable ones, by start.
func ValidNotices(ns []NoticeRange) []NoticeRange {
	var out []NoticeRange
	for _, n := range ns {
		if n.Check() == nil {
			out = append(out, n)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}

func asNotices(value any) ([]NoticeRange, error) {
	if ns, ok := value.([]NoticeRange); ok {
		b, _ := json.Marshal(ns)
		value = nil
		if err := json.Unmarshal(b, &value); err != nil {
			return nil, err
		}
	}
	list, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("%s must be a list of notice events", KeyNoticeEvents)
	}
	if len(list) > MaxNoticeEvents {
		return nil, fmt.Errorf("%s holds at most %d events", KeyNoticeEvents, MaxNoticeEvents)
	}
	out := make([]NoticeRange, 0, len(list))
	for i, item := range list {
		b, err := json.Marshal(item)
		if err != nil {
			return nil, err
		}
		var n NoticeRange
		if err := json.Unmarshal(b, &n); err != nil {
			return nil, fmt.Errorf("%s item %d: %v", KeyNoticeEvents, i+1, err)
		}
		if err := n.Check(); err != nil {
			return nil, fmt.Errorf("%s item %d %v", KeyNoticeEvents, i+1, err)
		}
		out = append(out, n)
	}
	return out, nil
}

func (n NoticeRange) has(d string) bool { return d >= n.Start && d <= n.End }

// noticeEvents: the day's notice events.
func (c Config) noticeEvents(date string) []Event {
	var out []Event
	for _, n := range ValidNotices(c.NoticeEvents) {
		if n.has(date) {
			out = append(out, Event{Type: NoticeEventType(n.Type), Name: n.Name, ZoneIDs: append([]string(nil), n.ZoneIDs...)})
		}
	}
	return out
}

// GregorianOfHijri: Umm al-Qura to YYYY-MM-DD.
func GregorianOfHijri(year, month, day int) (out string, ok bool) {
	if year < 1357 || year > 1499 || month < 1 || month > 12 || day < 1 || day > 30 {
		return "", false
	}
	defer func() {
		if recover() != nil {
			out, ok = "", false
		}
	}()
	t := hijri.UmmAlQuraDate{Year: int64(year), Month: int64(month), Day: int64(day)}.ToGregorian()
	g := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	back := HijriOf(g)
	// Day 30 of a 29-day month rolls over
	if back == nil || back.Year != year || back.Month != month || back.Day != day {
		return "", false
	}
	return g, true
}
