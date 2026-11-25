// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// dispatchFeedSource reads the board from the feed tables.
type dispatchFeedSource struct {
	conn   *tenancy.Connection
	window time.Duration
	now    func() time.Time
}

var feedSource *dispatchFeedSource

// UseFeedsDispatch makes the board read cases and agents from the feeds.
func UseFeedsDispatch(conn *tenancy.Connection, window time.Duration) {
	feedSource = &dispatchFeedSource{conn: conn, window: window, now: time.Now}
	UsePostgresAssignments(conn)
}

// UseReplayDispatch puts the demo replay back.
func UseReplayDispatch() {
	feedSource = nil
	UseMemoryAssignments()
}

func dispatchFromFeeds() bool { return feedSource != nil }

// liveAgent is one agent as the status feed last saw them.
type liveAgent struct {
	ID        string
	Code      string
	Kind      string
	ZoneID    *string
	VehicleID *string
	Status    string
	Lat, Lon  *float64
	At        time.Time
	// ShiftEnd: published roster line covering now
	ShiftEnd *time.Time
	Open     *openCase
}

// openCase: the case an agent is still on.
type openCase struct {
	AssignedAt time.Time
	ArrivedAt  *time.Time
	Lat, Lon   *float64
}

// withAssignmentFacts: shift ends, open cases
func (f *dispatchFeedSource) withAssignmentFacts(ctx context.Context, tenantID string, nowMs int64, states []liveAgent) ([]liveAgent, error) {
	now := timeFromMs(nowMs)
	type facts struct {
		end  map[string]time.Time
		open map[string]openCase
	}
	got, err := tenancy.WithTenant(ctx, f.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (facts, error) {
		out := facts{end: map[string]time.Time{}, open: map[string]openCase{}}
		rows, err := tx.Query(ctx, `SELECT ra.agent_id::text, max(ra.end_at) FROM roster_assignments ra
			JOIN rosters r ON r.tenant_id = ra.tenant_id AND r.id = ra.roster_id
			WHERE r.status = 'published' AND ra.start_at <= $1 AND ra.end_at > $1 GROUP BY ra.agent_id`, now)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var id string
			var end time.Time
			if err := rows.Scan(&id, &end); err != nil {
				rows.Close()
				return out, err
			}
			out.end[id] = end
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return out, err
		}
		rows, err = tx.Query(ctx, `SELECT DISTINCT ON (agent_id) agent_id::text, assigned_at, arrived_at, latitude, longitude FROM cases
			WHERE registered_at >= $1 AND registered_at <= $2 AND agent_id IS NOT NULL AND assigned_at IS NOT NULL
			AND closed_at IS NULL AND on_scene_completed_at IS NULL ORDER BY agent_id, assigned_at DESC`, now.Add(-f.window), now)
		if err != nil {
			return out, err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var o openCase
			if err := rows.Scan(&id, &o.AssignedAt, &o.ArrivedAt, &o.Lat, &o.Lon); err != nil {
				return out, err
			}
			out.open[id] = o
		}
		return out, rows.Err()
	})
	if err != nil {
		return nil, err
	}
	res := make([]liveAgent, len(states))
	for i, s := range states {
		if end, ok := got.end[s.ID]; ok {
			s.ShiftEnd = &end
		}
		if o, ok := got.open[s.ID]; ok {
			s.Open = &o
		}
		res[i] = s
	}
	return res, nil
}

func (f *dispatchFeedSource) agents(ctx context.Context, tenantID string) ([]liveAgent, error) {
	return tenancy.WithTenant(ctx, f.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]liveAgent, error) {
		rows, err := tx.Query(ctx, `SELECT s.id::text, s.code, s.kind, s.home_zone_id::text, s.default_vehicle_id::text, l.status, l.latitude, l.longitude, l.occurred_at
			FROM agent_live_state l JOIN agents s ON s.tenant_id = l.tenant_id AND s.id = l.agent_id ORDER BY s.code`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []liveAgent
		for rows.Next() {
			var s liveAgent
			if err := rows.Scan(&s.ID, &s.Code, &s.Kind, &s.ZoneID, &s.VehicleID, &s.Status, &s.Lat, &s.Lon, &s.At); err != nil {
				return nil, err
			}
			out = append(out, s)
		}
		return out, rows.Err()
	})
}

