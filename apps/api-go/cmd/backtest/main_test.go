// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func env(dir string) func(string) string {
	return func(k string) string {
		if k == "OPENDISPATCH_DATA_DIR" {
			return dir
		}
		return ""
	}
}

func TestLongSyntheticRunsInMemoryAndSaysItIsIllustrative(t *testing.T) {
	var so, se bytes.Buffer
	out := filepath.Join(t.TempDir(), "res")
	args := []string{"-long-synthetic", "-weeks", "12", "-volume", "0.05", "-seed", "4", "-out", out}
	if err := run(context.Background(), args, env(""), &so, &se); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"data_source: SYNTHETIC", "illustrative: true", "known, made-up effects", "origins: 4", "1 event day"} {
		if !strings.Contains(so.String(), want) {
			t.Errorf("missing %q in\n%s", want, so.String())
		}
	}
}

func TestRefusesOutInsideRepoWhenDataDirSet(t *testing.T) {
	data := t.TempDir()
	out := filepath.Join("..", "..", "..", "..", "fixtures", "backtest-out")
	var so, se bytes.Buffer
	err := run(context.Background(), []string{"-out", out}, env(data), &so, &se)
	if err == nil || !strings.Contains(err.Error(), "inside a git repository") {
		t.Fatalf("got %v", err)
	}
	if _, statErr := os.Stat(out); statErr == nil {
		t.Fatal("the out dir must not be created")
	}
	if so.Len() != 0 {
		t.Fatal("nothing may be printed before the guard passes")
	}
}

func TestRefusesRealDataInsideRepo(t *testing.T) {
	var so, se bytes.Buffer
	err := run(context.Background(), []string{"-out", t.TempDir()}, env("../../../../fixtures"), &so, &se)
	if err == nil {
		t.Fatal("expected a refusal")
	}
}

func TestSegmentBaselineAndGateFlags(t *testing.T) {
	var so, se bytes.Buffer
	args := []string{"-long-synthetic", "-weeks", "12", "-volume", "0.05", "-out", filepath.Join(t.TempDir(), "r"), "-gate-baseline", "segment"}
	if err := run(context.Background(), args, env(""), &so, &se); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"segment-average (the customer's method)", "STAFFING CONSEQUENCE", "compared with: segment-average"} {
		if !strings.Contains(so.String(), want) {
			t.Errorf("missing %q in\n%s", want, so.String())
		}
	}
	if err := run(context.Background(), []string{"-gate-baseline", "x"}, env(""), &so, &se); err == nil {
		t.Error("a bad -gate-baseline must fail")
	}
}

func TestSyntheticRunWritesOnlyToOut(t *testing.T) {
	out := filepath.Join(t.TempDir(), "res")
	var so, se bytes.Buffer
	args := []string{"-synthetic", "-fixtures", "../../../../fixtures", "-out", out}
	if err := run(context.Background(), args, env(""), &so, &se); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(so.String(), "Synthetic data: these figures say nothing about accuracy on real cases.") {
		t.Fatalf("stdout lacks the notice:\n%s", so.String())
	}
	for _, f := range []string{"report.json", "report.txt"} {
		if _, err := os.Stat(filepath.Join(out, f)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRunWithDataFileOutsideDir(t *testing.T) {
	data := t.TempDir()
	cases := `[`
	for d := 1; d <= 9; d++ {
		if d > 1 {
			cases += ","
		}
		cases += `{"id":"c` + string(rune('0'+d)) + `","data_source":"IMPORTED","registered_at":"2026-09-0` + string(rune('0'+d)) + `T08:00:00+03:00","zone_id":"z1"}`
	}
	cases += `]`
	if err := os.WriteFile(filepath.Join(data, "cases.json"), []byte(cases), 0o644); err != nil {
		t.Fatal(err)
	}
	var so, se bytes.Buffer
	out := filepath.Join(t.TempDir(), "res")
	if err := run(context.Background(), []string{"-only", "forecast", "-out", out}, env(data), &so, &se); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(so.String(), "data_source: IMPORTED") || !strings.Contains(so.String(), "illustrative: false") {
		t.Fatalf("report:\n%s", so.String())
	}
}
