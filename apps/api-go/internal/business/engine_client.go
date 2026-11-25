// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// ErrNoRequestBuilder means a request for that engine is not built yet.
var ErrNoRequestBuilder = errors.New("engine: no request builder for this engine yet")

var (
	engineMu      sync.Mutex
	engineCfg     = engines.Config{Mode: engines.ModeFixture}
	engineTenants = map[string]*tenantEngines{}
	engineAnswers = map[string]cachedAnswer{}
)

// tenantEngines: per tenant, memory is O(tenants).
type tenantEngines struct {
	guards    map[engines.Name]*engines.Guard
	fallbacks map[engines.Name]int
	models    map[engines.Name]string
}

// tenantState needs engineMu held.
func tenantState(tenant string) *tenantEngines {
	t, ok := engineTenants[tenant]
	if !ok {
		t = &tenantEngines{guards: map[engines.Name]*engines.Guard{}, fallbacks: map[engines.Name]int{}, models: map[engines.Name]string{}}
		engineTenants[tenant] = t
	}
	return t
}

type cachedAnswer struct {
	out     AssignmentEngineOutput
	expires time.Time
}

// UseEngines sets where engine answers come from (fixture is the default).
func UseEngines(cfg engines.Config) {
	engineMu.Lock()
	defer engineMu.Unlock()
	engineCfg = cfg
	engineTenants = map[string]*tenantEngines{}
	engineAnswers = map[string]cachedAnswer{}
	if m, ok := engineAnswerData.(*memoryEngineAnswers); ok {
		m.reset()
	}
	forgetAllForecasterOutputs()
	resetReposition()
}

// UseFixtureEngines puts the committed fixtures back (tests).
func UseFixtureEngines() { UseEngines(engines.Config{Mode: engines.ModeFixture}) }

func engineMode() engines.Mode {
	engineMu.Lock()
	defer engineMu.Unlock()
	return engineCfg.Mode
}

func engineGuard(tenant string, name engines.Name) (*engines.Guard, error) {
	engineMu.Lock()
	defer engineMu.Unlock()
	t := tenantState(tenant)
	if g, ok := t.guards[name]; ok {
		return g, nil
	}
	g, err := engineCfg.Build(name, nil)
	if err != nil {
		return nil, err
	}
	t.guards[name] = g
	return g, nil
}

func countFallback(tenant string, name engines.Name, why error) {
	engineMu.Lock()
	tenantState(tenant).fallbacks[name]++
	engineMu.Unlock()
	log.Printf("engines: %s answered from its fixture instead: %v", name, why)
}

// EngineStatus is one engine's state for a health page.
type EngineStatus struct {
	Name      engines.Name
	Mode      engines.Mode
	Stats     engines.Stats
	Fallbacks int
	Model     string
}

// EngineStatuses lists the four engines for one tenant.
func EngineStatuses(tenant string) []EngineStatus {
	out := make([]EngineStatus, 0, len(engines.All))
	for _, n := range engines.All {
		st := EngineStatus{Name: n, Mode: engineMode()}
		engineMu.Lock()
		if t, ok := engineTenants[tenant]; ok {
			if g, ok := t.guards[n]; ok {
				st.Stats = g.Stats()
			}
			st.Fallbacks = t.fallbacks[n]
			st.Model = t.models[n]
		}
		engineMu.Unlock()
		out = append(out, st)
	}
	return out
}

// engineDocument reads what a batch engine answers. In fixture mode it is the committed fixture, exactly as before. In engine mode
// it is the engine's answer; if the engine cannot answer (or no request can be built yet) the fixture is used and the fallback counted.
func engineDocument(ctx context.Context, tenant string, name engines.Name, fixtureName string, build func() ([]byte, error), into any) (bool, error) {
	if engineMode() != engines.ModeEngine {
		return fixtures.Object(fixtureName, into)
	}
	body, err := callEngine(ctx, tenant, name, build)
	if err == nil {
		if err = json.Unmarshal(body, into); err == nil {
			return true, nil
		}
		err = engines.ErrInvalidResponse
	}
	if !errors.Is(err, ErrNoRequestBuilder) {
		countFallback(tenant, name, err)
	}
	return fixtures.Object(fixtureName, into)
}

func callEngine(ctx context.Context, tenant string, name engines.Name, build func() ([]byte, error)) ([]byte, error) {
	request, err := build()
	if err != nil {
		return nil, err
	}
	g, err := engineGuard(tenant, name)
	if err != nil {
		return nil, err
	}
	body, err := g.Call(context.Background(), request)
	if err == nil {
		noteModel(ctx, tenant, name, body)
	}
	return body, err
}

// noteModel keeps the last model_version seen.
func noteModel(ctx context.Context, tenant string, name engines.Name, body []byte) {
	var doc struct {
		ModelVersion string `json:"model_version"`
	}
	if json.Unmarshal(body, &doc) != nil || doc.ModelVersion == "" {
		return
	}
	// Health shows the champion, not the challenger
	if name == engines.Forecaster && doc.ModelVersion == challengerModel(ctx, tenant) {
		return
	}
	engineMu.Lock()
	tenantState(tenant).models[name] = doc.ModelVersion
	engineMu.Unlock()
}

