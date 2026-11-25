// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"encoding/json"
	"slices"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

func cmpData(t *testing.T, seed int64) *Dataset {
	t.Helper()
	res, err := GenerateLong(longBase(), LongOptions{Weeks: 4, Seed: seed, End: "2026-09-30", Volume: 0.1})
	if err != nil {
		t.Fatal(err)
	}
	return res.Dataset
}

// oracle knows the future: a perfect forecast.
func oracle(ds *Dataset) Forecaster {
	return func(_ context.Context, r ForecastRequest) ([]ForecastValue, error) {
		var out []ForecastValue
		end := addDays(r.Origin, r.Days)
		for _, h := range ds.Intervals {
			if !h.Start.Before(r.Origin) && h.Start.Before(end) {
				out = append(out, ForecastValue{ZoneID: "z1", SubZoneID: h.SubZoneID, Start: h.Start, Expected: float64(h.Total)})
			}
		}
		return out, nil
	}
}

// strict fails if it sees the held-out days.
func strict(t *testing.T, seen *[]string) Forecaster {
	return func(ctx context.Context, r ForecastRequest) ([]ForecastValue, error) {
		for _, h := range r.History {
			if !h.Start.Before(r.Origin) {
				t.Fatalf("history at %s reaches the origin %s", h.Start, r.Origin)
			}
		}
		*seen = append(*seen, r.Origin.Format("2006-01-02"))
		return SeasonalNaive(ctx, r)
	}
}

func TestCompareScoresEveryModelOnTheSameOrigins(t *testing.T) {
	var runs []CompareRun
	var seen []string
	for _, seed := range []int64{1, 2} {
		ds := cmpData(t, seed)
		runs = append(runs, CompareRun{Seed: seed, Dataset: ds, Models: []CompareModel{
			{Name: "oracle", Kind: "test", Forecast: oracle(ds)},
			{Name: "naive", Kind: "baseline", Forecast: strict(t, &seen)},
			{Name: "zero", Kind: "test", Forecast: func(context.Context, ForecastRequest) ([]ForecastValue, error) { return nil, nil }},
		}})
	}
	c, err := Compare(context.Background(), runs, CompareConfig{Horizon: 7, StepDays: 7, Windows: []CompareWindow{{Name: "a", From: "2026-09-10", Days: 14}, {Name: "b", From: "2026-09-24", Days: 7}}})
	if err != nil {
		t.Fatal(err)
	}
	if c.Origins != 3 || !slices.Equal(seen, []string{"2026-09-10", "2026-09-17", "2026-09-24", "2026-09-10", "2026-09-17", "2026-09-24"}) {
		t.Fatalf("origins %d, seen %v", c.Origins, seen)
	}
	if !c.Illustrative || c.Notice != CompareNotice {
		t.Fatal("a synthetic comparison must be labelled illustrative")
	}
	byName := map[string]CompareModelReport{}
	for _, m := range c.Models {
		byName[m.Name] = m
		if m.Requests != 6 {
			t.Fatalf("%s: %d requests, want 6", m.Name, m.Requests)
		}
	}
	o, n, z := byName["oracle"], byName["naive"], byName["zero"]
	if *o.Overall.ZoneHourWAPE != 0 || *o.Overall.Bias != 0 || o.Staffing.HoursOver != 0 || o.Staffing.HoursUnder != 0 {
		t.Fatalf("a perfect forecast scored %+v %+v", o.Overall, o.Staffing)
	}
	if *n.Overall.ZoneHourWAPE <= 0 || *z.Overall.ZoneHourWAPE != 1 || *z.Overall.Bias != -1 {
		t.Fatalf("naive %v, zero %v", *n.Overall.ZoneHourWAPE, *z.Overall.ZoneHourWAPE)
	}
	if z.Staffing.HoursUnder != z.Staffing.HoursNeeded || z.Staffing.HoursOver != 0 {
		t.Fatalf("zero forecast staffing %+v", z.Staffing)
	}
	if c.Ranking[0].Name != "oracle" || c.Ranking[2].Name != "zero" {
		t.Fatalf("ranking %+v", c.Ranking)
	}
	if len(o.ByHour) != 24 || len(o.ByWeekday) != 7 || len(o.ByWindow) != 2 || len(o.BySeed) != 2 {
		t.Fatalf("breakdowns %d %d %d %d", len(o.ByHour), len(o.ByWeekday), len(o.ByWindow), len(o.BySeed))
	}
	if _, err := json.Marshal(c); err != nil {
		t.Fatal(err)
	}
}

