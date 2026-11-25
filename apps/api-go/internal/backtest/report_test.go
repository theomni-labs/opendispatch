// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixtureDataset(t *testing.T) *Dataset {
	t.Helper()
	ds, err := Load(LoadOptions{Dir: fixturesDir, ExtraCaseFiles: []string{filepath.Join(fixturesDir, "replay", "cases.json")}})
	if err != nil {
		t.Fatal(err)
	}
	return ds
}

func TestFixtureReportIsIllustrativeAndAggregateOnly(t *testing.T) {
	ds := fixtureDataset(t)
	if ds.DataSource != SourceSynthetic {
		t.Fatalf("source %s", ds.DataSource)
	}
	rep := NewReport(ds)
	var err error
	cfg := ForecastConfig{Candidate: SeasonalMean, CandidateName: "seasonal-mean-4-weeks"}
	if rep.Forecast, err = RunForecast(context.Background(), ds, cfg); err != nil {
		t.Fatal(err)
	}
	if rep.Replay, err = RunReplay(context.Background(), ds, ReplayConfig{}); err != nil {
		t.Fatal(err)
	}
	j, err := rep.JSON()
	if err != nil {
		t.Fatal(err)
	}
	for name, s := range map[string]string{"json": string(j), "text": rep.Text()} {
		if !strings.Contains(s, SyntheticNotice) {
			t.Fatalf("%s lacks the synthetic sentence", name)
		}
		if !strings.Contains(s, "SYNTHETIC") {
			t.Fatalf("%s lacks data_source", name)
		}
	}
	if !strings.Contains(string(j), `"illustrative": true`) || !rep.Illustrative {
		t.Fatal("report is not labelled illustrative")
	}
	if !strings.Contains(string(j), "share_within_10_min") || !strings.Contains(rep.Text(), "from registration") {
		t.Fatal("both 10-minute readings must appear")
	}
	for _, c := range ds.Cases {
		if strings.Contains(string(j), c.ID) || strings.Contains(rep.Text(), c.ID) {
			t.Fatalf("report contains case id %s", c.ID)
		}
	}
	for _, key := range []string{"registered_at", "latitude", "longitude", "agent_id", "case_id", "case_number"} {
		if strings.Contains(string(j), key) {
			t.Fatalf("report contains case-level key %q", key)
		}
	}
	if len(j) > 500_000 {
		t.Fatalf("report is %d bytes: too large to be aggregates", len(j))
	}
}

func TestNoticeByDataSource(t *testing.T) {
	for src, want := range map[string]string{
		SourceSynthetic: SyntheticNotice,
		SourceMixed:     SyntheticNotice,
		SourceImported:  "Imported sample",
		SourceLive:      "live",
	} {
		r := NewReport(&Dataset{DataSource: src})
		if !strings.Contains(r.Notice, want) {
			t.Fatalf("%s: notice %q", src, r.Notice)
		}
		if synth := src == SourceSynthetic || src == SourceMixed; r.Illustrative != synth {
			t.Fatalf("%s: illustrative %t", src, r.Illustrative)
		}
	}
}

func TestWriteFiles(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "out")
	if err := NewReport(&Dataset{DataSource: SourceSynthetic}).WriteFiles(dir); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"report.json", "report.txt"} {
		if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCheckOutRefusesRepoWhenDataDirSet(t *testing.T) {
	inRepo := filepath.Join(fixturesDir, "new-out")
	if err := CheckOut(inRepo, "/some/real/dir", false); err == nil {
		t.Fatal("expected a refusal for -out inside the repository")
	}
	if err := CheckOut(inRepo, "/some/real/dir", true); err == nil {
		t.Fatal("env set with -synthetic must still refuse")
	}
	if err := CheckOut(inRepo, "", false); err == nil {
		t.Fatal("real mode without an env dir must refuse too")
	}
	if err := CheckOut(filepath.Join(t.TempDir(), "x"), "/some/real/dir", false); err != nil {
		t.Fatalf("temp out refused: %v", err)
	}
	if err := CheckOut(inRepo, "", true); err != nil {
		t.Fatalf("synthetic-only run may write in the repo: %v", err)
	}
}

func TestCheckDataRefusesRepoAndMissingEnv(t *testing.T) {
	if err := CheckData(fixturesDir, false); err == nil {
		t.Fatal("real data inside the repository must be refused")
	}
	if err := CheckData("", false); err == nil {
		t.Fatal("missing env must be refused")
	}
	if err := CheckData(t.TempDir(), false); err != nil {
		t.Fatal(err)
	}
	if err := CheckData("", true); err != nil {
		t.Fatal(err)
	}
}
