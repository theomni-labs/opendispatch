// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadJSONAndCSV(t *testing.T) {
	dir := t.TempDir()
	writeJSON(t, filepath.Join(dir, "cases", "a.json"), []map[string]any{
		{"id": "c1", "data_source": "SYNTHETIC", "registered_at": "2026-09-06T08:00:00+03:00", "zone_id": "z1", "sub_zone_id": "s1", "handling": "field"},
		{"id": "c2", "data_source": "SYNTHETIC", "registered_at": "2026-09-06T09:00:00+03:00", "zone_id": "z1", "handling": "remote_inferred"},
	})
	csv := "id,data_source,registered_at,zone_id,assigned_at,latitude\n" +
		"c3,SYNTHETIC,2026-09-06T10:00:00+03:00,z2,2026-09-06T10:05:00+03:00,24.7\n" +
		"c1,SYNTHETIC,2026-09-06T08:00:00+03:00,z1,,\n"
	if err := os.WriteFile(filepath.Join(dir, "cases", "b.csv"), []byte(csv), 0o644); err != nil {
		t.Fatal(err)
	}
	ds, err := Load(LoadOptions{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if len(ds.Cases) != 3 || ds.DataSource != SourceSynthetic {
		t.Fatalf("cases %d source %s", len(ds.Cases), ds.DataSource)
	}
	if ds.Cases[2].AssignedAt == nil || ds.Cases[2].Latitude != 24.7 {
		t.Fatalf("csv row not parsed: %+v", ds.Cases[2])
	}
	if got := ds.ZoneSubs["z1"]; len(got) != 2 {
		t.Fatalf("z1 sub-zones %v", got)
	}
}

func TestLoadRejectsMissingSourceAndMixes(t *testing.T) {
	dir := t.TempDir()
	writeJSON(t, filepath.Join(dir, "cases.json"), []map[string]any{
		{"id": "c1", "registered_at": "2026-09-06T08:00:00+03:00", "zone_id": "z1"},
	})
	if _, err := Load(LoadOptions{Dir: dir}); err == nil {
		t.Fatal("expected an error for a case without data_source")
	}
	writeJSON(t, filepath.Join(dir, "cases.json"), []map[string]any{
		{"id": "c1", "data_source": "SYNTHETIC", "registered_at": "2026-09-06T08:00:00+03:00", "zone_id": "z1"},
		{"id": "c2", "data_source": "IMPORTED", "registered_at": "2026-09-06T08:00:00+03:00", "zone_id": "z1"},
	})
	ds, err := Load(LoadOptions{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if ds.DataSource != SourceMixed || !ds.Illustrative() {
		t.Fatalf("source %s", ds.DataSource)
	}
}

func TestLoadEmptyDir(t *testing.T) {
	if _, err := Load(LoadOptions{Dir: t.TempDir()}); err == nil {
		t.Fatal("expected an error for no cases")
	}
}