type answer string

func (a answer) Call(context.Context, []byte) ([]byte, error) { return []byte(a), nil }

func TestCompareLeavesOutAModelTheEngineDidNotRun(t *testing.T) {
	ds := cmpData(t, 1)
	cand := NewEngineCandidate(answer(`{"model_version":"ensemble-4","values":[]}`), EngineOptions{ModelVersion: "lightgbm-1", Source: SourceSynthetic})
	runs := []CompareRun{{Seed: 1, Dataset: ds, Models: []CompareModel{
		{Name: "lightgbm-1", Kind: "engine", Forecast: cand.Forecast, Engine: cand},
		{Name: "naive", Kind: "baseline", Forecast: SeasonalNaive},
	}}}
	c, err := Compare(context.Background(), runs, CompareConfig{Horizon: 7, StepDays: 7, Windows: []CompareWindow{{Name: "a", From: "2026-09-17", Days: 7}}})
	if err != nil {
		t.Fatal(err)
	}
	m := c.Models[0]
	if m.Available || m.RanAs != "ensemble-4" || m.Note == "" {
		t.Fatalf("model %+v", m)
	}
	if len(c.Ranking) != 1 || c.Ranking[0].Name != "naive" {
		t.Fatalf("ranking %+v", c.Ranking)
	}
}

func TestCompareOrigins(t *testing.T) {
	o, err := CompareOrigins(CompareWindow{Name: "m", From: "2026-04-12", Days: 28}, 7, 7)
	if err != nil || len(o) != 4 || o[3].Format("2006-01-02") != "2026-05-03" {
		t.Fatalf("%v %v", o, err)
	}
	if _, err := CompareOrigins(CompareWindow{Name: "s", From: "2026-04-12", Days: 5}, 7, 7); err == nil {
		t.Fatal("a window shorter than the horizon must fail")
	}
}

func TestCalendarTags(t *testing.T) {
	cal := forecastcal.Config{PaydayDay: 27, SchoolTerms: []forecastcal.Range{{Start: "2026-01-01", End: "2026-06-17", Name: "t1"}, {Start: "2026-08-23", End: "2026-12-16", Name: "t2"}}}
	rain := func(zone, date string) bool { return zone == "z1" && date == "2026-08-24" }
	tags := CalendarTags(cal, nil, rain)
	cases := map[string][]string{
		"2026-03-01": {TagRamadan},
		"2026-03-20": {TagEid},
		"2026-09-23": {TagHoliday},
		"2026-08-24": {TagSchoolStart, TagWeather},
		"2026-04-27": {TagPayday},
		"2026-04-14": nil,
	}
	for date, want := range cases {
		if got := tags("z1", date); !slices.Equal(got, want) {
			t.Errorf("%s: %v, want %v", date, got, want)
		}
	}
	if got := tags("z2", "2026-08-24"); !slices.Equal(got, []string{TagSchoolStart}) {
		t.Errorf("weather is per zone: %v", got)
	}
}

func TestCompareOnRealCasesIsLabelledMeasured(t *testing.T) {
	ds := cmpData(t, 1)
	ds.DataSource, ds.RealOnly = SourceImported, true
	c, err := Compare(context.Background(), []CompareRun{{Seed: 1, Dataset: ds, Models: []CompareModel{{Name: "oracle", Kind: "test", Forecast: oracle(ds)}}}},
		CompareConfig{Horizon: 7, StepDays: 7, Windows: []CompareWindow{{Name: "a", From: "2026-09-10", Days: 7}}})
	if err != nil {
		t.Fatal(err)
	}
	if c.Illustrative || c.Notice != CompareRealNotice || c.DataSource != SourceImported {
		t.Fatalf("real cases must not be labelled synthetic: %v %q %q", c.Illustrative, c.Notice, c.DataSource)
	}
}
