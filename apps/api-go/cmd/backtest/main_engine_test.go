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

const engineAnswer = `{"model_version":"m9","model_info":{"feature_set":["dow","payday"],"training_start":"2026-09-01","training_end":"2026-09-08","history_days":8},"values":[]}`

func writeCases(t *testing.T, source string) string {
	t.Helper()
	data := t.TempDir()
	cases := `[`
	for d := 1; d <= 9; d++ {
		if d > 1 {
			cases += ","
		}
		cases += `{"id":"c` + string(rune('0'+d)) + `","data_source":"` + source + `","registered_at":"2026-09-0` + string(rune('0'+d)) + `T08:00:00+03:00","zone_id":"z1"}`
	}
	if err := os.WriteFile(filepath.Join(data, "cases.json"), []byte(cases+`]`), 0o644); err != nil {
		t.Fatal(err)
	}
	return data
}

func TestEngineBacktestPrintsJSONWithModelInfoAndShortHistory(t *testing.T) {
	srv := enginetest.New()
	defer srv.Close()
	srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: engineAnswer})
	var so, se bytes.Buffer
	args := []string{"-only", "forecast", "-forecaster", "engine", "-engine-url", srv.URL, "-json", "-out", filepath.Join(t.TempDir(), "res")}
	if err := run(context.Background(), args, env(writeCases(t, "IMPORTED")), &so, &se); err != nil {
		t.Fatal(err)
	}
	out := so.String()
	if i := strings.Index(out, "\nwritten to"); i > 0 {
		out = out[:i]
	}
	var rep struct {
		Illustrative bool `json:"illustrative"`
		Forecast     struct {
			ModelVersion string `json:"model_version"`
			ModelInfo    struct {
				FeatureSet []string `json:"feature_set"`
			} `json:"model_info"`
			Gate struct {
				Result string `json:"result"`
			} `json:"gate"`
			Warnings []string `json:"warnings"`
		} `json:"forecast"`
	}
	if err := json.Unmarshal([]byte(out), &rep); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	f := rep.Forecast
	if rep.Illustrative || f.ModelVersion != "m9" || len(f.ModelInfo.FeatureSet) != 2 || f.Gate.Result != "not_enough_history" {
		t.Fatalf("report %+v", rep)
	}
	if len(f.Warnings) == 0 || !strings.Contains(f.Warnings[0], "52 weeks") {
		t.Fatalf("warnings %v", f.Warnings)
	}
	if len(srv.Requests()) == 0 || !strings.Contains(srv.Requests()[0].Body, `"is_payday"`) {
		t.Fatal("the engine request carries no calendar features")
	}
}

func TestEngineBacktestNeedsAnURL(t *testing.T) {
	var so, se bytes.Buffer
	err := run(context.Background(), []string{"-only", "forecast", "-forecaster", "engine", "-out", t.TempDir()}, env(writeCases(t, "IMPORTED")), &so, &se)
	if err == nil || !strings.Contains(err.Error(), "engine-url") {
		t.Fatalf("got %v", err)
	}
}

func TestPerfectForecastWeatherIsOptInAndStamped(t *testing.T) {
	var so, se bytes.Buffer
	err := run(context.Background(), []string{"-only", "forecast", "-forecaster", "engine", "-engine-url", "http://127.0.0.1:1", "-weather-perfect-forecast", "-out", t.TempDir()}, env(writeCases(t, "IMPORTED")), &so, &se)
	if err == nil || !strings.Contains(err.Error(), "-weather synthetic or file") {
		t.Fatalf("perfect weather without weather: %v", err)
	}
	for _, perfect := range []bool{false, true} {
		srv := enginetest.New()
		srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: engineAnswer})
		so.Reset()
		args := []string{"-synthetic", "-fixtures", "../../../../fixtures", "-only", "forecast", "-forecaster", "engine", "-engine-url", srv.URL, "-weather", "synthetic", "-out", filepath.Join(t.TempDir(), "res")}
		if perfect {
			args = append(args, "-weather-perfect-forecast")
		}
		if err := run(context.Background(), args, env(""), &so, &se); err != nil {
			t.Fatal(err)
		}
		if got := strings.Contains(so.String(), "PERFECT-FORECAST WEATHER"); got != perfect {
			t.Fatalf("perfect %v: stamped %v in:\n%s", perfect, got, so.String())
		}
		horizon := 0
		for _, r := range srv.Requests() {
			var b struct {
				Horizon struct {
					Start string `json:"start_date"`
				} `json:"horizon"`
				Weather []struct {
					Date string `json:"date"`
				} `json:"weather"`
			}
			if err := json.Unmarshal([]byte(r.Body), &b); err != nil {
				t.Fatal(err)
			}
			for _, w := range b.Weather {
				if w.Date >= b.Horizon.Start {
					horizon++
				}
			}
		}
		n := len(srv.Requests())
		srv.Close()
		if n == 0 || (horizon > 0) != perfect {
			t.Fatalf("perfect %v: %d horizon weather days in %d requests", perfect, horizon, n)
		}
	}
}

func TestSyntheticEngineReportStaysLabelledIllustrative(t *testing.T) {
	srv := enginetest.New()
	defer srv.Close()
	srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: engineAnswer})
	var so, se bytes.Buffer
	args := []string{"-synthetic", "-fixtures", "../../../../fixtures", "-only", "forecast", "-forecaster", "engine", "-engine-url", srv.URL, "-out", filepath.Join(t.TempDir(), "res")}
	if err := run(context.Background(), args, env(""), &so, &se); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"ILLUSTRATIVE", "GATE (candidate against baseline): NOT_ENOUGH_HISTORY", "WARNING:", "WEAKEST"} {
		if !strings.Contains(so.String(), want) {
			t.Fatalf("missing %q in:\n%s", want, so.String())
		}
	}
}
