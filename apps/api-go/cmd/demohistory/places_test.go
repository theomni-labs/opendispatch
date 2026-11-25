// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
)

func TestPlaceRowsAddsSyntheticPositions(t *testing.T) {
	start := time.Date(2026, 1, 1, 8, 0, 0, 0, riyadh)
	res := &backtest.LongResult{Dataset: &backtest.Dataset{Intervals: []backtest.HistoryRecord{
		{SubZoneID: "s1", Start: start, Total: 3, Field: 1},
		{SubZoneID: "s2", Start: start, Total: 1, Field: 0},
	}}}
	places := backtest.NewPlaces(map[string][2]float64{"s1": {24.7, 46.7}})
	rows := placeRows(buildRows(res, "t", map[string]string{"s1": "z1", "s2": "z1"}, nil, testFields(), 1), places, 1)
	if len(rows) != 4 {
		t.Fatalf("rows %d", len(rows))
	}
	for _, r := range rows {
		if len(r) != len(copyColumns()) {
			t.Fatalf("row %v", r)
		}
		lat, _ := r[len(r)-2].(float64)
		if r[7] == "s1" && (lat < 24.68 || lat > 24.72) {
			t.Fatalf("s1 position %v is not near its centre", r[len(r)-2:])
		}
		if r[7] == "s2" && r[len(r)-2] != nil {
			t.Fatal("a sub-zone without a centre gets no position")
		}
	}
}
