// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecasthist"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const engineRangeCover = 0.8

// forecastHistorySettings: how much history is sent.
func forecastHistorySettings(ctx context.Context, tenant string) forecasthist.Settings {
	d := forecasthist.Defaults()
	return forecasthist.Settings{
		DetailWeeks: readSetting(ctx, tenant, forecasthist.KeyDetailWeeks, d.DetailWeeks),
		Years:       readSetting(ctx, tenant, forecasthist.KeyYears, d.Years),
		AggMinutes:  readSetting(ctx, tenant, forecasthist.KeyAggMinutes, d.AggMinutes),
	}.Normalized()
}

// loadForecastAggregates: totals per sub-zone.
func loadForecastAggregates(ctx context.Context, conn *tenancy.Connection, tenant string, zoneIDs []string, from, to time.Time, minutes int) ([]historyRow, []string, error) {
	type result struct {
		rows    []historyRow
		sources []string
	}
	bin := "1 day"
	if minutes == 60 {
		bin = "1 hour"
	}
	res, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (result, error) {
		var out result
		rows, err := tx.Query(ctx, `SELECT sub_zone_id::text, date_bin($4::interval, registered_at, TIMESTAMPTZ '2000-01-01 00:00:00+03'),
				count(*), count(*) FILTER (WHERE handling = 'field'), array_agg(DISTINCT data_source)
			FROM cases WHERE zone_id = ANY($1::uuid[]) AND sub_zone_id IS NOT NULL AND registered_at >= $2 AND registered_at < $3
			GROUP BY 1, 2 ORDER BY 2, 1`, zoneIDs, from, to, bin)
		if err != nil {
			return out, err
		}
		defer rows.Close()
		seen := map[string]bool{}
		for rows.Next() {
			r := historyRow{Minutes: minutes}
			var src []string
			if err := rows.Scan(&r.SubZoneID, &r.IntervalStart, &r.Total, &r.Field, &src); err != nil {
				return out, err
			}
			out.rows = append(out.rows, r)
			for _, x := range src {
				if !seen[x] {
					seen[x] = true
					out.sources = append(out.sources, x)
				}
			}
		}
		return out, rows.Err()
	})
	return res.rows, res.sources, err
}

// ramadanOutside: Umm al-Qura where the table ends.
func ramadanOutside(date string, months []HijriMonth, cal forecastcal.Config) (bool, bool) {
	for _, m := range months {
		if date >= m.GregorianStart && date <= m.GregorianEnd {
			return false, false
		}
	}
	return cal.For(date).IsRamadan, true
}

// engineDayCaseCap is a var so tests can lower it.
var engineDayCaseCap = 5000

// capWarning says how many cases the caps left out.
func capWarning(dropped int) string {
	if dropped <= 0 {
		return ""
	}
	return fmt.Sprintf(" Warning: %d cases were left out because of the request size cap.", dropped)
}

func riyadhMidnight(date string) (time.Time, error) {
	return time.Parse(time.RFC3339, date+"T00:00:00+03:00")
}

// loadForecastHistory counts cases per sub-zone and 15 minutes.
func loadForecastHistory(ctx context.Context, conn *tenancy.Connection, tenant string, zoneIDs []string, from, to time.Time) ([]historyRow, []string, error) {
	type result struct {
		rows    []historyRow
		sources []string
	}
	res, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (result, error) {
		var out result
		rows, err := tx.Query(ctx, `SELECT sub_zone_id::text, date_bin('15 minutes', registered_at, TIMESTAMPTZ '2000-01-01 00:00:00+03'),
				count(*), count(*) FILTER (WHERE handling = 'field')
			FROM cases WHERE zone_id = ANY($1::uuid[]) AND sub_zone_id IS NOT NULL AND registered_at >= $2 AND registered_at < $3
			GROUP BY 1, 2 ORDER BY 2, 1`, zoneIDs, from, to)
		if err != nil {
			return out, err
		}
		defer rows.Close()
		for rows.Next() {
			var r historyRow
			if err := rows.Scan(&r.SubZoneID, &r.IntervalStart, &r.Total, &r.Field); err != nil {
				return out, err
			}
			out.rows = append(out.rows, r)
		}
		if err := rows.Err(); err != nil {
			return out, err
		}
		rows.Close()
		src, err := tx.Query(ctx, `SELECT DISTINCT data_source FROM cases WHERE zone_id = ANY($1::uuid[]) AND sub_zone_id IS NOT NULL AND registered_at >= $2 AND registered_at < $3`, zoneIDs, from, to)
		if err != nil {
			return out, err
		}
		defer src.Close()
		for src.Next() {
			var s string
			if err := src.Scan(&s); err != nil {
				return out, err
			}
			out.sources = append(out.sources, s)
		}
		return out, src.Err()
	})
	return res.rows, res.sources, err
}