func noRequestYet() ([]byte, error) { return nil, ErrNoRequestBuilder }

// keepAnswer stores an engine's last good answer.
func keepAnswer(ctx context.Context, tenant string, name engines.Name, scope string, body []byte, merge mergeFn) error {
	if name == engines.Forecaster {
		defer forgetForecasterOutputs(tenant)
	}
	return engineAnswerData.keep(ctx, tenant, name, scope, body, merge)
}

// readKept fills into from the last good answer.
func readKept(ctx context.Context, tenant string, name engines.Name, into any) (bool, error) {
	if engineMode() != engines.ModeEngine {
		return false, nil
	}
	body, err := engineAnswerData.latest(ctx, tenant, name)
	if err != nil || body == nil {
		return false, err
	}
	return json.Unmarshal(body, into) == nil, nil
}

// Reads use the last good answer a job kept; before one, engine mode uses the fixture.
func readForecasterDocument(ctx context.Context, tenant string, into any) (bool, error) {
	return readEngineDocument(ctx, tenant, engines.Forecaster, "forecaster.output", into)
}

func readOptimizerDocument(ctx context.Context, tenant string, into any) (bool, error) {
	return readEngineDocument(ctx, tenant, engines.Optimizer, "optimizer.output", into)
}

func readSimulatorDocument(ctx context.Context, tenant string, into any) (bool, error) {
	return readEngineDocument(ctx, tenant, engines.Simulator, "simulator.output", into)
}

func readEngineDocument(ctx context.Context, tenant string, name engines.Name, fixtureName string, into any) (bool, error) {
	if found, err := readKept(ctx, tenant, name, into); err != nil || found {
		return found, err
	}
	return engineDocument(ctx, tenant, name, fixtureName, noRequestYet, into)
}

// ---- assignment: per case, inside a deadline, never answered from a fixture ----

const (
	assignmentAnswerTTL = 30 * time.Second
	assignmentMaxCalls  = 25
)

type assignmentCandidate struct {
	AgentID    string   `json:"agent_id"`
	Status     string   `json:"status"`
	Latitude   float64  `json:"latitude"`
	Longitude  float64  `json:"longitude"`
	PositionAt string   `json:"position_at"`
	RosterZone *string  `json:"roster_zone_id"`
	Skills     []string `json:"skills"`
	HasVehicle bool     `json:"has_vehicle"`
	ShiftEndAt *string  `json:"shift_end_at,omitempty"`
	BusyUntil  *string  `json:"busy_until,omitempty"`
}

// assignmentRequest is the contract's request for one case and the agents the status feed knows.
func assignmentRequest(c Case, states []liveAgent, atMs int64, stage string, deadline time.Duration, x assignmentExtras) ([]byte, error) {
	now := isoAtMs(atMs)
	cands := make([]assignmentCandidate, 0, len(states))
	for _, s := range states {
		if s.Kind != "field" || s.Lat == nil || s.Lon == nil {
			continue
		}
		cand := assignmentCandidate{AgentID: s.ID, Status: s.Status, Latitude: *s.Lat, Longitude: *s.Lon, PositionAt: datactx.ToRiyadhISO(s.At),
			RosterZone: s.ZoneID, Skills: []string{}, HasVehicle: s.VehicleID != nil}
		if s.ShiftEnd != nil {
			end := datactx.ToRiyadhISO(*s.ShiftEnd)
			cand.ShiftEndAt = &end
		}
		if b := busyUntil(s, atMs, x); b != nil {
			until := datactx.ToRiyadhISO(*b)
			cand.BusyUntil = &until
		}
		cands = append(cands, cand)
	}
	return json.Marshal(map[string]any{
		"schema_version": "1.0", "request_id": datactx.NewID(), "requested_at": now, "data_source": c.DataSource, "input_data_sources": []string{c.DataSource},
		"now": now, "stage": stage, "decision_deadline_ms": int(deadline / time.Millisecond), "top_n": placeholderMaxRanked,
		"case": map[string]any{
			"case_id": c.ID, "registered_at": c.RegisteredAt, "zone_id": c.ZoneID, "latitude": c.Latitude, "longitude": c.Longitude,
			"handling": c.Handling, "required_skills": []string{}, "existing_assignment_id": nil,
		},
		"candidates": cands, "travel_model": x.Travel, "prayer_window": x.Prayer,
	})
}

// noAnswer is what OpenDispatch says when its engine could not: no decision, so the customer's dispatch assigns.
func noAnswer(c Case, atMs int64, deadline time.Duration, err error) AssignmentEngineOutput {
	return AssignmentEngineOutput{
		SchemaVersion: "1.0", RequestID: "engine|" + c.ID, Engine: AssignmentEngineRef{Name: "assignment", Version: "unavailable"}, ModelVersion: "none",
		GeneratedAt: isoAtMs(atMs), DataSource: c.DataSource, Illustrative: true, CaseID: c.ID, Status: "no_eligible_agent",
		DecisionTimeMs: int(deadline/time.Millisecond) + 1, DeadlineExceeded: errors.Is(err, engines.ErrTimeout), Ranking: []AssignmentEngineRanked{},
	}
}

