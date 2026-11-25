// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

func TestDemandSettings_DefaultsAreDurationAndFiveSickDays(t *testing.T) {
	resetSettings(t)
	d := getDemandSettings(context.Background(), "")
	if d.Method != demandDuration || d.CustomerCases != 0.5 || d.Admin != 10 || d.SickDays != 5 || d.WorkingDays != 230 {
		t.Fatalf("defaults: %+v", d)
	}
	if !near(d.availableShare(), 1-5.0/230) {
		t.Fatalf("share %v", d.availableShare())
	}
	// 20 + 30 + 10 admin = 60 min: a quarter case
	if !near(d.casesPerInterval(zoneDurations{Travel: 20, OnScene: 30, Admin: 10}), 0.25) {
		t.Fatalf("duration method: %v", d.casesPerInterval(zoneDurations{Travel: 20, OnScene: 30, Admin: 10}))
	}
	got := d.requestCases(zoneDurations{Travel: 20, OnScene: 30, Admin: 10})
	if got == nil || !near(*got, math.Round(0.25*(1-5.0/230)*1e6)/1e6) {
		t.Fatalf("one case an hour, less sick leave: %v", got)
	}
}

func TestDemandSettings_CustomerConventionStaysOneSettingAway(t *testing.T) {
	resetSettings(t)
	putSetting(t, demandMethodKey, demandRate)
	d := getDemandSettings(context.Background(), "")
	if d.Method != demandRate || d.casesPerInterval(zoneDurations{Travel: 20, OnScene: 30, Admin: 10}) != 0.5 {
		t.Fatalf("customer convention ignores durations: %+v", d)
	}
	got := d.requestCases(zoneDurations{})
	if got == nil || !near(*got, math.Round(0.5*(1-5.0/230)*1e6)/1e6) {
		t.Fatalf("one case a half hour, less sick leave: %v", got)
	}
}

func TestDemandSettings_DurationMethodUsesMinutesPerCase(t *testing.T) {
	resetSettings(t)
	putSetting(t, demandMethodKey, demandDuration)
	putSetting(t, demandAdminKey, 15.0)
	d := getDemandSettings(context.Background(), "")
	z := d.withSettings(zoneDurations{Travel: 20, OnScene: 25, FromHistory: true})
	if !near(d.casesPerInterval(z), 15.0/60) || !z.FromHistory {
		t.Fatalf("cases %v from history %v", d.casesPerInterval(z), z.FromHistory)
	}
	putSetting(t, demandTravelKey, 5.0)
	d = getDemandSettings(context.Background(), "")
	z = d.withSettings(zoneDurations{Travel: 20, OnScene: 25, FromHistory: true})
	if z.Travel != 5 || z.FromHistory || !near(d.casesPerInterval(z), 15.0/45) {
		t.Fatalf("travel setting not applied: %+v", z)
	}
}

func TestDemandSettings_BadValuesFallBack(t *testing.T) {
	resetSettings(t)
	putSetting(t, demandMethodKey, "guess")
	putSetting(t, sickLeaveDaysKey, -3.0)
	putSetting(t, workingDaysKey, 12.0)
	putSetting(t, demandAdminKey, 9999.0)
	d := getDemandSettings(context.Background(), "")
	if d.Method != demandDuration || d.SickDays != 5 || d.WorkingDays != 230 || d.Admin != 10 {
		t.Fatalf("fallbacks: %+v", d)
	}
}

func TestRequestCases_NoneSentWhenNothingChanges(t *testing.T) {
	d := demandSettings{Method: demandRate, CustomerCases: 1, SickDays: 0, WorkingDays: 230}
	if d.requestCases(zoneDurations{}) != nil {
		t.Fatal("customer with no sick leave must send nothing")
	}
	d.SickDays = 5
	got := d.requestCases(zoneDurations{})
	if got == nil || !near(*got, math.Round((1-5.0/230)*1e6)/1e6) {
		t.Fatalf("sick leave lowers capacity: %v", got)
	}
}

