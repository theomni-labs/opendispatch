// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// engineScenarioCaseCap bounds a request.
const engineScenarioCaseCap = 10000

// scenarioSeed orders cases for thin and flip.
const scenarioSeed = 1

// unsupportedAdjustments: changes it cannot take.
func unsupportedAdjustments(s Scenario) []OptimizerViolation {
	var out []OptimizerViolation
	for _, d := range s.Adjustments.HeadcountDelta {
		zone := d.ZoneID
		if d.RemoteAgents != 0 {
			out = append(out, OptimizerViolation{Code: "unsupported_adjustment", ZoneID: &zone,
				Message: "Remote agent change not applied: the simulator replays field cases only."})
		}
		if d.Vehicles != 0 {
			out = append(out, OptimizerViolation{Code: "unsupported_adjustment", ZoneID: &zone,
				Message: "Vehicle change not applied: the simulator request carries no vehicles."})
		}
	}
	return out
}

func caseRank(id string) uint64 {
	h := fnv.New64a()
	_, _ = fmt.Fprintf(h, "%d:%s", scenarioSeed, id)
	return h.Sum64()
}

// rankedIndexes: positions by seeded hash, lowest first.
func rankedIndexes(cases []simDayCase, keep func(simDayCase) bool) []int {
	var idx []int
	for i, c := range cases {
		if keep(c) {
			idx = append(idx, i)
		}
	}
	sort.SliceStable(idx, func(a, b int) bool {
		ra, rb := caseRank(cases[idx[a]].ID), caseRank(cases[idx[b]].ID)
		if ra != rb {
			return ra < rb
		}
		return cases[idx[a]].ID < cases[idx[b]].ID
	})
	return idx
}

// thinCases keeps n cases, chosen by seeded hash.
func thinCases(cases []simDayCase, n int) []simDayCase {
	if len(cases) <= n {
		return cases
	}
	keep := map[int]bool{}
	for _, i := range rankedIndexes(cases, func(simDayCase) bool { return true })[:n] {
		keep[i] = true
	}
	out := make([]simDayCase, 0, n)
	for i, c := range cases {
		if keep[i] {
			out = append(out, c)
		}
	}
	return out
}

// applyRemoteShare sets each zone's remote share.
func applyRemoteShare(cases []simDayCase, share float64) ([]simDayCase, int) {
	out := append([]simDayCase(nil), cases...)
	zones := map[string]bool{}
	for _, c := range out {
		zones[c.ZoneID] = true
	}
	flipped := 0
	for zone := range zones {
		inZone := func(c simDayCase) bool { return c.ZoneID == zone }
		total, field := 0, 0
		for _, c := range out {
			if inZone(c) {
				total++
				if c.Handling == "field" {
					field++
				}
			}
		}
		target := int(float64(total)*(1-share) + 0.5)
		from, to, n := "field", "remote_inferred", field-target
		if target > field {
			from, to, n = "remote_inferred", "field", target-field
		}
		for _, i := range rankedIndexes(out, func(c simDayCase) bool { return inZone(c) && c.Handling == from }) {
			if n <= 0 {
				break
			}
			out[i].Handling = to
			n--
			flipped++
		}
	}
	return out, flipped
}

// scenarioCaseDay: last earlier day, same weekday.
func scenarioCaseDay(ctx context.Context, conn *tenancy.Connection, tenant string, zoneIDs []string, base string) string {
	from, err := riyadhMidnight(base)
	if err != nil {
		return historyDayFor(base)
	}
	day, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (string, error) {
		var d *time.Time
		err := tx.QueryRow(ctx, `SELECT max(d) FROM (SELECT DISTINCT (registered_at AT TIME ZONE 'Asia/Riyadh')::date AS d FROM cases
			WHERE zone_id = ANY($1::uuid[]) AND latitude IS NOT NULL AND registered_at >= $2 AND registered_at < $3) x
			WHERE extract(dow FROM d) = extract(dow FROM $4::date)`, zoneIDs, from.AddDate(0, 0, -120), from, base).Scan(&d)
		if err != nil || d == nil {
			return "", err
		}
		return d.Format("2006-01-02"), nil
	})
	if err != nil || day == "" {
		return historyDayFor(base)
	}
	return day
}

