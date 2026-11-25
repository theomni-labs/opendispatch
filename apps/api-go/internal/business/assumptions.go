// SPDX-License-Identifier: AGPL-3.0-only

// Working assumptions shown to the customer.
package business

import (
	"context"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

// confirmedClockStart: a setting.
const confirmedClockStart = "assignment"

// WorkingAssumptions mirrors the contract type.
type WorkingAssumptions struct {
	LiveTravelSpeedKmh     float64         `json:"live_travel_speed_kmh"`
	PlanningTravelSpeedKmh float64         `json:"planning_travel_speed_kmh"`
	ClockStart             string          `json:"clock_start"`
	ClockStartConfirmed    bool            `json:"clock_start_confirmed"`
	PaydayDay              int             `json:"payday_day"`
	HandlingInferred       bool            `json:"handling_inferred"`
	CaseDataSources        []string        `json:"case_data_sources"`
	Weather                WeatherCoverage `json:"weather"`
	WeatherFeed            string          `json:"weather_feed"`
	TrafficSource          string          `json:"traffic_source"`
}

// GetWorkingAssumptions reads settings and stores.
func GetWorkingAssumptions(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) (WorkingAssumptions, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminForecastModel, access.AccessView); err != nil {
		return WorkingAssumptions{}, err
	}
	tenant := rc.CustomerID
	clock := readSetting(ctx, tenant, "clock_start", "assignment")
	if clock != "registration" {
		clock = "assignment"
	}
	payday := readSetting(ctx, tenant, forecastcal.KeyPaydayDay, forecastcal.DefaultPaydayDay)
	if payday < 1 || payday > 31 {
		payday = 0
	}
	out := WorkingAssumptions{
		LiveTravelSpeedKmh:     placeholderSpeedKmh,
		PlanningTravelSpeedKmh: getTravelModel(ctx, tenant).AverageSpeedKmh,
		ClockStart:             clock,
		ClockStartConfirmed:    clock == confirmedClockStart,
		PaydayDay:              payday,
		HandlingInferred:       true,
		CaseDataSources:        []string{},
		WeatherFeed:            strings.SplitN(forecastWeatherSource().Name(), "+", 2)[0],
		TrafficSource:          trafficSourceName(),
	}
	if !contains([]string{"none", "file", "openmeteo", "synthetic"}, out.WeatherFeed) {
		out.WeatherFeed = "file"
	}
	if conn == nil {
		out.Weather = weatherStatus(WeatherCoverage{Sources: []string{}, DataSources: []string{}})
		return out, nil
	}
	sources, err := caseDataSources(ctx, conn, tenant)
	if err != nil {
		return out, err
	}
	out.CaseDataSources = sources
	cov, err := weatherCoverage(ctx, conn, tenant)
	if err != nil {
		return out, err
	}
	out.Weather = weatherStatus(cov)
	return out, nil
}

func caseDataSources(ctx context.Context, conn *tenancy.Connection, tenant string) ([]string, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]string, error) {
		var out []string
		// skip scan on cases_tenant_data_source_idx
		err := tx.QueryRow(ctx, `WITH RECURSIVE ds AS (
				SELECT min(data_source) AS d FROM cases
				UNION ALL
				SELECT (SELECT min(data_source) FROM cases WHERE data_source > ds.d) FROM ds WHERE ds.d IS NOT NULL)
			SELECT coalesce(array_agg(d ORDER BY d), '{}') FROM ds WHERE d IS NOT NULL`).Scan(&out)
		return out, err
	})
}

// modelNames: source suffix to a short name.
var modelNames = map[string]string{weather.ModelERA5: "ERA5", weather.ModelGFSSeamless: "GFS"}

// weatherStatus adds source and attribution.
func weatherStatus(c WeatherCoverage) WeatherCoverage {
	c.Source = "none"
	if c.Days > 0 {
		c.Source = "stored"
	} else if _, off := forecastWeatherSource().(weather.NoneSource); !off {
		c.Source = "feed"
	}
	var models []string
	openMeteo := false
	for _, s := range c.Sources {
		parts := strings.Split(s, ":")
		if parts[0] != "open-meteo" {
			continue
		}
		openMeteo = true
		if n := modelNames[parts[len(parts)-1]]; n != "" && !contains(models, n) {
			models = append(models, n)
		}
	}
	if openMeteo {
		sort.Strings(models)
		a := "Open-Meteo"
		if len(models) > 0 {
			a += " (" + strings.Join(models, ", ") + ")"
		}
		a += ", CC BY 4.0"
		c.Attribution = &a
	}
	return c
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
