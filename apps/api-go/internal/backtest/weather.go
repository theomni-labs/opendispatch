// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"encoding/json"
	"path/filepath"
	"sort"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/traffic"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

// WeatherNotice labels a run with synthetic weather.
const WeatherNotice = "Weather is SYNTHETIC with made-up effects (rain and dust lift accidents)."

// PerfectWeatherNotice heads a perfect-weather run.
const PerfectWeatherNotice = "PERFECT-FORECAST WEATHER: the engine was given the weather of the held-out days themselves, which no forecast knows at the origin; the figures flatter every model that uses weather and are for research only."

// WeatherFunc gives a city's weather on a date.
type WeatherFunc func(cityID, cityName, date string) (weather.Day, bool)

// SyntheticWeather is the shared generator.
func SyntheticWeather(seed int64) WeatherFunc {
	return func(id, name, date string) (weather.Day, bool) {
		d := weather.Synthetic(seed, name, date)
		d.CityID = id
		return d, true
	}
}

// SourceWeather reads a configured source once.
func SourceWeather(ctx context.Context, s weather.Source, cities []weather.City, from, to string) (WeatherFunc, int, error) {
	days, err := s.Days(ctx, cities, from, to)
	idx := map[string]weather.Day{}
	for _, d := range days {
		idx[d.CityID+"|"+d.Date] = d
	}
	return func(id, _, date string) (weather.Day, bool) {
		d, ok := idx[id+"|"+date]
		return d, ok
	}, len(days), err
}

// longWeather: the day's known synthetic effect.
func longWeather(o LongOptions, city, date string) float64 {
	if !o.Weather {
		return 1
	}
	eff := weather.DefaultEffects()
	if o.WeatherEffects != nil {
		eff = *o.WeatherEffects
	}
	return eff.Multiplier(weather.Synthetic(o.Seed, city, date))
}

// longTraffic: the day's synthetic traffic effect.
func longTraffic(o LongOptions, city, date string) float64 {
	if !o.Traffic {
		return 1
	}
	return traffic.Multiplier(traffic.Synthetic(o.Seed, city, date))
}

// LoadZoneCityIDs reads zone to city id.
func LoadZoneCityIDs(dir string) (map[string]string, error) {
	out := map[string]string{}
	err := loadOptional(filepath.Join(dir, "locations/zones.json"), func(b []byte) error {
		var l []struct {
			ID     string `json:"id"`
			CityID string `json:"city_id"`
		}
		if err := json.Unmarshal(b, &l); err != nil {
			return err
		}
		for _, z := range l {
			if z.CityID != "" {
				out[z.ID] = z.CityID
			}
		}
		return nil
	})
	return out, err
}

// LoadWeatherCities reads cities for a file source.
func LoadWeatherCities(dir string) ([]weather.City, error) {
	var out []weather.City
	err := loadOptional(filepath.Join(dir, "locations/cities.json"), func(b []byte) error {
		var l []struct {
			ID     string `json:"id"`
			Code   string `json:"case_code"`
			NameEn string `json:"name_en"`
		}
		if err := json.Unmarshal(b, &l); err != nil {
			return err
		}
		for _, c := range l {
			out = append(out, weather.City{ID: c.ID, Code: c.Code, NameEn: c.NameEn})
		}
		return nil
	})
	return out, err
}

// weatherDays: days before the origin only,
// unless PerfectWeather adds the horizon.
func (c *EngineCandidate) weatherDays(zoneIDs []string, origin time.Time, days, history int) []weather.Day {
	if c.opt.Weather == nil {
		return nil
	}
	names := map[string]string{}
	for _, z := range zoneIDs {
		if id := c.opt.ZoneCityID[z]; id != "" {
			names[id] = c.opt.ZoneCity[z]
		}
	}
	ids := make([]string, 0, len(names))
	for id := range names {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	end := 0
	if c.opt.PerfectWeather {
		end = days
	}
	var out []weather.Day
	for _, id := range ids {
		for d := -history; d < end; d++ {
			date := addDays(origin, d).Format("2006-01-02")
			if w, ok := c.opt.Weather(id, names[id], date); ok && w.Known() {
				w.CityID, w.Date = id, date
				out = append(out, w)
			}
		}
	}
	return out
}
