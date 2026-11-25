// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecasthist"
)

// Baseline names accepted in -models.
const (
	modelNaive   = "naive"
	modelSegment = "segment"
)

// DefaultCompareWindows: ordinary, Ramadan-Eid
const DefaultCompareWindows = "ordinary=2026-04-12:28,ramadan-eid=2026-03-01:28"

// compareSetup: what runCompare needs from run.
type compareSetup struct {
	models, windows, seeds string
	step, horizon          int
	coverage               float64
	engineURL              string
	base                   *backtest.Dataset
	cal                    forecastcal.Config
	long                   *backtest.LongOptions
	segmenter              func(cal forecastcal.Config) backtest.Segmenter
	wxSend                 string
	wxPerfect              bool
	engineOpts             func(ds *backtest.Dataset, cal forecastcal.Config, seed int64) (backtest.EngineOptions, error)
	out                    string
}

// compareFlags: the run flags -models uses.
type compareFlags struct {
	models, windows, seeds, out, dir    string
	horizon, step                       int
	coverage                            float64
	engineURL                           string
	historyDays, detailWeeks, histYears int
	aggMinutes                          int
	wxSend                              string
	wxPerfect, wxData, long             bool
	weeks                               int
	end                                 string
	volume                              float64
	payday                              int
	explicit                            map[string]bool
	activeSubs                          int
}

// compareFrom turns the flags into a setup.
func compareFrom(ctx context.Context, f compareFlags, ds *backtest.Dataset, cal forecastcal.Config, loadDir string, getenv func(string) string, stdout, stderr io.Writer) error {
	url := f.engineURL
	if url == "" {
		url = getenv("OPENDISPATCH_ENGINE_FORECASTER_URL")
	}
	out := f.out
	if out == "" {
		dir := f.dir
		if dir == "" {
			var err error
			if dir, err = os.MkdirTemp("", "opendispatch-compare-"); err != nil {
				return err
			}
		}
		out = filepath.Join(dir, "comparison.json")
	}
	if err := backtest.CheckOut(filepath.Dir(out), getenv(backtest.EnvDataDir), getenv(backtest.EnvDataDir) == ""); err != nil {
		return err
	}
	c := compareSetup{models: f.models, windows: f.windows, seeds: f.seeds, step: f.step, horizon: f.horizon, coverage: f.coverage,
		engineURL: url, base: ds, cal: cal, out: out, wxSend: f.wxSend, wxPerfect: f.wxPerfect}
	if !f.explicit["horizon"] {
		c.horizon = 7
	}
	if !f.explicit["origin-step-days"] {
		c.step = c.horizon
	}
	if f.long {
		c.long = &backtest.LongOptions{Weeks: f.weeks, End: f.end, Volume: f.volume, PaydayDay: f.payday, Weather: f.wxData}
	}
	c.segmenter = backtest.SegmentFromCalendar
	c.engineOpts = func(ds *backtest.Dataset, cal forecastcal.Config, seed int64) (backtest.EngineOptions, error) {
		o := backtest.EngineOptions{Source: ds.SendSource(), Calendar: cal, HistoryDays: f.historyDays, ZoneCity: ds.ZoneCity, ActiveSubZoneDays: f.activeSubs}
		if f.detailWeeks > 0 {
			hs := forecasthist.Settings{DetailWeeks: f.detailWeeks, Years: f.histYears, AggMinutes: f.aggMinutes}
			if err := checkHistory(hs); err != nil {
				return o, err
			}
			o.Long = &hs
		}
		return o, weatherOptions(ctx, &o, ds, f.wxSend, f.wxPerfect, seed, loadDir, getenv)
	}
	return runCompare(ctx, c, stdout, stderr)
}

// parseModels splits the -models list.
func parseModels(s string) ([]string, error) {
	var out []string
	seen := map[string]bool{}
	for _, m := range strings.Split(s, ",") {
		m = strings.TrimSpace(m)
		if m == "" || seen[m] {
			continue
		}
		if len(m) > 64 {
			return nil, fmt.Errorf("-models: %q is over 64 characters", m)
		}
		seen[m] = true
		out = append(out, m)
	}
	for _, b := range []string{modelNaive, modelSegment} {
		if !seen[b] {
			out = append(out, b)
		}
	}
	return out, nil
}

