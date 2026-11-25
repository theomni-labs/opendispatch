// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/geocell"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	// apart from the kept forecast
	locationAnswers       engines.Name = "forecaster.location"
	locationScope                      = "location:"
	locationMaxCells                   = 200
	locationOutCells                   = 1_000_000
	locationMaxRecords                 = 200_000
	locationRawBudget                  = engines.MaxRawRequest / 8
	locationPoolPrecision              = 5
)

// dayGroups by Go weekday, Sunday first.
var dayGroups = [7]string{"weekday", "weekday", "weekday", "weekday", "thursday", "friday", "saturday"}

var dayGroupOrder = map[string]int{"weekday": 0, "thursday": 1, "friday": 2, "saturday": 3}

// DayGroupOf: the day group of a date.
func DayGroupOf(date string) (string, error) {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return "", dataerr.Invalid("date must be YYYY-MM-DD")
	}
	return dayGroups[t.Weekday()], nil
}

type fcLocationRecord struct {
	SubZoneID string `json:"sub_zone_id"`
	CellID    string `json:"cell_id"`
	Hour      int    `json:"hour"`
	DayGroup  string `json:"day_group"`
	Cases     int    `json:"cases"`
}

// locationCount: cases per cell, hour, day.
type locationCount struct {
	SubZoneID      string
	LatIdx, LonIdx int64
	Hour, Weekday  int
	Cases          int
}

// withLocations adds non-empty records.
func withLocations(history map[string]any, recs []fcLocationRecord) map[string]any {
	if len(recs) > 0 {
		history["location_records"] = recs
	}
	return history
}

// activeSubZones: those sent to the engine.
func activeSubZones(zones []Zone, subs []SubZone) map[string]SubZone {
	on := map[string]bool{}
	for _, z := range zones {
		on[z.ID] = z.IsActive
	}
	out := map[string]SubZone{}
	for _, s := range subs {
		if s.IsActive && on[s.ZoneID] && uuidPattern.MatchString(s.ID) {
			out[s.ID] = s
		}
	}
	return out
}

// loadForecastLocations: counts per cell.
func loadForecastLocations(ctx context.Context, conn *tenancy.Connection, tenant string, zones []Zone, subs []SubZone, from, to time.Time) ([]fcLocationRecord, error) {
	active := activeSubZones(zones, subs)
	if len(active) == 0 {
		return nil, nil
	}
	ids := make([]string, 0, len(active))
	for id := range active {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	precision := forecastcal.LocationCellPrecision(readSetting(ctx, tenant, forecastcal.KeyLocationCellPrecision, forecastcal.DefaultLocationCellPrecision))
	latBits, lonBits := geocell.Bits(precision)
	counts, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]locationCount, error) {
		rows, err := tx.Query(ctx, `SELECT sub_zone_id::text, floor((latitude + 90) / 180 * $4)::bigint, floor((longitude + 180) / 360 * $5)::bigint,
				extract(hour FROM (registered_at AT TIME ZONE 'UTC') + interval '3 hours')::int,
				extract(dow FROM (registered_at AT TIME ZONE 'UTC') + interval '3 hours')::int, count(*)::int
			FROM cases WHERE sub_zone_id = ANY($1::uuid[]) AND registered_at >= $2 AND registered_at < $3
				AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND NOT (latitude = 0 AND longitude = 0)
			GROUP BY 1, 2, 3, 4, 5`, ids, from, to, float64(int64(1)<<latBits), float64(int64(1)<<lonBits))
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []locationCount
		for rows.Next() {
			var c locationCount
			if err := rows.Scan(&c.SubZoneID, &c.LatIdx, &c.LonIdx, &c.Hour, &c.Weekday, &c.Cases); err != nil {
				return nil, err
			}
			c.LatIdx = min(c.LatIdx, int64(1)<<latBits-1)
			c.LonIdx = min(c.LonIdx, int64(1)<<lonBits-1)
			out = append(out, c)
		}
		return out, rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return buildLocationRecords(counts, active, precision), nil
}

