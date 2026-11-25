// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"fmt"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

// weatherOptions sets what weather the engine gets.
func weatherOptions(ctx context.Context, o *backtest.EngineOptions, ds *backtest.Dataset, mode string, perfect bool, seed int64, dir string, getenv func(string) string) error {
	if mode == "none" {
		if perfect {
			return fmt.Errorf("-weather-perfect-forecast needs -weather synthetic or file")
		}
		return nil
	}
	o.PerfectWeather = perfect
	ids, err := backtest.LoadZoneCityIDs(dir)
	if err != nil {
		return fmt.Errorf("-weather: %w", err)
	}
	if len(ids) == 0 {
		return fmt.Errorf("-weather %s needs locations/zones.json with city_id", mode)
	}
	o.ZoneCityID = ids
	if mode == "synthetic" {
		o.Weather = backtest.SyntheticWeather(seed)
		return nil
	}
	path := getenv(weather.EnvFile)
	if path == "" {
		return fmt.Errorf("-weather file needs %s", weather.EnvFile)
	}
	cities, err := backtest.LoadWeatherCities(dir)
	if err != nil {
		return fmt.Errorf("-weather: %w", err)
	}
	first := time.Time{}
	for _, h := range ds.Intervals {
		if first.IsZero() || h.Start.Before(first) {
			first = h.Start
		}
	}
	for _, c := range ds.Cases {
		if first.IsZero() || c.RegisteredAt.Before(first) {
			first = c.RegisteredAt
		}
	}
	if first.IsZero() {
		return fmt.Errorf("-weather file: no history")
	}
	f := first.In(weather.Riyadh)
	from, to := f.Format("2006-01-02"), f.AddDate(0, 0, weather.MaxSpanDays).Format("2006-01-02")
	fn, n, err := backtest.SourceWeather(ctx, weather.NewFileSource(path), cities, from, to)
	if n == 0 {
		return fmt.Errorf("-weather file: no weather days read: %v", err)
	}
	o.Weather = fn
	return nil
}
