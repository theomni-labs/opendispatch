// SPDX-License-Identifier: AGPL-3.0-only

// Scenario Lab: the optimizer builds the roster.
package business

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// optScenario: scenario_adjustments of one request.
type optScenario struct {
	HeadcountDelta  []optHeadcount `json:"headcount_delta,omitempty"`
	ShiftPatternIDs []string       `json:"shift_pattern_ids,omitempty"`
	RemoteShare     *float64       `json:"remote_share,omitempty"`
}

type optHeadcount struct {
	ZoneID       string `json:"zone_id"`
	FieldAgents  int    `json:"field_agents,omitempty"`
	RemoteAgents int    `json:"remote_agents,omitempty"`
	Vehicles     int    `json:"vehicles,omitempty"`
}

// scenarioKept: what a run keeps for the gap view.
type scenarioKept struct {
	RosterDate string                        `json:"roster_date"`
	Stamp      string                        `json:"opendispatch_scenario_stamp"`
	Lines      map[string][]RosterAssignment `json:"opendispatch_scenario_lines"`
	Answers    []json.RawMessage             `json:"answers"`
}

// hasHeadcount: a people or vehicle change.
func hasHeadcount(s Scenario) bool {
	for _, d := range s.Adjustments.HeadcountDelta {
		if d.FieldAgents != 0 || d.RemoteAgents != 0 || d.Vehicles != 0 {
			return true
		}
	}
	return false
}

// remotePoolDelta: the per-zone changes, added up.
func remotePoolDelta(s Scenario) int {
	n := 0
	for _, d := range s.Adjustments.HeadcountDelta {
		n += d.RemoteAgents
	}
	return n
}

// scenarioRequestPart: one zone's adjustments.
func scenarioRequestPart(s Scenario, zoneID string, patterns []ShiftPattern) *optScenario {
	out := &optScenario{RemoteShare: s.Adjustments.RemoteShare}
	h := optHeadcount{ZoneID: zoneID, RemoteAgents: remotePoolDelta(s)}
	for _, d := range s.Adjustments.HeadcountDelta {
		if d.ZoneID == zoneID {
			h.FieldAgents, h.Vehicles = d.FieldAgents, d.Vehicles
		}
	}
	if h.FieldAgents != 0 || h.RemoteAgents != 0 || h.Vehicles != 0 {
		out.HeadcountDelta = []optHeadcount{h}
	}
	if len(s.Adjustments.ShiftPatternIDs) > 0 {
		ids := append([]string(nil), s.Adjustments.ShiftPatternIDs...)
		for _, p := range patterns {
			if p.Kind == "remote" && p.Status == ShiftStatusActive && !containsStr(ids, p.ID) {
				ids = append(ids, p.ID)
			}
		}
		sort.Strings(ids)
		out.ShiftPatternIDs = ids
	}
	return out
}

// isAddedID: an engine-added person (uuid5).
func isAddedID(id string) bool {
	return uuidPattern.MatchString(id) && len(id) == 36 && id[14] == '5'
}

// askScenarioZone: one zone's scenario roster.
func askScenarioZone(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, plan *PlanReader, run ForecastRun, s Scenario, zoneID string) ([]byte, *optimizerOutputDoc, []RosterAssignment, error) {
	date := s.BaseDate
	src, err := loadOptimizerSource(ctx, conn, rc, plan, zoneID, date, run)
	if err != nil && !errors.Is(err, ErrEngineInput) {
		return nil, nil, nil, scenarioFatal{err}
	}
	locked := lockedLines(plan, rosterFor(plan, zoneID, date), zoneID)
	var request []byte
	if err == nil {
		src.Fixed, src.Scenario = locked, scenarioRequestPart(s, zoneID, plan.Patterns)
		request, err = buildOptimizerRequest(src)
	}
	body, err := askEngine(ctx, rc, engines.Optimizer, request, err)
	if err != nil {
		return nil, nil, nil, err
	}
	var doc optimizerOutputDoc
	if err = checkAnswerHeader(engines.Optimizer, body); err == nil && (json.Unmarshal(body, &doc) != nil || doc.RosterDate != date) {
		err = fmt.Errorf("%w: roster date", ErrEngineAnswer)
	}
	var lines []RosterAssignment
	if err == nil {
		lines, err = answerLines(&doc, plan, zoneID, date, locked, true)
	}
	if err != nil {
		auditEngineFailure(rc, engines.Optimizer, err)
		return nil, nil, nil, err
	}
	for i := range lines {
		lines[i].ID = datactx.DeterministicUUID(fmt.Sprintf("scenario:%s:%s:optimizer:%d", s.ID, zoneID, i))
		lines[i].RosterID, lines[i].TenantID, lines[i].DataSource = "", rc.CustomerID, recordsource.Get()
	}
	return body, &doc, lines, nil
}

