// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

const (
	tZone  = "091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a"
	tZone2 = "9c5b4a9a-6a53-4d7e-9a1f-0c6f5a2f0b11"
	tCity  = "c602613f-ca37-49ae-b617-7e2c29fc2a84"
	tSub1  = "1c3884cd-b920-4cdc-8f46-d3fa53127ce3"
	tSub2  = "54293f6f-617f-4055-b9af-35236212daae"
	tPat   = "bfd12e32-9711-49d5-a7a6-a1653fd12607"
	tRule  = "b789cbe5-c479-40e7-8d3f-aee0eab303c4"
	tSurv1 = "8aec9202-669d-4b1d-8e97-27d132e909ed"
	tSurv2 = "7b2250b5-d39c-4d1e-8300-28a84a841442"
	tVeh   = "960da2cd-1c46-4e73-9938-99d4a9535cf4"
	tPoint = "92b7ff9b-6358-4eb7-9690-8b004d8f600c"
	tCase  = "53c6974b-d62b-469d-afcd-d52d2b578eb6"
)

var tNow = time.Date(2026, 9, 13, 2, 0, 0, 0, time.FixedZone("x", 3*3600))

func sp(s string) *string { return &s }

func trec(id, source string) datactx.BaseRecord {
	return datactx.BaseRecord{ID: id, DataSource: source}
}

func testForecasterSource() forecasterSource {
	prayer := &PrayerTime{Fajr: "04:17", Dhuhr: "11:52", Asr: "15:20", Maghrib: "18:07", Isha: "19:37"}
	return forecasterSource{
		Now: tNow, StartDate: "2026-09-14", Days: 1, ModelVersion: "placeholder-0.1", RangeCoverage: 0.8, RuleSetVersion: "draft-2026-09",
		Zones: []Zone{{BaseRecord: trec(tZone, "SYNTHETIC"), CityID: tCity, IsActive: true}},
		SubZones: []SubZone{
			{BaseRecord: trec(tSub1, "SYNTHETIC"), ZoneID: tZone, Latitude: 24.7, Longitude: 46.6, IsActive: true},
			{BaseRecord: trec(tSub2, "SYNTHETIC"), ZoneID: tZone, Latitude: 24.6, Longitude: 46.6},
		},
		Calendar: []forecastDay{{Date: "2026-09-14", IsHoliday: true, HolidayName: "National Day", Prayer: prayer}},
		History:  []historyRow{{SubZoneID: tSub1, IntervalStart: tNow, Total: 4, Field: 2}, {SubZoneID: tSub2, IntervalStart: tNow, Total: 1, Field: 1}},
		Sources:  []string{"SYNTHETIC", "IMPORTED", "SYNTHETIC"},
	}
}

func testOptimizerSource() optimizerSource {
	hours := ShiftHours{Applies: true, StartTime: sp("22:00"), EndTime: sp("06:00"), CrossesMidnight: true}
	return optimizerSource{
		Now: tNow, Date: "2026-09-14", ZoneID: tZone, PlanningLevel: "zone", ForecastRef: "run-1",
		Forecast: []ForecastValue{{ZoneID: tZone, SubZoneID: tSub1, IntervalStart: "2026-09-14T07:00:00+03:00", Low: 0.2, Expected: 0.6, High: 1.1, FieldExpected: 0.4, RemoteInferredExpected: 0.2}},
		Agents: []Agent{
			{BaseRecord: trec(tSurv1, "SYNTHETIC"), Kind: "field", HomeZoneID: sp(tZone), IsActive: true},
			{BaseRecord: trec(tSurv2, "SYNTHETIC"), Kind: "remote", IsActive: true},
			{BaseRecord: trec("not-used", "SYNTHETIC"), Kind: "field", IsActive: false},
		},
		Skills:     map[string][]string{tSurv1: {"heavy", "general"}},
		OnLeave:    map[string]bool{tSurv2: true},
		Vehicles:   []Vehicle{{BaseRecord: trec(tVeh, "SYNTHETIC"), ZoneID: sp(tZone), IsActive: true}},
		Patterns:   []ShiftPattern{{BaseRecord: trec(tPat, "SYNTHETIC"), Code: "NIGHT", Kind: ShiftKindField, Normal: hours, Ramadan: ShiftHours{Applies: false}, BreakRuleID: sp(tRule), Status: ShiftStatusActive}},
		BreakRules: []BreakRule{{BaseRecord: trec(tRule, "SYNTHETIC"), BreakMinutes: 30, AfterConsecutiveHours: 5}},
		Prayer:     &PrayerTime{Fajr: "04:17", Dhuhr: "11:52", Asr: "15:20", Maghrib: "18:07", Isha: "19:37"},
		Points:     []StandbyPoint{{BaseRecord: trec(tPoint, "SYNTHETIC"), ZoneID: tZone, Latitude: 24.7, Longitude: 46.7, CoverageRadiusM: 4500, IsActive: true}},
		Sources:    []string{"SYNTHETIC"},
	}
}

