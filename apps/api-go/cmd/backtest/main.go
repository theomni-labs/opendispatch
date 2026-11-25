// SPDX-License-Identifier: AGPL-3.0-only

// Command backtest runs the harness.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecasthist"
)

type calendarFile struct {
	SchoolTerms  []forecastcal.Range `json:"school_terms"`
	SeasonEvents []forecastcal.Range `json:"season_events"`
	UmrahWindows []forecastcal.Range `json:"umrah_windows"`
}

// calendarConfig: empty lists stay unknown.
func calendarConfig(path string, payday int) (forecastcal.Config, error) {
	c := forecastcal.Config{PaydayDay: payday}
	if path == "" {
		return c, nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	var f calendarFile
	if err := json.Unmarshal(b, &f); err != nil {
		return c, fmt.Errorf("%s: %w", path, err)
	}
	c.SchoolTerms, c.SeasonEvents, c.UmrahWindows = f.SchoolTerms, f.SeasonEvents, f.UmrahWindows
	return c, nil
}

// checkHistory refuses out-of-range flags.
func checkHistory(hs forecasthist.Settings) error {
	for k, v := range map[string]int{forecasthist.KeyDetailWeeks: hs.DetailWeeks, forecasthist.KeyYears: hs.Years, forecasthist.KeyAggMinutes: hs.AggMinutes} {
		if err := forecasthist.ValidateSetting(k, v); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Getenv, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "backtest:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, getenv func(string) string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("backtest", flag.ContinueOnError)
	fs.SetOutput(stderr)
	synthetic := fs.Bool("synthetic", false, "use the committed synthetic fixtures")
	long := fs.Bool("long-synthetic", false, "generate a long synthetic history in memory, calibrated on the fixtures (forecast only)")
	weeks := fs.Int("weeks", 52, "weeks of history for -long-synthetic")
	seed := fs.Int64("seed", 1, "random seed for -long-synthetic")
	endDay := fs.String("end", "2026-09-30", "last day of the -long-synthetic history (YYYY-MM-DD)")
	volume := fs.Float64("volume", 1, "scale of the -long-synthetic case volume")
	step := fs.Int("origin-step-days", 1, "days between forecast origins")
	fixtures := fs.String("fixtures", "", "fixtures dir for -synthetic (default: repo fixtures)")
	out := fs.String("out", "", "output dir (default: a new temp dir)")
	only := fs.String("only", "all", "all, forecast or replay")
	forecaster := fs.String("forecaster", "seasonal-mean", "candidate forecaster: seasonal-mean, engine or none")
	engineURL := fs.String("engine-url", "", "forecaster engine URL for -forecaster engine (or OPENDISPATCH_ENGINE_FORECASTER_URL)")
	modelVersion := fs.String("model-version", "backtest-candidate", "model version sent to the engine")
	heldOut := fs.Int("held-out-days", 28, "score only the last days of data, training on earlier data (0: all after min-history)")
	weakest := fs.Int("weakest", backtest.DefaultWeakestN, "how many weakest locations to list")
	historyDays := fs.Int("history-days", 28, "days of history sent to the engine per request (0: all)")
	detailWeeks := fs.Int("history-detail-weeks", 0, "weeks sent at 15 minutes, older history as totals (0: off, all at 15 minutes)")
	histYears := fs.Int("history-years", forecasthist.DefaultYears, "years of history with -history-detail-weeks")
	activeSubs := fs.Int("active-subzone-days", 0, "send the engine only sub-zones with a case in these days before the origin (0: all)")
	aggMinutes := fs.Int("history-aggregate-minutes", forecasthist.DefaultAggMinutes, "grain of the totals: 1440 or 60")
	paydayDay := fs.Int("payday-day", forecastcal.DefaultPaydayDay, "ASSUMPTION: day of the month salaries are paid (0: off)")
	calFile := fs.String("calendar-file", "", "JSON file with school_terms, season_events, umrah_windows (each a list of start, end, name)")
	gateMin := fs.Float64("gate-min-improvement", backtest.DefaultMinImprovement, "WAPE the engine must beat the baseline by (share)")
	gateWorse := fs.Float64("gate-max-worse-zones", backtest.DefaultMaxWorseZoneShare, "share of zones the engine may be worse in")
	gateBase := fs.String("gate-baseline", backtest.GateBaselineNaive, "baseline the gate compares with: naive or segment (segment-average, the customer's method)")
	gatePoint := fs.String("gate-point", backtest.GatePointMedian, "how the gate scores the engine: median (least absolute error per zone-hour) or expected")
	shapeShare := fs.Float64("shape-share", backtest.DefaultShapeShare, "engine's share of each zone-day's shape against the customer's segment average (1: no blend)")
	smallZone := fs.Float64("small-zone", backtest.DefaultSmallZone, "cases a day under which a zone's daily total is averaged with the segment average's (0: never)")
	dayTypes := fs.Bool("day-types", true, "Ramadan, Eid and national days on their own three-year shape; the engine's share follows its window's school status")
	asJSON := fs.Bool("json", false, "print the JSON report instead of the text report")
	horizon := fs.Int("horizon", 1, "forecast horizon in days")
	minHist := fs.Int("min-history", 7, "days of history before the first origin")
	coverage := fs.Float64("coverage", 0.8, "target coverage of the likely range")
	speed := fs.Float64("speed", 40, "straight-line speed in km/h")
	duty := fs.Float64("duty-window-hours", 4, "hours around a case that mark an agent on duty")
	deadline := fs.Int("deadline-ms", 2000, "decision deadline in ms")
	fallback := fs.Int("fallback-ms", 5000, "Operator fallback time in ms")
	clock := fs.String("primary-clock", "assignment", "primary 10-minute clock: assignment or registration")
	wxSend := fs.String("weather", "none", "weather sent to the engine: none, synthetic or file (OPENDISPATCH_WEATHER_FILE)")
	wxPerfect := fs.Bool("weather-perfect-forecast", false, "research only: also send the held-out days' own weather (a perfect forecast); stamped on the report")
	wxData := fs.Bool("weather-in-data", false, "-long-synthetic: synthetic weather changes the history (on with -weather synthetic)")
	models := fs.String("models", "", "compare these engine model versions (comma list) with naive and segment on the same windows")
	cmpWindows := fs.String("compare-windows", DefaultCompareWindows, "-models: held-out windows, name=YYYY-MM-DD:days, comma list")
	seeds := fs.String("seeds", "1,2", "-models: seeds of -long-synthetic, comma list")
	cmpOut := fs.String("compare-out", "", "-models: JSON report path (default: comparison.json in -out)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *wxSend != "none" && *wxSend != "synthetic" && *wxSend != "file" {
		return fmt.Errorf("-weather %q: want none, synthetic or file", *wxSend)
	}
	if *wxPerfect && *wxSend == "none" {
		return errors.New("-weather-perfect-forecast needs -weather synthetic or file")
	}
	explicit := map[string]bool{}
	fs.Visit(func(f *flag.Flag) { explicit[f.Name] = true })
	if *wxSend == "synthetic" && !explicit["weather-in-data"] {
		*wxData = true
	}
	if *long {
		*synthetic = true
		*only = "forecast"
		for k, v := range map[string]*int{"horizon": horizon, "origin-step-days": step, "min-history": minHist} {
			if !explicit[k] {
				*v = map[string]int{"horizon": 7, "origin-step-days": 7, "min-history": backtest.MinTrainingDays}[k]
			}
		}
		if !explicit["history-days"] {
			*historyDays = 0
		}
	}
	if *only != "all" && *only != "forecast" && *only != "replay" {
		return fmt.Errorf("-only %q: want all, forecast or replay", *only)
	}
	dataDir := getenv(backtest.EnvDataDir)
	if err := backtest.CheckData(dataDir, *synthetic); err != nil {
		return err
	}
	if err := backtest.CheckOut(*out, dataDir, *synthetic); err != nil {
		return err
	}
	opts := backtest.LoadOptions{Dir: dataDir}
	if *synthetic {
		dir := *fixtures
		if dir == "" {
			wd, _ := os.Getwd()
			root := backtest.RepoRoot(wd)
			if root == "" {
				return errors.New("no repository found: pass -fixtures")
			}
			dir = filepath.Join(root, "fixtures")
		}
		opts = backtest.LoadOptions{Dir: dir, ExtraCaseFiles: []string{filepath.Join(dir, "replay", "cases.json")}}
	}
	ds, err := backtest.Load(opts)
	if err != nil {
		return err
	}
	loadDir := opts.Dir
	cal, err := calendarConfig(*calFile, *paydayDay)
	if err != nil {
		return err
	}
	if *models != "" {
		return compareFrom(ctx, compareFlags{
			models: *models, windows: *cmpWindows, seeds: *seeds, out: *cmpOut, dir: *out, horizon: *horizon, step: *step, coverage: *coverage,
			engineURL: *engineURL, historyDays: *historyDays, detailWeeks: *detailWeeks, histYears: *histYears, aggMinutes: *aggMinutes,
			wxSend: *wxSend, wxPerfect: *wxPerfect, wxData: *wxData, long: *long, weeks: *weeks, end: *endDay, volume: *volume, payday: *paydayDay,
			explicit: explicit, activeSubs: *activeSubs,
		}, ds, cal, loadDir, getenv, stdout, stderr)
	}
	if *long {
		res, err := backtest.GenerateLong(ds, backtest.LongOptions{Weeks: *weeks, Seed: *seed, End: *endDay, Volume: *volume, PaydayDay: *paydayDay, Weather: *wxData})
		if err != nil {
			return err
		}
		ds, cal = res.Dataset, res.Calendar
	}
	rep := backtest.NewReport(ds)
	if *long {
		rep.Notice = backtest.LongNotice + " " + rep.Notice
		if *wxData {
			rep.Notice = backtest.WeatherNotice + " " + rep.Notice
		}
	}
	if *wxPerfect {
		rep.PerfectWeather = true
		rep.Notice = backtest.PerfectWeatherNotice + " " + rep.Notice
	}
	if *gateBase != backtest.GateBaselineNaive && *gateBase != backtest.GateBaselineSegment {
		return fmt.Errorf("-gate-baseline %q: want naive or segment", *gateBase)
	}
	if *gatePoint != backtest.GatePointMedian && *gatePoint != backtest.GatePointExpected {
		return fmt.Errorf("-gate-point %q: want median or expected", *gatePoint)
	}
	if *only != "replay" {
		cfg := backtest.ForecastConfig{Horizon: *horizon, MinHistoryDays: *minHist, Coverage: *coverage, HeldOutDays: *heldOut, OriginStepDays: *step, WeakestN: *weakest, Calendar: cal,
			Gate: &backtest.GateOptions{MinImprovement: *gateMin, MaxWorseZoneShare: *gateWorse}, GateBaseline: *gateBase, GatePoint: *gatePoint}
		cfg.Segmenter = backtest.SegmentFromCalendar(cal)
		if *shapeShare < 1 || *smallZone > 0 || *dayTypes {
			cfg.Blend = &backtest.ShapeBlend{Share: *shapeShare, SmallZone: *smallZone, DayTypes: *dayTypes}
		}
		switch *forecaster {
		case "seasonal-mean":
			cfg.Candidate, cfg.CandidateName = backtest.SeasonalMean, "seasonal-mean-4-weeks"
		case "engine":
			url := *engineURL
			if url == "" {
				url = getenv("OPENDISPATCH_ENGINE_FORECASTER_URL")
			}
			if url == "" {
				return errors.New("-forecaster engine needs -engine-url or OPENDISPATCH_ENGINE_FORECASTER_URL")
			}
			opts := backtest.EngineOptions{ModelVersion: *modelVersion, Source: ds.SendSource(), Calendar: cal, HistoryDays: *historyDays, ActiveSubZoneDays: *activeSubs}
			if *detailWeeks > 0 {
				hs := forecasthist.Settings{DetailWeeks: *detailWeeks, Years: *histYears, AggMinutes: *aggMinutes}
				if err := checkHistory(hs); err != nil {
					return err
				}
				opts.Long = &hs
			}
			if err := weatherOptions(ctx, &opts, ds, *wxSend, *wxPerfect, *seed, loadDir, getenv); err != nil {
				return err
			}
			rep.Forecast, err = backtest.RunEngine(ctx, ds, engines.NewHTTP(engines.Forecaster, url), opts, cfg)
		case "none":
		default:
			return fmt.Errorf("-forecaster %q: want seasonal-mean, engine or none", *forecaster)
		}
		if rep.Forecast == nil && err == nil {
			rep.Forecast, err = backtest.RunForecast(ctx, ds, cfg)
		}
		if err != nil {
			return err
		}
	}
	if *only != "forecast" {
		rep.Replay, err = backtest.RunReplay(ctx, ds, backtest.ReplayConfig{
			SpeedKmh: *speed, DutyWindow: time.Duration(*duty * float64(time.Hour)),
			DeadlineMs: *deadline, FallbackMs: *fallback, PrimaryClock: *clock,
		})
		if err != nil {
			return err
		}
	}
	dir := *out
	if dir == "" {
		if dir, err = os.MkdirTemp("", "opendispatch-backtest-"); err != nil {
			return err
		}
	}
	if err := rep.WriteFiles(dir); err != nil {
		return err
	}
	if *asJSON {
		j, err := rep.JSON()
		if err != nil {
			return err
		}
		fmt.Fprintln(stdout, string(j))
	} else {
		fmt.Fprint(stdout, rep.Text())
	}
	fmt.Fprintf(stdout, "\nwritten to %s\n", dir)
	return nil
}