// buildLocationRecords: cap, pool, budget.
func buildLocationRecords(counts []locationCount, subs map[string]SubZone, precision int) []fcLocationRecord {
	if len(counts) == 0 || len(subs) == 0 {
		return nil
	}
	type key struct{ lat, lon int64 }
	ids := map[key]string{}
	cellOf := func(c locationCount) string {
		k := key{c.LatIdx, c.LonIdx}
		if id, ok := ids[k]; ok {
			return id
		}
		ids[k] = geocell.FromIndex(c.LatIdx, c.LonIdx, precision)
		return ids[k]
	}
	totals := map[string]map[string]int{}
	for _, c := range counts {
		if totals[c.SubZoneID] == nil {
			totals[c.SubZoneID] = map[string]int{}
		}
		totals[c.SubZoneID][cellOf(c)] += c.Cases
	}
	ranked := map[string][]string{}
	for sub, cells := range totals {
		for cell := range cells {
			ranked[sub] = append(ranked[sub], cell)
		}
		sort.Slice(ranked[sub], func(i, j int) bool {
			a, b := ranked[sub][i], ranked[sub][j]
			if cells[a] != cells[b] {
				return cells[a] > cells[b]
			}
			return a < b
		})
	}
	k := max(1, min(locationMaxCells, locationOutCells/(96*len(subs))))
	for {
		recs := assembleLocations(counts, ranked, subs, cellOf, precision, k)
		if k == 1 || fitsLocationBudget(recs) {
			return recs
		}
		k /= 2
	}
}

func fitsLocationBudget(recs []fcLocationRecord) bool {
	if len(recs) > locationMaxRecords {
		return false
	}
	b, err := json.Marshal(recs)
	return err == nil && len(b) <= locationRawBudget
}

// poolCell: the sub-zone's own cell for the rest.
func poolCell(s SubZone, top string, precision int) string {
	p := min(precision, locationPoolPrecision)
	if s.Latitude == 0 && s.Longitude == 0 {
		return top[:p]
	}
	return geocell.Encode(s.Latitude, s.Longitude, p)
}

func assembleLocations(counts []locationCount, ranked map[string][]string, subs map[string]SubZone, cellOf func(locationCount) string, precision, k int) []fcLocationRecord {
	kept := map[string]map[string]bool{}
	pool := map[string]string{}
	for sub, cells := range ranked {
		kept[sub] = map[string]bool{}
		for _, c := range cells[:min(k, len(cells))] {
			kept[sub][c] = true
		}
		pool[sub] = poolCell(subs[sub], cells[0], precision)
	}
	type rk struct {
		sub, cell string
		hour, dg  int
	}
	sum := map[rk]int{}
	for _, c := range counts {
		cell := cellOf(c)
		if !kept[c.SubZoneID][cell] {
			cell = pool[c.SubZoneID]
		}
		sum[rk{c.SubZoneID, cell, c.Hour, dayGroupOrder[dayGroups[c.Weekday%7]]}] += c.Cases
	}
	out := make([]fcLocationRecord, 0, len(sum))
	for r, n := range sum {
		out = append(out, fcLocationRecord{SubZoneID: r.sub, CellID: r.cell, Hour: r.hour, DayGroup: dayGroupNames[r.dg], Cases: n})
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.SubZoneID != b.SubZoneID {
			return a.SubZoneID < b.SubZoneID
		}
		if a.Hour != b.Hour {
			return a.Hour < b.Hour
		}
		if a.DayGroup != b.DayGroup {
			return dayGroupOrder[a.DayGroup] < dayGroupOrder[b.DayGroup]
		}
		return a.CellID < b.CellID
	})
	return out
}

var dayGroupNames = [4]string{"weekday", "thursday", "friday", "saturday"}

// EngineLocationCell: one answered cell.
type EngineLocationCell struct {
	CellID      string  `json:"cell_id"`
	Probability float64 `json:"probability"`
}

// EngineLocationDistribution: one group.
type EngineLocationDistribution struct {
	SubZoneID string               `json:"sub_zone_id"`
	Hour      int                  `json:"hour"`
	DayGroup  string               `json:"day_group"`
	Cells     []EngineLocationCell `json:"cells"`
}

