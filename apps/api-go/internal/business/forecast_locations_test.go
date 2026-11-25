// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/geocell"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

func TestDayGroupOfFollowsTheSaudiWeek(t *testing.T) {
	want := map[string]string{"2026-09-13": "weekday", "2026-09-16": "weekday", "2026-09-17": "thursday", "2026-09-18": "friday", "2026-09-19": "saturday"}
	for d, g := range want {
		if got, err := DayGroupOf(d); err != nil || got != g {
			t.Fatalf("%s: got %q %v, want %q", d, got, err, g)
		}
	}
	if _, err := DayGroupOf("13/09/2026"); err == nil {
		t.Fatal("a bad date must be refused")
	}
}

func locCount(sub string, lat, lon float64, hour, weekday, n int) locationCount {
	la, lo := geocell.Index(lat, lon, 7)
	return locationCount{SubZoneID: sub, LatIdx: la, LonIdx: lo, Hour: hour, Weekday: weekday, Cases: n}
}

func TestLocationRecordsCapCellsAndPoolTheRest(t *testing.T) {
	subs := map[string]SubZone{tSub1: {BaseRecord: trec(tSub1, "SYNTHETIC"), Latitude: 24.7, Longitude: 46.6}}
	var counts []locationCount
	total := 0
	for i := 0; i < locationMaxCells+50; i++ {
		n := 1 + (locationMaxCells+50-i)/10
		counts = append(counts, locCount(tSub1, 24.70+float64(i%20)*0.002, 46.60+float64(i/20)*0.002, 8, 4, n))
		total += n
	}
	recs := buildLocationRecords(counts, subs, 7)
	cells, sum := map[string]bool{}, 0
	pool := geocell.Encode(24.7, 46.6, locationPoolPrecision)
	for _, r := range recs {
		cells[r.CellID] = true
		sum += r.Cases
		if r.DayGroup != "thursday" || r.Hour != 8 {
			t.Fatalf("got %s at %d, want thursday at 8", r.DayGroup, r.Hour)
		}
		if len(r.CellID) != 7 && r.CellID != pool {
			t.Fatalf("cell %s is neither a micro-cell nor the pool", r.CellID)
		}
	}
	if len(cells) != locationMaxCells+1 || !cells[pool] || sum != total {
		t.Fatalf("got %d cells (pool %v) and %d cases, want %d cells with the pool and %d cases", len(cells), cells[pool], sum, locationMaxCells+1, total)
	}
	again := buildLocationRecords(append([]locationCount(nil), counts...), subs, 7)
	if fmt.Sprint(again) != fmt.Sprint(recs) {
		t.Fatal("the records must be deterministic")
	}
}

func TestLocationRecordsRespectTheBudget(t *testing.T) {
	subs := map[string]SubZone{}
	var counts []locationCount
	for s := 0; s < 12; s++ {
		id := fmt.Sprintf("00000000-0000-4000-8000-%012d", s)
		subs[id] = SubZone{BaseRecord: trec(id, "SYNTHETIC"), Latitude: 24.7, Longitude: 46.6}
		for c := 0; c < locationMaxCells; c++ {
			for h := 0; h < 24; h++ {
				for w := 3; w < 7; w++ {
					counts = append(counts, locCount(id, 24.6+float64(c%20)*0.002, 46.5+float64(c/20)*0.002, h, w, 1))
				}
			}
		}
	}
	recs := buildLocationRecords(counts, subs, 7)
	if len(recs) == 0 || !fitsLocationBudget(recs) {
		t.Fatalf("got %d records, want a non-empty set within the budget", len(recs))
	}
	if len(counts) <= locationMaxRecords || len(recs) >= len(counts) {
		t.Fatalf("setup: %d counts must be over the cap and %d records under them", len(counts), len(recs))
	}
}

