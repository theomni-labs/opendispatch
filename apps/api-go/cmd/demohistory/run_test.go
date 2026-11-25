// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
)

func TestCheckDemoURL(t *testing.T) {
	if err := CheckDemoURL("postgres://u:p@127.0.0.1:5432/opendispatch_demo"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"", "postgres://u:p@127.0.0.1:5432/opendispatch", "postgres://u:p@db.example.com:5432/opendispatch_demo"} {
		if CheckDemoURL(bad) == nil {
			t.Fatalf("%q should be refused", bad)
		}
	}
}

func TestBuildRowsSyntheticAndCounts(t *testing.T) {
	start := time.Date(2026, 1, 1, 8, 0, 0, 0, riyadh)
	res := &backtest.LongResult{Dataset: &backtest.Dataset{Intervals: []backtest.HistoryRecord{
		{SubZoneID: "s1", Start: start, Total: 3, Field: 1},
		{SubZoneID: "s1", Start: start.Add(15 * time.Minute), Total: 2, Field: 2},
	}}}
	rows := buildRows(res, "t", map[string]string{"s1": "z1"}, map[string]string{"z1": "c1"}, testFields(), 1)
	if len(rows) != 5 {
		t.Fatalf("rows %d", len(rows))
	}
	field := 0
	seen := map[any]bool{}
	for _, r := range rows {
		if r[1] != "SYNTHETIC" || r[6] != "z1" || r[5] != "c1" {
			t.Fatalf("row %v", r)
		}
		if r[8] == "field" {
			field++
		}
		seen[r[2]] = true
		at := r[3].(time.Time)
		if at.Before(start) || !at.Before(start.Add(30*time.Minute)) {
			t.Fatalf("time %v outside intervals", at)
		}
	}
	if field != 3 || len(seen) != 5 {
		t.Fatalf("field %d unique numbers %d", field, len(seen))
	}
}
