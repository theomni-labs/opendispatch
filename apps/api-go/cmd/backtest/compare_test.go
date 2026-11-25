// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
)

func TestModelsFlagWritesOneComparison(t *testing.T) {
	srv := enginetest.New()
	defer srv.Close()
	srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: `{"model_version":"m1","values":[]}`})
	path := filepath.Join(t.TempDir(), "cmp", "comparison.json")
	var so, se bytes.Buffer
	args := []string{"-synthetic", "-fixtures", "../../../../fixtures", "-long-synthetic", "-weeks", "5", "-volume", "0.05",
		"-models", "m1,naive", "-seeds", "3,4", "-compare-windows", "w=2026-09-17:14", "-engine-url", srv.URL, "-compare-out", path}
	if err := run(context.Background(), args, env(""), &so, &se); err != nil {
		t.Fatalf("%v\n%s", err, se.String())
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Illustrative bool    `json:"illustrative"`
		Seeds        []int64 `json:"seeds"`
		Origins      int     `json:"origins_per_model"`
		Models       []struct {
			Name     string `json:"name"`
			Requests int    `json:"requests"`
		} `json:"models"`
	}
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, m := range c.Models {
		names = append(names, m.Name)
		if m.Requests != 4 {
			t.Fatalf("%s: %d requests, want 2 origins x 2 seeds", m.Name, m.Requests)
		}
	}
	if !c.Illustrative || len(c.Seeds) != 2 || c.Origins != 2 || strings.Join(names, ",") != "m1,naive,segment" {
		t.Fatalf("comparison %+v", c)
	}
	if len(srv.Requests()) != 4 || !strings.Contains(srv.Requests()[0].Body, `"model_version":"m1"`) {
		t.Fatalf("engine saw %d requests", len(srv.Requests()))
	}
	if !strings.Contains(so.String(), "ILLUSTRATIVE") {
		t.Fatalf("text report:\n%s", so.String())
	}
}

func TestModelsFlagNeedsAnEngineForEngineModels(t *testing.T) {
	var so, se bytes.Buffer
	args := []string{"-synthetic", "-fixtures", "../../../../fixtures", "-long-synthetic", "-weeks", "5", "-volume", "0.05",
		"-models", "ets-1", "-compare-windows", "w=2026-09-17:14", "-out", t.TempDir()}
	err := run(context.Background(), args, env(""), &so, &se)
	if err == nil || !strings.Contains(err.Error(), "engine-url") {
		t.Fatalf("got %v", err)
	}
}

func TestParseWindowsRefusesBadItems(t *testing.T) {
	for _, s := range []string{"", "a", "a=2026-01-01", "a=2026-01-01:x", "=2026-01-01:3"} {
		if _, err := parseWindows(s); err == nil {
			t.Errorf("%q: want an error", s)
		}
	}
	w, err := parseWindows(DefaultCompareWindows)
	if err != nil || len(w) != 2 || w[1].Name != "ramadan-eid" {
		t.Fatalf("%v %v", w, err)
	}
}
