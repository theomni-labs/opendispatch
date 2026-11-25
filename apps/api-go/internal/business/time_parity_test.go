// SPDX-License-Identifier: AGPL-3.0-only

// Parity with the TS adhan and Intl oracle (testdata).
package business

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type parityFile struct {
	Hijri  map[string][3]int `json:"hijri"`
	Cities []struct {
		ID    string            `json:"id"`
		Name  string            `json:"name"`
		Lat   float64           `json:"lat"`
		Lng   float64           `json:"lng"`
		Times map[string]string `json:"times"`
	} `json:"cities"`
}

func loadParity(t *testing.T) parityFile {
	raw, err := os.ReadFile("testdata/time_parity.json")
	check(t, err)
	var f parityFile
	check(t, json.Unmarshal(raw, &f))
	return f
}

func TestParity_HijriExact(t *testing.T) {
	f := loadParity(t)
	bad := 0
	for date, want := range f.Hijri {
		got, err := ToHijriDate(date)
		check(t, err)
		if got.Year != want[0] || got.Month != want[1] || got.Day != want[2] {
			bad++
			if bad <= 10 {
				t.Errorf("%s: got %d-%d-%d, want %d-%d-%d", date, got.Year, got.Month, got.Day, want[0], want[1], want[2])
			}
		}
	}
	t.Logf("hijri: %d dates, %d differ", len(f.Hijri), bad)
	if bad > 0 {
		t.Fatalf("%d hijri dates differ", bad)
	}
}

func TestParity_PrayerTimesToTheMinute(t *testing.T) {
	f := loadParity(t)
	total, bad := 0, 0
	for _, c := range f.Cities {
		for date, want := range c.Times {
			pt, err := computePrayerTimeFor(c.ID, c.Lat, c.Lng, date)
			check(t, err)
			got := strings.Join([]string{pt.Fajr, pt.Sunrise, pt.Dhuhr, pt.Asr, pt.Maghrib, pt.Isha}, " ")
			total++
			if got != want {
				bad++
				if bad <= 10 {
					t.Errorf("%s %s: got %s, want %s", c.Name, date, got, want)
				}
			}
		}
	}
	t.Logf("prayer: %d city-days, %d differ", total, bad)
	if bad > 0 {
		t.Fatalf("%d city-days differ", bad)
	}
}

func TestParity_FixtureMonthsMatchLibrary(t *testing.T) {
	ReloadLeaveCalendarForTest()
	months := allHijriMonths()
	if len(months) != 13 {
		t.Fatalf("got %d seeded months, want 13", len(months))
	}
	for i, m := range months {
		if i == 0 {
			continue // the fixture clips its first month to 1 Jan
		}
		got, err := ToHijriDate(m.GregorianStart)
		check(t, err)
		if got.Year != m.HijriYear || got.Month != m.Month || got.Day != 1 {
			t.Errorf("%s: start is %d-%d-%d, fixture says %d-%d-1", m.NameEn, got.Year, got.Month, got.Day, m.HijriYear, m.Month)
		}
	}
}

func TestParity_FixturePrayerRowsMatchComputed(t *testing.T) {
	ReloadLeaveCalendarForTest()
	calendarMu.Lock()
	seedCalendarLocked()
	rows := append([]PrayerTime(nil), prayerTimeRows...)
	calendarMu.Unlock()
	f := loadParity(t)
	points := map[string][2]float64{}
	for _, c := range f.Cities {
		points[c.ID] = [2]float64{c.Lat, c.Lng}
	}
	if len(rows) != 21 {
		t.Fatalf("got %d seeded rows, want 21", len(rows))
	}
	for _, row := range rows {
		p := points[row.CityID]
		got, err := computePrayerTimeFor(row.CityID, p[0], p[1], row.PrayerDate)
		check(t, err)
		if got.Fajr != row.Fajr || got.Sunrise != row.Sunrise || got.Dhuhr != row.Dhuhr || got.Asr != row.Asr || got.Maghrib != row.Maghrib || got.Isha != row.Isha {
			t.Errorf("%s %s: fixture and computed differ", row.CityID, row.PrayerDate)
		}
	}
}

func TestToHijriDate_KnownDatesAndBadInput(t *testing.T) {
	for date, want := range map[string]HijriDate{
		"2026-02-18": {Year: 1447, Month: 9, Day: 1},
		"2026-09-13": {Year: 1448, Month: 4, Day: 2},
	} {
		got, err := ToHijriDate(date)
		check(t, err)
		if got != want {
			t.Errorf("%s: got %+v, want %+v", date, got, want)
		}
	}
	if _, err := ToHijriDate("2026-13-40"); err == nil {
		t.Fatalf("got nil error for a bad date")
	}
}