func testSimulatorSource() simulatorSource {
	parties := 2
	return simulatorSource{
		Now: tNow, ClockStart: "assignment", ThresholdSeconds: 600, Policy: "nearest",
		Cases:     []simDayCase{{ID: tCase, RegisteredAt: "2026-09-14T00:07:11+03:00", ZoneID: tZone, SubZoneID: tSub1, Handling: "field", Latitude: 24.67, Longitude: 46.73, Parties: &parties}},
		RosterRef: "roster-1",
		Lines:     []RosterAssignment{{AgentID: tSurv1, ShiftPatternID: sp(tPat), ZoneID: sp(tZone), StartAt: "2026-09-14T06:00:00+03:00", EndAt: "2026-09-14T14:00:00+03:00", StandbyPointID: sp(tPoint)}},
		Points:    []StandbyPoint{{BaseRecord: trec(tPoint, "SYNTHETIC"), Latitude: 24.7, Longitude: 46.7}},
		Sources:   []string{"SYNTHETIC"},
	}
}

func TestTheContractCheckerAcceptsTheExamples(t *testing.T) {
	for _, n := range []string{"forecaster", "optimizer", "simulator"} {
		raw, err := os.ReadFile(filepath.Join(contractDir(), "examples", n+".input.json"))
		if err != nil {
			t.Fatal(err)
		}
		checkRequest(t, n, raw)
	}
}

func TestTheContractCheckerRefusesABadRequest(t *testing.T) {
	schema := loadJSON(t, filepath.Join(contractDir(), "optimizer.input.schema.json"))
	bad := map[string]any{
		"schema_version": "1.0", "planning_level": "galaxy",
		"shift_patterns": []any{map[string]any{"normal": map[string]any{"applies": true, "crosses_midnight": true}}},
	}
	var errs []string
	checkNode(schema, schema, bad, "$", &errs)
	joined := strings.Join(errs, "\n")
	for _, want := range []string{"not in enum", "crosses_midnight", "missing required"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("want %q among:\n%s", want, joined)
		}
	}
}

func TestForecasterRequestFitsTheContract(t *testing.T) {
	raw, err := buildForecasterRequest(testForecasterSource())
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "forecaster", raw)
	for _, want := range []string{`"data_source":"IMPORTED"`, `"input_data_sources":["SYNTHETIC","IMPORTED"]`, `"is_holiday":true`} {
		if !strings.Contains(string(raw), want) {
			t.Fatalf("want %s in %s", want, raw)
		}
	}
	if strings.Contains(string(raw), tSub2) {
		t.Fatal("an inactive sub-zone was sent")
	}
}

func TestForecasterRequestSendsEmptyEventsNotAbsent(t *testing.T) {
	raw, err := buildForecasterRequest(testForecasterSource())
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Calendar []map[string]json.RawMessage `json:"calendar"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil || len(doc.Calendar) == 0 {
		t.Fatalf("no calendar: %v", err)
	}
	for _, day := range doc.Calendar {
		ev, ok := day["events"]
		if !ok || string(ev) == "null" {
			t.Fatalf("a day has no explicit events list: %s", raw)
		}
	}
}

func TestOptimizerRequestFitsTheContractAndDropsCrossesMidnight(t *testing.T) {
	raw, err := buildOptimizerRequest(testOptimizerSource())
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "optimizer", raw)
	if strings.Contains(string(raw), "crosses_midnight") || strings.Contains(string(raw), "not-used") {
		t.Fatalf("crosses_midnight or an inactive agent leaked: %s", raw)
	}
	if !strings.Contains(string(raw), `"unavailable_reason":"approved leave"`) {
		t.Fatalf("leave is not carried: %s", raw)
	}
}

func TestSimulatorRequestFitsTheContract(t *testing.T) {
	raw, err := buildSimulatorRequest(testSimulatorSource())
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "simulator", raw)
	if !strings.Contains(string(raw), `"start_latitude":24.7`) {
		t.Fatalf("the standby point is not the start: %s", raw)
	}
}

func TestBuildersReturnErrorsNotPanicsWhenDataIsMissing(t *testing.T) {
	f := testForecasterSource()
	f.History = nil
	o := testOptimizerSource()
	o.Forecast = nil
	o2 := testOptimizerSource()
	o2.Patterns[0].BreakRuleID = nil
	s := testSimulatorSource()
	s.Cases = nil
	s2 := testSimulatorSource()
	s2.Cases[0].ID = "not-a-uuid"
	builds := map[string]func() ([]byte, error){
		"history": func() ([]byte, error) { return buildForecasterRequest(f) },
		"values":  func() ([]byte, error) { return buildOptimizerRequest(o) },
		"rule":    func() ([]byte, error) { return buildOptimizerRequest(o2) },
		"cases":   func() ([]byte, error) { return buildSimulatorRequest(s) },
		"uuid":    func() ([]byte, error) { return buildSimulatorRequest(s2) },
		"empty":   func() ([]byte, error) { return buildForecasterRequest(forecasterSource{}) },
	}
	for name, build := range builds {
		if _, err := build(); !errors.Is(err, ErrEngineInput) {
			t.Fatalf("%s: got %v, want ErrEngineInput", name, err)
		}
	}
}
