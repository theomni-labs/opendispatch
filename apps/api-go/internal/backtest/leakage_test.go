// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

const leakHorizon = 2

func leakHoliday(date string) (bool, string) {
	if date[8:] == "05" {
		return true, "made-up holiday"
	}
	return false, ""
}

type leakReq struct {
	Origin   time.Time
	Wire     enginetest.Request
	Body     map[string]any
	History  []time.Time
	Calendar []map[string]any
	Weather  []string
}

func parseLeakReqs(t *testing.T, srv *enginetest.Server) []leakReq {
	t.Helper()
	var out []leakReq
	for _, r := range srv.Requests() {
		var b struct {
			At      string `json:"requested_at"`
			History struct {
				Records []struct {
					Start string `json:"interval_start"`
				} `json:"records"`
			} `json:"history"`
			Calendar []map[string]any `json:"calendar"`
			Weather  []struct {
				Date string `json:"date"`
			} `json:"weather"`
		}
		if err := json.Unmarshal([]byte(r.Body), &b); err != nil {
			t.Fatal(err)
		}
		at, err := time.Parse(time.RFC3339, b.At)
		if err != nil {
			t.Fatal(err)
		}
		m := map[string]any{}
		_ = json.Unmarshal([]byte(r.Body), &m)
		lr := leakReq{Origin: at, Wire: r, Body: m, Calendar: b.Calendar}
		for _, w := range b.Weather {
			lr.Weather = append(lr.Weather, w.Date)
		}
		for _, x := range b.History.Records {
			s, err := time.Parse(time.RFC3339, x.Start)
			if err != nil {
				t.Fatal(err)
			}
			lr.History = append(lr.History, s)
		}
		out = append(out, lr)
	}
	return out
}

var calendarKeys = map[string]bool{"date": true, "is_holiday": true, "holiday_name": true, "is_ramadan": true,
	"is_payday": true, "school_in_session": true, "events": true, "hijri_date": true}

// leakViolations: broken rules by letter
func leakViolations(reqs []leakReq, cal forecastcal.Config, horizon int) map[string][]string {
	v := map[string][]string{}
	add := func(k, f string, a ...any) { v[k] = append(v[k], fmt.Sprintf(f, a...)) }
	var origins []time.Time
	for _, r := range reqs {
		origins = append(origins, r.Origin)
	}
	for _, r := range reqs {
		o := r.Origin
		if !o.Equal(localDay(o)) {
			add("c", "origin %s is not a start of day", o)
		}
		hz, _ := r.Body["horizon"].(map[string]any)
		if hz["start_date"] != o.In(loc).Format("2006-01-02") || hz["days"] != float64(horizon) {
			add("c", "horizon %v for origin %s", hz, o)
		}
		for _, s := range r.History {
			if !s.Before(o) {
				add("a", "history %s at or after origin %s", s, o)
			}
			for _, so := range origins {
				if !so.Before(o) && !s.Before(so) && s.Before(addDays(so, horizon)) {
					add("d", "history %s is scored at origin %s", s, so)
				}
			}
		}
		for _, c := range r.Calendar {
			date, _ := c["date"].(string)
			for k := range c {
				if !calendarKeys[k] {
					add("b", "calendar %s carries %q", date, k)
				}
			}
			f := cal.For(date)
			wantHol, wantName := leakHoliday(date)
			want := map[string]any{"date": date, "is_holiday": wantHol, "is_ramadan": f.IsRamadan}
			if wantName != "" {
				want["holiday_name"] = wantName
			}
			got := map[string]any{"date": date, "is_holiday": c["is_holiday"], "is_ramadan": c["is_ramadan"]}
			if n, ok := c["holiday_name"]; ok {
				got["holiday_name"] = n
			}
			if !reflect.DeepEqual(want, got) {
				add("b", "calendar %s is %v, rules say %v", date, got, want)
			}
		}
		for _, d := range r.Weather {
			if d >= o.In(loc).Format("2006-01-02") {
				add("e", "weather of %s sent at origin %s", d, o)
			}
		}
		days := len(r.Calendar)
		if days < horizon || r.Calendar[days-horizon]["date"] != o.In(loc).Format("2006-01-02") {
			add("c", "calendar does not end with the %d horizon day(s) at %s", horizon, o)
		}
	}
	return v
}