// loadForecasterSource reads what the forecaster is asked with.
func loadForecasterSource(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, start string, days int) (forecasterSource, error) {
	s := forecasterSource{Now: time.Now(), StartDate: start, Days: days, RangeCoverage: engineRangeCover}
	zones, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return s, err
	}
	subs, err := allSubZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return s, err
	}
	s.Zones, s.SubZones = zones, subs
	s.ModelVersion = requestedForecastModel(ctx, rc.CustomerID)
	shares, err := getFieldShare(ctx, rc, FieldShareOptions{Date: start})
	if err != nil {
		return s, err
	}
	s.RuleSetVersion = shares.RuleSetVersion
	holidays, err := allHolidays(ctx, conn, rc.CustomerID)
	if err != nil {
		return s, err
	}
	var zoneIDs []string
	cityID := ""
	for _, z := range zones {
		if z.IsActive {
			zoneIDs = append(zoneIDs, z.ID)
			if cityID == "" {
				cityID = z.CityID
			}
		}
	}
	cal := forecastCalendarConfig(ctx, rc.CustomerID)
	hs := forecastHistorySettings(ctx, rc.CustomerID)
	to, err := riyadhMidnight(start)
	if err != nil {
		return s, err
	}
	aggFrom, detailFrom := hs.Windows(to)
	months := allHijriMonths()
	for i := -int(to.Sub(aggFrom).Hours()/24 + 0.5); i < days; i++ {
		date := shiftDateBy(start, i)
		day := forecastDay{Date: date}
		for _, h := range holidays {
			if datactx.InDateRange(date, h.StartDate, h.EndDate) {
				day.IsHoliday, day.HolidayName = true, h.NameEn
				break
			}
		}
		if day.IsRamadan, err = IsRamadan(rc, date); err != nil {
			return s, err
		}
		if r, outside := ramadanOutside(date, months, cal); outside {
			day.IsRamadan = r
		}
		applyCalendar(&day, cal)
		if cityID != "" && i >= 0 {
			if day.Prayer, err = prayerTimeForOne(ctx, conn, rc.CustomerID, cityID, date); err != nil {
				return s, err
			}
		}
		s.Calendar = append(s.Calendar, day)
	}
	if s.History, s.Sources, err = loadForecastHistory(ctx, conn, rc.CustomerID, zoneIDs, detailFrom, to); err != nil {
		return s, err
	}
	if aggFrom.Before(detailFrom) {
		var agg []historyRow
		var src []string
		agg, src, err = loadForecastAggregates(ctx, conn, rc.CustomerID, zoneIDs, aggFrom, detailFrom, hs.AggMinutes)
		if err != nil {
			return s, err
		}
		s.Aggregated, s.Sources = agg, append(s.Sources, src...)
	}
	wxFrom := detailFrom
	if aggFrom.Before(wxFrom) {
		wxFrom = aggFrom
	}
	s.Weather = loadForecastWeather(ctx, conn, rc.CustomerID, zones, subs, wxFrom.Format("2006-01-02"), shiftDateBy(start, days-1))
	s.Traffic = loadForecastTraffic(ctx, conn, rc.CustomerID, zones, subs, wxFrom.Format("2006-01-02"), shiftDateBy(start, days-1))
	s.Locations, err = loadForecastLocations(ctx, conn, rc.CustomerID, zones, subs, detailFrom, to)
	return s, err
}

