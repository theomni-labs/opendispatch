// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func fptr(v float64) *float64 { return &v }

func TestChampionAndChallengerSettings(t *testing.T) {
	resetSettings(t)
	tenant := datactx.NewID()
	if championModel(context.Background(), tenant) != "ensemble-4" || challengerModel(context.Background(), tenant) != "lightgbm-1" {
		t.Fatal("defaults: ensemble-4, challenger lightgbm-1")
	}
	setForecastSetting(t, tenant, KeyChampionModel, "", DefaultChampionModel)
	setForecastSetting(t, tenant, KeyChallengerModel, "", "")
	if championModel(context.Background(), tenant) != "ensemble-4" || challengerModel(context.Background(), tenant) != "" {
		t.Fatal("an empty challenger is none, not the default")
	}
	check(t, settingsstore.Put(context.Background(), tenant, KeyChallengerModel, " ensemble-2 "))
	if challengerModel(context.Background(), tenant) != "ensemble-2" || !isChallengerRun(context.Background(), tenant, ForecastRun{ModelVersion: "ensemble-2"}) || isChallengerRun(context.Background(), tenant, ForecastRun{ModelVersion: "ensemble-4"}) {
		t.Fatal("ensemble-2 is the challenger")
	}
	check(t, settingsstore.Put(context.Background(), tenant, KeyChampionModel, "ensemble-2"))
	if challengerModel(context.Background(), tenant) != "" {
		t.Fatal("a challenger equal to the champion is off")
	}
	check(t, settingsstore.Put(context.Background(), tenant, KeyChampionModel, strings.Repeat("x", 65)))
	if championModel(context.Background(), tenant) != "ensemble-4" {
		t.Fatal("an over-long champion falls back")
	}
	ctx := context.Background()
	if requestedForecastModel(ctx, tenant) != "ensemble-4" || requestedForecastModel(withForecastModel(ctx, "m-2"), tenant) != "m-2" {
		t.Fatal("the override wins, else the champion")
	}
}

func TestEngineStatusKeepsTheChampionModel(t *testing.T) {
	tenant := datactx.NewID()
	setForecastSetting(t, tenant, KeyChampionModel, "", DefaultChampionModel)
	setForecastSetting(t, tenant, KeyChallengerModel, "", "")
	check(t, settingsstore.Put(context.Background(), tenant, KeyChallengerModel, "ensemble-3"))
	model := func() string {
		for _, st := range EngineStatuses(tenant) {
			if st.Name == engines.Forecaster {
				return st.Model
			}
		}
		return ""
	}
	noteModel(context.Background(), tenant, engines.Forecaster, []byte(`{"model_version":"ensemble-4"}`))
	noteModel(context.Background(), tenant, engines.Forecaster, []byte(`{"model_version":"ensemble-3"}`))
	if got := model(); got != "ensemble-4" {
		t.Fatalf("after a challenger answer the card reads %q, want the champion", got)
	}
	noteModel(context.Background(), tenant, engines.Forecaster, []byte(`{"model_version":"seasonal-profile-1"}`))
	if got := model(); got != "seasonal-profile-1" {
		t.Fatalf("any other model is still shown, got %q", got)
	}
	noteModel(context.Background(), tenant, engines.Simulator, []byte(`{"model_version":"ensemble-3"}`))
	for _, st := range EngineStatuses(tenant) {
		if st.Name == engines.Simulator && st.Model != "ensemble-3" {
			t.Fatalf("other engines keep what they answered, got %q", st.Model)
		}
	}
}

func TestChallengerSortsAfterItsChampion(t *testing.T) {
	if got := challengerCreatedAt("2026-09-13T02:00:00+03:00"); got != "2026-09-13T01:59:59+03:00" {
		t.Fatalf("got %s", got)
	}
}

