// SPDX-License-Identifier: AGPL-3.0-only

package traffic

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

func TestSyntheticIsStableAndBounded(t *testing.T) {
	a, b := Synthetic(1, "Riyadh", "2026-03-04"), Synthetic(1, " riyadh ", "2026-03-04")
	if a != b {
		t.Fatalf("same inputs differ: %+v %+v", a, b)
	}
	heavy, n := 0, 0
	for d := 0; d < 365; d++ {
		day := Synthetic(7, "Jeddah", shift("2025-01-01", d))
		if day.CongestionIndex < 0.3 || day.CongestionIndex > MaxIndex || day.Source != SyntheticLabel {
			t.Fatalf("out of range: %+v", day)
		}
		n++
		if day.Heavy() {
			heavy++
		}
	}
	if share := float64(heavy) / float64(n); share < 0.04 || share > 0.25 {
		t.Fatalf("heavy share %.2f, want a minority of days", share)
	}
}

func shift(date string, days int) string {
	f, _, _ := checkRange(date, date)
	return f.AddDate(0, 0, days).Format(dateLayout)
}

func TestSyntheticSourceCoversEveryCityDay(t *testing.T) {
	cities := []weather.City{{ID: "c1", NameEn: "Riyadh"}, {ID: "c2", NameEn: "Jeddah"}}
	days, err := SyntheticSource{Seed: 3}.Days(context.Background(), cities, "2026-09-01", "2026-09-30")
	if err != nil || len(days) != 60 {
		t.Fatalf("got %d days, %v", len(days), err)
	}
	if days[0].CityID != "c1" || days[59].CityID != "c2" {
		t.Fatalf("not sorted by city: %+v", days[0])
	}
}

func TestParseConfig(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	c, err := ParseConfig(env(nil))
	if err != nil || c.Kind != "none" {
		t.Fatalf("default: %+v %v", c, err)
	}
	if _, ok := c.Build().(NoneSource); !ok {
		t.Fatal("none builds a NoneSource")
	}
	c, err = ParseConfig(env(map[string]string{EnvSource: "synthetic", EnvSeed: "9"}))
	if err != nil || c.Seed != 9 {
		t.Fatalf("synthetic: %+v %v", c, err)
	}
	if _, err := ParseConfig(env(map[string]string{EnvSource: "file"})); err == nil {
		t.Fatal("file without a path must fail")
	}
	if _, err := ParseConfig(env(map[string]string{EnvSource: "http"})); err == nil {
		t.Fatal("unknown kind must fail")
	}
}

func TestFileSourceReadsTheImportFormat(t *testing.T) {
	path := filepath.Join(t.TempDir(), "traffic.csv")
	body := "city,date,congestion_index,source\nRD,2026-09-01,1.31,tomtom\nJeddah,2026-09-01,0.9,\nRD,2026-09-01,1.0,\nRD,2026-09-02,7,\nAbha,2026-09-02,1.1,\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	f := NewFileSource(path)
	cities := []weather.City{{ID: "r", Code: "RD", NameEn: "Riyadh"}, {ID: "j", Code: "JD", NameEn: "Jeddah"}}
	days, err := f.Days(context.Background(), cities, "2026-09-01", "2026-09-30")
	if err == nil || !strings.Contains(err.Error(), "1 row(s) match no city") {
		t.Fatalf("want the unmatched row reported, got %v", err)
	}
	if len(days) != 2 || days[1].CityID != "r" || !days[1].Heavy() || days[1].Source != "tomtom" || days[0].Source != "file" {
		t.Fatalf("days: %+v", days)
	}
	issues := f.Issues()
	if len(issues) != 2 || !strings.Contains(issues[0], "duplicate") || !strings.Contains(issues[1], "congestion_index") {
		t.Fatalf("issues: %v", issues)
	}
}

func TestTheFormatFileListsTheColumns(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "config", "mappings", "traffic", "traffic_v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		Columns []struct {
			Column   string `json:"column"`
			Required bool   `json:"required"`
		} `json:"columns"`
	}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	var req []string
	for _, c := range m.Columns {
		if c.Required {
			req = append(req, c.Column)
		}
	}
	if strings.Join(req, ",") != strings.Join(FileColumns, ",") {
		t.Fatalf("format file %v, reader %v", req, FileColumns)
	}
}

func TestFileSourceNeedsTheColumns(t *testing.T) {
	if _, _, err := ParseFile([]byte("city,date\nRD,2026-09-01\n")); err == nil {
		t.Fatal("a missing congestion_index column must fail")
	}
}
