// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecasthist"
)

// longSource: 7 days of 15 minutes, 60 of totals.
func longSource() forecasterSource {
	src := testForecasterSource()
	src.StartDate = "2026-09-14"
	src.Calendar = nil
	for i := -67; i < 1; i++ {
		d := forecastDay{Date: shiftDateBy("2026-09-14", i)}
		applyCalendar(&d, forecastCalendarConfig(context.Background(), ""))
		src.Calendar = append(src.Calendar, d)
	}
	start, _ := riyadhMidnight("2026-09-14")
	src.History = nil
	for d := 7; d >= 1; d-- {
		for i := 0; i < 40; i++ {
			src.History = append(src.History, historyRow{SubZoneID: tSub1, IntervalStart: start.AddDate(0, 0, -d).Add(time.Duration(i) * 15 * time.Minute), Total: 2, Field: 1})
		}
	}
	for d := 67; d > 7; d-- {
		src.Aggregated = append(src.Aggregated, historyRow{SubZoneID: tSub1, IntervalStart: start.AddDate(0, 0, -d), Total: 90, Field: 40, Minutes: 1440})
	}
	return src
}

type sentHistory struct {
	Calendar []struct{ Date string }
	History  struct {
		Records    []forecasthist.Record    `json:"records"`
		Aggregated []forecasthist.Aggregate `json:"aggregated_records"`
	}
}

func TestForecastRequestCarriesAggregatedHistory(t *testing.T) {
	raw, err := buildForecasterRequest(longSource())
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "forecaster", raw)
	var doc sentHistory
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	a := doc.History.Aggregated
	if len(a) != 60 || a[0].PeriodStart != "2026-07-09T00:00:00+03:00" || a[0].PeriodMinutes != 1440 || len(doc.History.Records) != 280 {
		t.Fatalf("%d totals from %s, %d records", len(a), a[0].PeriodStart, len(doc.History.Records))
	}
	if len(doc.Calendar) != 68 {
		t.Fatalf("calendar of %d days", len(doc.Calendar))
	}
	plain := longSource()
	plain.Aggregated = nil
	raw, err = buildForecasterRequest(plain)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]map[string]any
	_ = json.Unmarshal(raw, &m)
	if _, has := m["history"]["aggregated_records"]; has {
		t.Fatal("no totals: the key must be absent")
	}
}

func TestForecastTrimDropsOldestTotalsFirst(t *testing.T) {
	full, err := buildForecasterRequest(longSource())
	if err != nil {
		t.Fatal(err)
	}
	old := forecastRawCap
	defer func() { forecastRawCap = old }()
	forecastRawCap = len(full) - 1500
	small, err := buildForecasterRequest(longSource())
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "forecaster", small)
	var doc sentHistory
	if err := json.Unmarshal(small, &doc); err != nil {
		t.Fatal(err)
	}
	a := doc.History.Aggregated
	if len(doc.History.Records) != 280 || len(a) == 0 || len(a) >= 60 {
		t.Fatalf("kept %d records and %d totals", len(doc.History.Records), len(a))
	}
	if doc.Calendar[0].Date != a[0].PeriodStart[:10] {
		t.Fatalf("calendar starts %s, history %s", doc.Calendar[0].Date, a[0].PeriodStart)
	}
}

func TestRamadanOutsideTheHijriTable(t *testing.T) {
	months := allHijriMonths()
	cal := forecastCalendarConfig(context.Background(), "")
	if r, outside := ramadanOutside("2024-03-20", months, cal); !outside || !r {
		t.Fatalf("Ramadan 1445: %v %v", r, outside)
	}
	if r, outside := ramadanOutside("2024-05-20", months, cal); !outside || r {
		t.Fatalf("after Ramadan 1445: %v %v", r, outside)
	}
	if len(months) > 0 {
		if _, outside := ramadanOutside(months[0].GregorianStart, months, cal); outside {
			t.Fatal("inside the table the table decides")
		}
	}
}

func TestForecastHistorySettings(t *testing.T) {
	resetSettings(t)
	if s := forecastHistorySettings(context.Background(), ""); s != forecasthist.Defaults() {
		t.Fatalf("defaults %+v", s)
	}
	putSetting(t, forecasthist.KeyDetailWeeks, 8)
	putSetting(t, forecasthist.KeyYears, 1)
	putSetting(t, forecasthist.KeyAggMinutes, 60)
	if s := forecastHistorySettings(context.Background(), ""); s != (forecasthist.Settings{DetailWeeks: 8, Years: 1, AggMinutes: 60}) {
		t.Fatalf("stored %+v", s)
	}
}
