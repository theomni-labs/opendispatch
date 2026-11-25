// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"log"
	"os"
	"sync"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/traffic"
)

var (
	trafficOnce sync.Once
	trafficSrc  traffic.Source
	// trafficOverride is set by tests only.
	trafficOverride traffic.Source
)

// forecastTrafficSource is read once from the env.
func forecastTrafficSource() traffic.Source {
	if trafficOverride != nil {
		return trafficOverride
	}
	trafficOnce.Do(func() {
		c, err := traffic.ParseConfig(os.Getenv)
		if err != nil {
			log.Printf("traffic: %v; forecasts go without traffic", err)
			trafficSrc = traffic.NoneSource{}
			return
		}
		if c.Kind != "none" {
			log.Printf("traffic source=%s file=%t", c.Kind, c.File != "")
		}
		trafficSrc = c.Build()
	})
	return trafficSrc
}

// trafficSourceName: none, synthetic or file.
func trafficSourceName() string { return forecastTrafficSource().Name() }

// loadForecastTraffic never fails a forecast.
func loadForecastTraffic(ctx context.Context, conn *tenancy.Connection, tenant string, zones []Zone, subs []SubZone, from, to string) []traffic.Day {
	src := forecastTrafficSource()
	if _, off := src.(traffic.NoneSource); off {
		return nil
	}
	cities, err := allCities(ctx, conn, tenant)
	if err != nil {
		log.Printf("traffic: cities: %v; forecast goes without traffic", err)
		return nil
	}
	wctx, cancel := context.WithTimeout(ctx, weatherWait)
	defer cancel()
	days, err := src.Days(wctx, weatherCities(cities, zones, subs), from, to)
	if err != nil {
		log.Printf("traffic: %s: %v; sent %d days", src.Name(), err, len(days))
	}
	return days
}

// trafficFor keeps days of the request's cities.
func trafficFor(zones []fcZone, days []traffic.Day) []traffic.Day {
	city := map[string]bool{}
	for _, z := range zones {
		if z.CityID != "" {
			city[z.CityID] = true
		}
	}
	var out []traffic.Day
	for _, d := range days {
		if city[d.CityID] && d.CongestionIndex >= 0 && d.CongestionIndex <= traffic.MaxIndex && validDate("traffic date", d.Date) == nil {
			out = append(out, d)
		}
	}
	return out
}