// scenarioDayCases: zone cases moved onto the base.
func scenarioDayCases(ctx context.Context, conn *tenancy.Connection, tenant string, zoneIDs []string, runDate, base string) ([]simDayCase, int, error) {
	var all []simDayCase
	dropped := 0
	for _, zid := range zoneIDs {
		rows, cut, err := loadDayCases(ctx, conn, tenant, zid, runDate)
		if err != nil {
			return nil, 0, fmt.Errorf("load cases: %w", err)
		}
		all, dropped = append(all, rows...), dropped+cut
	}
	all, err := shiftDayCases(all, runDate, base)
	if err != nil {
		return nil, 0, fmt.Errorf("%w: %v", ErrEngineInput, err)
	}
	thinned := thinCases(all, engineScenarioCaseCap)
	return thinned, dropped + len(all) - len(thinned), nil
}

// scenarioSimSource: one simulator question.
func scenarioSimSource(ctx context.Context, rc reqctx.RequestContext, plan *PlanReader, plans []ScenarioZonePlan, cases []simDayCase, ref, policy string) simulatorSource {
	s := simulatorSource{Now: time.Now(), ClockStart: getClockStart(ctx, rc.CustomerID), ThresholdSeconds: getTenMinuteThresholdSeconds(ctx, rc.CustomerID),
		Policy: policy, Cases: cases, RosterRef: ref, Points: plan.Points, Travel: travelPtr(ctx, rc.CustomerID)}
	for _, p := range plans {
		s.Lines = append(s.Lines, p.Lines...)
	}
	for _, c := range cases {
		s.Sources = append(s.Sources, c.DataSource)
	}
	return s
}

// askScenarioSimulator sends and checks one request.
func askScenarioSimulator(ctx context.Context, rc reqctx.RequestContext, src simulatorSource) ([]byte, simEngineAnswer, error) {
	var answer simEngineAnswer
	request, err := buildSimulatorRequest(src)
	body, err := askEngine(ctx, rc, engines.Simulator, request, err)
	if err != nil {
		return nil, answer, err
	}
	if err = checkAnswerHeader(engines.Simulator, body); err == nil {
		body = stampProvenance(engines.Simulator, body, src.Sources)
		if json.Unmarshal(body, &answer) != nil {
			err = fmt.Errorf("%w: zones", ErrEngineAnswer)
		}
	}
	if err != nil {
		auditEngineFailure(rc, engines.Simulator, err)
		return nil, answer, err
	}
	return body, answer, nil
}

func keepSimulatorAnswer(ctx context.Context, rc reqctx.RequestContext, scope string, body []byte) error {
	merge := func(prev, next []byte) []byte { return mergeKept(prev, next, "zones", "zone_id") }
	return keepAnswer(ctx, rc.CustomerID, engines.Simulator, scope, body, merge)
}

// overallShares: both readings, all zones.
func overallShares(rows []ZoneServiceLevel) (registration, assignment Reading) {
	var rw, rc, aw, ac int
	for _, r := range rows {
		rw, rc = rw+r.FromRegistration.WithinCount, rc+r.FromRegistration.CaseCount
		aw, ac = aw+r.FromAssignment.WithinCount, ac+r.FromAssignment.CaseCount
	}
	return simReading(rw, rc), simReading(aw, ac)
}

func shareOrNil(r Reading) any {
	if r.Share == nil {
		return nil
	}
	return *r.Share
}

// scenarioFatal: our failure, not the engine's.
type scenarioFatal struct{ error }

// askScenarioBoth: baseline, then scenario.
func askScenarioBoth(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, plan *PlanReader, scenario Scenario, plans []ScenarioZonePlan, runDate, policy string) (before, after simEngineAnswer, bodies [2][]byte, flipped, dropped int, err error) {
	cases, dropped, err := scenarioDayCases(ctx, conn, rc.CustomerID, scenario.ZoneIDs, runDate, scenario.BaseDate)
	if err != nil {
		if !errors.Is(err, ErrEngineInput) {
			err = scenarioFatal{err}
		}
		return
	}
	baseline := scenario
	baseline.Adjustments = ScenarioAdjustments{}
	basePlans, perr := planScenarioZones(ctx, rc, plan, &baseline, "", nil)
	if perr != nil {
		err = scenarioFatal{perr}
		return
	}
	adjusted := cases
	if scenario.Adjustments.RemoteShare != nil {
		adjusted, flipped = applyRemoteShare(cases, *scenario.Adjustments.RemoteShare)
	}
	bodies[0], before, err = askScenarioSimulator(ctx, rc, scenarioSimSource(ctx, rc, plan, basePlans, cases, "scenario:"+scenario.ID+":before", policy))
	if err == nil {
		bodies[1], after, err = askScenarioSimulator(ctx, rc, scenarioSimSource(ctx, rc, plan, plans, adjusted, "scenario:"+scenario.ID, policy))
	}
	return
}

