// SPDX-License-Identifier: AGPL-3.0-only

// Command weatherfetch stores public weather per city.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

func main() {
	base := flag.String("url", os.Getenv(weather.EnvURL), "self-hosted Open-Meteo base URL (or OPENDISPATCH_WEATHER_URL)")
	years := flag.Int("years", 3, "years of daily history")
	cache := flag.String("cache", os.Getenv("OPENDISPATCH_WEATHER_CACHE_DIR"), "answer cache directory (gitignored)")
	offline := flag.Bool("offline", false, "use the cache only, never the network")
	tenant := flag.String("tenant", os.Getenv("OPENDISPATCH_TENANT_ID"), "customer uuid")
	workers := flag.Int("workers", 4, "parallel requests")
	flag.Parse()
	if *years < 1 || *years > 5 {
		log.Fatal("-years must be 1 to 5")
	}
	if *cache == "" {
		log.Fatal("-cache (or OPENDISPATCH_WEATHER_CACHE_DIR) is required")
	}
	if !*offline {
		if err := CheckBaseURL(*base); err != nil {
			log.Fatal(err)
		}
	}
	dsn := os.Getenv("OPENDISPATCH_APP_DATABASE_URL")
	if dsn == "" {
		log.Fatal("OPENDISPATCH_APP_DATABASE_URL is not set")
	}
	ctx := context.Background()
	conn, err := tenancy.OpenConnection(ctx, dsn)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer conn.Close()
	cities, err := business.WeatherCitiesFor(ctx, conn, *tenant)
	if err != nil {
		log.Fatalf("cities: %v", err)
	}
	now := time.Now().In(weather.Riyadh)
	today := now.Format(dateLayout)
	from := time.Date(now.Year()-*years, now.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -1, 0).Format(dateLayout)
	to := now.AddDate(0, 0, weather.ForecastAheadDays).Format(dateLayout)
	ad := weather.OpenMeteo{ForecastURL: *base, ArchiveURL: *base, ArchiveModel: weather.ModelERA5, ForecastModel: weather.ModelGFSSeamless}
	c := Cache{Dir: *cache, Offline: *offline, Today: today, Get: HTTPGet(&http.Client{Timeout: 3 * time.Minute})}
	t0 := time.Now()
	days, st := Fetch(ctx, ad, cities, from, to, c, *workers)
	if days, err = MergeSnapshot(*cache, days); err != nil {
		log.Printf("snapshot: %v", err)
	}
	n, err := business.SaveWeatherDays(ctx, conn, *tenant, days, business.WeatherPublicData, time.Now())
	if err != nil {
		log.Fatalf("save: %v", err)
	}
	fmt.Printf("weatherfetch: %d cities, %s..%s, %d days stored (%s), requests: %d network, %d cache, %d missed, %.1fs\n",
		len(cities), from, to, n, business.WeatherPublicData, st.Network, st.Cached, st.Missed, time.Since(t0).Seconds())
	for _, r := range Report(cities, days, from, to) {
		fmt.Printf("  %-10s %4d days %s..%s, %d missing; rain %d, max temp %d, visibility %d\n", r.City, r.Days, r.From, r.To, r.Missing, r.Rain, r.Temp, r.Vis)
	}
	for _, e := range st.Errors {
		fmt.Printf("  error: %s\n", e)
	}
	fmt.Println("  dust: unknown (no dust flag in ERA5 or GFS); source: Open-Meteo open data (ERA5, GFS), CC BY 4.0")
}
