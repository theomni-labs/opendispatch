// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

const wxCity = "c602613f-ca37-49ae-b617-7e2c29fc2a84"

func TestLongSynthWithoutWeatherIsUnchanged(t *testing.T) {
	o := LongOptions{Weeks: 3, Seed: 7, End: "2026-09-30", Volume: 0.1, Effects: flat()}
	a, err := GenerateLong(longBase(), o)
	if err != nil {
		t.Fatal(err)
	}
	o.WeatherEffects = &weather.Effects{Rain: 3, Dust: 3, LowVis: 3, Heat: 3}
	b, _ := GenerateLong(longBase(), o)
	if !reflect.DeepEqual(a.Dataset.Intervals, b.Dataset.Intervals) {
		t.Fatal("weather effects must not apply when weather is off")
	}
}

func TestLongSynthWeatherLiftsRainAndDustDays(t *testing.T) {
	base := longBase()
	base.ZoneCity = map[string]string{"z1": "Riyadh"}
	o := LongOptions{Weeks: 52, Seed: 3, End: "2026-09-30", Volume: 0.5, Effects: flat()}
	off, err := GenerateLong(base, o)
	if err != nil {
		t.Fatal(err)
	}
	o.Weather = true
	on, _ := GenerateLong(base, o)
	a, b := dayTotals(off.Dataset), dayTotals(on.Dataset)
	var wet, wetOff, dry, dryOff float64
	for d, n := range b {
		f := weather.FlagsOf(weather.Synthetic(3, "Riyadh", d))
		if (f.Rain || f.Dust) && !f.Heat {
			wet, wetOff = wet+float64(n), wetOff+float64(a[d])
		} else if !f.Rain && !f.Dust && !f.LowVis && !f.Heat {
			dry, dryOff = dry+float64(n), dryOff+float64(a[d])
		}
	}
	if r := wet / wetOff; r < 1.12 {
		t.Errorf("rain and dust days lift by %.3f, want about 1.15 to 1.5", r)
	}
	if r := dry / dryOff; r < 0.97 || r > 1.03 {
		t.Errorf("ordinary days moved by %.3f", r)
	}
}

func TestEngineRequestCarriesWeatherOnlyWhenSet(t *testing.T) {
	req := ForecastRequest{Origin: ts("2026-09-14", "00:00"), Days: 2, Coverage: 0.8,
		Zones:   []ZoneSpec{{ZoneID: "z1", SubZones: []string{"s1"}}},
		History: []HistoryRecord{{SubZoneID: "s1", Start: ts("2026-09-07", "07:00"), Total: 3, Field: 2}}}
	resp := `{"values":[]}`
	plain := &fakeCaller{resp: resp}
	if _, err := NewEngineCandidate(plain, EngineOptions{ModelVersion: "m", Source: SourceSynthetic, ZoneCityID: map[string]string{"z1": wxCity}}).Forecast(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	if _, ok := plain.got["weather"]; ok {
		t.Fatal("no weather func must send no weather")
	}
	if z := plain.got["zones"].([]any)[0].(map[string]any); z["city_id"] != nil {
		t.Fatal("city_id must not be added without weather")
	}
	wx := &fakeCaller{resp: resp}
	o := EngineOptions{ModelVersion: "m", Source: SourceSynthetic, ZoneCityID: map[string]string{"z1": wxCity},
		ZoneCity: map[string]string{"z1": "Riyadh"}, Weather: SyntheticWeather(5)}
	if _, err := NewEngineCandidate(wx, o).Forecast(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	days := wx.got["weather"].([]any)
	if len(days) != 7 || days[6].(map[string]any)["date"] != "2026-09-13" {
		t.Fatalf("want the 7 history days only, got %d", len(days))
	}
	perfect := &fakeCaller{resp: resp}
	o.PerfectWeather = true
	if _, err := NewEngineCandidate(perfect, o).Forecast(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	if n := len(perfect.got["weather"].([]any)); n != 9 {
		t.Fatalf("perfect forecast: want 7 history days and 2 horizon days, got %d", n)
	}
	first := days[0].(map[string]any)
	if first["city_id"] != wxCity || first["date"] != "2026-09-07" || first["source"] != "SYNTHETIC" {
		t.Fatalf("first %v", first)
	}
	if z := wx.got["zones"].([]any)[0].(map[string]any); z["city_id"] != wxCity {
		t.Fatalf("zone %v", z)
	}
}

func TestSourceWeatherReadsAFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "w.csv")
	body := "city,date,rain_mm,dust_event,max_temp_c,visibility_km\nRD,2026-09-08,3,,,\n"
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	fn, n, err := SourceWeather(context.Background(), weather.NewFileSource(p), []weather.City{{ID: wxCity, Code: "RD"}}, "2026-09-01", "2026-09-30")
	if err != nil || n != 1 {
		t.Fatalf("%d %v", n, err)
	}
	if d, ok := fn(wxCity, "", "2026-09-08"); !ok || *d.RainMM != 3 {
		t.Fatalf("%+v", d)
	}
}

func TestLoadZoneCityIDsFromFixtures(t *testing.T) {
	ids, err := LoadZoneCityIDs(filepath.Join("..", "..", "..", "..", "fixtures"))
	if err != nil || len(ids) == 0 {
		t.Fatalf("%v %v", ids, err)
	}
	cities, err := LoadWeatherCities(filepath.Join("..", "..", "..", "..", "fixtures"))
	if err != nil || len(cities) != 3 || cities[0].Code == "" {
		t.Fatalf("%+v %v", cities, err)
	}
}