// The engine backlog is 128, so 8 workers are safe.
const (
	assignmentWorkers      = 8
	assignmentBudgetMargin = 250 * time.Millisecond
)

// errAssignmentBudget: the read's budget ran out.
var errAssignmentBudget = fmt.Errorf("assignment budget exceeded: %w", engines.ErrTimeout)

// assignmentFlight is one call in progress.
type assignmentFlight struct {
	done chan struct{}
	out  AssignmentEngineOutput
}

var engineFlights = map[string]*assignmentFlight{}

// beginAssignment: kept answer or flight.
func beginAssignment(ctx context.Context, c Case, states []liveAgent, atMs int64, stage string) (AssignmentEngineOutput, *assignmentFlight) {
	engineMu.Lock()
	defer engineMu.Unlock()
	key := c.TenantID + "|" + c.ID
	if a, ok := engineAnswers[key]; ok && time.Now().Before(a.expires) {
		return a.out, nil
	}
	if f, ok := engineFlights[key]; ok {
		return AssignmentEngineOutput{}, f
	}
	f := &assignmentFlight{done: make(chan struct{})}
	engineFlights[key] = f
	deadline := engineCfg.Deadline(engines.Assignment)
	go runAssignment(tenancy.Detach(ctx), key, f, c, states, atMs, stage, deadline)
	return AssignmentEngineOutput{}, f
}

// runAssignment calls, keeps the answer, ends it.
func runAssignment(ctx context.Context, key string, f *assignmentFlight, c Case, states []liveAgent, atMs int64, stage string, deadline time.Duration) {
	var out AssignmentEngineOutput
	defer func() {
		engineMu.Lock()
		now := time.Now()
		for k, a := range engineAnswers {
			if now.After(a.expires) {
				delete(engineAnswers, k)
			}
		}
		engineAnswers[key] = cachedAnswer{out: out, expires: now.Add(assignmentAnswerTTL)}
		delete(engineFlights, key)
		engineMu.Unlock()
		f.out = out
		close(f.done)
	}()
	out = noAnswer(c, atMs, deadline, engines.ErrInvalidResponse)
	body, err := callEngine(ctx, c.TenantID, engines.Assignment, func() ([]byte, error) {
		return assignmentRequest(c, states, atMs, stage, deadline, assignmentExtrasFor(ctx, c, atMs))
	})
	if err == nil {
		var got AssignmentEngineOutput
		if err = json.Unmarshal(body, &got); err == nil && (got.CaseID != c.ID || (got.Status != "ranked" && got.Status != "no_eligible_agent" && got.Status != "already_assigned")) {
			err = engines.ErrInvalidResponse
		}
		if err == nil {
			out = got
			return
		}
	}
	log.Printf("engines: assignment for case %s gave no answer: %v", c.ID, err)
	out = noAnswer(c, atMs, deadline, err)
}

// engineAssignment asks about one case, no budget.
func engineAssignment(ctx context.Context, c Case, states []liveAgent, atMs int64, stage string) AssignmentEngineOutput {
	out, f := beginAssignment(ctx, c, states, atMs, stage)
	if f == nil {
		return out
	}
	<-f.done
	return f.out
}

// engineAssignments: small pool, one budget.
func engineAssignments(ctx context.Context, cases []Case, states []liveAgent, atMs int64, stage string) map[string]AssignmentEngineOutput {
	outs := make(map[string]AssignmentEngineOutput, len(cases))
	if len(cases) == 0 {
		return outs
	}
	ctx = tenancy.Detach(ctx) // workers run concurrently
	engineMu.Lock()
	deadline := engineCfg.Deadline(engines.Assignment)
	engineMu.Unlock()
	over := make(chan struct{})
	timer := time.AfterFunc(deadline+assignmentBudgetMargin, func() { close(over) })
	defer timer.Stop()
	var (
		mu   sync.Mutex
		wg   sync.WaitGroup
		work = make(chan Case)
	)
	put := func(c Case, out AssignmentEngineOutput) {
		mu.Lock()
		outs[c.ID] = out
		mu.Unlock()
	}
	for i := 0; i < assignmentWorkers && i < len(cases); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for c := range work {
				out, f := beginAssignment(ctx, c, states, atMs, stage)
				if f == nil {
					put(c, out)
					continue
				}
				select {
				case <-f.done:
					put(c, f.out)
				case <-over:
					put(c, noAnswer(c, atMs, deadline, errAssignmentBudget))
				}
			}
		}()
	}
	for _, c := range cases {
		select {
		case work <- c:
		case <-over:
			put(c, noAnswer(c, atMs, deadline, errAssignmentBudget))
		}
	}
	close(work)
	wg.Wait()
	return outs
}