// cases are those registered inside the window and not later than now.
func (f *dispatchFeedSource) cases(ctx context.Context, tenantID string, nowMs int64) ([]Case, error) {
	return f.windowCases(ctx, tenantID, nowMs, "", "")
}

// windowCases: window cases, narrowed in SQL.
func (f *dispatchFeedSource) windowCases(ctx context.Context, tenantID string, nowMs int64, and, limit string, args ...any) ([]Case, error) {
	since := timeFromMs(nowMs).Add(-f.window)
	return tenancy.WithTenant(ctx, f.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]Case, error) {
		rows, err := tx.Query(ctx, `SELECT `+caseColumns+` FROM cases WHERE registered_at >= $1 AND registered_at <= $2`+and+` ORDER BY registered_at, id`+limit,
			append([]any{since, timeFromMs(nowMs)}, args...)...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Case
		for rows.Next() {
			c, err := scanCaseRow(rows)
			if err != nil {
				return nil, err
			}
			out = append(out, c)
		}
		return out, rows.Err()
	})
}

// engineWaiting: first unassigned in the window.
func (f *dispatchFeedSource) engineWaiting(ctx context.Context, tenantID string, nowMs int64) ([]Case, error) {
	return f.windowCases(ctx, tenantID, nowMs, " AND assigned_at IS NULL", fmt.Sprintf(" LIMIT %d", assignmentMaxCalls))
}

// dispatchInput is what a board reads, from either source.
type dispatchInput struct {
	Clock   DispatchClock
	Cases   []Case
	Outputs map[string]AssignmentEngineOutput
}

// dispatchInputFor reads the feeds; the replay keeps its own readers.
func dispatchInputFor(ctx context.Context, tenantID string) (dispatchInput, error) {
	f := feedSource
	at := f.now().UnixMilli()
	cases, err := f.cases(ctx, tenantID, at)
	if err != nil {
		return dispatchInput{}, err
	}
	states, err := f.agents(ctx, tenantID)
	if err != nil {
		return dispatchInput{}, err
	}
	outputs := make(map[string]AssignmentEngineOutput, len(cases))
	var waiting []Case
	for _, c := range cases {
		// With an engine on, cases still waiting for a decision go to it (a few per read); the rest keep the baseline.
		if engineMode() == engines.ModeEngine && c.AssignedAt == nil && len(waiting) < assignmentMaxCalls {
			waiting = append(waiting, c)
			continue
		}
		outputs[c.ID] = placeholderRanking(c, states, at)
	}
	if len(waiting) > 0 {
		if states, err = f.withAssignmentFacts(ctx, tenantID, at, states); err != nil {
			return dispatchInput{}, err
		}
	}
	for id, out := range engineAssignments(ctx, waiting, states, at, "shadow") {
		outputs[id] = out
	}
	return dispatchInput{Clock: DispatchClock{Status: "playing", AtMs: at, Speed: 1}, Cases: cases, Outputs: outputs}, nil
}

// dispatchInputOne: the same read, one case.
func dispatchInputOne(ctx context.Context, tenantID, caseID string) (dispatchInput, error) {
	f := feedSource
	at := f.now().UnixMilli()
	var cases []Case
	if canonicalUUID(caseID) {
		var err error
		if cases, err = f.windowCases(ctx, tenantID, at, " AND id = $3::uuid", "", caseID); err != nil {
			return dispatchInput{}, err
		}
	}
	states, err := f.agents(ctx, tenantID)
	if err != nil {
		return dispatchInput{}, err
	}
	var waiting []Case
	if engineMode() == engines.ModeEngine {
		if waiting, err = f.engineWaiting(ctx, tenantID, at); err != nil {
			return dispatchInput{}, err
		}
	}
	outputs := make(map[string]AssignmentEngineOutput, len(cases))
	for _, c := range cases {
		outputs[c.ID] = placeholderRanking(c, states, at)
	}
	if len(waiting) > 0 {
		if states, err = f.withAssignmentFacts(ctx, tenantID, at, states); err != nil {
			return dispatchInput{}, err
		}
	}
	for id, out := range engineAssignments(ctx, waiting, states, at, "shadow") {
		outputs[id] = out
	}
	return dispatchInput{Clock: DispatchClock{Status: "playing", AtMs: at, Speed: 1}, Cases: cases, Outputs: outputs}, nil
}

