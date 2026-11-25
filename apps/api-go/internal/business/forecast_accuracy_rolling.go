// SPDX-License-Identifier: AGPL-3.0-only

// Rolling forecast accuracy.
package business

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// Roll-up dimensions, as stored.
const (
	dimZone    = "zone"
	dimHour    = "hour"
	dimWeekday = "weekday"
)

// accSums: additive error sums of one bucket.
type accSums struct {
	Days     int
	Forecast float64
	Actual   int64
	AbsError float64
	APESum   float64
	APECount int
}

// add one unit: a day, or one hour of a day.
func (s *accSums) add(f float64, a int) {
	s.Days++
	s.Forecast += f
	s.Actual += int64(a)
	e := math.Abs(f - float64(a))
	s.AbsError += e
	if a > 0 {
		s.APESum += e / float64(a)
		s.APECount++
	}
}

func (s *accSums) merge(o accSums) {
	s.Days = max(s.Days, o.Days)
	s.Forecast += o.Forecast
	s.Actual += o.Actual
	s.AbsError += o.AbsError
	s.APESum += o.APESum
	s.APECount += o.APECount
}

// zoneAcc: one zone over the window.
type zoneAcc struct {
	total        accSums
	hours        [24]accSums
	weekdays     [7]accSums
	sources      map[string]bool
	illustrative bool
}

// companyHours: all zones summed per day hour.
type companyHours struct {
	hours        [24]accSums
	zones        map[string]bool
	illustrative bool
}

// addDay scores one day's company-wide hours.
func (c *companyHours) addDay(f [24]float64, a [24]int) {
	for h := 0; h < 24; h++ {
		c.hours[h].add(f[h], a[h])
	}
}

// RollingAccuracyRefresh: what was stored.
type RollingAccuracyRefresh struct {
	WindowStart string
	WindowEnd   string
	Days        int
	Zones       int
}

type hourKey struct {
	zone, day string
	hour      int
}

// windowActuals: cases per zone, day and hour.
func windowActuals(ctx context.Context, conn *tenancy.Connection, tenant string, zoneIDs []string, from, to time.Time) (map[hourKey]int, map[string]map[string]bool, error) {
	type result struct {
		counts  map[hourKey]int
		sources map[string]map[string]bool
	}
	res, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (result, error) {
		out := result{counts: map[hourKey]int{}, sources: map[string]map[string]bool{}}
		rows, err := tx.Query(ctx, `SELECT zone_id::text, to_char(registered_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD'),
			extract(hour FROM registered_at AT TIME ZONE 'Asia/Riyadh')::int, data_source, count(*)::int
			FROM cases WHERE zone_id = ANY($1::uuid[]) AND registered_at >= $2 AND registered_at < $3
			GROUP BY 1, 2, 3, 4`, zoneIDs, from, to)
		if err != nil {
			return out, err
		}
		defer rows.Close()
		for rows.Next() {
			var k hourKey
			var source string
			var n int
			if err := rows.Scan(&k.zone, &k.day, &k.hour, &source, &n); err != nil {
				return out, err
			}
			out.counts[k] += n
			if out.sources[k.zone] == nil {
				out.sources[k.zone] = map[string]bool{}
			}
			out.sources[k.zone][source] = true
		}
		return out, rows.Err()
	})
	return res.counts, res.sources, err
}

// accuracyWindow: the setting and its days.
func accuracyWindow(ctx context.Context, tenant string) (days int, start, end string) {
	days = forecastcal.AccuracyWindowDays(readSetting(ctx, tenant, forecastcal.KeyAccuracyWindowDays, forecastcal.DefaultAccuracyWindowDays))
	today := todayIn(ctx, tenant)
	return days, shiftDateBy(today, -days), shiftDateBy(today, -1)
}

