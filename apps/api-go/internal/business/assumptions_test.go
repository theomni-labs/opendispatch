// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

func TestWorkingAssumptionsDefaults(t *testing.T) {
	useWeather(t, weather.NoneSource{})
	rc, _ := adminCtx(t)
	a, err := GetWorkingAssumptions(context.Background(), nil, rc)
	if err != nil {
		t.Fatal(err)
	}
	if a.LiveTravelSpeedKmh != 35 || a.PlanningTravelSpeedKmh != 40 || a.ClockStart != "assignment" || !a.ClockStartConfirmed ||
		a.PaydayDay != 27 || !a.HandlingInferred || a.Weather.Source != "none" || a.Weather.Attribution != nil {
		t.Fatalf("%+v", a)
	}
	raw, _ := json.Marshal(a)
	for _, k := range []string{`"case_data_sources":[]`, `"data_sources":[]`, `"from":null`} {
		if !strings.Contains(string(raw), k) {
			t.Errorf("%s missing in %s", k, raw)
		}
	}
	if strings.Contains(string(raw), `"sources"`) {
		t.Errorf("internal sources leak: %s", raw)
	}
}

func TestWorkingAssumptionsNeedForecastModelAccess(t *testing.T) {
	rc := reqctx.RequestContext{CustomerID: datactx.NewID(), UserID: datactx.NewID(), Role: access.RoleDispatcher,
		ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}, InstallMode: access.InstallPrivate}
	if _, err := GetWorkingAssumptions(context.Background(), nil, rc); err == nil {
		t.Fatal("a role without the module read the assumptions")
	}
}

func TestWeatherStatusNamesProviderModelsAndLicence(t *testing.T) {
	useWeather(t, weather.NoneSource{})
	c := weatherStatus(WeatherCoverage{Days: 3, Sources: []string{"open-meteo:forecast:gfs_seamless", "open-meteo:archive:era5", "file"}})
	if c.Source != "stored" || c.Attribution == nil || *c.Attribution != "Open-Meteo (ERA5, GFS), CC BY 4.0" {
		t.Fatalf("%+v", c)
	}
	if c := weatherStatus(WeatherCoverage{Days: 1, Sources: []string{"file"}}); c.Attribution != nil {
		t.Fatalf("a file has no attribution of ours: %v", *c.Attribution)
	}
	useWeather(t, weather.NewFileSource("unused.csv"))
	if c := weatherStatus(WeatherCoverage{}); c.Source != "feed" {
		t.Fatalf("%+v", c)
	}
}