// remoteNotSimulated: the pool change, once.
func remoteNotSimulated(s Scenario) []OptimizerViolation {
	n := remotePoolDelta(s)
	if n == 0 {
		return nil
	}
	return []OptimizerViolation{{Code: "unsupported_adjustment",
		Message: fmt.Sprintf("Remote agent change (%+d, the remote pool) planned by the optimizer only: the simulator replays field cases only.", n)}}
}

// scenarioRoster: the optimizer's roster, or the re-plan.
func scenarioRoster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, plan *PlanReader, scenario Scenario) ([]ScenarioZonePlan, OptimizerEngineOutput, map[string][]RosterAssignment, [][]byte, error) {
	var lines map[string][]RosterAssignment
	var docs []*optimizerOutputDoc
	var bodies [][]byte
	var askErr error
	if hasHeadcount(scenario) {
		lines, docs, bodies, askErr = askScenarioOptimizer(ctx, conn, rc, plan, scenario)
		var fatal scenarioFatal
		if errors.As(askErr, &fatal) {
			return nil, OptimizerEngineOutput{}, nil, nil, fatal.error
		}
	}
	plans, err := planScenarioZones(ctx, rc, plan, &scenario, "", lines)
	if err != nil {
		return nil, OptimizerEngineOutput{}, nil, nil, err
	}
	doc, err := optimizerDocument(ctx, scenario, plans)
	if err != nil {
		return nil, OptimizerEngineOutput{}, nil, nil, err
	}
	switch {
	case lines != nil:
		doc = withAnswers(doc, docs)
		doc.Violations = append(doc.Violations, remoteNotSimulated(scenario)...)
	case askErr != nil:
		doc.Violations = append(append(doc.Violations, optimizerFallback(askErr)), unsupportedAdjustments(scenario)...)
	default:
		doc.Violations = append(doc.Violations, unsupportedAdjustments(scenario)...)
	}
	return plans, doc, lines, bodies, nil
}

// rosterNote: where the scenario roster came from.
func rosterNote(doc OptimizerEngineOutput, lines map[string][]RosterAssignment) (string, string) {
	if lines != nil {
		return "optimizer", fmt.Sprintf(" Roster from the optimizer %s.", doc.ModelVersion)
	}
	for _, v := range doc.Violations {
		if v.Code == "optimizer_unavailable" {
			return "fallback", " " + v.Message
		}
	}
	return "re-plan", ""
}

