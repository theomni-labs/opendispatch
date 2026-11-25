// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

type sentDay struct {
	Date    string `json:"date"`
	Payday  *bool  `json:"is_payday"`
	School  *bool  `json:"school_in_session"`
	Events  []struct{ Type, Name string }
	Hijri   *struct{ Year, Month, Day int } `json:"hijri_date"`
	Ramadan bool                            `json:"is_ramadan"`
}

func putSetting(t *testing.T, key string, v any) {
	t.Helper()
	if err := settingsstore.Put(context.Background(), "", key, v); err != nil {
		t.Fatal(err)
	}
}

func resetSettings(t *testing.T) {
	t.Helper()
	settingsstore.UseMemory()
	settingsstore.ResetForTest()
	t.Cleanup(settingsstore.ReloadForTest)
}

// sendCalendar builds the request for the dates and reads what the mock saw.
func sendCalendar(t *testing.T, dates ...string) (map[string]sentDay, []byte) {
	t.Helper()
	srv := useMockEngines(t, time.Second)
	src := testForecasterSource()
	src.Calendar = nil
	cfg := forecastCalendarConfig(context.Background(), "")
	for _, d := range dates {
		day := forecastDay{Date: d}
		applyCalendar(&day, cfg)
		src.Calendar = append(src.Calendar, day)
	}
	raw, err := buildForecasterRequest(src)
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "forecaster", raw)
	if _, err := callEngine(context.Background(), tenantOfTest, engines.Forecaster, func() ([]byte, error) { return raw, nil }); err != nil {
		t.Fatal(err)
	}
	reqs := srv.Requests()
	if len(reqs) != 1 {
		t.Fatalf("%d requests", len(reqs))
	}
	var doc struct {
		Calendar []sentDay `json:"calendar"`
	}
	if err := json.Unmarshal([]byte(reqs[0].Body), &doc); err != nil {
		t.Fatal(err)
	}
	out := map[string]sentDay{}
	for _, d := range doc.Calendar {
		out[d.Date] = d
	}
	return out, []byte(reqs[0].Body)
}

func TestRequestCarriesPaydayOnTheDefaultDay(t *testing.T) {
	resetSettings(t)
	days, _ := sendCalendar(t, "2026-09-26", "2026-09-27")
	if p := days["2026-09-27"].Payday; p == nil || !*p {
		t.Fatal("27th must be payday by default")
	}
	if p := days["2026-09-26"].Payday; p == nil || *p {
		t.Fatal("26th must be sent as not payday")
	}
}

func TestPaydaySettingMovesTheDayAndZeroOmitsIt(t *testing.T) {
	resetSettings(t)
	putSetting(t, "forecast.payday_day", 25)
	days, _ := sendCalendar(t, "2026-09-25", "2026-09-27")
	if p := days["2026-09-25"].Payday; p == nil || !*p {
		t.Fatal("25th must be payday")
	}
	putSetting(t, "forecast.payday_day", 0)
	days, raw := sendCalendar(t, "2026-09-25")
	if days["2026-09-25"].Payday != nil || strings.Contains(string(raw), "is_payday") {
		t.Fatal("payday off must omit the field")
	}
}

func TestEidHajjAndNationalDayAreInTheRequest(t *testing.T) {
	resetSettings(t)
	days, _ := sendCalendar(t, "2026-03-20", "2026-05-27", "2026-09-23", "2026-09-14")
	want := map[string]string{"2026-03-20": "eid", "2026-05-27": "eid hajj", "2026-09-23": "national_day", "2026-09-14": ""}
	for date, w := range want {
		var got []string
		for _, e := range days[date].Events {
			got = append(got, e.Type)
		}
		if strings.Join(got, " ") != w {
			t.Fatalf("%s: events %v, want %q", date, got, w)
		}
	}
	if h := days["2026-05-27"].Hijri; h == nil || h.Month != 12 || h.Day != 10 {
		t.Fatalf("hijri date %+v", h)
	}
}

func TestEmptySettingsOmitSchoolButSendEmptyEvents(t *testing.T) {
	resetSettings(t)
	days, raw := sendCalendar(t, "2026-09-14")
	if days["2026-09-14"].School != nil || len(days["2026-09-14"].Events) != 0 {
		t.Fatal("unknown school must be omitted and an ordinary day has no events")
	}
	if strings.Contains(string(raw), "school_in_session") {
		t.Fatalf("school_in_session must not be sent when unknown: %s", raw)
	}
	if !strings.Contains(string(raw), `"events":[]`) {
		t.Fatalf("events must be sent as [] (derived events are known, absent means unknown): %s", raw)
	}
}

func TestSettingsDriveSchoolSeasonAndUmrah(t *testing.T) {
	resetSettings(t)
	putSetting(t, "forecast.school_terms", []any{map[string]any{"start": "2026-09-01", "end": "2026-12-10", "name": "T1"}})
	putSetting(t, "forecast.season_events", []any{map[string]any{"start": "2026-10-01", "end": "2026-10-05", "name": "Riyadh Season"}})
	putSetting(t, "forecast.umrah_windows", []any{map[string]any{"start": "2026-10-03", "end": "2026-10-09", "name": "Umrah"}})
	days, _ := sendCalendar(t, "2026-09-14", "2026-10-04", "2026-08-01")
	if s := days["2026-09-14"].School; s == nil || !*s {
		t.Fatal("in session")
	}
	if days["2026-08-01"].School != nil {
		t.Fatal("outside the listed terms is unknown")
	}
	var got []string
	for _, e := range days["2026-10-04"].Events {
		got = append(got, e.Type+":"+e.Name)
	}
	if strings.Join(got, ",") != "season_event:Riyadh Season,umrah:Umrah" {
		t.Fatalf("events %v", got)
	}
}

func TestPlanningModeChoosesTheQuantile(t *testing.T) {
	resetSettings(t)
	if planningQuantile(context.Background(), "") != "expected" {
		t.Fatal("central is the default")
	}
	putSetting(t, "forecast.planning_mode", "high")
	if planningQuantile(context.Background(), "") != "high" {
		t.Fatal("high")
	}
	s := testOptimizerSource()
	s.DemandQuantile = planningQuantile(context.Background(), "")
	raw, err := buildOptimizerRequest(s)
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "optimizer", raw)
	if !strings.Contains(string(raw), `"demand_quantile":"high"`) {
		t.Fatalf("the quantile is not carried: %s", raw)
	}
	putSetting(t, "forecast.planning_mode", "bogus")
	if planningQuantile(context.Background(), "") != "expected" {
		t.Fatal("an unknown mode falls back to central")
	}
}
