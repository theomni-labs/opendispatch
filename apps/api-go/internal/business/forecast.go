// SPDX-License-Identifier: AGPL-3.0-only

// Ports forecast.ts (ops.forecast_explorer): runs,
// values, timeline, and the field/remote split.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

var forecastRunStatuses = []string{"queued", "running", "succeeded", "failed", "cancelled"}

// demoSubZoneRow: another stale-snapshot copy, like
// field_share.go's demoZoneRow (TS reads SubZone
// from the demo store, not store-api).
type demoSubZoneRow struct {
	ID     string
	NameEn string
}

var (
	forecastSubZoneMu     sync.Mutex
	demoSubZoneRows       []demoSubZoneRow
	forecastSubZoneSeeded bool
)

// ForecastSubZoneSeed: test seed, one sub-zone.
type ForecastSubZoneSeed struct {
	ID     string
	NameEn string
}

// ResetForecastSubZonesForTest clears the snapshot.
func ResetForecastSubZonesForTest() {
	forecastSubZoneMu.Lock()
	demoSubZoneRows, forecastSubZoneSeeded = nil, true
	forecastSubZoneMu.Unlock()
}

// ReloadForecastSubZonesForTest restores the fixtures.
func ReloadForecastSubZonesForTest() {
	forecastSubZoneMu.Lock()
	demoSubZoneRows, forecastSubZoneSeeded = nil, false
	forecastSubZoneMu.Unlock()
}

// SeedForecastSubZonesForTest sets the snapshot.
func SeedForecastSubZonesForTest(rows []ForecastSubZoneSeed) {
	forecastSubZoneMu.Lock()
	demoSubZoneRows, forecastSubZoneSeeded = nil, true
	for _, r := range rows {
		demoSubZoneRows = append(demoSubZoneRows, demoSubZoneRow{ID: r.ID, NameEn: r.NameEn})
	}
	forecastSubZoneMu.Unlock()
}

// Bypasses fixtures.Records' cache, keyed by schema only.
func uncachedFixtureRows[T any](schema string) ([]T, error) {
	dir, err := fixtures.Dir()
	if err != nil {
		return nil, err
	}
	entries, err := fixtures.Manifest()
	if err != nil {
		return nil, err
	}
	var out []T
	for _, e := range entries {
		if e.Schema != schema || e.Kind != "array" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Path))
		if err != nil {
			return nil, err
		}
		var rows []T
		if err := json.Unmarshal(raw, &rows); err != nil {
			return nil, err
		}
		out = append(out, rows...)
	}
	return out, nil
}

func subZoneNameOf(id string) string {
	forecastSubZoneMu.Lock()
	defer forecastSubZoneMu.Unlock()
	if !forecastSubZoneSeeded {
		forecastSubZoneSeeded = true
		if rows, err := uncachedFixtureRows[SubZone]("SubZone"); err == nil {
			for _, r := range rows {
				demoSubZoneRows = append(demoSubZoneRows, demoSubZoneRow{ID: r.ID, NameEn: r.NameEn})
			}
		}
	}
	for _, r := range demoSubZoneRows {
		if r.ID == id {
			return r.NameEn
		}
	}
	return ""
}

func dateOnly(s string) string {
	if len(s) >= 10 {
		return s[:10]
	}
	return s
}

// ForecastRunQuery mirrors listForecastRuns's query.
type ForecastRunQuery struct {
	Limit  int
	Cursor string
	Status string
}

// ListForecastRuns mirrors listForecastRuns.
func ListForecastRuns(rc reqctx.RequestContext, query ForecastRunQuery) (datactx.PageResult[ForecastRun], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsForecastExplorer, access.AccessView); err != nil {
		return datactx.PageResult[ForecastRun]{}, err
	}
	if query.Status != "" && !containsStr(forecastRunStatuses, query.Status) {
		return datactx.PageResult[ForecastRun]{}, dataerr.Invalid("status must be one of " + strings.Join(forecastRunStatuses, ", ") + ".")
	}
	all, err := loadForecastRuns(context.Background(), rc.CustomerID, true)
	if err != nil {
		return datactx.PageResult[ForecastRun]{}, err
	}
	var rows []ForecastRun
	for _, r := range all {
		if query.Status == "" || r.Status == query.Status {
			rows = append(rows, r)
		}
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// GetForecastRun mirrors getForecastRun.
func GetForecastRun(rc reqctx.RequestContext, id string) (ForecastRun, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsForecastExplorer, access.AccessView); err != nil {
		return ForecastRun{}, err
	}
	if _, err := importutil.RequireID(id, "Forecast run"); err != nil {
		return ForecastRun{}, err
	}
	row, err := loadForecastRun(context.Background(), rc.CustomerID, id, true)
	if err != nil {
		return ForecastRun{}, err
	}
	if row == nil {
		return ForecastRun{}, dataerr.NotFound("Forecast run not found.")
	}
	return *row, nil
}

// ForecastValueQuery mirrors ForecastValueQuery.
type ForecastValueQuery struct {
	Limit         int
	Cursor        string
	RunID         string
	ZoneID        string
	SubZoneID     string
	Date          string
	IntervalStart string
}

