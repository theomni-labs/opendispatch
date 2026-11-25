// SPDX-License-Identifier: AGPL-3.0-only

// Ports gen/time.ts: instants are integer epoch
// seconds; local time is Asia/Riyadh, fixed +03:00
// (no DST), so all arithmetic is plain integer math.
package synthetic

import (
	"fmt"
	"regexp"
	"strconv"
	"time"
)

const riyadhOffsetSeconds = 3 * 3600
const slotSeconds = 900

// SlotsPerDay: 15-minute slots in one day.
const SlotsPerDay = 96

const daySeconds = 86400

var weekdays = [7]string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}

var dateRe = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)

// dayStart: epoch seconds of local midnight (Riyadh)
// at the start of date (YYYY-MM-DD).
func dayStart(date string) (int64, error) {
	m := dateRe.FindStringSubmatch(date)
	if m == nil {
		return 0, fmt.Errorf("not a YYYY-MM-DD date: %s", date)
	}
	y, _ := strconv.Atoi(m[1])
	mo, _ := strconv.Atoi(m[2])
	d, _ := strconv.Atoi(m[3])
	t := time.Date(y, time.Month(mo), d, 0, 0, 0, 0, time.UTC)
	return t.Unix() - riyadhOffsetSeconds, nil
}

// localDate: the local calendar date of the instant.
func localDate(epoch int64) string {
	t := time.Unix(epoch+riyadhOffsetSeconds, 0).UTC()
	return t.Format("2006-01-02")
}

// secondsOfDay: seconds since local midnight.
func secondsOfDay(epoch int64) int64 {
	return (((epoch + riyadhOffsetSeconds) % daySeconds) + daySeconds) % daySeconds
}

// isoAt: ISO 8601 with the +03:00 offset.
func isoAt(epoch int64) string {
	t := time.Unix(epoch+riyadhOffsetSeconds, 0).UTC()
	return t.Format("2006-01-02T15:04:05") + "+03:00"
}

// parseIso: epoch seconds of an ISO 8601 timestamp
// with an offset. Whole seconds only.
func parseIso(text string) (int64, error) {
	t, err := time.Parse(time.RFC3339, text)
	if err != nil {
		return 0, fmt.Errorf("not an ISO 8601 timestamp: %s", text)
	}
	return t.Unix(), nil
}

var clockRe = regexp.MustCompile(`^(\d{2}):(\d{2})(?::(\d{2}))?$`)

// parseClock: seconds since midnight for "HH:MM" or
// "HH:MM:SS". "24:00" means 86400.
func parseClock(text string) (int64, error) {
	m := clockRe.FindStringSubmatch(text)
	if m == nil {
		return 0, fmt.Errorf("not an HH:MM clock time: %s", text)
	}
	h, _ := strconv.Atoi(m[1])
	mi, _ := strconv.Atoi(m[2])
	s := 0
	if m[3] != "" {
		s, _ = strconv.Atoi(m[3])
	}
	return int64(h*3600 + mi*60 + s), nil
}

// addDays mirrors addDays.
func addDays(date string, days int) (string, error) {
	start, err := dayStart(date)
	if err != nil {
		return "", err
	}
	return localDate(start + int64(days)*daySeconds + 12*3600), nil
}

// dateRange: every date first to last, inclusive.
func dateRange(first, last string) ([]string, error) {
	var out []string
	d := first
	for d <= last {
		out = append(out, d)
		next, err := addDays(d, 1)
		if err != nil {
			return nil, err
		}
		d = next
	}
	return out, nil
}

// weekdayOf mirrors weekdayOf.
func weekdayOf(date string) (string, error) {
	start, err := dayStart(date)
	if err != nil {
		return "", err
	}
	t := time.Unix(start+riyadhOffsetSeconds, 0).UTC()
	return weekdays[int(t.Weekday())], nil
}

// yymmdd: compact date for ids, e.g. 260906.
func yymmdd(date string) string {
	return date[2:4] + date[5:7] + date[8:10]
}