// RefreshRollingAccuracy replaces the window.
func RefreshRollingAccuracy(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) (RollingAccuracyRefresh, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminForecastModel, access.AccessEdit); err != nil {
		return RollingAccuracyRefresh{}, err
	}
	tenant := rc.CustomerID
	windowDays, start, end := accuracyWindow(ctx, tenant)
	out := RollingAccuracyRefresh{WindowStart: start, WindowEnd: end}
	index, err := indexStored(ctx, tenant)
	if err != nil {
		return out, err
	}
	picked, dates, err := accuracyRunsBack(ctx, tenant, index, windowDays)
	if err != nil {
		return out, err
	}
	zones, err := allZones(ctx, conn, tenant)
	if err != nil {
		return out, err
	}
	var ids []string
	for _, z := range zones {
		if z.IsActive {
			ids = append(ids, z.ID)
		}
	}
	accs := map[string]*zoneAcc{}
	company := &companyHours{zones: map[string]bool{}}
	if len(dates) > 0 && len(ids) > 0 {
		from, ferr := riyadhMidnight(start)
		to, terr := riyadhMidnight(todayIn(ctx, tenant))
		if ferr != nil || terr != nil {
			return out, fmt.Errorf("rolling accuracy: window %s..%s", start, end)
		}
		counts, sources, err := windowActuals(ctx, conn, tenant, ids, from, to)
		if err != nil {
			return out, err
		}
		for _, day := range dates {
			run := picked[day]
			wd, err := time.Parse("2006-01-02", day)
			if err != nil {
				return out, err
			}
			measured := false
			var cf [24]float64
			var ca [24]int
			for _, zid := range ids {
				rows, err := index.Rows(run.ID, zid, day)
				if err != nil {
					return out, err
				}
				if len(rows) == 0 {
					continue
				}
				var fh [24]float64
				for _, r := range rows {
					if r.IntervalIndex >= 0 && r.IntervalIndex < Intervals {
						fh[r.IntervalIndex/4] += r.Expected
					}
				}
				z := accs[zid]
				if z == nil {
					z = &zoneAcc{sources: sources[zid]}
					accs[zid] = z
				}
				z.illustrative = z.illustrative || run.Illustrative
				var df float64
				da := 0
				for h := 0; h < 24; h++ {
					a := counts[hourKey{zid, day, h}]
					z.hours[h].add(fh[h], a)
					cf[h] += fh[h]
					ca[h] += a
					df += fh[h]
					da += a
				}
				company.zones[zid] = true
				company.illustrative = company.illustrative || run.Illustrative
				z.total.add(df, da)
				z.weekdays[int(wd.Weekday())].add(df, da)
				measured = true
			}
			if measured {
				company.addDay(cf, ca)
				out.Days++
			}
		}
	}
	out.Zones = len(accs)
	return out, storeRollingAccuracy(ctx, conn, tenant, accs, company, start, end, windowDays)
}

// accSource: the zone's sources and Illustrative.
func accSource(z *zoneAcc) (string, []string, bool) {
	var all []string
	for s := range z.sources {
		all = append(all, s)
	}
	primary, distinct, err := sourcesOf(all)
	if err != nil {
		return "SYNTHETIC", []string{"SYNTHETIC"}, true
	}
	if distinct[0] == "SYNTHETIC" {
		primary = "SYNTHETIC"
	}
	return primary, distinct, z.illustrative || distinct[0] == "SYNTHETIC"
}

// companySource: the summed zones' sources.
func companySource(accs map[string]*zoneAcc, c *companyHours) (string, []string, bool) {
	sum := &zoneAcc{sources: map[string]bool{}, illustrative: c.illustrative}
	for zid := range c.zones {
		if z := accs[zid]; z != nil {
			for s := range z.sources {
				sum.sources[s] = true
			}
		}
	}
	return accSource(sum)
}