const (
	placeholderSpeedKmh   = 35.0
	placeholderMaxRanked  = 5
	placeholderDecisionMs = 50
)

func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371.0
	rad := math.Pi / 180
	dLat, dLon := (lat2-lat1)*rad, (lon2-lon1)*rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}

// nearestCand: an available agent, km away.
type nearestCand struct {
	s  *liveAgent
	km float64
}

// nearestAvailable: top n by (km, code), stable.
func nearestAvailable(c Case, states []liveAgent, n int) []nearestCand {
	best := make([]nearestCand, 0, n+1)
	for i := range states {
		s := &states[i]
		if s.Kind != "field" || s.Status != "available" || s.Lat == nil || s.Lon == nil {
			continue
		}
		k := nearestCand{s, haversineKm(c.Latitude, c.Longitude, *s.Lat, *s.Lon)}
		at := len(best)
		for at > 0 && (k.km < best[at-1].km || (k.km == best[at-1].km && k.s.Code < best[at-1].s.Code)) {
			at--
		}
		if at >= n {
			continue
		}
		best = append(best, nearestCand{})
		copy(best[at+1:], best[at:])
		best[at] = k
		if len(best) > n {
			best = best[:n]
		}
	}
	return best
}

// placeholderRanking is the nearest-baseline until the assignment engine exists: the closest available field agent
// by straight line. It says so (illustrative) and is never used to decide without a person or a stage that allows it.
func placeholderRanking(c Case, states []liveAgent, atMs int64) AssignmentEngineOutput {
	out := AssignmentEngineOutput{
		SchemaVersion: "1.0", RequestID: fmt.Sprintf("feeds|%s|%d", c.ID, atMs), Engine: AssignmentEngineRef{Name: "assignment", Version: "0.1.0"},
		ModelVersion: "nearest-baseline-0.1", GeneratedAt: isoAtMs(atMs), DataSource: c.DataSource, Illustrative: true, CaseID: c.ID,
		Status: "no_eligible_agent", DecisionTimeMs: placeholderDecisionMs, Ranking: []AssignmentEngineRanked{},
	}
	if c.Latitude == 0 && c.Longitude == 0 {
		return out
	}
	for i, k := range nearestAvailable(c, states, placeholderMaxRanked) {
		secs := int(math.Max(60, math.Round(k.km/placeholderSpeedKmh*3600)))
		codes := []string{"NEAREST_BY_TRAVEL_TIME", "AVAILABLE_NOW"}
		if k.s.ZoneID != nil && *k.s.ZoneID == c.ZoneID {
			codes = append(codes, "IN_ROSTER_ZONE")
		}
		out.Ranking = append(out.Ranking, AssignmentEngineRanked{
			Rank: i + 1, AgentID: k.s.ID, EstimatedTravelSeconds: secs, EstimatedArrivalAt: isoAtMs(atMs + int64(secs)*1000),
			Score: math.Round(100/(1+k.km)) / 100, ReasonCodes: codes,
			ReasonText: fmt.Sprintf("Closest available agent, about %d minutes away (placeholder ranking).", (secs+59)/60),
		})
	}
	if len(out.Ranking) > 0 {
		out.Status = "ranked"
	}
	return out
}

