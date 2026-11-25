// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/traffic"
)

func TestForecasterRequestCarriesTrafficOfItsCities(t *testing.T) {
	src := testForecasterSource()
	src.Traffic = []traffic.Day{
		{CityID: tCity, Date: "2026-09-13", CongestionIndex: 1.35, Source: "SYNTHETIC"},
		{CityID: tCity, Date: "2026-09-14", CongestionIndex: 9, Source: "SYNTHETIC"},
		{CityID: "79cd66f3-4fbf-4f73-b7cb-37929b4d5cf0", Date: "2026-09-14", CongestionIndex: 1},
	}
	raw, err := buildForecasterRequest(src)
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "forecaster", raw)
	var got struct {
		Traffic []traffic.Day `json:"traffic"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Traffic) != 1 || got.Traffic[0].CongestionIndex != 1.35 {
		t.Fatalf("want the one valid day of the zone's city, got %+v", got.Traffic)
	}
	none, err := buildForecasterRequest(testForecasterSource())
	if err != nil || strings.Contains(string(none), `"traffic"`) {
		t.Fatalf("no source must send no traffic key (%v)", err)
	}
}

func TestForecasterRequestTakesUpToThirtyDays(t *testing.T) {
	src := testForecasterSource()
	src.Days = 30
	raw, err := buildForecasterRequest(src)
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "forecaster", raw)
	src.Days = 31
	if _, err := buildForecasterRequest(src); err == nil {
		t.Fatal("31 days must be refused")
	}
}

func TestDefaultTrafficSourceIsNone(t *testing.T) {
	t.Setenv(traffic.EnvSource, "")
	if c, err := traffic.ParseConfig(func(k string) string { return "" }); err != nil || c.Kind != "none" {
		t.Fatalf("%+v %v", c, err)
	}
	old := trafficOverride
	trafficOverride = traffic.NoneSource{}
	t.Cleanup(func() { trafficOverride = old })
	if loadForecastTraffic(t.Context(), nil, "t", nil, nil, "2026-09-01", "2026-09-02") != nil || trafficSourceName() != "none" {
		t.Fatal("none reads nothing")
	}
}

func TestDatasetSnapshotIsStableAndOrderFree(t *testing.T) {
	at := time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC)
	a := forecasterSource{History: []historyRow{{SubZoneID: "s1", IntervalStart: at, Total: 3, Field: 2}, {SubZoneID: "s2", IntervalStart: at, Total: 1}}}
	b := forecasterSource{History: []historyRow{a.History[1], a.History[0]}}
	if datasetSnapshotID(a) == "" || datasetSnapshotID(a) != datasetSnapshotID(b) {
		t.Fatalf("same rows, other order: %q %q", datasetSnapshotID(a), datasetSnapshotID(b))
	}
	if !strings.HasPrefix(datasetSnapshotID(a), "ds-") || len(datasetSnapshotID(a)) != 19 {
		t.Fatalf("id %q", datasetSnapshotID(a))
	}
	c := forecasterSource{History: []historyRow{{SubZoneID: "s1", IntervalStart: at, Total: 4, Field: 2}, a.History[1]}}
	if datasetSnapshotID(c) == datasetSnapshotID(a) {
		t.Fatal("a changed count must change the id")
	}
	d := forecasterSource{History: a.History, Aggregated: []historyRow{{SubZoneID: "s1", IntervalStart: at.AddDate(-1, 0, 0), Total: 40, Minutes: 1440}}}
	if datasetSnapshotID(d) == datasetSnapshotID(a) {
		t.Fatal("older totals must change the id")
	}
	if datasetSnapshotID(forecasterSource{}) != "" {
		t.Fatal("no history, no id")
	}
	ds := &backtest.Dataset{Intervals: []backtest.HistoryRecord{{SubZoneID: "s1", Start: at, Total: 3, Field: 2}, {SubZoneID: "s2", Start: at, Total: 1}}}
	if backtestSnapshotID(ds) != datasetSnapshotID(a) {
		t.Fatal("the backtest's id must match the same 15-minute rows")
	}
}
