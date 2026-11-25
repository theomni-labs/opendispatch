// SPDX-License-Identifier: AGPL-3.0-only

// Stored weather per city and date.
package business

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

// WeatherPublicData marks fetched public weather.
const WeatherPublicData = "PUBLIC_OPEN_DATA"

var weatherDataSources = map[string]bool{"SYNTHETIC": true, "IMPORTED": true, "LIVE": true, WeatherPublicData: true}

// SaveWeatherDays upserts; a newer fetch wins.
func SaveWeatherDays(ctx context.Context, conn *tenancy.Connection, tenant string, days []weather.Day, dataSource string, fetchedAt time.Time) (int, error) {
	if !weatherDataSources[dataSource] {
		return 0, errors.New("weather: unknown data_source " + dataSource)
	}
	return tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (int, error) {
		b := &pgx.Batch{}
		n := 0
		for _, d := range days {
			if !d.Known() || d.Source == "" || validDate("weather date", d.Date) != nil || !uuidPattern.MatchString(d.CityID) {
				continue
			}
			b.Queue(`INSERT INTO weather_days (tenant_id, data_source, city_id, date, rain_mm, dust_event, max_temp_c, visibility_km, source, fetched_at)
				VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9)
				ON CONFLICT (tenant_id, city_id, date) DO UPDATE SET data_source = EXCLUDED.data_source, rain_mm = EXCLUDED.rain_mm,
				  dust_event = EXCLUDED.dust_event, max_temp_c = EXCLUDED.max_temp_c, visibility_km = EXCLUDED.visibility_km,
				  source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at, updated_at = clock_timestamp()`,
				dataSource, d.CityID, d.Date, d.RainMM, d.DustEvent, d.MaxTempC, d.VisibilityKM, d.Source, fetchedAt)
			n++
		}
		if n == 0 {
			return 0, nil
		}
		return n, tx.SendBatch(ctx, b).Close()
	})
}

// storedWeather reads the table as a Source.
type storedWeather struct {
	conn   *tenancy.Connection
	tenant string
}

func (storedWeather) Name() string { return "stored" }

func (s storedWeather) Days(ctx context.Context, cities []weather.City, from, to string) ([]weather.Day, error) {
	var ids []string
	for _, c := range cities {
		if uuidPattern.MatchString(c.ID) {
			ids = append(ids, c.ID)
		}
	}
	if len(ids) == 0 || validDate("from", from) != nil || validDate("to", to) != nil {
		return nil, nil
	}
	return tenancy.WithTenant(ctx, s.conn.Pool, s.tenant, func(ctx context.Context, tx pgx.Tx) ([]weather.Day, error) {
		rows, err := tx.Query(ctx, `SELECT city_id::text, to_char(date, 'YYYY-MM-DD'), rain_mm, dust_event, max_temp_c, visibility_km, source
			FROM weather_days WHERE city_id = ANY($1::uuid[]) AND date BETWEEN $2::date AND $3::date ORDER BY city_id, date`, ids, from, to)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []weather.Day
		for rows.Next() {
			var d weather.Day
			if err := rows.Scan(&d.CityID, &d.Date, &d.RainMM, &d.DustEvent, &d.MaxTempC, &d.VisibilityKM, &d.Source); err != nil {
				return nil, err
			}
			out = append(out, d)
		}
		return out, rows.Err()
	})
}

// WeatherCoverage: what the table holds.
type WeatherCoverage struct {
	Source      string   `json:"source"`
	Days        int      `json:"days"`
	Cities      int      `json:"cities"`
	From        *string  `json:"from"`
	To          *string  `json:"to"`
	FetchedAt   *string  `json:"fetched_at"`
	Attribution *string  `json:"attribution"`
	DataSources []string `json:"data_sources"`
	Sources     []string `json:"-"`
}

func weatherCoverage(ctx context.Context, conn *tenancy.Connection, tenant string) (WeatherCoverage, error) {
	empty := WeatherCoverage{Sources: []string{}, DataSources: []string{}}
	if conn == nil {
		return empty, nil
	}
	return tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (WeatherCoverage, error) {
		c := empty
		var fetched *time.Time
		if err := tx.QueryRow(ctx, `SELECT count(*), count(DISTINCT city_id), to_char(min(date), 'YYYY-MM-DD'), to_char(max(date), 'YYYY-MM-DD'), max(fetched_at),
			coalesce(array_agg(DISTINCT source), '{}'), coalesce(array_agg(DISTINCT data_source), '{}') FROM weather_days`).
			Scan(&c.Days, &c.Cities, &c.From, &c.To, &fetched, &c.Sources, &c.DataSources); err != nil {
			return empty, err
		}
		if c.Days == 0 {
			return empty, nil
		}
		if fetched != nil {
			s := fetched.In(weather.Riyadh).Format(time.RFC3339)
			c.FetchedAt = &s
		}
		sort.Strings(c.Sources)
		sort.Strings(c.DataSources)
		return c, nil
	})
}

// WeatherCitiesFor: the tenant's cities with points.
func WeatherCitiesFor(ctx context.Context, conn *tenancy.Connection, tenant string) ([]weather.City, error) {
	cities, err := allCities(ctx, conn, tenant)
	if err != nil {
		return nil, err
	}
	zones, err := allZones(ctx, conn, tenant)
	if err != nil {
		return nil, err
	}
	subs, err := allSubZones(ctx, conn, tenant)
	if err != nil {
		return nil, err
	}
	return weatherCities(cities, zones, subs), nil
}
