// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// accuracyLookback: past days offered, newest first.
const accuracyLookback = 28

// ForecastAccuracyQuery: getForecastAccuracy query.
type ForecastAccuracyQuery struct {
	ZoneID string
	Date   string
}

// AccuracyFigures: forecast against actual, one day.
type AccuracyFigures struct {
	Forecast    float64  `json:"forecast"`
	Actual      int      `json:"actual"`
	Difference  *float64 `json:"difference"`
	WAPE        *float64 `json:"wape"`
	WithinRange float64  `json:"within_range"`
}

// AccuracyZone: one zone's figures.
type AccuracyZone struct {
	ZoneID  string          `json:"zone_id"`
	Figures AccuracyFigures `json:"figures"`
}

// AccuracyInterval: one 15-minute interval.
type AccuracyInterval struct {
	IntervalIndex int     `json:"interval_index"`
	Low           float64 `json:"low"`
	Expected      float64 `json:"expected"`
	High          float64 `json:"high"`
	Actual        int     `json:"actual"`
}

// AccuracyRun: the run made for the day.
type AccuracyRun struct {
	ID           string `json:"id"`
	ModelVersion string `json:"model_version"`
	CreatedAt    string `json:"created_at"`
}

// ForecastAccuracy mirrors the contract type.
type ForecastAccuracy struct {
	Dates        []string           `json:"dates"`
	Date         *string            `json:"date"`
	ZoneID       *string            `json:"zone_id"`
	Run          *AccuracyRun       `json:"run"`
	DataSource   string             `json:"data_source"`
	MixedSources bool               `json:"mixed_sources"`
	Illustrative bool               `json:"illustrative"`
	Overall      *AccuracyFigures   `json:"overall"`
	Zones        []AccuracyZone     `json:"zones"`
	Intervals    []AccuracyInterval `json:"intervals"`
}

type daySeries struct {
	low, expected, high [Intervals]float64
	actual              [Intervals]int
}

func round4(x float64) float64 { return math.Round(x*10000) / 10000 }

// figuresOf: totals, hourly WAPE, range share.
func figuresOf(s *daySeries) AccuracyFigures {
	var f AccuracyFigures
	var hourErr float64
	in := 0
	for h := 0; h < 24; h++ {
		var fh float64
		ah := 0
		for i := h * 4; i < h*4+4; i++ {
			fh += s.expected[i]
			ah += s.actual[i]
		}
		hourErr += math.Abs(fh - float64(ah))
	}
	for i := 0; i < Intervals; i++ {
		f.Forecast += s.expected[i]
		f.Actual += s.actual[i]
		a := float64(s.actual[i])
		if a >= s.low[i]-1e-9 && a <= s.high[i]+1e-9 {
			in++
		}
	}
	f.Forecast = round3(f.Forecast)
	f.WithinRange = round4(float64(in) / Intervals)
	if f.Actual > 0 {
		d := round4((f.Forecast - float64(f.Actual)) / float64(f.Actual))
		w := round4(hourErr / float64(f.Actual))
		f.Difference, f.WAPE = &d, &w
	}
	return f
}

// accuracyRuns: per past day, the run made for it.
func accuracyRuns(ctx context.Context, tenant string, index *StoredIndex) (map[string]ForecastRun, []string, error) {
	return accuracyRunsBack(ctx, tenant, index, accuracyLookback)
}

// accuracyRunsBack: the same, over days back.
func accuracyRunsBack(ctx context.Context, tenant string, index *StoredIndex, days int) (map[string]ForecastRun, []string, error) {
	runs, err := loadForecastRuns(ctx, tenant, true)
	if err != nil {
		return nil, nil, err
	}
	byRun, err := index.datesByRun()
	if err != nil {
		return nil, nil, err
	}
	stored := map[string]map[string]bool{}
	for id, dates := range byRun {
		stored[id] = map[string]bool{}
		for _, d := range dates {
			stored[id][d] = true
		}
	}
	today := todayIn(ctx, tenant)
	picked := map[string]ForecastRun{}
	var dates []string
	for back := 1; back <= days; back++ {
		day := shiftDateBy(today, -back)
		var best *ForecastRun
		for i := range runs {
			r := runs[i]
			if r.Status != "succeeded" || isChallengerRun(ctx, tenant, r) || !stored[r.ID][day] {
				continue
			}
			if best == nil {
				best = &runs[i]
			}
			if parseBefore(r.CreatedAt, day) {
				best = &runs[i]
				break
			}
		}
		if best != nil {
			picked[day] = *best
			dates = append(dates, day)
		}
	}
	return picked, dates, nil
}

// parseBefore: made before the day began.
func parseBefore(createdAt, day string) bool {
	t, err := parseTime(createdAt)
	start, derr := riyadhMidnight(day)
	return err == nil && derr == nil && t.Before(start)
}

