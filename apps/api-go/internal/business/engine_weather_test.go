// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

func fp(v float64) *float64 { return &v }

func useWeather(t *testing.T, s weather.Source) {
	t.Helper()
	old := weatherOverride
	weatherOverride = s
	t.Cleanup(func() { weatherOverride = old })
}

func TestForecasterRequestCarriesWeatherOfItsCities(t *testing.T) {
	src := testForecasterSource()
	src.Weather = []weather.Day{
		{CityID: tCity, Date: "2026-09-13", RainMM: fp(4), Source: "file"},
		{CityID: tCity, Date: "2026-09-14", MaxTempC: fp(41.5), VisibilityKM: fp(1.5), Source: "open-meteo:forecast"},
		{CityID: tCity, Date: "2026-09-15"},
		{CityID: "79cd66f3-4fbf-4f73-b7cb-37929b4d5cf0", Date: "2026-09-14", RainMM: fp(1)},
	}
	raw, err := buildForecasterRequest(src)
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "forecaster", raw)
	var got struct {
		Weather []map[string]any `json:"weather"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Weather) != 2 {
		t.Fatalf("want the two known days of the zone's city, got %v", got.Weather)
	}
	if _, ok := got.Weather[0]["max_temp_c"]; ok {
		t.Fatal("an unknown field must be omitted, not sent")
	}
}

func TestForecasterRequestWithoutWeatherIsUnchanged(t *testing.T) {
	raw, err := buildForecasterRequest(testForecasterSource())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"weather"`) {
		t.Fatal("no source must send no weather key")
	}
}

func TestWeatherCitiesTakeAPointFromZonesOrSubZones(t *testing.T) {
	lat, lon := 21.5, 39.2
	cities := []City{
		{BaseRecord: trec(tCity, "SYNTHETIC"), CaseCode: "RD", NameEn: "Riyadh"},
		{BaseRecord: trec("79cd66f3-4fbf-4f73-b7cb-37929b4d5cf0", "SYNTHETIC"), CaseCode: "JD", NameEn: "Jeddah", Extra: map[string]any{"latitude": 21.6, "longitude": 39.1}},
		{BaseRecord: trec("ba39397e-167d-43c7-9cb1-e923097c8c1f", "SYNTHETIC"), NameEn: "Unused"},
	}
	zones := []Zone{
		{BaseRecord: trec(tZone, "SYNTHETIC"), CityID: tCity, IsActive: true},
		{BaseRecord: trec(tZone2, "SYNTHETIC"), CityID: "79cd66f3-4fbf-4f73-b7cb-37929b4d5cf0", Latitude: &lat, Longitude: &lon, IsActive: true},
	}
	subs := testForecasterSource().SubZones
	got := weatherCities(cities, zones, subs)
	if len(got) != 2 {
		t.Fatalf("%+v", got)
	}
	if !got[0].HasPoint || got[0].Lat != 24.7 || got[0].Code != "RD" {
		t.Fatalf("riyadh from its active sub-zone: %+v", got[0])
	}
	if got[1].Lat != 21.6 {
		t.Fatalf("a point in the city's extra wins: %+v", got[1])
	}
}

type failing struct{}

func (failing) Name() string { return "failing" }
func (failing) Days(context.Context, []weather.City, string, string) ([]weather.Day, error) {
	return nil, errors.New("feed down")
}

func TestNoSourceReadsNothing(t *testing.T) {
	useWeather(t, weather.NoneSource{})
	if d := loadForecastWeather(context.Background(), nil, "t", nil, nil, "2026-01-01", "2026-01-02"); d != nil {
		t.Fatalf("got %v", d)
	}
}

func TestDefaultWeatherSourceIsNone(t *testing.T) {
	t.Setenv(weather.EnvSource, "")
	if _, ok := forecastWeatherSource().(weather.NoneSource); !ok && weatherOverride == nil {
		t.Fatal("the default must be none")
	}
}

func writeWeatherCSV(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "weather.csv")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}
