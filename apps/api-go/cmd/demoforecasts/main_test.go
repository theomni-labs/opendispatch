// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
)

func TestProgressLineCountsTheDays(t *testing.T) {
	got := progressLine(3, 28, business.PastForecast{Date: "2026-08-19", RunID: "r1"}, 7*time.Second)
	if got != "   [3/28] 2026-08-19: run r1 (SYNTHETIC history before that day), 7s" {
		t.Fatalf("got %q", got)
	}
	if s := progressLine(1, 28, business.PastForecast{Date: "2026-08-17", Skipped: true}, 0); s != "   [1/28] 2026-08-17: a run exists, skipped, 0s" {
		t.Fatalf("skipped %q", s)
	}
}

func TestCheckDemoURLRefusesNonDemoOrRemote(t *testing.T) {
	for dsn, ok := range map[string]bool{
		"postgres://u@127.0.0.1:5432/opendispatch_demo":  true,
		"postgres://u@localhost/opendispatch_demo":       true,
		"postgres://u@127.0.0.1:5432/opendispatch":       false,
		"postgres://u@db.example:5432/opendispatch_demo": false,
		"": false,
	} {
		if err := checkDemoURL(dsn); (err == nil) != ok {
			t.Errorf("%q: got %v", dsn, err)
		}
	}
}