// runEngineScenario: two simulator runs, one seed.
func runEngineScenario(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, plan *PlanReader, scenario Scenario) (auditlog.AuditedWrite[ScenarioRunResult], error) {
	plans, optimizer, engineLines, answers, err := scenarioRoster(ctx, conn, rc, plan, scenario)
	if err != nil {
		return auditlog.AuditedWrite[ScenarioRunResult]{}, err
	}
	policy := "nearest"
	clockStart, threshold := getClockStart(ctx, rc.CustomerID), getTenMinuteThresholdSeconds(ctx, rc.CustomerID)
	runDate := scenarioCaseDay(ctx, conn, rc.CustomerID, scenario.ZoneIDs, scenario.BaseDate)

	var before, after simEngineAnswer
	var bodies [2][]byte
	var flipped, dropped int
	if runDate == "" {
		err = inputErr("no earlier day with cases")
		auditEngineFailure(rc, engines.Simulator, err)
	} else {
		before, after, bodies, flipped, dropped, err = askScenarioBoth(ctx, conn, rc, plan, scenario, plans, runDate, policy)
		var fatal scenarioFatal
		if errors.As(err, &fatal) {
			return auditlog.AuditedWrite[ScenarioRunResult]{}, fatal.error
		}
	}
	if err == nil {
		if err = keepSimulatorAnswer(ctx, rc, "scenario:"+scenario.ID, bodies[1]); err == nil {
			err = keepSimulatorAnswer(ctx, rc, "scenario:"+scenario.ID+":before", bodies[0])
		}
		if err != nil {
			return auditlog.AuditedWrite[ScenarioRunResult]{}, err
		}
	}

	at := datactx.NowISO()
	finished := scenario
	finished.LastRunAt, finished.UpdatedAt = &at, at
	input := SimulationRunInput{ID: datactx.DeterministicUUID("scenario-simulation:" + scenario.ID), ScenarioID: &scenario.ID, RunDate: runDate,
		AssignmentPolicy: policy, PrimaryClockStart: clockStart, ThresholdSeconds: threshold, Illustrative: true, FinishedAt: &at, CompleteScenario: &finished}
	if runDate == "" {
		input.RunDate = scenario.BaseDate
	}
	var rows, beforeRows []ZoneServiceLevel
	var simulation *SimulatorEngineOutput
	if err != nil {
		input.Status, finished.Status = "failed", "failed"
	} else {
		input.Status, finished.Status = "succeeded", "completed"
		input.Illustrative, input.EngineVersion = after.Illustrative, &after.Engine.Version
		rows, beforeRows = zoneRowsOf(after), zoneRowsOf(before)
		out, oerr := simulatorOutput(ctx, OutputMeta{Tenant: rc.CustomerID, RequestKey: fmt.Sprintf("scenario:%s:%s", scenario.ID, at), RosterRef: "scenario:" + scenario.ID,
			Policy: policy, ClockStart: clockStart, ThresholdSeconds: threshold, ModelVersion: after.ModelVersion}, rows)
		if oerr != nil {
			return auditlog.AuditedWrite[ScenarioRunResult]{}, oerr
		}
		out.EngineVersion, out.Illustrative = after.Engine.Version, after.Illustrative
		simulation = &out
	}
	if kerr := keepScenarioLines(ctx, rc, scenario, at, engineLines, answers); kerr != nil {
		return auditlog.AuditedWrite[ScenarioRunResult]{}, kerr
	}
	if _, serr := storeSimulation(ctx, rc, input, rows); serr != nil {
		return auditlog.AuditedWrite[ScenarioRunResult]{}, serr
	}

	gaps, surpluses := 0, 0
	for _, c := range optimizer.GapCells {
		if c.Kind == "gap" {
			gaps++
		} else if c.Kind == "surplus" {
			surpluses++
		}
	}
	detail := map[string]any{"zone_ids": scenario.ZoneIDs, "base_date": scenario.BaseDate, "gap_intervals": gaps, "surplus_intervals": surpluses,
		"case_day": runDate, "unsupported_adjustments": countCode(optimizer.Violations, "unsupported_adjustment"), "cases_dropped": dropped}
	source, note := rosterNote(optimizer, engineLines)
	detail["scenario_roster"] = source
	if engineLines != nil {
		detail["optimizer_model"], detail["optimizer_status"] = optimizer.ModelVersion, optimizer.Status
	}
	summary := fmt.Sprintf("Scenario %q run: the simulator failed (%s), no service-level reading.", scenario.Name, engineErrorClass(err))
	if err != nil {
		detail["error_class"] = engineErrorClass(err)
	} else {
		br, ba := overallShares(beforeRows)
		ar, aa := overallShares(rows)
		detail["before_from_assignment_share"], detail["after_from_assignment_share"] = shareOrNil(ba), shareOrNil(aa)
		detail["before_from_registration_share"], detail["after_from_registration_share"] = shareOrNil(br), shareOrNil(ar)
		detail["cases_reclassified"], detail["primary_clock_start"] = flipped, clockStart
		summary = fmt.Sprintf("Scenario %q run by the simulator, engine %s: %d gap and %d surplus intervals; before and after readings kept (Illustrative).%s",
			scenario.Name, after.Engine.Version, gaps, surpluses, capWarning(dropped))
	}
	summary += note
	id := scenario.ID
	result := ScenarioRunResult{ScenarioID: scenario.ID, GeneratedAt: at, Optimizer: optimizer, Simulation: simulation, Illustrative: true, DataSource: "SYNTHETIC"}
	return auditlog.AuditedWrite[ScenarioRunResult]{Result: result, EntityID: &id, SummaryEn: summary, Detail: detail}, nil
}