func loadSkills(ctx context.Context, conn *tenancy.Connection, tenant string, agentIDs []string) (map[string][]string, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (map[string][]string, error) {
		rows, err := tx.Query(ctx, `SELECT agent_id::text, skill_code FROM agent_skills WHERE agent_id = ANY($1::uuid[])`, agentIDs)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := map[string][]string{}
		for rows.Next() {
			var id, code string
			if err := rows.Scan(&id, &code); err != nil {
				return nil, err
			}
			out[id] = append(out[id], code)
		}
		return out, rows.Err()
	})
}

// loadOptimizerSource reads what the optimizer is asked with, from the plan already loaded.
func loadOptimizerSource(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, plan *PlanReader, zoneID, date string, run ForecastRun) (optimizerSource, error) {
	s := optimizerSource{Now: time.Now(), Date: date, ZoneID: zoneID, PlanningLevel: getPlanningLevel(ctx, rc), DemandQuantile: planningQuantile(ctx, rc.CustomerID), ForecastRef: run.ID,
		Agents: plan.Agents, Vehicles: plan.Vehicles, Patterns: plan.Patterns, BreakRules: plan.BreakRules, Points: plan.Points, OnLeave: map[string]bool{},
		Down: vehiclesDownOn(plan.Maintenance, date), ModelVersion: getOptimizerModel(ctx, rc.CustomerID),
		MaxRunSeconds: getOptimizerSeconds(ctx, rc.CustomerID), PrayerWindow: prayerPolicyOf(ctx, rc.CustomerID).window()}
	index, err := indexStored(ctx, rc.CustomerID)
	if err != nil {
		return s, err
	}
	if s.Forecast, err = forecastValuesOf(index, run, zoneID, date); err != nil {
		return s, err
	}
	if s.Ramadan, err = plan.Ramadan(date); err != nil {
		return s, err
	}
	var ids []string
	for _, sv := range plan.Agents {
		ids = append(ids, sv.ID)
		s.OnLeave[sv.ID] = onLeave(plan, sv.ID, date)
		s.Sources = append(s.Sources, sv.DataSource)
	}
	s.Unavail = weeklyBlocks(plan, date, s.Ramadan, nil)
	for _, v := range s.Forecast {
		s.Sources = append(s.Sources, v.DataSource)
	}
	if s.Skills, err = loadSkills(ctx, conn, rc.CustomerID, ids); err != nil {
		return s, err
	}
	if s.SubZones, err = allSubZones(ctx, conn, rc.CustomerID); err != nil {
		return s, err
	}
	if s.SkillReqs, err = loadSkillRequests(ctx, conn, rc.CustomerID, zoneID, date); err != nil {
		return s, err
	}
	s.ServiceLevel = &optServiceLevel{ThresholdSeconds: getTenMinuteThresholdSeconds(ctx, rc.CustomerID), TargetShare: getServiceLevelTargetShare(ctx, rc.CustomerID)}
	s.Travel = travelPtr(ctx, rc.CustomerID)
	demand := plan.Demand()
	s.CasesPerInterval = demand.settings.requestCasesAt(demand.zone(zoneID), demand.availableShare(zoneID, date))
	zones, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return s, err
	}
	for _, z := range zones {
		if z.ID == zoneID {
			home := z
			s.Home, s.DeployLimitKm = &home, getMaxDeployDistanceKm(ctx, rc.CustomerID)
			s.Prayer, err = prayerTimeForOne(ctx, conn, rc.CustomerID, z.CityID, date)
		}
	}
	return s, err
}

// forecastValuesOf: the run's stored values.
func forecastValuesOf(index *StoredIndex, run ForecastRun, zoneID, date string) ([]ForecastValue, error) {
	rows, err := index.Rows(run.ID, zoneID, date)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, inputErr("forecast run %s has no values for %s", run.ID, date)
	}
	return rows, nil
}

