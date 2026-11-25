// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func explainedDoc() (*ForecasterEngineOutput, ForecastRun) {
	doc := &ForecasterEngineOutput{ModelVersion: "ensemble-4", GeneratedAt: "2026-09-13T02:04:00Z"}
	doc.Engine.Version = "0.6.0"
	doc.Horizon.StartDate, doc.Horizon.Days = "2026-09-13", 10
	doc.ModelInfo = json.RawMessage(`{"feature_set":["holiday"],"training_start":"2025-09-13","training_end":"2026-09-12","history_days":365}`)
	doc.Explanations = []EngineExplanation{
		{ZoneID: tZone, Date: "2026-09-14", Base: 200, Expected: 231, Drivers: []ExplanationDriver{
			{Driver: "weekday", Multiplier: 1.1}, {Driver: "trend", Multiplier: 1.05}, {Driver: "payday", Multiplier: 1.0, Unknown: true}, {Driver: "model_other", Multiplier: 1}}},
	}
	ev, fin := doc.Engine.Version, doc.GeneratedAt
	run := ForecastRun{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), DataSource: "SYNTHETIC"}, ModelVersion: doc.ModelVersion, EngineVersion: &ev, FinishedAt: &fin, Illustrative: true,
		HorizonStartDate: "2026-09-13", HorizonDays: 10}
	return doc, run
}

func dataCode(err error) dataerr.Code {
	var de *dataerr.DataError
	if errors.As(err, &de) {
		return de.Code
	}
	return ""
}

func TestExplanationsFitTheEngineContract(t *testing.T) {
	doc, _ := explainedDoc()
	raw, _ := json.Marshal(map[string]any{"explanations": doc.Explanations})
	var v map[string]any
	_ = json.Unmarshal(raw, &v)
	schema := loadJSON(t, filepath.Join(contractDir(), "forecaster.output.schema.json"))
	var errs []string
	checkNode(schema, schema["properties"].(map[string]any)["explanations"].(map[string]any), v["explanations"], "$", &errs)
	if len(errs) > 0 {
		t.Fatal(strings.Join(errs, "\n"))
	}
}

func TestExplanationIsTheRunsOwnZoneDay(t *testing.T) {
	doc, run := explainedDoc()
	got, err := explanationFrom(doc, run, tZone, "2026-09-14")
	if err != nil {
		t.Fatal(err)
	}
	if got.ForecastRunID != run.ID || got.Base != 200 || got.Expected != 231 || len(got.Drivers) != 4 || !got.Drivers[2].Unknown {
		t.Fatalf("got %+v", got)
	}
	if got.TrainingStart != "2025-09-13" || got.TrainingEnd != "2026-09-12" || got.HistoryDays == nil || *got.HistoryDays != 365 {
		t.Fatalf("model info: %+v", got)
	}
	if got.ModelVersion != "ensemble-4" || got.EngineVersion != "0.6.0" || !got.Illustrative || got.DataSource != "SYNTHETIC" {
		t.Fatalf("provenance: %+v", got)
	}
	if _, err := explanationFrom(doc, run, tZone, "2026-09-15"); dataCode(err) != dataerr.CodeNotFound {
		t.Fatalf("another day: not found, got %v", err)
	}
	other := run
	mv := "seasonal-profile-1"
	other.ModelVersion = mv
	if _, err := explanationFrom(doc, other, tZone, "2026-09-14"); dataCode(err) != dataerr.CodeNotFound {
		t.Fatalf("a doc of another run: not found, got %v", err)
	}
	started, finished := "2026-09-13T02:03:58Z", "2026-09-13T02:04:02Z"
	stored := run
	stored.StartedAt, stored.FinishedAt = &started, &finished
	if _, err := explanationFrom(doc, stored, tZone, "2026-09-14"); err != nil {
		t.Fatalf("the run stores its own finish time after the answer: %v", err)
	}
	late := "2026-09-13T03:00:00Z"
	stored.StartedAt = &late
	if _, err := explanationFrom(doc, stored, tZone, "2026-09-14"); dataCode(err) != dataerr.CodeNotFound {
		t.Fatalf("an answer from before the run: not found, got %v", err)
	}
	if _, err := explanationFrom(nil, run, tZone, "2026-09-14"); dataCode(err) != dataerr.CodeNotFound {
		t.Fatalf("no doc: not found, got %v", err)
	}
}

func TestExplanationReadIsGuarded(t *testing.T) {
	q := ForecastExplanationQuery{ZoneID: tZone, Date: "2026-09-14"}
	if _, err := GetForecastExplanation(locRC(access.RoleChangeApprover), q); dataCode(err) != dataerr.CodeForbidden {
		t.Fatalf("no module access: forbidden, got %v", err)
	}
	if _, err := GetForecastExplanation(locRC(access.RoleDispatcher, "11111111-1111-4111-8111-111111111111"), q); dataCode(err) != dataerr.CodeNotFound {
		t.Fatalf("another zone: not found, got %v", err)
	}
	for _, bad := range []ForecastExplanationQuery{{Date: "2026-09-14"}, {ZoneID: "x", Date: "2026-09-14"}, {ZoneID: tZone, Date: "14/09/2026"}} {
		if _, err := GetForecastExplanation(locRC(access.RolePlanner), bad); dataCode(err) != dataerr.CodeInvalid {
			t.Fatalf("%+v: invalid, got %v", bad, err)
		}
	}
}

func TestChunksKeepEveryExplanation(t *testing.T) {
	a, _ := explainedDoc()
	b, _ := explainedDoc()
	b.Explanations[0].Date = "2026-09-15"
	var doc ForecasterEngineOutput
	if err := mergeForecastChunk(&doc, *a, true); err != nil {
		t.Fatal(err)
	}
	if err := mergeForecastChunk(&doc, *b, false); err != nil {
		t.Fatal(err)
	}
	if len(doc.Explanations) != 2 || doc.Explanations[1].Date != "2026-09-15" {
		t.Fatalf("got %+v", doc.Explanations)
	}
}

func TestLocationsReadTakesADateOrADayGroup(t *testing.T) {
	UseMemoryEngineAnswers()
	t.Cleanup(UseMemoryEngineAnswers)
	planner := locRC(access.RolePlanner, tZone)
	run := datactx.NewID()
	keepForecastLocations(context.Background(), planner, run, locationAnswer(tZone, tSub1))
	byDate, err := GetForecastLocations(planner, ForecastLocationsParams{SubZoneID: tSub1, Hour: "7", Date: "2026-09-14"})
	if err != nil || byDate.DayGroup != "weekday" || len(byDate.Cells) != 3 {
		t.Fatalf("a Monday is a weekday: %+v %v", byDate, err)
	}
	fri, err := GetForecastLocations(planner, ForecastLocationsParams{SubZoneID: tSub1, Hour: "7", DayGroup: "friday", ForecastRunID: run})
	if err != nil || fri.DayGroup != "friday" {
		t.Fatalf("friday: %+v %v", fri, err)
	}
	for _, bad := range []ForecastLocationsParams{{SubZoneID: tSub1, Hour: "x", DayGroup: "weekday"}, {SubZoneID: tSub1, Hour: "7"},
		{SubZoneID: tSub1, Hour: "7", DayGroup: "friday", Date: "2026-09-14"}, {SubZoneID: tSub1, Hour: "7", Date: "bad"}} {
		if _, err := GetForecastLocations(planner, bad); dataCode(err) != dataerr.CodeInvalid {
			t.Fatalf("%+v: invalid, got %v", bad, err)
		}
	}
}
