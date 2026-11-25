// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
	"time"
)

func sickYear(zone string, agents int, perMonth [12]float64) []sickRow {
	var out []sickRow
	for i, d := range perMonth {
		out = append(out, sickRow{ZoneID: zone, Month: time.Month(i + 1), Agents: agents, SickDays: d, DataSource: "SYNTHETIC"})
	}
	return out
}

func TestSickModel_AssumedWithoutHistory(t *testing.T) {
	d := demandSettings{SickDays: 5, WorkingDays: 230}
	m := buildSickModel(d, nil)
	share, src := m.share("z1", "2026-09-14")
	if !near(share, 5.0/230) || src != SickSourceAssumed {
		t.Fatalf("share %v source %s", share, src)
	}
}

func TestSickModel_HistoryRatePerZoneAndMonth(t *testing.T) {
	d := demandSettings{SickDays: 5, WorkingDays: 240}
	// 40 people, 20 working days a month: 800 FTE-days.
	var months [12]float64
	for i := range months {
		months[i] = 8
	}
	months[0] = 24
	m := buildSickModel(d, sickYear("z1", 40, months))
	jan, src := m.share("z1", "2027-01-10")
	if !near(jan, 24.0/800) || src != SickSourceHistory {
		t.Fatalf("january %v %s", jan, src)
	}
	if sep, _ := m.share("z1", "2026-09-14"); !near(sep, 8.0/800) {
		t.Fatalf("september %v", sep)
	}
	if other, src := m.share("z2", "2026-09-14"); src != SickSourceAssumed || !near(other, 5.0/240) {
		t.Fatalf("a zone with no history keeps the assumed rate: %v %s", other, src)
	}
}

func TestSickModel_TwoYearsAverageAndMissingMonthUsesOverall(t *testing.T) {
	d := demandSettings{SickDays: 5, WorkingDays: 240}
	rows := []sickRow{}
	for m := 1; m <= 6; m++ {
		rows = append(rows, sickRow{ZoneID: "z1", Month: time.Month(m), Agents: 10, SickDays: 2})
		rows = append(rows, sickRow{ZoneID: "z1", Month: time.Month(m), Agents: 10, SickDays: 4})
	}
	model := buildSickModel(d, rows)
	if feb, _ := model.share("z1", "2026-02-02"); !near(feb, 6.0/400) {
		t.Fatalf("two Februaries pooled: %v", feb)
	}
	if dec, src := model.share("z1", "2026-12-02"); src != SickSourceHistory || !near(dec, 36.0/2400) {
		t.Fatalf("no December: the zone's own rate, %v %s", dec, src)
	}
}

func TestSickModel_TooLittleHistoryAndBadRowsFallBack(t *testing.T) {
	d := demandSettings{SickDays: 5, WorkingDays: 230}
	rows := []sickRow{{ZoneID: "z1", Month: 1, Agents: 10, SickDays: 3}, {ZoneID: "z1", Month: 2, Agents: 0, SickDays: 3}, {ZoneID: "z1", Month: 13, Agents: 10, SickDays: 1}}
	if _, src := buildSickModel(d, rows).share("z1", "2026-01-05"); src != SickSourceAssumed {
		t.Fatal("under six months of history must use the assumed rate")
	}
	var months [12]float64
	for i := range months {
		months[i] = 10000
	}
	if v, _ := buildSickModel(d, sickYear("z1", 1, months)).share("z1", "2026-03-01"); v != maxSickShare {
		t.Fatalf("absurd history capped: %v", v)
	}
}

func TestPlanDemand_AvailableShareUsesTheModel(t *testing.T) {
	var months [12]float64
	for i := range months {
		months[i] = 80
	}
	d := demandSettings{SickDays: 5, WorkingDays: 240}
	p := &planDemand{settings: d, sick: buildSickModel(d, sickYear("z1", 40, months))}
	if got := p.availableShare("z1", "2026-09-14"); !near(got, 0.9) {
		t.Fatalf("10%% off sick: %v", got)
	}
	if got := p.availableShare("z2", "2026-09-14"); !near(got, 1-5.0/240) {
		t.Fatalf("no history: assumed, %v", got)
	}
	d.Method, d.CustomerCases = demandRate, 0.5
	if got := d.requestCasesAt(zoneDurations{}, 0.9); got == nil || !near(*got, 0.45) {
		t.Fatalf("cases less sick: %v", got)
	}
}

