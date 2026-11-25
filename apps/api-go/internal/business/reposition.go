// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/geocell"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/synthetic"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// Advisory repositioning.
const (
	repositionKey           = "dispatch.reposition"
	repositionMaxMoveKey    = "dispatch.reposition_max_move_km"
	repositionPeriodKey     = "dispatch.reposition_period_seconds"
	repositionLookAheadKey  = "dispatch.reposition_look_ahead_hours"
	defaultRepositionMaxKm  = 5.0
	defaultRepositionPeriod = 1800
	defaultRepositionLookH  = 1
	repositionTimeout       = 10 * time.Second
	repositionStaleSeconds  = 7200
	repositionMaxCells      = 20000
	repositionMaxIdle       = 2000
)

var repositionReasons = map[string]bool{"cover_expected_demand": true, "rebalance_zone": true}

// getReposition: off unless set.
func getReposition(ctx context.Context, tenant string) bool {
	return readSetting(ctx, tenant, repositionKey, false)
}

// getRepositionMaxMoveKm: above 0, at most 50.
func getRepositionMaxMoveKm(ctx context.Context, tenant string) float64 {
	v := readSetting(ctx, tenant, repositionMaxMoveKey, defaultRepositionMaxKm)
	if v > 0 && v <= 50 && !math.IsNaN(v) {
		return v
	}
	return defaultRepositionMaxKm
}

// getRepositionPeriod: 5 min to 6 h.
func getRepositionPeriod(ctx context.Context, tenant string) time.Duration {
	v := readSetting(ctx, tenant, repositionPeriodKey, defaultRepositionPeriod)
	if v < 300 || v > 21600 {
		v = defaultRepositionPeriod
	}
	return time.Duration(v) * time.Second
}

// getRepositionLookAhead: 1 to 6 hours.
func getRepositionLookAhead(ctx context.Context, tenant string) int {
	v := readSetting(ctx, tenant, repositionLookAheadKey, defaultRepositionLookH)
	if v < 1 || v > 6 {
		return defaultRepositionLookH
	}
	return v
}