// loadDayCases reads one zone's cases of one day, and how many the cap left out.
func loadDayCases(ctx context.Context, conn *tenancy.Connection, tenant, zoneID, date string) ([]simDayCase, int, error) {
	from, err := riyadhMidnight(date)
	if err != nil {
		return nil, 0, err
	}
	dropped := 0
	cases, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]simDayCase, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, registered_at, zone_id::text, sub_zone_id::text, latitude, longitude, handling, parties_involved,
				extract(epoch FROM on_scene_completed_at - arrived_at)::int, assigned_at, agent_id::text, data_source
			FROM cases WHERE zone_id = $1::uuid AND registered_at >= $2 AND registered_at < $3 AND latitude IS NOT NULL AND longitude IS NOT NULL
			ORDER BY registered_at, id LIMIT $4`, zoneID, from, from.AddDate(0, 0, 1), engineDayCaseCap)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []simDayCase
		for rows.Next() {
			var c simDayCase
			var reg time.Time
			var sub *string
			var assigned *time.Time
			if err := rows.Scan(&c.ID, &reg, &c.ZoneID, &sub, &c.Latitude, &c.Longitude, &c.Handling, &c.Parties, &c.OnSceneSeconds, &assigned, &c.ActualAgentID, &c.DataSource); err != nil {
				return nil, err
			}
			c.RegisteredAt = datactx.ToRiyadhISO(reg)
			if sub != nil {
				c.SubZoneID = *sub
			}
			c.ActualAssignedAt = nullableTimeToISO(assigned)
			out = append(out, c)
		}
		if err := rows.Err(); err != nil || len(out) < engineDayCaseCap {
			return out, err
		}
		var total int
		err = tx.QueryRow(ctx, `SELECT count(*) FROM cases WHERE zone_id = $1::uuid AND registered_at >= $2 AND registered_at < $3 AND latitude IS NOT NULL AND longitude IS NOT NULL`,
			zoneID, from, from.AddDate(0, 0, 1)).Scan(&total)
		dropped = max(0, total-len(out))
		return out, err
	})
	return cases, dropped, err
}

// loadSimulatorSourceFor reads what the simulator is asked with.
func loadSimulatorSourceFor(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, plan *PlanReader, roster *Roster, caseDate, policy string) (simulatorSource, error) {
	s := simulatorSource{Now: time.Now(), ClockStart: getClockStart(ctx, rc.CustomerID), ThresholdSeconds: getTenMinuteThresholdSeconds(ctx, rc.CustomerID), Policy: policy, Points: plan.Points,
		Travel: travelPtr(ctx, rc.CustomerID)}
	s.RosterRef = roster.ID
	s.Lines = plan.LinesByRoster[roster.ID]
	cases, dropped, err := loadDayCases(ctx, conn, rc.CustomerID, roster.ZoneID, caseDate)
	if err != nil {
		return s, fmt.Errorf("load cases: %w", err)
	}
	s.Dropped = dropped
	if cases, err = shiftDayCases(cases, caseDate, roster.RosterDate); err != nil {
		return s, fmt.Errorf("%w: %v", ErrEngineInput, err)
	}
	s.Cases = cases
	for _, c := range cases {
		s.Sources = append(s.Sources, c.DataSource)
	}
	return s, nil
}

// shiftDayCases moves cases onto the roster's day.
func shiftDayCases(cases []simDayCase, from, to string) ([]simDayCase, error) {
	a, err := riyadhMidnight(from)
	if err != nil {
		return nil, err
	}
	b, err := riyadhMidnight(to)
	if err != nil {
		return nil, err
	}
	d := b.Sub(a)
	if d == 0 {
		return cases, nil
	}
	move := func(iso string) (string, error) {
		t, err := time.Parse(time.RFC3339, iso)
		if err != nil {
			return "", err
		}
		return datactx.ToRiyadhISO(t.Add(d)), nil
	}
	out := make([]simDayCase, len(cases))
	for i, c := range cases {
		if c.RegisteredAt, err = move(c.RegisteredAt); err != nil {
			return nil, err
		}
		if c.ActualAssignedAt != nil {
			v, err := move(*c.ActualAssignedAt)
			if err != nil {
				return nil, err
			}
			c.ActualAssignedAt = &v
		}
		out[i] = c
	}
	return out, nil
}