// askScenarioOptimizer: every zone, or no lines.
func askScenarioOptimizer(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, plan *PlanReader, s Scenario) (map[string][]RosterAssignment, []*optimizerOutputDoc, [][]byte, error) {
	run, err := loadLatestForecastRun(ctx, rc.CustomerID, false)
	if err != nil {
		return nil, nil, nil, scenarioFatal{err}
	}
	if run == nil {
		err = inputErr("no forecast run")
		auditEngineFailure(rc, engines.Optimizer, err)
		return nil, nil, nil, err
	}
	lines := map[string][]RosterAssignment{}
	var docs []*optimizerOutputDoc
	var bodies [][]byte
	for _, zoneID := range s.ZoneIDs {
		body, doc, zl, err := askScenarioZone(ctx, conn, rc, plan, *run, s, zoneID)
		if err != nil {
			return nil, nil, nil, err
		}
		lines[zoneID], docs, bodies = zl, append(docs, doc), append(bodies, body)
	}
	return lines, docs, bodies, nil
}

// keepScenarioLines: the gap view's lines, stamped.
func keepScenarioLines(ctx context.Context, rc reqctx.RequestContext, s Scenario, stamp string, lines map[string][]RosterAssignment, bodies [][]byte) error {
	kept := scenarioKept{RosterDate: s.BaseDate, Stamp: stamp, Lines: lines}
	for _, b := range bodies {
		kept.Answers = append(kept.Answers, json.RawMessage(b))
	}
	body, err := json.Marshal(kept)
	if err != nil {
		return err
	}
	return keepAnswer(ctx, rc.CustomerID, engines.Optimizer, "scenario:"+s.ID, body, func(_, next []byte) []byte { return next })
}

// keptScenarioLines: lines of the current run, or nil.
func keptScenarioLines(ctx context.Context, tenant string, s *Scenario) (map[string][]RosterAssignment, error) {
	ran := s.Status == "completed" || s.Status == "failed"
	if engineMode() != engines.ModeEngine || !ran || s.LastRunAt == nil || !sameInstant(s.UpdatedAt, *s.LastRunAt) {
		return nil, nil
	}
	body, err := readKeptScope(ctx, tenant, engines.Optimizer, "scenario:"+s.ID)
	if err != nil || body == nil {
		return nil, err
	}
	var kept scenarioKept
	if json.Unmarshal(body, &kept) != nil || !sameInstant(kept.Stamp, *s.LastRunAt) || kept.RosterDate != s.BaseDate {
		return nil, nil
	}
	return kept.Lines, nil
}

// sameInstant: equal to the microsecond.
func sameInstant(a, b string) bool {
	ta, errA := time.Parse(time.RFC3339Nano, a)
	tb, errB := time.Parse(time.RFC3339Nano, b)
	return errA == nil && errB == nil && ta.Truncate(time.Microsecond).Equal(tb.Truncate(time.Microsecond))
}

var statusRank = map[string]int{"feasible": 0, "partial": 1, "infeasible": 2}

// withAnswers: the document says what the engine did.
func withAnswers(doc OptimizerEngineOutput, docs []*optimizerOutputDoc) OptimizerEngineOutput {
	doc.Status = "feasible"
	for _, d := range docs {
		doc.EngineVersion, doc.ModelVersion = d.Engine.Version, d.ModelVersion
		if statusRank[d.Status] > statusRank[doc.Status] {
			doc.Status = d.Status
		}
		doc.Violations = append(doc.Violations, d.Violations...)
	}
	return doc
}

func countCode(vs []OptimizerViolation, code string) int {
	n := 0
	for _, v := range vs {
		if v.Code == code {
			n++
		}
	}
	return n
}

// optimizerFallback: the result says so.
func optimizerFallback(err error) OptimizerViolation {
	return OptimizerViolation{Code: "optimizer_unavailable",
		Message: fmt.Sprintf("The optimizer could not be used (%s); the scenario roster is the in-API re-plan.", engineErrorClass(err))}
}