// feedAgentStatuses maps the live state to the board's rows; current_case_id is the open case an agent holds.
func feedAgentStatuses(rc reqctx.RequestContext, states []liveAgent, cases []Case) []AgentStatus {
	open := map[string]string{}
	for _, c := range cases {
		if c.AgentID != nil && c.AssignedAt != nil && c.ClosedAt == nil {
			open[*c.AgentID] = c.ID
		}
	}
	var out []AgentStatus
	for _, s := range states {
		if s.Kind != "field" || s.Lat == nil || s.Lon == nil {
			continue
		}
		at := datactx.ToRiyadhISO(s.At)
		st := AgentStatus{
			BaseRecord: datactx.SystemRecord(rc, fmt.Sprintf("status|%s", s.ID), at), AgentID: s.ID, Status: s.Status,
			Latitude: *s.Lat, Longitude: *s.Lon, PositionAt: at, ZoneID: s.ZoneID, VehicleID: s.VehicleID,
		}
		if id, ok := open[s.ID]; ok {
			st.CurrentCaseID = &id
		}
		out = append(out, st)
	}
	return out
}

// dispatchCasesAndOutputs is the one place the two sources differ for the case list and the recommendations.
func dispatchCasesAndOutputs(ctx context.Context, tenantID string) ([]Case, map[string]AssignmentEngineOutput, error) {
	if dispatchFromFeeds() {
		in, err := dispatchInputFor(ctx, tenantID)
		return in.Cases, in.Outputs, err
	}
	outputs, err := dispatchEngineOutputs()
	return dispatchReplayCases(), outputs, err
}

// dispatchCasesAndOutputFor: one case output.
func dispatchCasesAndOutputFor(ctx context.Context, tenantID, caseID string) ([]Case, map[string]AssignmentEngineOutput, error) {
	if dispatchFromFeeds() {
		in, err := dispatchInputOne(ctx, tenantID, caseID)
		return in.Cases, in.Outputs, err
	}
	return dispatchCasesAndOutputs(ctx, tenantID)
}

func feedAgentStatusPage(ctx context.Context, rc reqctx.RequestContext, query AgentStatusQuery) (datactx.PageResult[AgentStatus], error) {
	f := feedSource
	states, err := f.agents(ctx, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[AgentStatus]{}, err
	}
	cases, err := f.cases(ctx, rc.CustomerID, f.now().UnixMilli())
	if err != nil {
		return datactx.PageResult[AgentStatus]{}, err
	}
	var rows []AgentStatus
	for _, s := range feedAgentStatuses(rc, states, cases) {
		zone := ""
		if s.ZoneID != nil {
			zone = *s.ZoneID
		}
		if !reqctx.CanReadZone(rc, &zone) || (query.ZoneID != "" && zone != query.ZoneID) || (query.Status != "" && s.Status != query.Status) {
			continue
		}
		rows = append(rows, s)
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// feedPositionPage is the recorded history of one agent, newest last, from the status feed.
func feedPositionPage(ctx context.Context, rc reqctx.RequestContext, agentID string, fromMs, toMs int64, query AgentPositionQuery) (datactx.PageResult[AgentPosition], error) {
	rows, err := tenancy.WithTenant(ctx, feedSource.conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) ([]AgentPosition, error) {
		res, err := tx.Query(ctx, `SELECT occurred_at, latitude, longitude FROM agent_status_history
			WHERE agent_id = $1::uuid AND latitude IS NOT NULL AND longitude IS NOT NULL AND occurred_at >= $2 AND occurred_at <= $3
			ORDER BY occurred_at LIMIT $4`, agentID, timeFromMs(fromMs), timeFromMs(toMs), dispatchHistoryMaxPoints)
		if err != nil {
			return nil, err
		}
		defer res.Close()
		var out []AgentPosition
		for res.Next() {
			var at time.Time
			var lat, lon float64
			if err := res.Scan(&at, &lat, &lon); err != nil {
				return nil, err
			}
			iso := datactx.ToRiyadhISO(at)
			out = append(out, AgentPosition{BaseRecord: datactx.SystemRecord(rc, fmt.Sprintf("position|%s|%s", agentID, iso), iso), AgentID: agentID, RecordedAt: iso, Latitude: lat, Longitude: lon})
		}
		return out, res.Err()
	})
	if err != nil {
		return datactx.PageResult[AgentPosition]{}, err
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}