func storeRollingAccuracy(ctx context.Context, conn *tenancy.Connection, tenant string, accs map[string]*zoneAcc, company *companyHours, start, end string, windowDays int) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		if _, err := tx.Exec(ctx, `DELETE FROM forecast_accuracy_rollups`); err != nil {
			return struct{}{}, err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM forecast_accuracy_hour_totals`); err != nil {
			return struct{}{}, err
		}
		b := &pgx.Batch{}
		put := func(zid, src string, srcs []string, illus bool, dim string, bucket int, s accSums) {
			if s.Days == 0 {
				return
			}
			b.Queue(`INSERT INTO forecast_accuracy_rollups (tenant_id, data_source, zone_id, window_start, window_end, window_days,
				dimension, bucket, days, forecast_sum, actual_sum, abs_error_sum, ape_sum, ape_count, data_sources, illustrative, computed_at)
				VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, clock_timestamp())`,
				src, zid, start, end, windowDays, dim, bucket, s.Days, s.Forecast, s.Actual, s.AbsError, s.APESum, s.APECount, srcs, illus)
		}
		for zid, z := range accs {
			src, srcs, illus := accSource(z)
			put(zid, src, srcs, illus, dimZone, 0, z.total)
			for h, s := range z.hours {
				put(zid, src, srcs, illus, dimHour, h, s)
			}
			for d, s := range z.weekdays {
				put(zid, src, srcs, illus, dimWeekday, d, s)
			}
		}
		if len(company.zones) > 0 {
			src, srcs, illus := companySource(accs, company)
			for h, s := range company.hours {
				if s.Days == 0 {
					continue
				}
				b.Queue(`INSERT INTO forecast_accuracy_hour_totals (tenant_id, data_source, window_start, window_end, window_days, bucket, zones,
					days, forecast_sum, actual_sum, abs_error_sum, ape_sum, ape_count, data_sources, illustrative, computed_at)
					VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, clock_timestamp())`,
					src, start, end, windowDays, h, len(company.zones), s.Days, s.Forecast, s.Actual, s.AbsError, s.APESum, s.APECount, srcs, illus)
			}
		}
		if b.Len() == 0 {
			return struct{}{}, nil
		}
		return struct{}{}, tx.SendBatch(ctx, b).Close()
	})
	return err
}

// storedAccuracyWindow: stored end, length.
func storedAccuracyWindow(ctx context.Context, conn *tenancy.Connection, tenant string) (string, int, error) {
	type w struct {
		end  *string
		days *int
	}
	got, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (w, error) {
		var x w
		err := tx.QueryRow(ctx, `SELECT to_char(max(window_end), 'YYYY-MM-DD'), max(window_days) FROM forecast_accuracy_rollups`).Scan(&x.end, &x.days)
		return x, err
	})
	if err != nil || got.end == nil || got.days == nil {
		return "", 0, err
	}
	return *got.end, *got.days, nil
}

// casesOnDay: whether any case came that day.
func casesOnDay(ctx context.Context, conn *tenancy.Connection, tenant, day string) (bool, error) {
	from, err := riyadhMidnight(day)
	if err != nil {
		return false, err
	}
	return tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (bool, error) {
		var ok bool
		err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cases WHERE registered_at >= $1 AND registered_at < $2)`, from, from.Add(24*time.Hour)).Scan(&ok)
		return ok, err
	})
}

// runRollingAccuracyJob: daily, after cases.
func runRollingAccuracyJob(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, report *WorkerCycleReport) error {
	tenant := rc.CustomerID
	windowDays, _, end := accuracyWindow(ctx, tenant)
	storedEnd, storedDays, err := storedAccuracyWindow(ctx, conn, tenant)
	if err != nil {
		return fmt.Errorf("worker: rolling accuracy: %w", err)
	}
	if storedEnd == end && storedDays == windowDays {
		return nil
	}
	ready, err := casesOnDay(ctx, conn, tenant, end)
	if err != nil || !ready {
		return err
	}
	got, err := RefreshRollingAccuracy(ctx, conn, rc)
	if err != nil {
		return fmt.Errorf("worker: rolling accuracy: %w", err)
	}
	report.AccuracyDays = got.Days
	report.AccuracyStored = true
	return nil
}

// RollingAccuracyFigures: contract type.
type RollingAccuracyFigures struct {
	Days         int      `json:"days"`
	Forecast     float64  `json:"forecast"`
	Actual       int64    `json:"actual"`
	MAPE         *float64 `json:"mape"`
	WAPE         *float64 `json:"wape"`
	TargetStatus *string  `json:"target_status"`
}

