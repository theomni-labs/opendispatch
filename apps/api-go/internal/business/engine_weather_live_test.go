// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

func TestStoredWeatherReachesTheForecaster(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	cities, err := WeatherCitiesFor(ctx, w.conn, w.tenantID)
	check(t, err)
	if len(cities) == 0 {
		t.Fatal("no weather city for the fixture zone")
	}
	city := cities[0].ID
	t.Cleanup(func() {
		tenancy.WithTenant(ctx, w.conn.Pool, w.tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) { //nolint:errcheck
			_, err := tx.Exec(ctx, `DELETE FROM weather_days`)
			return struct{}{}, err
		})
	})
	yday := shiftDateBy(w.today, -1)
	n, err := SaveWeatherDays(ctx, w.conn, w.tenantID, []weather.Day{
		{CityID: city, Date: yday, RainMM: fp(3), MaxTempC: fp(31), Source: "open-meteo:archive:era5"},
		{CityID: city, Date: w.today, Source: "empty"},
	}, WeatherPublicData, time.Now())
	check(t, err)
	if n != 1 {
		t.Fatalf("saved %d, want 1 (an empty day is skipped)", n)
	}
	if _, err := SaveWeatherDays(ctx, w.conn, w.tenantID, nil, "MADE_UP", time.Now()); err == nil {
		t.Fatal("an unknown data_source was accepted")
	}
	csv := "city,date,rain_mm,dust_event,max_temp_c,visibility_km\n" +
		"Riyadh," + yday + ",0,,20,\n" + "Riyadh," + w.today + ",,,44,\n"
	useWeather(t, weather.NewFileSource(writeWeatherCSV(t, csv)))
	s, err := loadForecasterSource(ctx, w.conn, w.actors.Forecast, w.today, 2)
	check(t, err)
	got := map[string]weather.Day{}
	for _, d := range s.Weather {
		got[d.Date] = d
	}
	if d := got[yday]; d.Source != "open-meteo:archive:era5" || d.RainMM == nil || *d.RainMM != 3 {
		t.Fatalf("stored day must win over the feed: %+v", d)
	}
	if d := got[w.today]; d.MaxTempC == nil || *d.MaxTempC != 44 {
		t.Fatalf("the feed must fill a day the table lacks: %+v", d)
	}
	cov, err := weatherCoverage(ctx, w.conn, w.tenantID)
	check(t, err)
	if cov.Days != 1 || cov.Cities != 1 || cov.From == nil || *cov.From != yday || len(cov.DataSources) != 1 || cov.DataSources[0] != WeatherPublicData {
		t.Fatalf("coverage %+v", cov)
	}
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	a, err := GetWorkingAssumptions(ctx, w.conn, rc)
	check(t, err)
	if a.Weather.Source != "stored" || a.Weather.Attribution == nil || *a.Weather.Attribution != "Open-Meteo (ERA5), CC BY 4.0" ||
		len(a.CaseDataSources) != 1 || a.CaseDataSources[0] != "SYNTHETIC" {
		t.Fatalf("assumptions %+v", a)
	}
}

func TestForecasterSourceReadsTheWeatherFile(t *testing.T) {
	w := newEngineWorld(t)
	csv := "city,date,rain_mm,dust_event,max_temp_c,visibility_km\n" +
		"Riyadh," + shiftDateBy(w.today, -1) + ",6.5,false,24,\n" +
		"RY," + w.today + ",,true,,0.8\n" +
		"Taif," + w.today + ",1,,,\n"
	useWeather(t, weather.NewFileSource(writeWeatherCSV(t, csv)))
	s, err := loadForecasterSource(context.Background(), w.conn, w.actors.Forecast, w.today, 2)
	check(t, err)
	if len(s.Weather) != 2 {
		t.Fatalf("want two days matched by name and code, got %+v", s.Weather)
	}
	raw, err := buildForecasterRequest(s)
	check(t, err)
	checkRequest(t, "forecaster", raw)
}

func TestAFailedFeedNeverFailsTheForecastSource(t *testing.T) {
	w := newEngineWorld(t)
	useWeather(t, failing{})
	s, err := loadForecasterSource(context.Background(), w.conn, w.actors.Forecast, w.today, 2)
	check(t, err)
	if len(s.Weather) != 0 || len(s.History) == 0 {
		t.Fatalf("weather %v history %d", s.Weather, len(s.History))
	}
}