func leakDataset(t *testing.T) (*LongResult, ForecastConfig) {
	t.Helper()
	res, err := GenerateLong(longBase(), LongOptions{Weeks: 6, Seed: 11, End: "2026-09-30", Volume: 0.3})
	if err != nil {
		t.Fatal(err)
	}
	return res, ForecastConfig{Horizon: leakHorizon, MinHistoryDays: 7, HeldOutDays: 14, OriginStepDays: 2,
		Calendar: res.Calendar, Segmenter: SegmentFromCalendar(res.Calendar), CandidateName: "mock"}
}

func runLeak(t *testing.T, ds *Dataset, cfg ForecastConfig, opt EngineOptions, wrap func(Forecaster, *Dataset) Forecaster) []leakReq {
	t.Helper()
	srv := enginetest.New()
	defer srv.Close()
	srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: `{"values":[]}`})
	opt.ModelVersion, opt.Source, opt.Calendar, opt.Holiday = "m", SourceSynthetic, cfg.Calendar, leakHoliday
	cand := NewEngineCandidate(engines.NewHTTP(engines.Forecaster, srv.URL), opt)
	cfg.Candidate = cand.Forecast
	if wrap != nil {
		cfg.Candidate = wrap(cand.Forecast, ds)
	}
	if _, err := RunForecast(context.Background(), ds, cfg); err != nil {
		t.Fatal(err)
	}
	return parseLeakReqs(t, srv)
}

func TestBacktestRequestsNeverCarryTheFuture(t *testing.T) {
	res, cfg := leakDataset(t)
	reqs := runLeak(t, res.Dataset, cfg, EngineOptions{}, nil)
	if len(reqs) < 3 {
		t.Fatalf("only %d requests", len(reqs))
	}
	gz := 0
	for _, r := range reqs {
		if r.Wire.Encoding == "gzip" {
			gz++
		}
	}
	if gz == 0 {
		t.Fatal("no request was gzipped: the decode path is untested")
	}
	if v := leakViolations(reqs, cfg.Calendar, leakHorizon); len(v) > 0 {
		t.Fatalf("leakage: %v", v)
	}
}

func TestLeakyAdapterIsCaught(t *testing.T) {
	res, cfg := leakDataset(t)
	leaky := func(f Forecaster, ds *Dataset) Forecaster {
		return func(ctx context.Context, r ForecastRequest) ([]ForecastValue, error) {
			until := addDays(r.Origin, 1)
			n := sort.Search(len(ds.Intervals), func(k int) bool { return !ds.Intervals[k].Start.Before(until) })
			r.History = ds.Intervals[:n]
			return f(ctx, r)
		}
	}
	reqs := runLeak(t, res.Dataset, cfg, EngineOptions{}, leaky)
	v := leakViolations(reqs, cfg.Calendar, leakHorizon)
	if len(v["a"]) == 0 || len(v["d"]) == 0 {
		t.Fatalf("the harness missed a leak: %v", v)
	}
}

// leakWeather: synthetic weather for zone z1.
func leakWeather(perfect bool) EngineOptions {
	return EngineOptions{Weather: SyntheticWeather(3), ZoneCityID: map[string]string{"z1": wxCity},
		ZoneCity: map[string]string{"z1": "Riyadh"}, PerfectWeather: perfect}
}

func TestBacktestWeatherStopsAtTheOrigin(t *testing.T) {
	res, cfg := leakDataset(t)
	reqs := runLeak(t, res.Dataset, cfg, leakWeather(false), nil)
	sent := 0
	for _, r := range reqs {
		sent += len(r.Weather)
	}
	if sent == 0 {
		t.Fatal("no weather was sent: the test proves nothing")
	}
	if v := leakViolations(reqs, cfg.Calendar, leakHorizon); len(v) > 0 {
		t.Fatalf("leakage: %v", v)
	}
}

func TestPerfectWeatherIsCaughtAsLeakage(t *testing.T) {
	res, cfg := leakDataset(t)
	reqs := runLeak(t, res.Dataset, cfg, leakWeather(true), nil)
	v := leakViolations(reqs, cfg.Calendar, leakHorizon)
	if len(v["e"]) == 0 {
		t.Fatalf("the harness missed horizon weather: %v", v)
	}
}