func TestLiftIsTheChallengersErrorCut(t *testing.T) {
	if v := liftOf(fptr(0.4), fptr(0.3)); v == nil || *v != 0.25 {
		t.Fatalf("got %v, want 0.25", v)
	}
	if v := liftOf(fptr(0.2), fptr(0.3)); v == nil || *v != -0.5 {
		t.Fatalf("got %v, want -0.5", v)
	}
	if liftOf(nil, fptr(0.3)) != nil || liftOf(fptr(0), fptr(0.3)) != nil {
		t.Fatal("no champion error: no lift")
	}
	arm := func(w, zw, m float64) *backtest.ForecastArm {
		return &backtest.ForecastArm{Overall: backtest.Metrics{WAPE: fptr(w)}, ByZone: []backtest.ZoneMetrics{{ZoneID: "z1", Metrics: backtest.Metrics{WAPE: fptr(zw)}}},
			MAPE: &backtest.MAPEReport{ZoneDay: backtest.MAPEMetrics{MAPE: fptr(m)}, ByZone: []backtest.MAPERow{{ZoneID: "z1", MAPEMetrics: backtest.MAPEMetrics{MAPE: fptr(m)}}}}}
	}
	all, zones := liftBetween(&backtest.ForecastReport{Candidate: arm(0.5, 0.5, 0.2)}, &backtest.ForecastReport{Candidate: arm(0.4, 0.4, 0.1)})
	if *all.WAPELift != 0.2 || *all.MAPELift != 0.5 || len(zones) != 1 || *zones[0].WAPELift != 0.2 || *zones[0].MAPELift != 0.5 {
		t.Fatalf("overall %+v zones %+v", all, zones)
	}
	c := &ModelComparison{Champion: "ensemble-3", Challenger: "ensemble-2", Overall: all}
	if s := c.summary(); s != " Challenger ensemble-2 against ensemble-3: WAPE lift +20.0%, MAPE lift +50.0%." {
		t.Fatalf("summary %q", s)
	}
	if (*ModelComparison)(nil).summary() != "" {
		t.Fatal("no comparison: no tail")
	}
}

func TestZoneHourWAPEAndCooldown(t *testing.T) {
	var f, a [24]float64
	f[9], a[9], f[10], a[10] = 4, 2, 0, 2
	if w, act, fc, ok := windowWAPE([]zoneDay{{f: f, a: a}}); !ok || w != 1 || act != 4 || fc != 4 {
		t.Fatalf("got %v %v %v %v", w, act, fc, ok)
	}
	if _, _, _, ok := windowWAPE([]zoneDay{{f: f}}); ok {
		t.Fatal("no actuals: no score")
	}
	if !cooledDown("", "2026-09-12", 3) || cooledDown("2026-09-11", "2026-09-12", 3) || !cooledDown("2026-09-09", "2026-09-12", 3) || !cooledDown("2026-09-20", "2026-09-12", 3) {
		t.Fatal("cooldown is 3 days from the last alert")
	}
}

// One bad day in seven stays under the limit.
func TestWindowWAPESmoothsOneBadDay(t *testing.T) {
	day := func(miss float64) zoneDay {
		var d zoneDay
		for h := 8; h < 20; h++ {
			d.a[h], d.f[h] = 10, 10*(1+miss)
		}
		return d
	}
	week := []zoneDay{day(0.25), day(0.25), day(0.25), day(0.25), day(0.25), day(0.25), day(0.6)}
	if w, _, _, _ := windowWAPE(week[6:]); w <= defaultDegradationWAPE {
		t.Fatalf("one day alone %.2f, want above the limit", w)
	}
	if w, _, _, ok := windowWAPE(week); !ok || w >= defaultDegradationWAPE {
		t.Fatalf("seven days %.2f, want under the limit", w)
	}
	bad := []zoneDay{day(0.5), day(0.5), day(0.5), day(0.5), day(0.45), day(0.45), day(0.5)}
	if w, _, _, _ := windowWAPE(bad); w <= defaultDegradationWAPE {
		t.Fatalf("a bad week %.2f, want above the limit", w)
	}
}

func TestDegradationSummaryNamesTheWindow(t *testing.T) {
	res := &DegradationResult{Date: "2026-09-12", WindowDays: 7, Model: "m1", Limit: 0.4, Alerted: []ZoneError{{}, {}}}
	if got := degradationSummary(res); got != "Forecast error above the limit in 2 zone(s) over the 7 day(s) to 2026-09-12 (model m1, limit 40%)." {
		t.Fatalf("summary %q", got)
	}
}