func TestOptimizerRequest_SendsCasesPerInterval(t *testing.T) {
	src := testOptimizerSource()
	v := 0.25
	src.CasesPerInterval = &v
	raw, err := buildOptimizerRequest(src)
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "optimizer", raw)
	if !strings.Contains(string(raw), `"cases_per_agent_per_interval":0.25`) {
		t.Fatalf("not sent: %s", raw)
	}
	src.CasesPerInterval = nil
	raw, _ = buildOptimizerRequest(src)
	if strings.Contains(string(raw), "cases_per_agent_per_interval") {
		t.Fatal("sent when nil")
	}
	bad := 0.0
	src.CasesPerInterval = &bad
	if _, err := buildOptimizerRequest(src); err == nil {
		t.Fatal("zero accepted")
	}
}

func baselineWith(n int, used map[string]float64) *OptimizerBaseline {
	s := make([]int, 96)
	s[10] = n
	return &OptimizerBaseline{Date: "2026-09-14", Required: map[string][]int{"z1": s}, CasesPerInterval: used}
}

func TestRequiredSeries_DurationScalesTheConventionBaseline(t *testing.T) {
	resetSettings(t)
	putSetting(t, demandMethodKey, demandDuration)
	plan := &PlanReader{Baseline: baselineWith(3, nil), Factor: func(string, string, string) float64 { return 1 }}
	got := requiredSeries(plan, "z1", "2026-09-14")
	// fallback 20 + 30 + 10 = 60 min: x4
	if got[10] != 12 {
		t.Fatalf("got %d, want 12", got[10])
	}
}

func TestRequiredSeries_KeptCapacityIsUndone(t *testing.T) {
	resetSettings(t)
	putSetting(t, demandMethodKey, demandRate)
	plan := &PlanReader{Baseline: baselineWith(8, map[string]float64{"z1": 0.25}), Factor: func(string, string, string) float64 { return 1 }}
	if got := requiredSeries(plan, "z1", "2026-09-14"); got[10] != 4 {
		t.Fatalf("got %d, want 4 (8 at 0.25 is 2 cases, 4 at 0.5)", got[10])
	}
	plan = &PlanReader{Baseline: baselineWith(8, nil), Factor: func(string, string, string) float64 { return 1 }}
	if got := requiredSeries(plan, "z1", "2026-09-14"); got[10] != 16 {
		t.Fatalf("got %d, want 16 (8 at the engine's 1 is 8 cases)", got[10])
	}
	putSetting(t, demandRateCasesKey, 1.0)
	plan = &PlanReader{Baseline: baselineWith(8, nil), Factor: func(string, string, string) float64 { return 1 }}
	if got := requiredSeries(plan, "z1", "2026-09-14"); got[10] != 8 {
		t.Fatalf("setting 1 changed required: %d", got[10])
	}
}

func TestRequiredSeries_KeptAndFixtureDaysAgree(t *testing.T) {
	one := func(v float64) func(string, string, string) float64 {
		return func(string, string, string) float64 { return v }
	}
	// customer 0.5; duration 20 + 30 + 10 min: 0.25
	for method, per := range map[string]float64{demandRate: 0.5, demandDuration: 0.25} {
		resetSettings(t)
		putSetting(t, demandMethodKey, method)
		asked := *getDemandSettings(context.Background(), "").requestCases(zoneDurations{Travel: fallbackTravelMin, OnScene: fallbackOnSceneMin, Admin: 10})
		// field cases, clear of rounding edges
		for _, cases := range []float64{0.3, 0.9, 1.6, 2.3, 3.4, 4.6} {
			gen := math.Max(3, math.Ceil(cases*0.55/0.25/0.5))
			if method == demandDuration && gen*fixtureCasesPerInterval/per > math.Ceil(cases/per) {
				continue // the generator's 3-agent floor
			}
			kept := math.Ceil(cases/asked - 1e-9)
			onFixture := &PlanReader{Baseline: baselineWith(int(gen), map[string]float64{"z1": fixtureCasesPerInterval}), Factor: one(1)}
			onKept := &PlanReader{Baseline: baselineWith(int(kept), map[string]float64{"z1": asked}), Factor: one(1)}
			f, k := requiredSeries(onFixture, "z1", "2026-09-14")[10], requiredSeries(onKept, "z1", "2026-09-14")[10]
			if want := int(math.Ceil(cases / per)); f != want || k != want {
				t.Fatalf("%s, %v cases: fixture %d, kept %d, want %d", method, cases, f, k, want)
			}
		}
	}
}

