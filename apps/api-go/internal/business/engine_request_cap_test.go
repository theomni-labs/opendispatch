// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestForecastRequestDropsTheOldestDaysWhenOverTheCap(t *testing.T) {
	src := testForecasterSource()
	src.StartDate = "2026-09-14"
	src.Calendar = nil
	for i := -10; i < 1; i++ {
		d := forecastDay{Date: shiftDateBy("2026-09-14", i)}
		applyCalendar(&d, forecastCalendarConfig(context.Background(), ""))
		src.Calendar = append(src.Calendar, d)
	}
	src.History = nil
	for d := 10; d >= 1; d-- {
		for i := 0; i < 30; i++ {
			src.History = append(src.History, historyRow{SubZoneID: tSub1, IntervalStart: tNow.AddDate(0, 0, -d).Add(time.Duration(i) * 15 * time.Minute), Total: 2, Field: 1})
		}
	}
	full, err := buildForecasterRequest(src)
	if err != nil {
		t.Fatal(err)
	}
	old := forecastRequestCap
	forecastRequestCap = len(full) * 6 / 10
	defer func() { forecastRequestCap = old }()
	small, err := buildForecasterRequest(src)
	if err != nil {
		t.Fatal(err)
	}
	if len(small) > forecastRequestCap || len(small) >= len(full) {
		t.Fatalf("%d bytes, cap %d, full %d", len(small), forecastRequestCap, len(full))
	}
	checkRequest(t, "forecaster", small)
	var doc struct {
		Calendar []struct{ Date string }
		History  struct {
			Records []struct {
				IntervalStart string `json:"interval_start"`
			}
		}
	}
	if err := json.Unmarshal(small, &doc); err != nil {
		t.Fatal(err)
	}
	last := doc.Calendar[len(doc.Calendar)-1].Date
	if last != "2026-09-14" || len(doc.Calendar) >= 11 {
		t.Fatalf("calendar of %d ending %s", len(doc.Calendar), last)
	}
	if doc.History.Records[0].IntervalStart[:10] == full2first(full) {
		t.Fatal("the oldest day was kept")
	}
}

func full2first(full []byte) string {
	var doc struct {
		History struct {
			Records []struct {
				IntervalStart string `json:"interval_start"`
			}
		}
	}
	_ = json.Unmarshal(full, &doc)
	return doc.History.Records[0].IntervalStart[:10]
}

func TestForecastRequestKeepsAsManyDaysAsFitUnderTheRawCap(t *testing.T) {
	src := testForecasterSource()
	src.StartDate = "2026-09-14"
	src.History = nil
	for d := 20; d >= 1; d-- {
		for i := 0; i < 30; i++ {
			src.History = append(src.History, historyRow{SubZoneID: tSub1, IntervalStart: tNow.AddDate(0, 0, -d).Add(time.Duration(i) * 15 * time.Minute), Total: 2, Field: 1})
		}
	}
	full, err := buildForecasterRequest(src)
	if err != nil {
		t.Fatal(err)
	}
	old := forecastRawCap
	defer func() { forecastRawCap = old }()
	forecastRawCap = len(full) * 6 / 10
	small, err := buildForecasterRequest(src)
	if err != nil {
		t.Fatal(err)
	}
	perDay := len(full) / 20
	if len(small) > forecastRawCap || len(small)+2*perDay < forecastRawCap {
		t.Fatalf("%d bytes for cap %d, a day is about %d", len(small), forecastRawCap, perDay)
	}
	forecastRawCap = 100
	if _, err := buildForecasterRequest(src); err == nil {
		t.Fatal("a request that cannot fit must fail")
	}
}