func TestForecasterRequestCarriesLocationsOnlyWhenThereAreAny(t *testing.T) {
	src := testForecasterSource()
	raw, err := buildForecasterRequest(src)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "location_records") {
		t.Fatal("no locations: the field must be absent")
	}
	src.Locations = []fcLocationRecord{{SubZoneID: tSub1, CellID: "th3n0bc", Hour: 7, DayGroup: "weekday", Cases: 3}}
	raw, err = buildForecasterRequest(src)
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "forecaster", raw)
	if !strings.Contains(string(raw), `"location_records":[{"sub_zone_id":"`+tSub1+`","cell_id":"th3n0bc","hour":7,"day_group":"weekday","cases":3}]`) {
		t.Fatalf("location_records missing from %s", raw)
	}
}

func locationAnswer(runZone, sub string) ForecasterEngineOutput {
	doc := ForecasterEngineOutput{ModelVersion: "ensemble-3", DataSource: "SYNTHETIC", Illustrative: true,
		Values: []EngineValue{{ZoneID: runZone, SubZoneID: sub}}}
	doc.LocationDistributions = []EngineLocationDistribution{
		{SubZoneID: sub, Hour: 7, DayGroup: "weekday", Cells: []EngineLocationCell{{CellID: "th3n0bc", Probability: 0.25}, {CellID: "th3n0bf", Probability: 0.7}, {CellID: "th3n0", Probability: 0.05}}},
		{SubZoneID: sub, Hour: 7, DayGroup: "friday", Cells: []EngineLocationCell{{CellID: "th3n0bf", Probability: 1}}},
	}
	return doc
}

func TestTheEngineAnswerWithLocationsFitsTheContract(t *testing.T) {
	doc := locationAnswer(tZone, tSub1)
	raw, err := json.Marshal(map[string]any{"location_distributions": doc.LocationDistributions})
	if err != nil {
		t.Fatal(err)
	}
	var v map[string]any
	_ = json.Unmarshal(raw, &v)
	schema := loadJSON(t, filepath.Join(contractDir(), "forecaster.output.schema.json"))
	props := schema["properties"].(map[string]any)
	var errs []string
	checkNode(schema, props["location_distributions"].(map[string]any), v["location_distributions"], "$", &errs)
	if len(errs) > 0 {
		t.Fatal(strings.Join(errs, "\n"))
	}
}

func locRC(role access.Role, zones ...string) reqctx.RequestContext {
	return reqctx.RequestContext{CustomerID: "8f3c2a10-5b7e-4d64-9a21-3c6e0d7b1a55", UserID: datactx.NewID(), Role: role,
		ZoneScope: access.ZoneScopeFor(role, zones), InstallMode: access.InstallPrivate}
}

func TestLocationDistributionsAreKeptPerRunAndRead(t *testing.T) {
	UseMemoryEngineAnswers()
	t.Cleanup(UseMemoryEngineAnswers)
	planner := locRC(access.RolePlanner, tZone)
	run1, run2 := datactx.NewID(), datactx.NewID()
	keepForecastLocations(context.Background(), planner, run1, locationAnswer(tZone, tSub1))
	second := locationAnswer(tZone, tSub1)
	second.LocationDistributions[0].Cells = []EngineLocationCell{{CellID: "th3n0bc", Probability: 1}}
	keepForecastLocations(context.Background(), planner, run2, second)

	got, err := GetForecastLocationDistribution(planner, ForecastLocationQuery{ForecastRunID: run1, SubZoneID: tSub1, Hour: 7, DayGroup: "weekday"})
	if err != nil {
		t.Fatal(err)
	}
	if got.ForecastRunID != run1 || got.ZoneID != tZone || got.CellPrecision != 7 || !got.Illustrative || got.DataSource != "SYNTHETIC" || len(got.Cells) != 3 {
		t.Fatalf("got %+v", got)
	}
	if got.Cells[0].CellID != "th3n0bf" || got.Cells[0].Probability != 0.7 || got.Cells[0].Pooled || !got.Cells[2].Pooled {
		t.Fatalf("cells must be highest first with the pool marked: %+v", got.Cells)
	}
	box, _ := geocell.Decode("th3n0bf")
	if got.Cells[0].South != box.South || got.Cells[0].East != box.East {
		t.Fatal("cells carry their bounds")
	}
	latest, err := GetForecastLocationDistribution(planner, ForecastLocationQuery{SubZoneID: tSub1, Hour: 7, DayGroup: "weekday"})
	if err != nil || latest.ForecastRunID != run2 || len(latest.Cells) != 1 {
		t.Fatalf("no run id: the latest run, got %+v %v", latest, err)
	}
	fri, err := GetForecastLocationDistribution(planner, ForecastLocationQuery{ForecastRunID: run1, SubZoneID: tSub1, Hour: 7, DayGroup: "friday"})
	if err != nil || len(fri.Cells) != 1 || fri.Cells[0].Probability != 1 {
		t.Fatalf("friday: got %+v %v", fri, err)
	}
	empty, err := GetForecastLocationDistribution(planner, ForecastLocationQuery{ForecastRunID: run1, SubZoneID: tSub1, Hour: 3, DayGroup: "saturday"})
	if err != nil || len(empty.Cells) != 0 {
		t.Fatalf("a group with nothing: empty cells, got %+v %v", empty, err)
	}
}