// actualCounts: cases per zone and interval.
func actualCounts(ctx context.Context, conn *tenancy.Connection, tenant string, zoneIDs []string, day time.Time) (map[string]*[Intervals]int, []string, error) {
	type result struct {
		counts  map[string]*[Intervals]int
		sources []string
	}
	res, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (result, error) {
		out := result{counts: map[string]*[Intervals]int{}}
		rows, err := tx.Query(ctx, `SELECT zone_id::text, registered_at, data_source FROM cases
			WHERE zone_id = ANY($1::uuid[]) AND registered_at >= $2 AND registered_at < $3`, zoneIDs, day, day.Add(24*time.Hour))
		if err != nil {
			return out, err
		}
		defer rows.Close()
		seen := map[string]bool{}
		for rows.Next() {
			var zone, source string
			var at time.Time
			if err := rows.Scan(&zone, &at, &source); err != nil {
				return out, err
			}
			i := int(at.Sub(day) / (15 * time.Minute))
			if i < 0 || i >= Intervals {
				continue
			}
			if out.counts[zone] == nil {
				out.counts[zone] = &[Intervals]int{}
			}
			out.counts[zone][i]++
			if !seen[source] {
				seen[source] = true
				out.sources = append(out.sources, source)
			}
		}
		return out, rows.Err()
	})
	return res.counts, res.sources, err
}

// GetForecastAccuracy mirrors getForecastAccuracy.
func GetForecastAccuracy(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, q ForecastAccuracyQuery) (ForecastAccuracy, error) {
	out := ForecastAccuracy{Dates: []string{}, DataSource: "SYNTHETIC", Illustrative: true, Zones: []AccuracyZone{}, Intervals: []AccuracyInterval{}}
	if err := reqctx.RequireAccess(rc, access.ModuleOpsForecastExplorer, access.AccessView); err != nil {
		return out, err
	}
	if q.ZoneID != "" {
		if _, err := importutil.RequireID(q.ZoneID, "Zone"); err != nil {
			return out, err
		}
	}
	if q.Date != "" {
		if err := validateDateString(q.Date); err != nil {
			return out, err
		}
	}
	tenant := rc.CustomerID
	index, err := indexStored(ctx, tenant)
	if err != nil {
		return out, err
	}
	picked, dates, err := accuracyRuns(ctx, tenant, index)
	if err != nil || len(dates) == 0 {
		return out, err
	}
	out.Dates = dates
	day := dates[0]
	if _, ok := picked[q.Date]; ok {
		day = q.Date
	}
	run := picked[day]
	out.Date = &day
	out.Run = &AccuracyRun{ID: run.ID, ModelVersion: run.ModelVersion, CreatedAt: run.CreatedAt}
	if run.DataSource != "" {
		out.DataSource = run.DataSource // no cases: the run's source
	}

	zones, err := allZones(ctx, conn, tenant)
	if err != nil {
		return out, err
	}
	sort.SliceStable(zones, func(i, j int) bool { return zones[i].NameEn < zones[j].NameEn })
	series := map[string]*daySeries{}
	var order, ids []string
	for _, z := range zones {
		zid := z.ID
		if !z.IsActive || !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		rows, err := index.Rows(run.ID, z.ID, day)
		if err != nil {
			return out, err
		}
		if len(rows) == 0 {
			continue
		}
		s := &daySeries{}
		for _, r := range rows {
			if r.IntervalIndex < 0 || r.IntervalIndex >= Intervals {
				continue
			}
			s.low[r.IntervalIndex] += r.Low
			s.expected[r.IntervalIndex] += r.Expected
			s.high[r.IntervalIndex] += r.High
		}
		series[z.ID] = s
		order = append(order, z.ID)
		ids = append(ids, z.ID)
	}
	if len(order) == 0 {
		return out, nil
	}
	start, err := riyadhMidnight(day)
	if err != nil {
		return out, err
	}
	counts, sources, err := actualCounts(ctx, conn, tenant, ids, start)
	if err != nil {
		return out, err
	}
	if len(sources) > 0 {
		primary, distinct, serr := sourcesOf(sources)
		if serr != nil {
			return out, serr
		}
		out.MixedSources = len(distinct) > 1
		out.DataSource = primary
		if distinct[0] == "SYNTHETIC" {
			out.DataSource = "SYNTHETIC"
		}
		out.Illustrative = run.Illustrative || distinct[0] == "SYNTHETIC"
	}
	selected := order[0]
	for _, id := range order {
		if c := counts[id]; c != nil {
			series[id].actual = *c
		}
		out.Zones = append(out.Zones, AccuracyZone{ZoneID: id, Figures: figuresOf(series[id])})
		if id == q.ZoneID {
			selected = id
		}
	}
	out.ZoneID = &selected
	for _, z := range out.Zones {
		if z.ZoneID == selected {
			f := z.Figures
			out.Overall = &f
		}
	}
	s := series[selected]
	for i := 0; i < Intervals; i++ {
		out.Intervals = append(out.Intervals, AccuracyInterval{IntervalIndex: i, Low: round3(s.low[i]), Expected: round3(s.expected[i]), High: round3(s.high[i]), Actual: s.actual[i]})
	}
	return out, nil
}
