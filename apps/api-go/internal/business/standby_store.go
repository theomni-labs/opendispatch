// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// standbyData is what one standby request reads.
type standbyData struct {
	zones       []standbyZone
	subZones    []standbySubZone
	points      []standbyPoint
	agents      []standbyAgent
	rosters     []standbyRoster
	assignments []standbyAssignment
}

// standbyBackend loads standby data and saves a move.
type standbyBackend interface {
	load(ctx context.Context, tenant, zoneID string) (standbyData, error)
	move(ctx context.Context, tenant string, ids []string, from, to, at string) error
}

var standbyBackendInUse standbyBackend = memoryStandby{}

// UsePostgresStandby reads rosters and their lines from Postgres.
func UsePostgresStandby(conn *tenancy.Connection) { standbyBackendInUse = pgStandby{conn: conn} }

// UseMemoryStandby puts the in-memory store back (tests).
func UseMemoryStandby() { standbyBackendInUse = memoryStandby{} }

type memoryStandby struct{}

func (memoryStandby) load(context.Context, string, string) (standbyData, error) {
	standbyMu.Lock()
	defer standbyMu.Unlock()
	seedStandbyLocked()
	return standbyData{
		zones: append([]standbyZone(nil), zones...), subZones: append([]standbySubZone(nil), subZones...), points: append([]standbyPoint(nil), points...),
		agents: append([]standbyAgent(nil), agents...), rosters: append([]standbyRoster(nil), rosters...), assignments: append([]standbyAssignment(nil), assignments...),
	}, nil
}

func (memoryStandby) move(_ context.Context, _ string, ids []string, _, to, at string) error {
	standbyMu.Lock()
	defer standbyMu.Unlock()
	seedStandbyLocked()
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	for _, a := range append([]standbyAssignment(nil), assignments...) {
		if want[a.ID] {
			dest := to
			a.StandbyPointID, a.UpdatedAt = &dest, at
			upsertAssignmentLocked(a)
		}
	}
	return nil
}

type pgStandby struct{ conn *tenancy.Connection }