func TestGapCells_PlannedIsExpectedAfterSickLeave(t *testing.T) {
	series := CoverageSeries{OnDuty: make([]int, 96), WithVehicle: make([]int, 96)}
	series.OnDuty[0], series.WithVehicle[0] = 30, 30
	series.OnDuty[1], series.WithVehicle[1] = 10, 10
	required := make([]int, 96)
	required[0], required[1] = 30, 10
	cells := gapCells("z1", "2026-09-14", series, required, GeographyInput{}, 1-5.0/230)
	if cells[0].Planned != 29 || cells[0].Kind != "gap" {
		t.Fatalf("30 rostered at 97.8%%: %+v", cells[0])
	}
	if cells[1].Planned != 10 || cells[1].Kind != "balanced" {
		t.Fatalf("10 rostered rounds back to 10: %+v", cells[1])
	}
}

func TestStampAndMergeCasesUsed(t *testing.T) {
	v := 0.5
	a := stampCasesUsed([]byte(`{"roster_date":"2026-09-14"}`), "z1", &v)
	b := stampCasesUsed([]byte(`{"roster_date":"2026-09-14"}`), "z2", nil)
	var doc optimizerOutputDoc
	if err := json.Unmarshal(mergeCasesUsed(a, b), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CasesPerInterval["z1"] != 0.5 || doc.CasesPerInterval["z2"] != 1 {
		t.Fatalf("merged %v", doc.CasesPerInterval)
	}
	if got := baselineOf(&doc).CasesPerInterval["z1"]; got != 0.5 {
		t.Fatalf("baseline %v", got)
	}
}

func TestValidPlanningSetting(t *testing.T) {
	ok := map[string]any{demandMethodKey: demandDuration, demandAdminKey: 12.0, demandTravelKey: nil, sickLeaveDaysKey: 0.0, workingDaysKey: 230.0, demandRateCasesKey: 0.5, overrideTargetKey: 0.1}
	for k, v := range ok {
		if err := validPlanningSetting(k, v); err != nil {
			t.Fatalf("%s=%v: %v", k, v, err)
		}
	}
	bad := map[string]any{demandMethodKey: "x", demandAdminKey: -1.0, sickLeaveDaysKey: 61.0, workingDaysKey: 50.0, demandRateCasesKey: 0.0, demandOnSceneKey: "ten", overrideTargetKey: 0.0}
	for k, v := range bad {
		if err := validPlanningSetting(k, v); err == nil {
			t.Fatalf("%s=%v accepted", k, v)
		}
	}
}

func TestBasis_SaysMethodAndMinutes(t *testing.T) {
	resetSettings(t)
	plan := &PlanReader{}
	b := plan.basis([]string{"z1"}, "2026-09-14")
	if b.Method != demandDuration || *b.AdminMinutes != 10 || *b.Zones[0].MinutesPerCase != 60 || b.Zones[0].CasesPerInterval != 0.25 {
		t.Fatalf("default duration basis %+v %+v", b, b.Zones[0])
	}
	putSetting(t, demandMethodKey, demandRate)
	plan = &PlanReader{}
	b = plan.basis([]string{"z1"}, "2026-09-14")
	if b.Method != demandRate || b.AdminMinutes != nil || b.Zones[0].MinutesPerCase != nil || b.Zones[0].CasesPerInterval != 0.5 {
		t.Fatalf("customer basis %+v", b)
	}
}