func TestSickModel_WeekShareSpansMonths(t *testing.T) {
	var months [12]float64
	months[8], months[9] = 40, 80
	for i := range months {
		if months[i] == 0 {
			months[i] = 8
		}
	}
	d := demandSettings{SickDays: 5, WorkingDays: 240}
	m := buildSickModel(d, sickYear("z1", 40, months))
	got, src := m.weekShare("z1", "2026-09-27", 7)
	want := (4*40.0/800 + 3*80.0/800) / 7
	if !near(got, want) || src != SickSourceHistory {
		t.Fatalf("27 Sep to 3 Oct: %v want %v (%s)", got, want, src)
	}
}

func TestSickSettings_MethodAndWindow(t *testing.T) {
	resetSettings(t)
	if m, n := sickSettings(context.Background(), ""); m != sickMethodHistory || n != defaultSickHistoryMonths {
		t.Fatalf("defaults %s %d", m, n)
	}
	putSetting(t, sickMethodKey, sickMethodAssumed)
	putSetting(t, sickHistoryMonthsKey, 12.0)
	if m, n := sickSettings(context.Background(), ""); m != sickMethodAssumed || n != 12 {
		t.Fatalf("set %s %d", m, n)
	}
	putSetting(t, sickHistoryMonthsKey, 1.0)
	if _, n := sickSettings(context.Background(), ""); n != defaultSickHistoryMonths {
		t.Fatalf("out of range falls back: %d", n)
	}
	for k, v := range map[string]any{sickMethodKey: "guess", sickHistoryMonthsKey: 2.5} {
		if validPlanningSetting(k, v) == nil {
			t.Fatalf("%s=%v accepted", k, v)
		}
	}
	for k, v := range map[string]any{sickMethodKey: sickMethodHistory, sickHistoryMonthsKey: 36.0, durationDaysKey: 28.0} {
		if err := validPlanningSetting(k, v); err != nil {
			t.Fatalf("%s=%v: %v", k, v, err)
		}
	}
	for _, v := range []any{3.0, 28.5, 400.0} {
		if validPlanningSetting(durationDaysKey, v) == nil {
			t.Fatalf("duration window %v accepted", v)
		}
	}
}

func TestDurations_AdminMeasuredUnlessSet(t *testing.T) {
	resetSettings(t)
	putSetting(t, demandMethodKey, demandDuration)
	d := getDemandSettings(context.Background(), "")
	if d.AdminSet || d.HistoryDays != demandHistoryDays {
		t.Fatalf("defaults %+v", d)
	}
	z := d.withSettings(zoneDurations{Travel: 20, OnScene: 25, Admin: 15, FromHistory: true, AdminFromHistory: true})
	if z.Admin != 15 || !z.AdminFromHistory || !near(d.casesPerInterval(z), 15.0/60) {
		t.Fatalf("measured admin kept: %+v", z)
	}
	if z := d.withSettings(zoneDurations{Travel: 20, OnScene: 25}); z.Admin != defaultAdminMinutes || z.AdminFromHistory {
		t.Fatalf("no measure: the default admin, %+v", z)
	}
	putSetting(t, demandAdminKey, 5.0)
	putSetting(t, durationDaysKey, 28.0)
	d = getDemandSettings(context.Background(), "")
	if z := d.withSettings(zoneDurations{Admin: 15, AdminFromHistory: true}); z.Admin != 5 || z.AdminFromHistory || d.HistoryDays != 28 {
		t.Fatalf("a stored admin setting wins: %+v %d", z, d.HistoryDays)
	}
}

func TestDurations_SlowerZoneNeedsMoreAgents(t *testing.T) {
	d := demandSettings{Method: demandDuration, Admin: 10, SickDays: 0, WorkingDays: 230}
	p := &planDemand{settings: d, byZone: map[string]zoneDurations{
		"fast": {Travel: 8, OnScene: 20, Admin: 5, FromHistory: true, AdminFromHistory: true},
		"slow": {Travel: 18, OnScene: 30, Admin: 12, FromHistory: true, AdminFromHistory: true},
	}, all: zoneDurations{Travel: 20, OnScene: 30}}
	fast, slow := d.casesPerInterval(p.zone("fast")), d.casesPerInterval(p.zone("slow"))
	if !(slow < fast) || !near(fast, 15.0/33) || !near(slow, 15.0/60) {
		t.Fatalf("fast %v slow %v", fast, slow)
	}
}
