// SPDX-License-Identifier: AGPL-3.0-only

package fixtures

import "testing"

type testOptimizerOutput struct {
	RosterDate string `json:"roster_date"`
	Engine     struct {
		Version string `json:"version"`
	} `json:"engine"`
	GapCells []struct {
		ZoneID        string `json:"zone_id"`
		IntervalIndex int    `json:"interval_index"`
		Required      int    `json:"required"`
	} `json:"gap_cells"`
}

func TestObject_ReadsRealOptimizerOutputFixture(t *testing.T) {
	ClearCacheForTest()
	var out testOptimizerOutput
	found, err := Object("optimizer.output", &out)
	if err != nil {
		t.Fatalf("Object: %v", err)
	}
	if !found {
		t.Fatalf("optimizer.output not found in the real fixtures/manifest.json")
	}
	if out.RosterDate == "" || out.Engine.Version == "" || len(out.GapCells) == 0 {
		t.Fatalf("got %+v (only %d gap cells), want a filled baseline", out, len(out.GapCells))
	}
}

func TestObject_UnknownSchemaReportsNotFound(t *testing.T) {
	ClearCacheForTest()
	var out map[string]any
	found, err := Object("no-such-schema", &out)
	if err != nil {
		t.Fatalf("Object: %v", err)
	}
	if found {
		t.Fatalf("got found=true for a schema that does not exist")
	}
}

func TestDir_RespectsOverride(t *testing.T) {
	t.Setenv("OPENDISPATCH_FIXTURES_DIR", "/tmp/does-not-matter")
	dir, err := Dir()
	if err != nil {
		t.Fatalf("Dir: %v", err)
	}
	if dir != "/tmp/does-not-matter" {
		t.Fatalf("got %q, want the override honored", dir)
	}
}

func TestRecords_ReadsRealAssignmentOutputFixture(t *testing.T) {
	ClearCacheForTest()
	type row struct {
		CaseID string `json:"case_id"`
	}
	rows, err := Records[row]("assignment.output")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 839 {
		t.Fatalf("got %d rows, want 839", len(rows))
	}
	if rows[0].CaseID == "" {
		t.Fatalf("got %+v, want a populated case_id", rows[0])
	}
}

func TestSeed_ReadsRealManifestSeed(t *testing.T) {
	ClearCacheForTest()
	seed, err := Seed()
	if err != nil {
		t.Fatal(err)
	}
	if seed == "" {
		t.Fatalf("got empty seed")
	}
}
