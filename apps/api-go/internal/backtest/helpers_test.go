// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

const fixturesDir = "../../../../fixtures"

func ts(day, hm string) time.Time {
	t, err := time.Parse(time.RFC3339, day+"T"+hm+":00+03:00")
	if err != nil {
		panic(err)
	}
	return t
}

func tp(t time.Time) *time.Time { return &t }

func writeJSON(t *testing.T, path string, v any) {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatal(err)
	}
}

func dsOf(cases ...Case) *Dataset {
	ds := &Dataset{Cases: cases, Agents: map[string]Agent{}, Standby: map[string]Point{},
		ZoneSubs: map[string][]string{}, DataSource: SourceSynthetic}
	seen := map[string]bool{}
	for _, c := range cases {
		if !seen[c.ZoneID+c.subZone()] {
			seen[c.ZoneID+c.subZone()] = true
			ds.ZoneSubs[c.ZoneID] = append(ds.ZoneSubs[c.ZoneID], c.subZone())
		}
	}
	return ds
}