// ListForecastValues mirrors listForecastValues.
func ListForecastValues(rc reqctx.RequestContext, query ForecastValueQuery) (datactx.PageResult[ForecastValue], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsForecastExplorer, access.AccessView); err != nil {
		return datactx.PageResult[ForecastValue]{}, err
	}
	run, err := requireRun(context.Background(), rc.CustomerID, query.RunID)
	if err != nil {
		return datactx.PageResult[ForecastValue]{}, err
	}
	date := query.Date
	if date == "" {
		date = run.HorizonStartDate
	} else if err := validateDateString(date); err != nil {
		return datactx.PageResult[ForecastValue]{}, err
	}
	var wantedStart *time.Time
	if query.IntervalStart != "" {
		t, parseErr := time.Parse(time.RFC3339, query.IntervalStart)
		if parseErr != nil {
			return datactx.PageResult[ForecastValue]{}, dataerr.Invalid("interval_start must be a date-time.")
		}
		wantedStart = &t
	}
	index, err := indexStored(context.Background(), rc.CustomerID)
	if err != nil {
		return datactx.PageResult[ForecastValue]{}, err
	}
	var rows []ForecastValue
	for _, zoneID := range zoneIDsFor(context.Background(), rc.CustomerID) {
		zid := zoneID
		if !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		if query.ZoneID != "" && zoneID != query.ZoneID {
			continue
		}
		var list []rawRow
		raw, err := rawRows(context.Background(), rc, index, run, zoneID, date)
		if err != nil {
			return datactx.PageResult[ForecastValue]{}, err
		}
		for _, r := range raw {
			if query.SubZoneID != "" && r.Row.SubZoneID != query.SubZoneID {
				continue
			}
			if wantedStart != nil {
				rowStart, _ := time.Parse(time.RFC3339, intervalStartOf(date, r.Row.IntervalIndex))
				if !rowStart.Equal(*wantedStart) {
					continue
				}
			}
			list = append(list, r)
		}
		sort.SliceStable(list, func(i, j int) bool {
			ni, nj := subZoneNameOf(list[i].Row.SubZoneID), subZoneNameOf(list[j].Row.SubZoneID)
			if ni != nj {
				return ni < nj
			}
			return list[i].Row.IntervalIndex < list[j].Row.IntervalIndex
		})
		for _, r := range list {
			expected := round3(r.Row.Expected * r.Factor)
			field := round3(r.Row.FieldExpected * r.Factor)
			remote := round3(r.Row.RemoteInferredExpected * r.Factor)
			derived := r.Factor != 1 || dateOnly(r.Row.IntervalStart) != date
			id := r.Row.ID
			if derived {
				id = datactx.DeterministicUUID(fmt.Sprintf("forecast-value:%s:%s:%s:%d", run.ID, r.Row.SubZoneID, date, r.Row.IntervalIndex))
			}
			row := r.Row
			row.ID = id
			row.ForecastRunID = run.ID
			row.IntervalStart = intervalStartOf(date, r.Row.IntervalIndex)
			row.Low = round3(r.Row.Low * r.Factor)
			row.Expected = expected
			row.High = round3(r.Row.High * r.Factor)
			row.FieldExpected = field
			row.RemoteInferredExpected = remote
			rows = append(rows, row)
		}
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// ForecastTimelineInterval: one timeline interval.
type ForecastTimelineInterval struct {
	IntervalStart          string  `json:"interval_start"`
	IntervalIndex          int     `json:"interval_index"`
	Low                    float64 `json:"low"`
	Expected               float64 `json:"expected"`
	High                   float64 `json:"high"`
	FieldExpected          float64 `json:"field_expected"`
	RemoteInferredExpected float64 `json:"remote_inferred_expected"`
}

// ForecastTimeline mirrors the contract type.
type ForecastTimeline struct {
	ZoneID        string                     `json:"zone_id"`
	Date          string                     `json:"date"`
	ForecastRunID string                     `json:"forecast_run_id"`
	Intervals     []ForecastTimelineInterval `json:"intervals"`
	Illustrative  bool                       `json:"illustrative"`
	DataSource    string                     `json:"data_source"`
}

// ForecastTimelineQuery: getForecastTimeline query.
type ForecastTimelineQuery struct {
	ZoneID string
	Date   string
	RunID  string
}

// GetForecastTimeline mirrors getForecastTimeline.
func GetForecastTimeline(rc reqctx.RequestContext, query ForecastTimelineQuery) (ForecastTimeline, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsForecastExplorer, access.AccessView); err != nil {
		return ForecastTimeline{}, err
	}
	if query.ZoneID == "" {
		return ForecastTimeline{}, dataerr.Invalid("zone_id is required.")
	}
	if _, err := importutil.RequireID(query.ZoneID, "Zone"); err != nil {
		return ForecastTimeline{}, err
	}
	if err := validateDateString(query.Date); err != nil {
		return ForecastTimeline{}, err
	}
	found := false
	for _, id := range zoneIDsFor(context.Background(), rc.CustomerID) {
		if id == query.ZoneID {
			zid := id
			found = reqctx.CanReadZone(rc, &zid)
			break
		}
	}
	if !found {
		return ForecastTimeline{}, dataerr.NotFound("Zone not found.")
	}
	run, err := requireRun(context.Background(), rc.CustomerID, query.RunID)
	if err != nil {
		return ForecastTimeline{}, err
	}
	demand, err := zoneDemand(context.Background(), rc, query.ZoneID, query.Date, nil, run.ID)
	if err != nil {
		return ForecastTimeline{}, err
	}
	intervals := make([]ForecastTimelineInterval, len(demand))
	for i, d := range demand {
		intervals[i] = ForecastTimelineInterval{
			IntervalStart: d.IntervalStart, IntervalIndex: d.IntervalIndex,
			Low: d.Low, Expected: d.Expected, High: d.High,
			FieldExpected: d.FieldExpected, RemoteInferredExpected: d.RemoteInferredExpected,
		}
	}
	return ForecastTimeline{
		ZoneID: query.ZoneID, Date: query.Date, ForecastRunID: run.ID, Intervals: intervals,
		Illustrative: run.Illustrative, DataSource: "SYNTHETIC",
	}, nil
}