// RollingAccuracyZone: one zone's figures.
type RollingAccuracyZone struct {
	ZoneID  string                 `json:"zone_id"`
	Figures RollingAccuracyFigures `json:"figures"`
}

// RollingAccuracyHour: one hour of day.
type RollingAccuracyHour struct {
	Hour    int                    `json:"hour"`
	Figures RollingAccuracyFigures `json:"figures"`
}

// RollingAccuracyWeekday: 0 is Sunday.
type RollingAccuracyWeekday struct {
	Weekday int                    `json:"weekday"`
	Figures RollingAccuracyFigures `json:"figures"`
}

// RollingForecastAccuracy: contract type.
type RollingForecastAccuracy struct {
	WindowDays   int                      `json:"window_days"`
	WindowStart  *string                  `json:"window_start"`
	WindowEnd    *string                  `json:"window_end"`
	ComputedAt   *string                  `json:"computed_at"`
	MAPETarget   float64                  `json:"mape_target"`
	DataSource   string                   `json:"data_source"`
	DataSources  []string                 `json:"data_sources"`
	MixedSources bool                     `json:"mixed_sources"`
	Illustrative bool                     `json:"illustrative"`
	Overall      *RollingAccuracyFigures  `json:"overall"`
	Zones        []RollingAccuracyZone    `json:"zones"`
	Hours        []RollingAccuracyHour    `json:"hours"`
	Weekdays     []RollingAccuracyWeekday `json:"weekdays"`
}

// figuresFrom: MAPE, WAPE and the target status.
func figuresFrom(s accSums, target float64) RollingAccuracyFigures {
	f := RollingAccuracyFigures{Days: s.Days, Forecast: round3(s.Forecast), Actual: s.Actual}
	if s.APECount > 0 {
		m := round4(s.APESum / float64(s.APECount))
		status := "above"
		if m <= target+1e-9 {
			status = "at_or_below"
		}
		f.MAPE, f.TargetStatus = &m, &status
	}
	if s.Actual > 0 {
		w := round4(s.AbsError / float64(s.Actual))
		f.WAPE = &w
	}
	return f
}

type storedAccRow struct {
	zone, source, dim      string
	bucket                 int
	sums                   accSums
	sources                []string
	illus                  bool
	start, end, computedAt string
	windowDays             int
}

func loadRollingAccuracy(ctx context.Context, conn *tenancy.Connection, tenant string) ([]storedAccRow, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]storedAccRow, error) {
		rows, err := tx.Query(ctx, `SELECT zone_id::text, data_source, dimension, bucket, days, forecast_sum, actual_sum, abs_error_sum,
			ape_sum, ape_count, data_sources, illustrative, to_char(window_start, 'YYYY-MM-DD'), to_char(window_end, 'YYYY-MM-DD'),
			window_days, computed_at FROM forecast_accuracy_rollups ORDER BY window_end DESC`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []storedAccRow
		for rows.Next() {
			var r storedAccRow
			var at time.Time
			if err := rows.Scan(&r.zone, &r.source, &r.dim, &r.bucket, &r.sums.Days, &r.sums.Forecast, &r.sums.Actual, &r.sums.AbsError,
				&r.sums.APESum, &r.sums.APECount, &r.sources, &r.illus, &r.start, &r.end, &r.windowDays, &at); err != nil {
				return nil, err
			}
			r.computedAt = datactx.ToRiyadhISO(at)
			out = append(out, r)
		}
		return out, rows.Err()
	})
}

// loadHourTotals: company-wide hours of one window.
func loadHourTotals(ctx context.Context, conn *tenancy.Connection, tenant, windowEnd string) (map[int]accSums, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (map[int]accSums, error) {
		rows, err := tx.Query(ctx, `SELECT bucket, days, forecast_sum, actual_sum, abs_error_sum, ape_sum, ape_count
			FROM forecast_accuracy_hour_totals WHERE window_end = $1::date`, windowEnd)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := map[int]accSums{}
		for rows.Next() {
			var h int
			var s accSums
			if err := rows.Scan(&h, &s.Days, &s.Forecast, &s.Actual, &s.AbsError, &s.APESum, &s.APECount); err != nil {
				return nil, err
			}
			out[h] = s
		}
		return out, rows.Err()
	})
}