func (p pgStandby) load(ctx context.Context, tenant, zoneID string) (standbyData, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (standbyData, error) {
		var d standbyData
		zrows, err := tx.Query(ctx, `SELECT id::text, name_en, latitude, longitude FROM zones WHERE ($1 = '' OR id = NULLIF($1, '')::uuid) ORDER BY created_at, id`, zoneID)
		if err != nil {
			return d, err
		}
		for zrows.Next() {
			var z standbyZone
			if err := zrows.Scan(&z.ID, &z.NameEn, &z.Latitude, &z.Longitude); err != nil {
				zrows.Close()
				return d, err
			}
			d.zones = append(d.zones, z)
		}
		zrows.Close()
		if err := zrows.Err(); err != nil {
			return d, err
		}
		if zoneID == "" {
			return d, nil
		}
		srows, err := tx.Query(ctx, `SELECT id::text, zone_id::text, is_active, COALESCE(latitude, 0), COALESCE(longitude, 0), name_en FROM sub_zones WHERE zone_id = $1::uuid`, zoneID)
		if err != nil {
			return d, err
		}
		for srows.Next() {
			var s standbySubZone
			if err := srows.Scan(&s.ID, &s.ZoneID, &s.IsActive, &s.Latitude, &s.Longitude, &s.NameEn); err != nil {
				srows.Close()
				return d, err
			}
			d.subZones = append(d.subZones, s)
		}
		srows.Close()
		if err := srows.Err(); err != nil {
			return d, err
		}
		prows, err := tx.Query(ctx, `SELECT id::text, zone_id::text, is_active, latitude, longitude, coverage_radius_m, name_en FROM standby_points WHERE zone_id = $1::uuid`, zoneID)
		if err != nil {
			return d, err
		}
		for prows.Next() {
			var s standbyPoint
			if err := prows.Scan(&s.ID, &s.ZoneID, &s.IsActive, &s.Latitude, &s.Longitude, &s.CoverageRadiusM, &s.NameEn); err != nil {
				prows.Close()
				return d, err
			}
			d.points = append(d.points, s)
		}
		prows.Close()
		if err := prows.Err(); err != nil {
			return d, err
		}
		vrows, err := tx.Query(ctx, `SELECT id::text, home_zone_id::text, kind, is_active, extra->>'standby_point_id' FROM agents
			WHERE home_zone_id = $1::uuid AND kind = 'field' AND is_active`, zoneID)
		if err != nil {
			return d, err
		}
		for vrows.Next() {
			var s standbyAgent
			if err := vrows.Scan(&s.ID, &s.HomeZoneID, &s.Kind, &s.IsActive, &s.DefaultStandbyPointID); err != nil {
				vrows.Close()
				return d, err
			}
			d.agents = append(d.agents, s)
		}
		vrows.Close()
		if err := vrows.Err(); err != nil {
			return d, err
		}
		rrows, err := tx.Query(ctx, `SELECT id::text, zone_id::text, to_char(roster_date, 'YYYY-MM-DD'), status, created_at FROM rosters WHERE zone_id = $1::uuid`, zoneID)
		if err != nil {
			return d, err
		}
		for rrows.Next() {
			var r standbyRoster
			var created time.Time
			if err := rrows.Scan(&r.ID, &r.ZoneID, &r.RosterDate, &r.Status, &created); err != nil {
				rrows.Close()
				return d, err
			}
			r.CreatedAt = datactx.ToRiyadhISO(created)
			d.rosters = append(d.rosters, r)
		}
		rrows.Close()
		if err := rrows.Err(); err != nil {
			return d, err
		}
		arows, err := tx.Query(ctx, `SELECT id::text, roster_id::text, zone_id::text, start_at, end_at, break_start_at, break_end_at, standby_point_id::text,
				to_char(roster_date, 'YYYY-MM-DD'), updated_at FROM roster_assignments WHERE zone_id = $1::uuid`, zoneID)
		if err != nil {
			return d, err
		}
		defer arows.Close()
		for arows.Next() {
			var a standbyAssignment
			var start, end, updated time.Time
			var brkStart, brkEnd *time.Time
			if err := arows.Scan(&a.ID, &a.RosterID, &a.ZoneID, &start, &end, &brkStart, &brkEnd, &a.StandbyPointID, &a.RosterDate, &updated); err != nil {
				return d, err
			}
			a.StartAt, a.EndAt, a.UpdatedAt = datactx.ToRiyadhISO(start), datactx.ToRiyadhISO(end), datactx.ToRiyadhISO(updated)
			a.BreakStartAt, a.BreakEndAt = nullableTimeToISO(brkStart), nullableTimeToISO(brkEnd)
			d.assignments = append(d.assignments, a)
		}
		return d, arows.Err()
	})
}

func (p pgStandby) move(ctx context.Context, tenant string, ids []string, from, to, at string) error {
	updated, err := parseTime(at)
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		tag, err := tx.Exec(ctx, `UPDATE roster_assignments SET standby_point_id = $3::uuid, updated_at = $4
			WHERE id = ANY($1::uuid[]) AND standby_point_id = $2::uuid`, ids, from, to, updated)
		if err != nil {
			return struct{}{}, err
		}
		if int(tag.RowsAffected()) != len(ids) {
			return struct{}{}, dataerr.Conflict("The roster changed while the move was made; refresh and try again.")
		}
		return struct{}{}, nil
	})
	return err
}

func loadStandby(ctx context.Context, tenant, zoneID string) (standbyData, error) {
	return standbyBackendInUse.load(ctx, tenant, zoneID)
}

func (d standbyData) findZone(id string) *standbyZone {
	for _, z := range d.zones {
		if z.ID == id {
			zone := z
			return &zone
		}
	}
	return nil
}

