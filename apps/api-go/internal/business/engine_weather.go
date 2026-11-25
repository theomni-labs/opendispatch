// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"log"
	"os"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

// weatherWait caps the time a feed may take.
const weatherWait = 20 * time.Second

var (
	weatherOnce sync.Once
	weatherSrc  weather.Source
	// weatherOverride is set by tests only.
	weatherOverride weather.Source
)

// forecastWeatherSource is read once from the env.
func forecastWeatherSource() weather.Source {
	if weatherOverride != nil {
		return weatherOverride
	}
	weatherOnce.Do(func() {
		c, err := weather.ParseConfig(os.Getenv)
		if err != nil {
			log.Printf("weather: %v; forecasts go without weather", err)
			weatherSrc = weather.NoneSource{}
			return
		}
		if c.Kind != "none" {
			log.Print(weather.Describe(c.Kind, c.File != "", c.URL, c.ArchiveURL, c.APIKey != "", c.Timeout))
		}
		weatherSrc = c.Build()
	})
	return weatherSrc
}

func extraFloat(m map[string]any, k string) (float64, bool) {
	v, ok := m[k].(float64)
	return v, ok
}

// weatherCities: zone cities, each with a point.
func weatherCities(cities []City, zones []Zone, subs []SubZone) []weather.City {
	type acc struct{ lat, lon, n float64 }
	zoneCity := map[string]string{}
	pts := map[string]*acc{}
	add := func(city string, lat, lon float64) {
		if lat == 0 && lon == 0 {
			return
		}
		a := pts[city]
		if a == nil {
			a = &acc{}
			pts[city] = a
		}
		a.lat, a.lon, a.n = a.lat+lat, a.lon+lon, a.n+1
	}
	for _, z := range zones {
		if z.IsActive && uuidPattern.MatchString(z.CityID) {
			zoneCity[z.ID] = z.CityID
			if z.Latitude != nil && z.Longitude != nil {
				add(z.CityID, *z.Latitude, *z.Longitude)
			}
		}
	}
	for _, s := range subs {
		if c, ok := zoneCity[s.ZoneID]; ok && s.IsActive && pts[c] == nil {
			add(c, s.Latitude, s.Longitude)
		}
	}
	used := map[string]bool{}
	for _, c := range zoneCity {
		used[c] = true
	}
	var out []weather.City
	for _, c := range cities {
		if !used[c.ID] {
			continue
		}
		wc := weather.City{ID: c.ID, Code: c.CaseCode, NameEn: c.NameEn}
		lat, ok1 := extraFloat(c.Extra, "latitude")
		lon, ok2 := extraFloat(c.Extra, "longitude")
		if a := pts[c.ID]; ok1 && ok2 {
			wc.Lat, wc.Lon, wc.HasPoint = lat, lon, true
		} else if a != nil {
			wc.Lat, wc.Lon, wc.HasPoint = a.lat/a.n, a.lon/a.n, true
		}
		out = append(out, wc)
	}
	return out
}

// loadForecastWeather never fails a forecast.
func loadForecastWeather(ctx context.Context, conn *tenancy.Connection, tenant string, zones []Zone, subs []SubZone, from, to string) []weather.Day {
	src := forecastWeatherSource()
	_, off := src.(weather.NoneSource)
	if conn != nil {
		stored := storedWeather{conn: conn, tenant: tenant}
		if off {
			src = stored
		} else {
			src = weather.Fallback{Primary: stored, Secondary: src}
		}
	} else if off {
		return nil
	}
	cities, err := allCities(ctx, conn, tenant)
	if err != nil {
		log.Printf("weather: cities: %v; forecast goes without weather", err)
		return nil
	}
	wctx, cancel := context.WithTimeout(ctx, weatherWait)
	defer cancel()
	days, err := src.Days(wctx, weatherCities(cities, zones, subs), from, to)
	if err != nil {
		log.Printf("weather: %s: %v; sent %d known days", src.Name(), err, len(days))
	}
	if len(days) > 0 {
		log.Printf("weather: %s gave %d days for %s..%s", src.Name(), len(days), from, to)
	}
	return days
}

// weatherFor keeps days of the request's cities.
func weatherFor(zones []fcZone, days []weather.Day) []weather.Day {
	city := map[string]bool{}
	for _, z := range zones {
		if z.CityID != "" {
			city[z.CityID] = true
		}
	}
	var out []weather.Day
	for _, d := range days {
		if city[d.CityID] && d.Known() && validDate("weather date", d.Date) == nil {
			out = append(out, d)
		}
	}
	return out
}