// GetRollingForecastAccuracy: the read.
func GetRollingForecastAccuracy(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) (RollingForecastAccuracy, error) {
	tenant := rc.CustomerID
	windowDays, _, _ := accuracyWindow(ctx, tenant)
	target := forecastcal.MAPETarget(readSetting(ctx, tenant, forecastcal.KeyMAPETarget, forecastcal.DefaultMAPETarget))
	out := RollingForecastAccuracy{WindowDays: windowDays, MAPETarget: target, DataSource: "SYNTHETIC", Illustrative: true,
		DataSources: []string{}, Zones: []RollingAccuracyZone{}, Hours: []RollingAccuracyHour{}, Weekdays: []RollingAccuracyWeekday{}}
	if err := reqctx.RequireAccess(rc, access.ModuleAdminForecastModel, access.AccessView); err != nil {
		return out, err
	}
	rows, err := loadRollingAccuracy(ctx, conn, tenant)
	if err != nil || len(rows) == 0 {
		return out, err
	}
	zones, err := allZones(ctx, conn, tenant)
	if err != nil {
		return out, err
	}
	name := map[string]string{}
	for _, z := range zones {
		name[z.ID] = z.NameEn
	}
	latest := rows[0].end
	var total accSums
	var hours [24]accSums
	var weekdays [7]accSums
	perZone := map[string]accSums{}
	var sources []string
	illus := false
	for _, r := range rows {
		zid := r.zone
		if r.end != latest || !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		if out.WindowEnd == nil {
			start, end, at := r.start, r.end, r.computedAt
			out.WindowStart, out.WindowEnd, out.ComputedAt, out.WindowDays = &start, &end, &at, r.windowDays
		}
		sources = append(sources, r.sources...)
		illus = illus || r.illus
		switch r.dim {
		case dimZone:
			perZone[zid] = r.sums
			total.merge(r.sums)
		case dimHour:
			hours[r.bucket].merge(r.sums)
		case dimWeekday:
			weekdays[r.bucket].merge(r.sums)
		}
	}
	if out.WindowEnd == nil {
		return out, nil
	}
	// company totals need every zone readable
	if rc.ZoneScope.Kind != access.ScopeAssignedZones {
		totals, err := loadHourTotals(ctx, conn, tenant, latest)
		if err != nil {
			return out, err
		}
		if len(totals) > 0 {
			hours = [24]accSums{}
			for h, s := range totals {
				if h >= 0 && h < 24 {
					hours[h] = s
				}
			}
		}
	}
	primary, distinct, err := sourcesOf(sources)
	if err != nil {
		return out, err
	}
	out.DataSource = primary
	if distinct[0] == "SYNTHETIC" {
		out.DataSource = "SYNTHETIC"
	}
	out.DataSources = distinct
	out.MixedSources = len(distinct) > 1
	out.Illustrative = illus || distinct[0] == "SYNTHETIC"
	if total.Days > 0 {
		f := figuresFrom(total, target)
		out.Overall = &f
	}
	ids := make([]string, 0, len(perZone))
	for id := range perZone {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		if name[ids[i]] != name[ids[j]] {
			return name[ids[i]] < name[ids[j]]
		}
		return ids[i] < ids[j]
	})
	for _, id := range ids {
		out.Zones = append(out.Zones, RollingAccuracyZone{ZoneID: id, Figures: figuresFrom(perZone[id], target)})
	}
	for h, s := range hours {
		if s.Days > 0 {
			out.Hours = append(out.Hours, RollingAccuracyHour{Hour: h, Figures: figuresFrom(s, target)})
		}
	}
	for d, s := range weekdays {
		if s.Days > 0 {
			out.Weekdays = append(out.Weekdays, RollingAccuracyWeekday{Weekday: d, Figures: figuresFrom(s, target)})
		}
	}
	return out, nil
}