func TestTrimNeverDropsTheNewestHistoryDay(t *testing.T) {
	res, cfg := leakDataset(t)
	full := runLeak(t, res.Dataset, cfg, EngineOptions{}, nil)
	biggest := 0
	for _, r := range full {
		biggest = max(biggest, r.Wire.WireBytes)
	}
	reqs := runLeak(t, res.Dataset, cfg, EngineOptions{RequestCap: biggest * 6 / 10}, nil)
	trimmed := 0
	newestOf := func(h []time.Time) time.Time {
		var n time.Time
		for _, s := range h {
			if s.After(n) {
				n = s
			}
		}
		return n
	}
	for i, r := range reqs {
		if got, want := newestOf(r.History), newestOf(full[i].History); !got.Equal(want) {
			t.Fatalf("origin %s: newest sent %s, newest before origin %s", r.Origin, got, want)
		}
		if len(r.History) < len(full[i].History) {
			trimmed++
		}
		if r.Wire.WireBytes > biggest*6/10 {
			t.Fatalf("request over the cap: %d", r.Wire.WireBytes)
		}
	}
	if trimmed == 0 {
		t.Fatal("nothing was trimmed: the test proves nothing")
	}
	if v := leakViolations(reqs, cfg.Calendar, leakHorizon); len(v) > 0 {
		t.Fatalf("leakage after trim: %v", v)
	}
}

func poison(h []HistoryRecord, from time.Time) []HistoryRecord {
	out := append([]HistoryRecord(nil), h...)
	for i := range out {
		if !out[i].Start.Before(from) {
			out[i].Total, out[i].Field = 1_000_000_000, 1_000_000_000
		}
	}
	return out
}

func TestPoisonedFutureChangesNeitherRequestsNorBaselines(t *testing.T) {
	res, cfg := leakDataset(t)
	ds := res.Dataset
	days := map[int64]time.Time{}
	for _, h := range ds.Intervals {
		d := localDay(h.Start)
		days[d.Unix()] = d
	}
	var list []time.Time
	for _, d := range days {
		list = append(list, d)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Before(list[j]) })
	cut := list[len(list)-10]
	bad := &Dataset{Intervals: poison(ds.Intervals, cut), ZoneSubs: ds.ZoneSubs, Agents: ds.Agents, Standby: ds.Standby, DataSource: ds.DataSource}

	a := runLeak(t, ds, cfg, EngineOptions{}, nil)
	b := runLeak(t, bad, cfg, EngineOptions{}, nil)
	if len(a) != len(b) {
		t.Fatalf("%d against %d requests", len(a), len(b))
	}
	same := 0
	for i := range a {
		if a[i].Origin.After(cut) {
			continue
		}
		same++
		if a[i].Wire.Body != b[i].Wire.Body {
			t.Fatalf("the request for origin %s changed with the future", a[i].Origin)
		}
	}
	if same == 0 || same == len(a) {
		t.Fatalf("%d of %d origins compared", same, len(a))
	}

	arms := map[string]Forecaster{"naive": SeasonalNaive, "mean": SeasonalMean, "segment": SegmentAverage(cfg.Segmenter)}
	for name, f := range arms {
		for _, o := range list[10:] {
			if o.After(cut) {
				break
			}
			n := sort.Search(len(ds.Intervals), func(k int) bool { return !ds.Intervals[k].Start.Before(o) })
			clean := ForecastRequest{Origin: o, Days: leakHorizon, Zones: zoneSpecs(ds), History: ds.Intervals[:n], Coverage: 0.8}
			dirty := clean
			dirty.History = poison(ds.Intervals, o)
			x, _ := f(context.Background(), clean)
			y, _ := f(context.Background(), dirty)
			if !reflect.DeepEqual(x, y) {
				t.Fatalf("%s at %s changed with the future", name, o)
			}
			for _, v := range y {
				if v.Expected >= 1e8 {
					t.Fatalf("%s at %s used a future value", name, o)
				}
			}
		}
	}
}

func TestBaselinesReceiveOnlyHistoryBeforeTheOrigin(t *testing.T) {
	res, cfg := leakDataset(t)
	seen := 0
	cfg.Baseline, cfg.BaselineName = func(ctx context.Context, r ForecastRequest) ([]ForecastValue, error) {
		seen++
		for _, h := range r.History {
			if !h.Start.Before(r.Origin) {
				t.Fatalf("baseline got history %s at origin %s", h.Start, r.Origin)
			}
		}
		return SeasonalNaive(ctx, r)
	}, "naive"
	if _, err := RunForecast(context.Background(), res.Dataset, cfg); err != nil || seen == 0 {
		t.Fatal(err, seen)
	}
}