// keptLocations: one run in engine_answers.
type keptLocations struct {
	RunID         string                    `json:"run_id"`
	DataSource    string                    `json:"data_source"`
	Illustrative  bool                      `json:"illustrative"`
	CellPrecision int                       `json:"cell_precision"`
	ModelVersion  string                    `json:"model_version"`
	SubZones      map[string]keptSubZoneMap `json:"sub_zones"`
}

// keptSubZoneMap: probabilities by cell.
type keptSubZoneMap struct {
	ZoneID string               `json:"zone_id"`
	Cells  []string             `json:"cells"`
	Groups map[string][]float64 `json:"groups"`
}

func groupKey(hour int, dayGroup string) string { return fmt.Sprintf("%s:%02d", dayGroup, hour) }

// packLocations: the answer, kept form.
func packLocations(runID string, doc ForecasterEngineOutput) keptLocations {
	zoneOf := map[string]string{}
	for _, v := range doc.Values {
		zoneOf[v.SubZoneID] = v.ZoneID
	}
	kept := keptLocations{RunID: runID, DataSource: doc.DataSource, Illustrative: doc.Illustrative, ModelVersion: doc.ModelVersion, SubZones: map[string]keptSubZoneMap{}}
	index := map[string]map[string]int{}
	for _, d := range doc.LocationDistributions {
		if _, ok := dayGroupOrder[d.DayGroup]; !ok || d.Hour < 0 || d.Hour > 23 {
			continue
		}
		sz, ok := kept.SubZones[d.SubZoneID]
		if !ok {
			sz = keptSubZoneMap{ZoneID: zoneOf[d.SubZoneID], Groups: map[string][]float64{}}
			index[d.SubZoneID] = map[string]int{}
		}
		at := index[d.SubZoneID]
		for _, c := range d.Cells {
			if _, seen := at[c.CellID]; !seen {
				at[c.CellID] = len(sz.Cells)
				sz.Cells = append(sz.Cells, c.CellID)
			}
			kept.CellPrecision = max(kept.CellPrecision, len(c.CellID))
		}
		probs := make([]float64, len(sz.Cells))
		for _, c := range d.Cells {
			probs[at[c.CellID]] = c.Probability
		}
		sz.Groups[groupKey(d.Hour, d.DayGroup)] = probs
		kept.SubZones[d.SubZoneID] = sz
	}
	return kept
}

// keepForecastLocations: failures are logged.
func keepForecastLocations(ctx context.Context, rc reqctx.RequestContext, runID string, doc ForecasterEngineOutput) {
	if len(doc.LocationDistributions) == 0 {
		return
	}
	body, err := json.Marshal(packLocations(runID, doc))
	if err == nil {
		err = keepAnswer(ctx, rc.CustomerID, locationAnswers, locationScope+runID, body, nil)
	}
	if err != nil {
		log.Printf("forecast locations: not stored for run %s: %v", runID, err)
	}
}

// readKeptScope: one kept answer by scope.
func readKeptScope(ctx context.Context, tenant string, name engines.Name, scope string) ([]byte, error) {
	switch b := engineAnswerData.(type) {
	case pgEngineAnswers:
		return tenancy.WithTenant(ctx, b.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]byte, error) {
			var body []byte
			err := tx.QueryRow(ctx, `SELECT body::text FROM engine_answers WHERE engine = $1 AND scope_key = $2`, string(name), scope).Scan(&body)
			if err == pgx.ErrNoRows {
				return nil, nil
			}
			return body, err
		})
	case *memoryEngineAnswers:
		b.mu.Lock()
		defer b.mu.Unlock()
		if r, ok := b.rows[tenant+"|"+string(name)+"|"+scope]; ok {
			return append([]byte(nil), r.body...), nil
		}
		return nil, nil
	}
	return nil, fmt.Errorf("forecast locations: unknown answer store")
}

// ForecastLocationQuery: sub-zone, hour, day.
type ForecastLocationQuery struct {
	// ForecastRunID empty: the latest stored run.
	ForecastRunID string
	SubZoneID     string
	Hour          int
	DayGroup      string
}

