// SPDX-License-Identifier: AGPL-3.0-only

// Ports standby.ts + internal/standby-coverage.ts.
// Neither cut over to Postgres in TS, so this stays
// in-memory too, same as the sync demo store. Local
// types below are this module's own; never reuse
// locations.go/people.go's Postgres types.
package business

import (
	"context"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

const moduleStandbyCoverage = access.ModuleOpsStandbyCoverage

const defaultFieldShifts = 3

var movableRosterStatuses = []string{"draft", "rejected"}

// Local, module-private mirrors of the fields this
// module reads, not the real Postgres-backed shape.

type standbyZone struct {
	ID                  string
	NameEn              string
	Latitude, Longitude *float64
}

type standbySubZone struct {
	ID, ZoneID          string
	IsActive            bool
	Latitude, Longitude float64
	NameEn              string
}

type standbyPoint struct {
	ID, ZoneID          string
	IsActive            bool
	Latitude, Longitude float64
	CoverageRadiusM     int
	NameEn              string
}

type standbyAgent struct {
	ID, HomeZoneID, Kind  string
	IsActive              bool
	DefaultStandbyPointID *string
}

type standbyRoster struct {
	ID, ZoneID, RosterDate, Status, CreatedAt string
}

type standbyAssignment struct {
	ID, RosterID, ZoneID     string
	StartAt, EndAt           string
	BreakStartAt, BreakEndAt *string
	StandbyPointID           *string
	RosterDate               string
	UpdatedAt                string
}

var (
	standbyMu     sync.Mutex
	standbySeeded bool
	zones         []standbyZone
	subZones      []standbySubZone
	points        []standbyPoint
	agents        []standbyAgent
	rosters       []standbyRoster
	assignments   []standbyAssignment
)

// ResetStandbyForTest empties every local store.
func ResetStandbyForTest() {
	standbyMu.Lock()
	zones, subZones, points, agents, rosters, assignments = nil, nil, nil, nil, nil, nil
	standbySeeded = true
	standbyMu.Unlock()
}

// ReloadStandbyForTest: back to the fixtures.
func ReloadStandbyForTest() {
	standbyMu.Lock()
	zones, subZones, points, agents, rosters, assignments = nil, nil, nil, nil, nil, nil
	standbySeeded = false
	standbyMu.Unlock()
}

type fxStandbyLocation struct {
	ID              string  `json:"id"`
	ZoneID          string  `json:"zone_id"`
	NameEn          string  `json:"name_en"`
	IsActive        bool    `json:"is_active"`
	Latitude        float64 `json:"latitude"`
	Longitude       float64 `json:"longitude"`
	CoverageRadiusM int     `json:"coverage_radius_m"`
}

type fxStandbyAgent struct {
	ID         string         `json:"id"`
	HomeZoneID string         `json:"home_zone_id"`
	Kind       string         `json:"kind"`
	IsActive   bool           `json:"is_active"`
	Extra      map[string]any `json:"extra"`
}

type fxStandbyRoster struct {
	ID         string `json:"id"`
	ZoneID     string `json:"zone_id"`
	RosterDate string `json:"roster_date"`
	Status     string `json:"status"`
	CreatedAt  string `json:"created_at"`
}

type fxStandbyAssignment struct {
	ID             string  `json:"id"`
	RosterID       string  `json:"roster_id"`
	ZoneID         *string `json:"zone_id"`
	StartAt        string  `json:"start_at"`
	EndAt          string  `json:"end_at"`
	BreakStartAt   *string `json:"break_start_at"`
	BreakEndAt     *string `json:"break_end_at"`
	StandbyPointID *string `json:"standby_point_id"`
	RosterDate     string  `json:"roster_date"`
	UpdatedAt      string  `json:"updated_at"`
}

// seedStandbyLocked loads the fixtures once.
func seedStandbyLocked() {
	if standbySeeded {
		return
	}
	standbySeeded = true
	if rows, err := fixtures.Records[fxStandbyLocation]("Zone"); err == nil {
		for _, r := range rows {
			z := standbyZone{ID: r.ID, NameEn: r.NameEn}
			if r.Latitude != 0 || r.Longitude != 0 {
				lat, lon := r.Latitude, r.Longitude
				z.Latitude, z.Longitude = &lat, &lon
			}
			zones = append(zones, z)
		}
	}
	if rows, err := fixtures.Records[fxStandbyLocation]("SubZone"); err == nil {
		for _, r := range rows {
			subZones = append(subZones, standbySubZone{ID: r.ID, ZoneID: r.ZoneID, IsActive: r.IsActive, Latitude: r.Latitude, Longitude: r.Longitude, NameEn: r.NameEn})
		}
	}
	if rows, err := fixtures.Records[fxStandbyLocation]("StandbyPoint"); err == nil {
		for _, r := range rows {
			points = append(points, standbyPoint{ID: r.ID, ZoneID: r.ZoneID, IsActive: r.IsActive, Latitude: r.Latitude, Longitude: r.Longitude, CoverageRadiusM: r.CoverageRadiusM, NameEn: r.NameEn})
		}
	}
	if rows, err := fixtures.Records[fxStandbyAgent]("Agent"); err == nil {
		for _, r := range rows {
			row := standbyAgent{ID: r.ID, HomeZoneID: r.HomeZoneID, Kind: r.Kind, IsActive: r.IsActive}
			if point, ok := r.Extra["standby_point_id"].(string); ok {
				row.DefaultStandbyPointID = &point
			}
			agents = append(agents, row)
		}
	}
	if rows, err := fixtures.Records[fxStandbyRoster]("Roster"); err == nil {
		for _, r := range rows {
			rosters = append(rosters, standbyRoster{ID: r.ID, ZoneID: r.ZoneID, RosterDate: r.RosterDate, Status: r.Status, CreatedAt: r.CreatedAt})
		}
	}
	if rows, err := fixtures.Records[fxStandbyAssignment]("RosterAssignment"); err == nil {
		for _, r := range rows {
			if r.ZoneID == nil {
				continue
			}
			assignments = append(assignments, standbyAssignment{
				ID: r.ID, RosterID: r.RosterID, ZoneID: *r.ZoneID, StartAt: r.StartAt, EndAt: r.EndAt,
				BreakStartAt: r.BreakStartAt, BreakEndAt: r.BreakEndAt, StandbyPointID: r.StandbyPointID,
				RosterDate: r.RosterDate, UpdatedAt: r.UpdatedAt,
			})
		}
	}
}

// UpsertZoneForTest: local, not locations.go's Zone.
func UpsertZoneForTest(z standbyZone) {
	standbyMu.Lock()
	seedStandbyLocked()
	defer standbyMu.Unlock()
	for i, x := range zones {
		if x.ID == z.ID {
			zones[i] = z
			return
		}
	}
	zones = append(zones, z)
}

// UpsertSubZoneForTest: local to standby.go.
func UpsertSubZoneForTest(s standbySubZone) {
	standbyMu.Lock()
	seedStandbyLocked()
	defer standbyMu.Unlock()
	for i, x := range subZones {
		if x.ID == s.ID {
			subZones[i] = s
			return
		}
	}
	subZones = append(subZones, s)
}

// UpsertStandbyPointForTest: local to standby.go.
func UpsertStandbyPointForTest(p standbyPoint) {
	standbyMu.Lock()
	seedStandbyLocked()
	defer standbyMu.Unlock()
	for i, x := range points {
		if x.ID == p.ID {
			points[i] = p
			return
		}
	}
	points = append(points, p)
}

// UpsertAgentForTest: local to standby.go.
func UpsertAgentForTest(s standbyAgent) {
	standbyMu.Lock()
	seedStandbyLocked()
	defer standbyMu.Unlock()
	for i, x := range agents {
		if x.ID == s.ID {
			agents[i] = s
			return
		}
	}
	agents = append(agents, s)
}

// UpsertRosterForTest: local to standby.go.
func UpsertRosterForTest(r standbyRoster) {
	standbyMu.Lock()
	seedStandbyLocked()
	defer standbyMu.Unlock()
	for i, x := range rosters {
		if x.ID == r.ID {
			rosters[i] = r
			return
		}
	}
	rosters = append(rosters, r)
}

// UpsertRosterAssignmentForTest: local type.
func UpsertRosterAssignmentForTest(a standbyAssignment) {
	standbyMu.Lock()
	seedStandbyLocked()
	defer standbyMu.Unlock()
	upsertAssignmentLocked(a)
}

func upsertAssignmentLocked(a standbyAssignment) {
	for i, x := range assignments {
		if x.ID == a.ID {
			assignments[i] = a
			return
		}
	}
	assignments = append(assignments, a)
}

// distanceMeters mirrors distanceMeters (haversine).
func distanceMeters(lat1, lon1, lat2, lon2 float64) float64 {
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLon := (lon2 - lon1) * rad
	a := math.Pow(math.Sin(dLat/2), 2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Pow(math.Sin(dLon/2), 2)
	return 2 * 6_371_000 * math.Asin(math.Min(1, math.Sqrt(a)))
}

// reach mirrors reach.
func reach(p standbyPoint, subZonesIn []standbySubZone) []string {
	out := []string{}
	for _, s := range subZonesIn {
		if distanceMeters(p.Latitude, p.Longitude, s.Latitude, s.Longitude) <= float64(p.CoverageRadiusM) {
			out = append(out, s.ID)
		}
	}
	return out
}

// CoverageArea mirrors the contract type.
type CoverageArea struct {
	StandbyPointID    string   `json:"standby_point_id"`
	Latitude          float64  `json:"latitude"`
	Longitude         float64  `json:"longitude"`
	CoverageRadiusM   int      `json:"coverage_radius_m"`
	RecommendedAgents int      `json:"recommended_agents"`
	CoveredSubZoneIDs []string `json:"covered_sub_zone_ids"`
	ReachMinutes      *float64 `json:"reach_minutes,omitempty"`
	HomeDistanceKm    *float64 `json:"home_distance_km,omitempty"`
	BeyondDeployLimit *bool    `json:"beyond_deploy_limit,omitempty"`
}

// CoverageResult mirrors CoverageResult.
type CoverageResult struct {
	Areas         []CoverageArea
	Uncovered     []string
	StaffedPoints int
	SubZoneCount  int
}

// coverageOf reads the in-memory points and sub-zones.
func coverageOf(cx context.Context, ctx reqctx.RequestContext, zoneID string, staff map[string]int) CoverageResult {
	d, _ := memoryStandby{}.load(cx, "", zoneID)
	return d.coverageOf(ctx, zoneID, staff)
}

func quarterIndex(iso string, base time.Time) int {
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return 0
	}
	return int(math.Round(t.Sub(base).Seconds() / 900))
}

// peakStaffByPoint mirrors peakStaffByPoint.
func peakStaffByPoint(rows []standbyAssignment) map[string]int {
	quarters := map[string]map[int]int{}
	for _, a := range rows {
		if a.StandbyPointID == nil {
			continue
		}
		base, err := time.Parse(time.RFC3339, a.RosterDate+"T00:00:00+03:00")
		if err != nil {
			continue
		}
		byQuarter, ok := quarters[*a.StandbyPointID]
		if !ok {
			byQuarter = map[int]int{}
		}
		away := map[int]bool{}
		if a.BreakStartAt != nil && a.BreakEndAt != nil {
			for i := quarterIndex(*a.BreakStartAt, base); i < quarterIndex(*a.BreakEndAt, base); i++ {
				away[i] = true
			}
		}
		for i := quarterIndex(a.StartAt, base); i < quarterIndex(a.EndAt, base); i++ {
			if !away[i] {
				byQuarter[i]++
			}
		}
		quarters[*a.StandbyPointID] = byQuarter
	}
	out := map[string]int{}
	for point, byQuarter := range quarters {
		peak := 0
		for _, n := range byQuarter {
			if n > peak {
				peak = n
			}
		}
		out[point] = peak
	}
	return out
}

func validDateString(date string) (string, error) {
	return datactx.Date(datactx.Obj{"date": date}, "date")
}

// requireDay mirrors requireDay.
func requireDay(date *string) (string, error) {
	if date == nil {
		return validDateString("")
	}
	return validDateString(*date)
}

// Coverage mirrors the contract type.
type Coverage struct {
	ZoneID              string         `json:"zone_id"`
	RosterDate          string         `json:"roster_date"`
	RosterID            *string        `json:"roster_id"`
	Areas               []CoverageArea `json:"areas"`
	UncoveredSubZoneIDs []string       `json:"uncovered_sub_zone_ids"`
	ReachShare          *float64       `json:"reach_share,omitempty"`
	MaxDeployDistanceKm *float64       `json:"max_deploy_distance_km,omitempty"`
	Illustrative        bool           `json:"illustrative"`
	DataSource          string         `json:"data_source"`
}

func coverageView(cx context.Context, ctx reqctx.RequestContext, d standbyData, zone standbyZone, date string) Coverage {
	roster, staff := d.staffingOf(zone.ID, date)
	result := d.coverageOf(ctx, zone.ID, staff)
	var rosterID *string
	if roster != nil {
		rosterID = &roster.ID
	}
	view := Coverage{
		ZoneID: zone.ID, RosterDate: date, RosterID: rosterID, Areas: result.Areas,
		UncoveredSubZoneIDs: result.Uncovered, Illustrative: true, DataSource: "SYNTHETIC",
	}
	if !reqctx.CanReadZone(ctx, &zone.ID) {
		return view
	}
	in := newReachInputs(cx, ctx.CustomerID)
	var staffed []standbyPoint
	for i, p := range d.activePoints(zone.ID) {
		if i < len(view.Areas) && view.Areas[i].StandbyPointID == p.ID {
			m := math.Round(in.model.minutesFor(float64(p.CoverageRadiusM))*10) / 10
			view.Areas[i].ReachMinutes = &m
		}
		if staff[p.ID] > 0 {
			staffed = append(staffed, p)
		}
	}
	weights, _ := in.demand(zone.ID, date)
	view.ReachShare = reachShare(d.subZonesOf(zone.ID), staffed, weights, in.radius())
	markDeployDistance(&view, d, zone, getMaxDeployDistanceKm(cx, ctx.CustomerID))
	return view
}

// CoverageQuery mirrors getCoverage's query.
type CoverageQuery struct {
	ZoneID *string
	Date   *string
}

// GetCoverage mirrors getCoverage.
func GetCoverage(ctx reqctx.RequestContext, query CoverageQuery) (Coverage, error) {
	if err := reqctx.RequireAccess(ctx, moduleStandbyCoverage, access.AccessView); err != nil {
		return Coverage{}, err
	}
	zone, data, err := requireZone(context.Background(), ctx, query.ZoneID)
	if err != nil {
		return Coverage{}, err
	}
	date, err := requireDay(query.Date)
	if err != nil {
		return Coverage{}, err
	}
	return coverageView(context.Background(), ctx, data, zone, date), nil
}

// StandbyMove mirrors StandbyMove.
type StandbyMove struct {
	FromStandbyPointID     string   `json:"from_standby_point_id"`
	ToStandbyPointID       string   `json:"to_standby_point_id"`
	Agents                 int      `json:"agents"`
	NewlyCoveredSubZoneIDs []string `json:"newly_covered_sub_zone_ids"`
	ReasonEn               string   `json:"reason_en"`
}

// StandbyMoveRecommendation mirrors the TS type.
type StandbyMoveRecommendation struct {
	ZoneID          string        `json:"zone_id"`
	RosterDate      string        `json:"roster_date"`
	RosterID        *string       `json:"roster_id"`
	Moves           []StandbyMove `json:"moves"`
	UncoveredBefore int           `json:"uncovered_before"`
	UncoveredAfter  int           `json:"uncovered_after"`
	Illustrative    bool          `json:"illustrative"`
	DataSource      string        `json:"data_source"`
}

// RecommendStandbyMoves mirrors the TS function.
func RecommendStandbyMoves(ctx reqctx.RequestContext, query CoverageQuery) (StandbyMoveRecommendation, error) {
	if err := reqctx.RequireAccess(ctx, moduleStandbyCoverage, access.AccessView); err != nil {
		return StandbyMoveRecommendation{}, err
	}
	zone, data, err := requireZone(context.Background(), ctx, query.ZoneID)
	if err != nil {
		return StandbyMoveRecommendation{}, err
	}
	date, err := requireDay(query.Date)
	if err != nil {
		return StandbyMoveRecommendation{}, err
	}
	roster, staff := data.staffingOf(zone.ID, date)
	working := map[string]int{}
	for k, v := range staff {
		working[k] = v
	}
	first := data.coverageOf(ctx, zone.ID, working)
	names := map[string]string{}
	limitKm := getMaxDeployDistanceKm(context.Background(), ctx.CustomerID)
	beyond := map[string]bool{}
	for _, p := range data.activePoints(zone.ID) {
		names[p.ID] = p.NameEn
		beyond[p.ID] = beyondDeployLimit(zone, p, limitKm)
	}
	current := first
	moves := []StandbyMove{}
	for step := 0; step < 3 && len(current.Uncovered) > 0; step++ {
		uncoveredSet := map[string]bool{}
		for _, id := range current.Uncovered {
			uncoveredSet[id] = true
		}
		type target struct {
			area   CoverageArea
			gained []string
		}
		var targets []target
		for _, a := range current.Areas {
			if a.RecommendedAgents != 0 || beyond[a.StandbyPointID] {
				continue
			}
			gained := []string{}
			for _, id := range a.CoveredSubZoneIDs {
				if uncoveredSet[id] {
					gained = append(gained, id)
				}
			}
			if len(gained) > 0 {
				targets = append(targets, target{area: a, gained: gained})
			}
		}
		sort.Slice(targets, func(i, j int) bool {
			if len(targets[i].gained) != len(targets[j].gained) {
				return len(targets[i].gained) > len(targets[j].gained)
			}
			return targets[i].area.StandbyPointID < targets[j].area.StandbyPointID
		})
		var sources []CoverageArea
		for _, a := range current.Areas {
			if a.RecommendedAgents >= 2 {
				sources = append(sources, a)
			}
		}
		sort.Slice(sources, func(i, j int) bool {
			if sources[i].RecommendedAgents != sources[j].RecommendedAgents {
				return sources[i].RecommendedAgents > sources[j].RecommendedAgents
			}
			return sources[i].StandbyPointID < sources[j].StandbyPointID
		})
		if len(sources) == 0 || len(targets) == 0 {
			break
		}
		source := sources[0]
		tgt := targets[0]
		working[source.StandbyPointID]--
		working[tgt.area.StandbyPointID]++
		fromName := names[source.StandbyPointID]
		if fromName == "" {
			fromName = "a busy point"
		}
		toName := names[tgt.area.StandbyPointID]
		if toName == "" {
			toName = "an empty point"
		}
		moves = append(moves, StandbyMove{
			FromStandbyPointID: source.StandbyPointID, ToStandbyPointID: tgt.area.StandbyPointID,
			Agents: 1, NewlyCoveredSubZoneIDs: tgt.gained,
			ReasonEn: fmt.Sprintf("Move 1 agent from %s to %s: %d sub-zone(s) that no staffed standby point reaches.", fromName, toName, len(tgt.gained)),
		})
		current = data.coverageOf(ctx, zone.ID, working)
	}
	var rosterID *string
	if roster != nil {
		rosterID = &roster.ID
	}
	return StandbyMoveRecommendation{
		ZoneID: zone.ID, RosterDate: date, RosterID: rosterID, Moves: moves,
		UncoveredBefore: len(first.Uncovered), UncoveredAfter: len(current.Uncovered),
		Illustrative: true, DataSource: "SYNTHETIC",
	}, nil
}

// ApplyStandbyMove mirrors applyStandbyMove.
func ApplyStandbyMove(ctx reqctx.RequestContext, body any) (Coverage, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleStandbyCoverage}, auditlog.WriteMeta{Action: "standby.moved", EntityType: "roster"}, func(uctx context.Context) (auditlog.AuditedWrite[Coverage], error) {
		o, err := datactx.Object(body, "Standby move", []string{"zone_id", "roster_date", "from_standby_point_id", "to_standby_point_id", "agents"})
		if err != nil {
			return auditlog.AuditedWrite[Coverage]{}, err
		}
		zoneID, err := datactx.UUID(o, "zone_id")
		if err != nil {
			return auditlog.AuditedWrite[Coverage]{}, err
		}
		date, err := datactx.Date(o, "roster_date")
		if err != nil {
			return auditlog.AuditedWrite[Coverage]{}, err
		}
		from, err := datactx.UUID(o, "from_standby_point_id")
		if err != nil {
			return auditlog.AuditedWrite[Coverage]{}, err
		}
		to, err := datactx.UUID(o, "to_standby_point_id")
		if err != nil {
			return auditlog.AuditedWrite[Coverage]{}, err
		}
		count, err := datactx.Int(o, "agents", datactx.NumOpts{Min: 1, Max: 50, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[Coverage]{}, err
		}
		if err := reqctx.RequireWriteZone(ctx, &zoneID); err != nil {
			return auditlog.AuditedWrite[Coverage]{}, err
		}
		zone, data, err := requireZone(uctx, ctx, &zoneID)
		if err != nil {
			return auditlog.AuditedWrite[Coverage]{}, err
		}
		if from == to {
			return auditlog.AuditedWrite[Coverage]{}, dataerr.Invalid("Standby move: choose two different standby points.")
		}
		pointsByID := map[string]standbyPoint{}
		for _, p := range data.activePoints(zone.ID) {
			pointsByID[p.ID] = p
		}
		if _, ok := pointsByID[from]; !ok {
			return auditlog.AuditedWrite[Coverage]{}, dataerr.Invalid("Standby move: both standby points must be active points of the zone.")
		}
		if _, ok := pointsByID[to]; !ok {
			return auditlog.AuditedWrite[Coverage]{}, dataerr.Invalid("Standby move: both standby points must be active points of the zone.")
		}
		if limitKm := getMaxDeployDistanceKm(uctx, ctx.CustomerID); beyondDeployLimit(zone, pointsByID[to], limitKm) {
			return auditlog.AuditedWrite[Coverage]{}, deployLimitErr(zone, pointsByID[to], limitKm)
		}
		roster := data.currentRoster(zone.ID, date)
		if roster == nil {
			return auditlog.AuditedWrite[Coverage]{}, dataerr.NotFound(fmt.Sprintf("A roster for %s on %s not found.", zone.NameEn, date))
		}
		movable := false
		for _, s := range movableRosterStatuses {
			if roster.Status == s {
				movable = true
			}
		}
		if !movable {
			return auditlog.AuditedWrite[Coverage]{}, dataerr.Conflict(fmt.Sprintf("The roster is %s; standby points can only be moved while it is a draft.", roster.Status))
		}
		var waiting []standbyAssignment
		for _, a := range data.zoneAssignments(roster.ID, zone.ID) {
			if a.StandbyPointID != nil && *a.StandbyPointID == from {
				waiting = append(waiting, a)
			}
		}
		if len(waiting) < count {
			return auditlog.AuditedWrite[Coverage]{}, dataerr.Conflict(fmt.Sprintf("Only %d agent(s) wait at that standby point.", len(waiting)))
		}
		at := datactx.NowISO()
		moved := make([]string, count)
		for i := 0; i < count; i++ {
			moved[i] = waiting[i].ID
		}
		if err := standbyBackendInUse.move(uctx, ctx.CustomerID, moved, from, to, at); err != nil {
			return auditlog.AuditedWrite[Coverage]{}, err
		}
		after, err := loadStandby(uctx, ctx.CustomerID, zone.ID)
		if err != nil {
			return auditlog.AuditedWrite[Coverage]{}, err
		}
		fromName := pointsByID[from].NameEn
		toName := pointsByID[to].NameEn
		id := roster.ID
		return auditlog.AuditedWrite[Coverage]{
			Result: coverageView(uctx, ctx, after, zone, date), EntityID: &id,
			SummaryEn: fmt.Sprintf("%d agent(s) of %s on %s moved from %s to %s.", count, zone.NameEn, date, fromName, toName),
			Detail:    map[string]any{"zone_id": zone.ID, "roster_date": date, "from_standby_point_id": from, "to_standby_point_id": to, "agents": count},
		}, nil
	})
}