// ForecastSplitZone: one zone's split.
type ForecastSplitZone struct {
	ZoneID                 string   `json:"zone_id"`
	FieldExpected          float64  `json:"field_expected"`
	RemoteInferredExpected float64  `json:"remote_inferred_expected"`
	FieldShare             *float64 `json:"field_share"`
}

// ForecastSplit mirrors the contract type.
type ForecastSplit struct {
	RuleSetVersion string              `json:"rule_set_version"`
	GeneratedAt    string              `json:"generated_at"`
	DataSource     string              `json:"data_source"`
	Illustrative   bool                `json:"illustrative"`
	Zones          []ForecastSplitZone `json:"zones"`
}

// ForecastSplitQuery: getForecastSplit's query.
type ForecastSplitQuery struct {
	ZoneID        string
	Date          string
	RuleVersionID string
}

// GetForecastSplit mirrors getForecastSplit.
func GetForecastSplit(rc reqctx.RequestContext, query ForecastSplitQuery) (ForecastSplit, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsForecastExplorer, access.AccessView); err != nil {
		return ForecastSplit{}, err
	}
	run, err := requireRun(context.Background(), rc.CustomerID, "")
	if err != nil {
		return ForecastSplit{}, err
	}
	date := query.Date
	if date == "" {
		date = run.HorizonStartDate
	} else if err := validateDateString(date); err != nil {
		return ForecastSplit{}, err
	}
	if query.ZoneID != "" {
		if _, err := datactx.UUID(datactx.Obj{"zone_id": query.ZoneID}, "zone_id"); err != nil {
			return ForecastSplit{}, err
		}
	}
	ruleSetVersion := ""
	if run.RuleSetVersion != nil {
		ruleSetVersion = *run.RuleSetVersion
	}
	var preview map[string]float64
	if query.RuleVersionID != "" {
		result, err := getFieldShare(context.Background(), rc, FieldShareOptions{Date: date, RuleVersionID: query.RuleVersionID, ZoneID: query.ZoneID})
		if err != nil {
			return ForecastSplit{}, err
		}
		if preview, err = previewShift(context.Background(), rc.CustomerID, date, query.RuleVersionID); err != nil {
			return ForecastSplit{}, err
		}
		ruleSetVersion = result.RuleSetVersion
	}
	var zoneIDs []string
	for _, id := range zoneIDsFor(context.Background(), rc.CustomerID) {
		zid := id
		if reqctx.CanReadZone(rc, &zid) && (query.ZoneID == "" || id == query.ZoneID) {
			zoneIDs = append(zoneIDs, id)
		}
	}
	if query.ZoneID != "" && len(zoneIDs) == 0 {
		return ForecastSplit{}, dataerr.NotFound("Zone not found.")
	}
	zones := make([]ForecastSplitZone, len(zoneIDs))
	for i, zoneID := range zoneIDs {
		demand, err := zoneDemand(context.Background(), rc, zoneID, date, preview, run.ID)
		if err != nil {
			return ForecastSplit{}, err
		}
		var expected, field, remote float64
		for _, d := range demand {
			expected += d.Expected
			field += d.FieldExpected
			remote += d.RemoteInferredExpected
		}
		field = round3(field)
		remote = round3(remote)
		total := field + remote
		var share *float64
		if expected != 0 && total != 0 {
			s := field / total
			share = &s
		}
		zones[i] = ForecastSplitZone{ZoneID: zoneID, FieldExpected: field, RemoteInferredExpected: remote, FieldShare: share}
	}
	return ForecastSplit{
		RuleSetVersion: ruleSetVersion, GeneratedAt: datactx.NowISO(), DataSource: "SYNTHETIC",
		Illustrative: run.Illustrative, Zones: zones,
	}, nil
}