// parseWindows reads name=YYYY-MM-DD:days items.
func parseWindows(s string) ([]backtest.CompareWindow, error) {
	var out []backtest.CompareWindow
	for _, item := range strings.Split(s, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		name, spec, ok := strings.Cut(item, "=")
		from, days, ok2 := strings.Cut(spec, ":")
		n, err := strconv.Atoi(days)
		if !ok || !ok2 || err != nil || n < 1 || name == "" {
			return nil, fmt.Errorf("-compare-windows %q: want name=YYYY-MM-DD:days", item)
		}
		out = append(out, backtest.CompareWindow{Name: name, From: from, Days: n})
	}
	if len(out) == 0 {
		return nil, errors.New("-compare-windows: no window")
	}
	return out, nil
}

func parseSeeds(s string) ([]int64, error) {
	var out []int64
	for _, x := range strings.Split(s, ",") {
		if x = strings.TrimSpace(x); x == "" {
			continue
		}
		n, err := strconv.ParseInt(x, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("-seeds %q: %w", x, err)
		}
		out = append(out, n)
	}
	if len(out) == 0 {
		return nil, errors.New("-seeds: no seed")
	}
	return out, nil
}

// runCompare scores every model on the same windows.
func runCompare(ctx context.Context, c compareSetup, stdout, stderr io.Writer) error {
	names, err := parseModels(c.models)
	if err != nil {
		return err
	}
	windows, err := parseWindows(c.windows)
	if err != nil {
		return err
	}
	seeds, err := parseSeeds(c.seeds)
	if err != nil {
		return err
	}
	if c.long == nil && len(seeds) > 1 {
		fmt.Fprintln(stderr, "-seeds: without -long-synthetic the data is fixed; only the first seed is used")
		seeds = seeds[:1]
	}
	engineModels := 0
	for _, n := range names {
		if n != modelNaive && n != modelSegment {
			engineModels++
		}
	}
	if engineModels > 0 && c.engineURL == "" {
		return errors.New("-models needs -engine-url or OPENDISPATCH_ENGINE_FORECASTER_URL for engine models")
	}
	var runs []backtest.CompareRun
	for _, seed := range seeds {
		ds, cal := c.base, c.cal
		var tags func(zone, date string) []string
		if c.long != nil {
			o := *c.long
			o.Seed = seed
			res, err := backtest.GenerateLong(c.base, o)
			if err != nil {
				return err
			}
			ds, cal = res.Dataset, res.Calendar
			wx := func(zone, date string) bool { return backtest.LongWeatherDay(o, ds.ZoneCity[zone], date) }
			tags = backtest.CalendarTags(cal, nil, wx)
		} else {
			tags = backtest.CalendarTags(cal, nil, nil)
		}
		run := backtest.CompareRun{Seed: seed, Dataset: ds, Tags: tags}
		for _, n := range names {
			switch n {
			case modelNaive:
				run.Models = append(run.Models, backtest.CompareModel{Name: n, Kind: "baseline", Forecast: backtest.SeasonalNaive})
			case modelSegment:
				run.Models = append(run.Models, backtest.CompareModel{Name: n, Kind: "baseline", Forecast: backtest.SegmentAverage(c.segmenter(cal))})
			default:
				opts, err := c.engineOpts(ds, cal, seed)
				if err != nil {
					return err
				}
				opts.ModelVersion = n
				cand := backtest.NewEngineCandidate(engines.NewHTTP(engines.Forecaster, c.engineURL), opts)
				run.Models = append(run.Models, backtest.CompareModel{Name: n, Kind: "engine", Forecast: cand.Forecast, Engine: cand})
			}
		}
		runs = append(runs, run)
		fmt.Fprintf(stderr, "compare: seed %d ready, %d models\n", seed, len(run.Models))
	}
	rep, err := backtest.Compare(ctx, runs, backtest.CompareConfig{Horizon: c.horizon, StepDays: c.step, Coverage: c.coverage, Windows: windows})
	if err != nil {
		return err
	}
	rep.Setup = map[string]string{"calendar": "synthetic", "history": "as sent by the backtest (see flags)"}
	switch {
	case c.wxPerfect:
		rep.Notice = backtest.PerfectWeatherNotice + " " + rep.Notice
		rep.Setup["weather"] = c.wxSend + ": history and held-out days (perfect forecast)"
	case c.wxSend != "" && c.wxSend != "none":
		rep.Setup["weather"] = c.wxSend + ": days before each origin only"
	}
	if c.long != nil {
		rep.Setup["data"] = fmt.Sprintf("long synthetic, %d weeks ending %s, weather in data: %t", c.long.Weeks, c.long.End, c.long.Weather)
	}
	b, err := json.MarshalIndent(rep, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(c.out), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(c.out, b, 0o644); err != nil {
		return err
	}
	fmt.Fprint(stdout, backtest.CompareText(rep))
	fmt.Fprintf(stdout, "\nwritten to %s\n", c.out)
	return nil
}