func TestLocationDistributionReadIsGuarded(t *testing.T) {
	UseMemoryEngineAnswers()
	t.Cleanup(UseMemoryEngineAnswers)
	run := datactx.NewID()
	keepForecastLocations(context.Background(), locRC(access.RolePlanner), run, locationAnswer(tZone, tSub1))
	q := ForecastLocationQuery{ForecastRunID: run, SubZoneID: tSub1, Hour: 7, DayGroup: "weekday"}
	code := func(err error) dataerr.Code {
		var de *dataerr.DataError
		if errors.As(err, &de) {
			return de.Code
		}
		return ""
	}
	if _, err := GetForecastLocationDistribution(locRC(access.RoleChangeApprover), q); code(err) != dataerr.CodeForbidden {
		t.Fatalf("no module access: forbidden, got %v", err)
	}
	if _, err := GetForecastLocationDistribution(locRC(access.RoleDispatcher, "11111111-1111-4111-8111-111111111111"), q); code(err) != dataerr.CodeNotFound {
		t.Fatalf("another zone: not found, got %v", err)
	}
	if _, err := GetForecastLocationDistribution(locRC(access.RoleDispatcher, tZone), q); err != nil {
		t.Fatalf("own zone: %v", err)
	}
	for _, bad := range []ForecastLocationQuery{{SubZoneID: tSub1, Hour: 24, DayGroup: "weekday"}, {SubZoneID: tSub1, Hour: 1, DayGroup: "sunday"}, {SubZoneID: "x", Hour: 1, DayGroup: "weekday"}} {
		if _, err := GetForecastLocationDistribution(locRC(access.RolePlanner), bad); code(err) != dataerr.CodeInvalid {
			t.Fatalf("%+v: invalid, got %v", bad, err)
		}
	}
	if _, err := GetForecastLocationDistribution(locRC(access.RolePlanner), ForecastLocationQuery{ForecastRunID: datactx.NewID(), SubZoneID: tSub1, Hour: 7, DayGroup: "weekday"}); code(err) != dataerr.CodeNotFound {
		t.Fatalf("unknown run: not found, got %v", err)
	}
}

func TestTheKeptForecastLeavesTheLocationsOut(t *testing.T) {
	UseMemoryEngineAnswers()
	t.Cleanup(UseMemoryEngineAnswers)
	doc := locationAnswer(tZone, tSub1)
	doc.Horizon.StartDate = "2026-09-14"
	if err := keepForecast(context.Background(), "8f3c2a10-5b7e-4d64-9a21-3c6e0d7b1a55", doc); err != nil {
		t.Fatal(err)
	}
	body, _ := engineAnswerData.latest(context.Background(), "8f3c2a10-5b7e-4d64-9a21-3c6e0d7b1a55", "forecaster")
	if strings.Contains(string(body), "location_distributions") || len(doc.LocationDistributions) == 0 {
		t.Fatal("the kept forecast must not carry the locations, and the caller's doc keeps them")
	}
}