func (d standbyData) activePoints(zoneID string) []standbyPoint {
	var out []standbyPoint
	for _, p := range d.points {
		if p.ZoneID == zoneID && p.IsActive {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].NameEn != out[j].NameEn {
			return out[i].NameEn < out[j].NameEn
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (d standbyData) subZonesOf(zoneID string) []standbySubZone {
	var out []standbySubZone
	for _, s := range d.subZones {
		if s.ZoneID == zoneID && s.IsActive {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].NameEn != out[j].NameEn {
			return out[i].NameEn < out[j].NameEn
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// coverageOf: the areas and uncovered sub-zones of a zone.
func (d standbyData) coverageOf(ctx reqctx.RequestContext, zoneID string, staff map[string]int) CoverageResult {
	if !reqctx.CanReadZone(ctx, &zoneID) {
		return CoverageResult{Areas: []CoverageArea{}, Uncovered: []string{}}
	}
	subs := d.subZonesOf(zoneID)
	areas := []CoverageArea{}
	for _, p := range d.activePoints(zoneID) {
		areas = append(areas, CoverageArea{
			StandbyPointID: p.ID, Latitude: p.Latitude, Longitude: p.Longitude,
			CoverageRadiusM: p.CoverageRadiusM, RecommendedAgents: staff[p.ID],
			CoveredSubZoneIDs: reach(p, subs),
		})
	}
	covered := map[string]bool{}
	staffedPoints := 0
	for _, a := range areas {
		if a.RecommendedAgents > 0 {
			staffedPoints++
			for _, id := range a.CoveredSubZoneIDs {
				covered[id] = true
			}
		}
	}
	uncovered := []string{}
	for _, s := range subs {
		if !covered[s.ID] {
			uncovered = append(uncovered, s.ID)
		}
	}
	return CoverageResult{Areas: areas, Uncovered: uncovered, StaffedPoints: staffedPoints, SubZoneCount: len(subs)}
}

// currentRoster: newest roster not superseded.
func (d standbyData) currentRoster(zoneID, date string) *standbyRoster {
	var matches []standbyRoster
	for _, r := range d.rosters {
		if r.ZoneID == zoneID && r.RosterDate == date && r.Status != "superseded" {
			matches = append(matches, r)
		}
	}
	if len(matches) == 0 {
		return nil
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].CreatedAt > matches[j].CreatedAt })
	return &matches[0]
}

func (d standbyData) zoneAssignments(rosterID, zoneID string) []standbyAssignment {
	var out []standbyAssignment
	for _, a := range d.assignments {
		if a.RosterID == rosterID && a.ZoneID == zoneID {
			out = append(out, a)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].StartAt != out[j].StartAt {
			return out[i].StartAt < out[j].StartAt
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// staffingOf: the roster and agents per standby point.
func (d standbyData) staffingOf(zoneID, date string) (*standbyRoster, map[string]int) {
	roster := d.currentRoster(zoneID, date)
	if roster != nil {
		rows := d.zoneAssignments(roster.ID, zoneID)
		if len(rows) > 0 {
			return roster, peakStaffByPoint(rows)
		}
	}
	counts := map[string]int{}
	for _, s := range d.agents {
		if s.HomeZoneID != zoneID || s.Kind != "field" || !s.IsActive || s.DefaultStandbyPointID == nil {
			continue
		}
		counts[*s.DefaultStandbyPointID]++
	}
	staff := map[string]int{}
	for point, n := range counts {
		v := int(math.Round(float64(n) / defaultFieldShifts))
		if v < 1 {
			v = 1
		}
		staff[point] = v
	}
	return roster, staff
}

// requireZone: the zone, or not found when out of scope.
func requireZone(cx context.Context, ctx reqctx.RequestContext, zoneID *string) (standbyZone, standbyData, error) {
	if zoneID == nil {
		return standbyZone{}, standbyData{}, dataerr.Invalid("zone_id is required.")
	}
	if _, err := importutil.RequireID(*zoneID, "Zone"); err != nil {
		return standbyZone{}, standbyData{}, err
	}
	d, err := loadStandby(cx, ctx.CustomerID, *zoneID)
	if err != nil {
		return standbyZone{}, standbyData{}, err
	}
	z := d.findZone(*zoneID)
	if z == nil || !reqctx.CanReadZone(ctx, zoneID) {
		return standbyZone{}, standbyData{}, dataerr.NotFound("Zone not found.")
	}
	return *z, d, nil
}