// WaitingSpot mirrors one WaitingSpots item.
type WaitingSpot struct {
	AgentID    string  `json:"agent_id"`
	ZoneID     string  `json:"zone_id"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
	MoveKm     float64 `json:"move_km"`
	ReasonCode string  `json:"reason_code"`
}

// WaitingSpots mirrors the contract type.
type WaitingSpots struct {
	GeneratedAt  *string       `json:"generated_at"`
	Enabled      bool          `json:"enabled"`
	ModelVersion *string       `json:"model_version"`
	Illustrative bool          `json:"illustrative"`
	Items        []WaitingSpot `json:"items"`
	DataSource   string        `json:"data_source"`
}

// repositionRun: the latest suggestions.
type repositionRun struct {
	clockMs    int64
	maxKm      float64
	model      string
	dataSource string
	items      []WaitingSpot
}

var (
	repositionMu     sync.Mutex
	repositionRuns   = map[string]*repositionRun{}
	repositionLocks  = map[string]*sync.Mutex{}
	repositionGuards = map[string]*engines.Guard{}
)

// resetReposition: on engine config change.
func resetReposition() {
	repositionMu.Lock()
	repositionRuns = map[string]*repositionRun{}
	repositionGuards = map[string]*engines.Guard{}
	repositionMu.Unlock()
}

// ResetRepositionForTest clears kept runs.
func ResetRepositionForTest() { resetReposition() }

func repositionLock(tenant string) *sync.Mutex {
	repositionMu.Lock()
	defer repositionMu.Unlock()
	l, ok := repositionLocks[tenant]
	if !ok {
		l = &sync.Mutex{}
		repositionLocks[tenant] = l
	}
	return l
}

func latestReposition(tenant string) *repositionRun {
	repositionMu.Lock()
	defer repositionMu.Unlock()
	return repositionRuns[tenant]
}

// repositionGuard: separate from live ranking.
func repositionGuard(tenant string) (*engines.Guard, error) {
	engineMu.Lock()
	cfg := engineCfg
	engineMu.Unlock()
	repositionMu.Lock()
	defer repositionMu.Unlock()
	if g, ok := repositionGuards[tenant]; ok {
		return g, nil
	}
	g, err := cfg.BuildRoute(engines.Assignment, "reposition", repositionTimeout, nil)
	if err != nil {
		return nil, err
	}
	repositionGuards[tenant] = g
	return g, nil
}

// stale: never run, period passed, clock rewound.
func (r *repositionRun) stale(clockMs int64, period time.Duration, maxKm float64) bool {
	return r == nil || clockMs < r.clockMs || clockMs-r.clockMs >= period.Milliseconds() || r.maxKm != maxKm
}

// ListWaitingSpots mirrors listWaitingSpots.
func ListWaitingSpots(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, zoneID string) (WaitingSpots, error) {
	out := WaitingSpots{Illustrative: true, Items: []WaitingSpot{}, DataSource: "SYNTHETIC"}
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return out, err
	}
	if zoneID != "" && !uuidPattern.MatchString(zoneID) {
		return out, dataerr.Invalid("zone_id must be an id")
	}
	if !getReposition(ctx, rc.CustomerID) {
		return out, nil
	}
	out.Enabled = true
	run, err := refreshReposition(ctx, conn, rc.CustomerID)
	if err != nil {
		return out, err
	}
	if run == nil {
		return out, nil
	}
	at := isoAtMs(run.clockMs)
	out.GeneratedAt = &at
	if run.model != "" {
		m := run.model
		out.ModelVersion = &m
	}
	if run.dataSource != "" {
		out.DataSource = run.dataSource
	}
	for _, it := range run.items {
		zid := it.ZoneID
		if (zoneID != "" && zid != zoneID) || !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		out.Items = append(out.Items, it)
	}
	return out, nil
}

// refreshReposition: once a period, board clock.
func refreshReposition(ctx context.Context, conn *tenancy.Connection, tenant string) (*repositionRun, error) {
	clock, err := readDispatchClock(ctx, tenant)
	if err != nil {
		return nil, err
	}
	period := getRepositionPeriod(ctx, tenant)
	maxKm := getRepositionMaxMoveKm(ctx, tenant)
	if run := latestReposition(tenant); !run.stale(clock.AtMs, period, maxKm) {
		return run, nil
	}
	lock := repositionLock(tenant)
	lock.Lock()
	defer lock.Unlock()
	if run := latestReposition(tenant); !run.stale(clock.AtMs, period, maxKm) {
		return run, nil
	}
	if engineMode() != engines.ModeEngine {
		return nil, nil
	}
	run, err := planReposition(ctx, conn, tenant, clock.AtMs, maxKm, getRepositionLookAhead(ctx, tenant))
	if err != nil {
		return nil, err
	}
	repositionMu.Lock()
	repositionRuns[tenant] = run
	repositionMu.Unlock()
	return run, nil
}

// idleAgent: free, on shift, with a position.
type idleAgent struct {
	ID       string
	ZoneID   string
	Lat, Lon float64
}

// repositionIdle: by the board's own source.
func repositionIdle(ctx context.Context, conn *tenancy.Connection, tenant string, atMs int64) ([]idleAgent, error) {
	if dispatchFromFeeds() {
		f := feedSource
		states, err := f.agents(ctx, tenant)
		if err != nil {
			return nil, err
		}
		if states, err = f.withAssignmentFacts(ctx, tenant, atMs, states); err != nil {
			return nil, err
		}
		return idleFromFeeds(states, atMs), nil
	}
	seed, err := fixtures.Seed()
	if err != nil {
		return nil, err
	}
	states, err := synthetic.AllAgentStatesAt(seed, isoAtMs(atMs))
	if err != nil {
		return nil, err
	}
	index, err := dispatchFieldAgentIndex(ctx, conn, tenant)
	if err != nil {
		return nil, err
	}
	var out []idleAgent
	for _, s := range states {
		if k, ok := index[s.AgentID]; ok && k.Agent.Kind == "field" && s.Status == "available" && s.CurrentCaseID == nil && s.ZoneID != "" {
			out = append(out, idleAgent{ID: s.AgentID, ZoneID: s.ZoneID, Lat: s.Latitude, Lon: s.Longitude})
		}
	}
	return out, nil
}

// idleFromFeeds: rosters bind once any covers now.
func idleFromFeeds(states []liveAgent, atMs int64) []idleAgent {
	rostered := false
	for _, s := range states {
		if s.ShiftEnd != nil {
			rostered = true
			break
		}
	}
	since := timeFromMs(atMs).Add(-repositionStaleSeconds * time.Second)
	var out []idleAgent
	for _, s := range states {
		if s.Kind != "field" || s.Status != "available" || s.Open != nil || s.ZoneID == nil || s.Lat == nil || s.Lon == nil {
			continue
		}
		if (rostered && s.ShiftEnd == nil) || s.At.Before(since) {
			continue
		}
		out = append(out, idleAgent{ID: s.ID, ZoneID: *s.ZoneID, Lat: *s.Lat, Lon: *s.Lon})
	}
	return out
}

// demandCell: expected field cases at a point.
type demandCell struct {
	Lat      float64 `json:"latitude"`
	Lon      float64 `json:"longitude"`
	Expected float64 `json:"expected_cases"`
}

// repositionForecastDay: today, weekday, or first.
func repositionForecastDay(values []EngineValue, now time.Time) (string, bool) {
	dates := map[string]bool{}
	first := ""
	for _, v := range values {
		if len(v.IntervalStart) < 10 {
			continue
		}
		t, err := time.Parse(time.RFC3339, v.IntervalStart)
		if err != nil {
			continue
		}
		d := t.In(riyadhZone).Format("2006-01-02")
		dates[d] = true
		if first == "" || d < first {
			first = d
		}
	}
	if first == "" {
		return "", false
	}
	today := now.In(riyadhZone).Format("2006-01-02")
	if dates[today] {
		return today, true
	}
	keys := make([]string, 0, len(dates))
	for d := range dates {
		keys = append(keys, d)
	}
	sort.Strings(keys)
	for _, d := range keys {
		if t, err := time.ParseInLocation("2006-01-02", d, riyadhZone); err == nil && t.Weekday() == now.In(riyadhZone).Weekday() {
			return d, true
		}
	}
	return first, true
}

// repositionDemand: field cases per cell, by zone.
func repositionDemand(doc *ForecasterEngineOutput, kept *keptLocations, subs map[string]SubZone, now time.Time, hours int) map[string][]demandCell {
	out := map[string][]demandCell{}
	if doc == nil {
		return out
	}
	day, ok := repositionForecastDay(doc.Values, now)
	if !ok {
		return out
	}
	local := now.In(riyadhZone)
	base, err := time.ParseInLocation("2006-01-02", day, riyadhZone)
	if err != nil {
		return out
	}
	from := base.Add(time.Duration(local.Hour())*time.Hour + time.Duration(local.Minute())*time.Minute)
	to := from.Add(time.Duration(hours) * time.Hour)
	type key struct{ zone, cell string }
	sums := map[key]*demandCell{}
	order := []key{}
	add := func(k key, lat, lon, v float64) {
		if v <= 0 {
			return
		}
		c, ok := sums[k]
		if !ok {
			c = &demandCell{Lat: lat, Lon: lon}
			sums[k] = c
			order = append(order, k)
		}
		c.Expected += v
	}
	boxes := map[string]*geocell.Box{}
	for _, v := range doc.Values {
		t, err := time.Parse(time.RFC3339, v.IntervalStart)
		if err != nil || t.Before(from) || !t.Before(to) || v.FieldExpected <= 0 {
			continue
		}
		lt := t.In(riyadhZone)
		spread := false
		if kept != nil {
			if sz, ok := kept.SubZones[v.SubZoneID]; ok {
				probs := sz.Groups[groupKey(lt.Hour(), dayGroups[lt.Weekday()])]
				for i, p := range probs {
					if p <= 0 || i >= len(sz.Cells) {
						continue
					}
					b, ok := boxes[sz.Cells[i]]
					if !ok {
						if d, err := geocell.Decode(sz.Cells[i]); err == nil {
							b = &d
						}
						boxes[sz.Cells[i]] = b
					}
					if b == nil {
						continue
					}
					add(key{v.ZoneID, sz.Cells[i]}, (b.South+b.North)/2, (b.West+b.East)/2, v.FieldExpected*p)
					spread = true
				}
			}
		}
		if s, ok := subs[v.SubZoneID]; !spread && ok && !(s.Latitude == 0 && s.Longitude == 0) {
			add(key{v.ZoneID, "sub:" + s.ID}, s.Latitude, s.Longitude, v.FieldExpected)
		}
	}
	for _, k := range order {
		c := sums[k]
		c.Expected = math.Round(c.Expected*10000) / 10000
		if c.Expected > 0 && len(out[k.zone]) < repositionMaxCells {
			out[k.zone] = append(out[k.zone], *c)
		}
	}
	return out
}

// repositionAnswer: the engine contract's output.
type repositionAnswer struct {
	ModelVersion string `json:"model_version"`
	DataSource   string `json:"data_source"`
	ZoneID       string `json:"zone_id"`
	WaitingSpots []struct {
		AgentID    string  `json:"agent_id"`
		Latitude   float64 `json:"latitude"`
		Longitude  float64 `json:"longitude"`
		MoveKm     float64 `json:"move_km"`
		ReasonCode string  `json:"reason_code"`
	} `json:"waiting_spots"`
}

// planReposition asks the engine, zone by zone.
func planReposition(ctx context.Context, conn *tenancy.Connection, tenant string, atMs int64, maxKm float64, hours int) (*repositionRun, error) {
	now := timeFromMs(atMs)
	run := &repositionRun{clockMs: atMs, maxKm: maxKm, items: []WaitingSpot{}}
	idle, err := repositionIdle(ctx, conn, tenant, atMs)
	if err != nil {
		return nil, err
	}
	if len(idle) == 0 {
		return run, nil
	}
	doc, err := readForecasterOutput(ctx, tenant)
	if err != nil {
		return nil, err
	}
	var kept *keptLocations
	if body, err := engineAnswerData.latest(ctx, tenant, locationAnswers); err == nil && body != nil {
		var k keptLocations
		if json.Unmarshal(body, &k) == nil {
			kept = &k
		}
	}
	subList, err := allSubZones(ctx, conn, tenant)
	if err != nil {
		return nil, err
	}
	subs := map[string]SubZone{}
	for _, s := range subList {
		subs[s.ID] = s
	}
	zoneList, err := allZones(ctx, conn, tenant)
	if err != nil {
		return nil, err
	}
	demand := repositionDemand(doc, kept, subs, now, hours)
	dataSource := "SYNTHETIC"
	if doc != nil && doc.DataSource != "" {
		dataSource = doc.DataSource
	}
	run.dataSource = dataSource
	byZone := map[string][]idleAgent{}
	for _, s := range idle {
		byZone[s.ZoneID] = append(byZone[s.ZoneID], s)
	}
	for _, z := range zoneList {
		group, cells := byZone[z.ID], demand[z.ID]
		if !z.IsActive || len(group) == 0 || len(cells) == 0 || atPrayer(ctx, tenant, z.CityID, now) {
			continue
		}
		if len(group) > repositionMaxIdle {
			group = group[:repositionMaxIdle]
		}
		ans, err := askReposition(ctx, tenant, z.ID, now, dataSource, maxKm, hours, group, cells)
		if err != nil {
			log.Printf("reposition: zone %s gave no answer: %v", z.ID, err)
			continue
		}
		run.model = ans.ModelVersion
		for _, w := range ans.WaitingSpots {
			run.items = append(run.items, WaitingSpot{AgentID: w.AgentID, ZoneID: z.ID, Latitude: w.Latitude, Longitude: w.Longitude, MoveKm: w.MoveKm, ReasonCode: w.ReasonCode})
		}
	}
	return run, nil
}

// atPrayer: inside the zone city's prayer window.
func atPrayer(ctx context.Context, tenant, cityID string, now time.Time) bool {
	w := assignmentPrayerWindow(ctx, Case{TenantID: tenant, CityID: cityID}, now)
	if w == nil {
		return false
	}
	start, err := time.Parse(time.RFC3339, w["starts_at"])
	return err == nil && !now.Before(start)
}

var errRepositionAnswer = errors.New("reposition: answer does not match the request")

// askReposition: one zone, answer checked.
func askReposition(ctx context.Context, tenant, zoneID string, now time.Time, dataSource string, maxKm float64, hours int, group []idleAgent, cells []demandCell) (repositionAnswer, error) {
	var ans repositionAnswer
	idle := make([]map[string]any, 0, len(group))
	asked := map[string]bool{}
	for _, s := range group {
		idle = append(idle, map[string]any{"agent_id": s.ID, "latitude": s.Lat, "longitude": s.Lon})
		asked[s.ID] = true
	}
	at := datactx.ToRiyadhISO(now)
	body, err := json.Marshal(map[string]any{
		"schema_version": "1.0", "request_id": datactx.NewID(), "requested_at": datactx.ToRiyadhISO(time.Now()), "data_source": dataSource,
		"input_data_sources": []string{dataSource}, "now": at, "zone_id": zoneID,
		"settings":    map[string]any{"max_move_km": maxKm, "look_ahead_hours": hours},
		"idle_agents": idle, "demand_cells": cells,
	})
	if err != nil {
		return ans, err
	}
	g, err := repositionGuard(tenant)
	if err != nil {
		return ans, err
	}
	out, err := g.Call(tenancy.Detach(ctx), body)
	if err != nil {
		return ans, err
	}
	if err := json.Unmarshal(out, &ans); err != nil {
		return ans, fmt.Errorf("%w: %v", engines.ErrInvalidResponse, err)
	}
	if ans.ZoneID != zoneID {
		return ans, errRepositionAnswer
	}
	seen := map[string]bool{}
	for _, w := range ans.WaitingSpots {
		if !asked[w.AgentID] || seen[w.AgentID] || !repositionReasons[w.ReasonCode] || w.MoveKm < 0 || w.MoveKm > maxKm+0.01 ||
			w.Latitude < -90 || w.Latitude > 90 || w.Longitude < -180 || w.Longitude > 180 {
			return ans, errRepositionAnswer
		}
		seen[w.AgentID] = true
	}
	return ans, nil
}