// ForecastLocationCell: a cell and bounds.
type ForecastLocationCell struct {
	CellID      string  `json:"cell_id"`
	Probability float64 `json:"probability"`
	// Pooled: the rest of the sub-zone.
	Pooled bool    `json:"pooled"`
	South  float64 `json:"south"`
	West   float64 `json:"west"`
	North  float64 `json:"north"`
	East   float64 `json:"east"`
}

// ForecastLocationDistribution: a group.
type ForecastLocationDistribution struct {
	ForecastRunID string                 `json:"forecast_run_id"`
	ZoneID        string                 `json:"zone_id"`
	SubZoneID     string                 `json:"sub_zone_id"`
	Hour          int                    `json:"hour"`
	DayGroup      string                 `json:"day_group"`
	CellPrecision int                    `json:"cell_precision"`
	ModelVersion  string                 `json:"model_version"`
	DataSource    string                 `json:"data_source"`
	Illustrative  bool                   `json:"illustrative"`
	Cells         []ForecastLocationCell `json:"cells"`
}

// GetForecastLocationDistribution: read one.
func GetForecastLocationDistribution(rc reqctx.RequestContext, q ForecastLocationQuery) (ForecastLocationDistribution, error) {
	var out ForecastLocationDistribution
	if err := reqctx.RequireAccess(rc, access.ModuleOpsForecastExplorer, access.AccessView); err != nil {
		return out, err
	}
	if _, ok := dayGroupOrder[q.DayGroup]; !ok {
		return out, dataerr.Invalid("day_group must be weekday, thursday, friday or saturday")
	}
	if q.Hour < 0 || q.Hour > 23 {
		return out, dataerr.Invalid("hour must be 0 to 23")
	}
	if !uuidPattern.MatchString(q.SubZoneID) || (q.ForecastRunID != "" && !uuidPattern.MatchString(q.ForecastRunID)) {
		return out, dataerr.Invalid("sub_zone_id and forecast_run_id must be ids")
	}
	var body []byte
	var err error
	if q.ForecastRunID == "" {
		body, err = engineAnswerData.latest(context.Background(), rc.CustomerID, locationAnswers)
	} else {
		body, err = readKeptScope(context.Background(), rc.CustomerID, locationAnswers, locationScope+q.ForecastRunID)
	}
	if err != nil {
		return out, err
	}
	var kept keptLocations
	if body == nil || json.Unmarshal(body, &kept) != nil {
		return out, dataerr.NotFound("No location distributions for this forecast run.")
	}
	sz, ok := kept.SubZones[q.SubZoneID]
	if !ok {
		return out, dataerr.NotFound("No location distributions for this sub-zone.")
	}
	zone := sz.ZoneID
	if zone == "" || !reqctx.CanReadZone(rc, &zone) {
		return out, dataerr.NotFound("No location distributions for this sub-zone.")
	}
	out = ForecastLocationDistribution{ForecastRunID: kept.RunID, ZoneID: zone, SubZoneID: q.SubZoneID, Hour: q.Hour, DayGroup: q.DayGroup,
		CellPrecision: kept.CellPrecision, ModelVersion: kept.ModelVersion, DataSource: kept.DataSource, Illustrative: kept.Illustrative, Cells: []ForecastLocationCell{}}
	for i, p := range sz.Groups[groupKey(q.Hour, q.DayGroup)] {
		if p <= 0 || i >= len(sz.Cells) {
			continue
		}
		box, err := geocell.Decode(sz.Cells[i])
		if err != nil {
			continue
		}
		out.Cells = append(out.Cells, ForecastLocationCell{CellID: sz.Cells[i], Probability: p, Pooled: len(sz.Cells[i]) < kept.CellPrecision,
			South: box.South, West: box.West, North: box.North, East: box.East})
	}
	sort.Slice(out.Cells, func(i, j int) bool {
		a, b := out.Cells[i], out.Cells[j]
		if a.Probability != b.Probability {
			return a.Probability > b.Probability
		}
		return a.CellID < b.CellID
	})
	return out, nil
}
