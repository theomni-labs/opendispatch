// SPDX-License-Identifier: AGPL-3.0-only

// Ports dispatch.ts (ops.live_dispatch_board, flow
// 11; the project rules/20). the demo replays one
// synthetic day; everything here is a pure function
// of the replay clock, the zone stage setting, the
// fallback events and stored decisions.
//
// Rule 19: The customer's dispatch is always the fallback.
// Rule 20: every assignment carries its source and,
// for a manual change, a reason code.
package business

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/synthetic"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"

	"github.com/jackc/pgx/v5"
)

var dispatchReasonCodes = []string{"agent_unavailable", "vehicle_unavailable", "closer_agent_known", "skills_needed", "dispatcher_judgement", "other"}
var dispatchFeeds = []string{"case_feed", "agent_feed", "assignment_channel"}

const (
	dispatchMinSpeed     = 0.1
	dispatchMaxSpeed     = 600
	dispatchDefaultSpeed = 60
)

// -------------------------------------------------
// Replay inputs (fixtures) and the replay clock
// -------------------------------------------------

// DispatchScriptEvent mirrors ScriptEvent.
type DispatchScriptEvent struct {
	At      string `json:"at"`
	Kind    string `json:"kind"`
	CaseID  string `json:"case_id"`
	Request struct {
		AgentID    string  `json:"agent_id"`
		ReasonCode string  `json:"reason_code"`
		Note       *string `json:"note"`
		Feed       string  `json:"feed"`
		Active     bool    `json:"active"`
	} `json:"request"`
}

// dispatchReplayScript mirrors ReplayScript.
type dispatchReplayScript struct {
	ReplayDate     string                `json:"replay_date"`
	DefaultStartAt string                `json:"default_start_at"`
	TotalCases     int                   `json:"total_cases"`
	Events         []DispatchScriptEvent `json:"events"`
}

func dispatchScript() (dispatchReplayScript, error) {
	var doc dispatchReplayScript
	found, err := fixtures.Object("ReplayScript", &doc)
	if err != nil {
		return dispatchReplayScript{}, err
	}
	if !found {
		return dispatchReplayScript{}, dataerr.NotFound("Replay script not found.")
	}
	return doc, nil
}

// AssignmentEngineRanked mirrors RankedAgent.
type AssignmentEngineRanked struct {
	Rank                   int      `json:"rank"`
	AgentID                string   `json:"agent_id"`
	EstimatedTravelSeconds int      `json:"estimated_travel_seconds"`
	EstimatedArrivalAt     string   `json:"estimated_arrival_at"`
	Score                  float64  `json:"score"`
	ReasonCodes            []string `json:"reason_codes"`
	ReasonText             string   `json:"reason_text"`
}

// AssignmentEngineOutput mirrors the engine.
type AssignmentEngineRef struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type AssignmentEngineOutput struct {
	SchemaVersion    string                   `json:"schema_version"`
	RequestID        string                   `json:"request_id"`
	Engine           AssignmentEngineRef      `json:"engine"`
	ModelVersion     string                   `json:"model_version"`
	GeneratedAt      string                   `json:"generated_at"`
	DataSource       string                   `json:"data_source"`
	Illustrative     bool                     `json:"illustrative"`
	CaseID           string                   `json:"case_id"`
	Status           string                   `json:"status"`
	DecisionTimeMs   int                      `json:"decision_time_ms"`
	DeadlineExceeded bool                     `json:"deadline_exceeded"`
	Ranking          []AssignmentEngineRanked `json:"ranking"`
}

var (
	engineOutputsMu    sync.Mutex
	engineOutputsCache map[string]AssignmentEngineOutput
)

func dispatchEngineOutputs() (map[string]AssignmentEngineOutput, error) {
	engineOutputsMu.Lock()
	if engineOutputsCache != nil {
		out := engineOutputsCache
		engineOutputsMu.Unlock()
		return out, nil
	}
	engineOutputsMu.Unlock()
	rows, err := fixtures.Records[AssignmentEngineOutput]("assignment.output")
	if err != nil {
		return nil, err
	}
	byCase := make(map[string]AssignmentEngineOutput, len(rows))
	for _, r := range rows {
		byCase[r.CaseID] = r
	}
	engineOutputsMu.Lock()
	engineOutputsCache = byCase
	engineOutputsMu.Unlock()
	return byCase, nil
}

// ResetDispatchEngineOutputsForTest: clear cache.
func ResetDispatchEngineOutputsForTest() {
	engineOutputsMu.Lock()
	engineOutputsCache = nil
	engineOutputsMu.Unlock()
}

func dispatchReplayCases() []Case {
	rows := allReplayCases()
	sort.SliceStable(rows, func(i, j int) bool {
		ti, _ := datactx.EpochOf(rows[i].RegisteredAt)
		tj, _ := datactx.EpochOf(rows[j].RegisteredAt)
		if !ti.Equal(tj) {
			return ti.Before(tj)
		}
		return rows[i].ID < rows[j].ID
	})
	return rows
}

// DispatchClock mirrors Clock. Shares the
// "dispatch.replay" settingsstore key and its
// replayStored type with remote.go's replay clock:
// both TS modules read the same underlying demo-
// store value, so both Go sides must too.
type DispatchClock struct {
	Status string
	AtMs   int64
	Speed  float64
}

func dispatchDayEndMs(s dispatchReplayScript) (int64, error) {
	t, err := datactx.EpochOf(s.ReplayDate + "T00:00:00+03:00")
	if err != nil {
		return 0, err
	}
	return t.UnixMilli() + remoteDayMs, nil
}

func readDispatchClock(ctx context.Context, tenant string) (DispatchClock, error) {
	if dispatchFromFeeds() {
		return DispatchClock{Status: "playing", AtMs: feedSource.now().UnixMilli(), Speed: 1}, nil
	}
	s, err := dispatchScript()
	if err != nil {
		return DispatchClock{}, err
	}
	stored, err := readSettingStrict(ctx, tenant, "dispatch.replay", replayStored{})
	if err != nil {
		return DispatchClock{}, err
	}
	if stored.Status == "" {
		stored = replayStored{Status: "stopped", ReplayAt: s.DefaultStartAt, Speed: dispatchDefaultSpeed}
	}
	baseT, err := datactx.EpochOf(stored.ReplayAt)
	if err != nil {
		return DispatchClock{}, err
	}
	base := baseT.UnixMilli()
	if stored.Status != "playing" || stored.AnchorWallMs == nil {
		return DispatchClock{Status: stored.Status, AtMs: base, Speed: stored.Speed}, nil
	}
	at := base + int64(float64(nowMs()-*stored.AnchorWallMs)*stored.Speed)
	end, err := dispatchDayEndMs(s)
	if err != nil {
		return DispatchClock{}, err
	}
	if at >= end {
		return DispatchClock{Status: "finished", AtMs: end, Speed: stored.Speed}, nil
	}
	return DispatchClock{Status: "playing", AtMs: at, Speed: stored.Speed}, nil
}

func writeDispatchClock(ctx context.Context, tenant, status string, atMs int64, speed float64, anchorWallMs *int64) error {
	return settingsstore.Put(ctx, tenant, "dispatch.replay", replayStored{Status: status, ReplayAt: isoAtMs(atMs), Speed: speed, AnchorWallMs: anchorWallMs})
}

// -------------------------------------------------
// Fallback: pure function of events up
// to a moment.
// -------------------------------------------------

// DispatchFallbackEvent mirrors FallbackEvent.
type DispatchFallbackEvent struct {
	At     string `json:"at"`
	Kind   string `json:"kind"`
	Feed   string `json:"feed,omitempty"`
	Active bool   `json:"active"`
	Signal string `json:"signal,omitempty"`
	Reason string `json:"reason,omitempty"`
	// Cause: set when OpenDispatch signalled by itself.
	Cause string   `json:"cause,omitempty"`
	Zones []string `json:"zones,omitempty"`
}

// DispatchFallbackView mirrors FallbackView.
type DispatchFallbackView struct {
	Active       bool
	Reason       string
	Since        *string
	OutageActive bool
	Maintenance  bool
	LastSignal   *string
	LastSignalAt *string
	SignalCause  string // "" for a person's signal
}

func dispatchFallbackEvents(ctx context.Context, tenant string) ([]DispatchFallbackEvent, error) {
	s, err := dispatchScript()
	if err != nil {
		return nil, err
	}
	var out []DispatchFallbackEvent
	for _, e := range s.Events {
		if e.Kind == "feed_outage" && !dispatchFromFeeds() {
			out = append(out, DispatchFallbackEvent{At: e.At, Kind: "outage", Feed: e.Request.Feed, Active: e.Request.Active})
		}
	}
	manual, err := readSettingStrict(ctx, tenant, "dispatch.fallback_log", []DispatchFallbackEvent(nil))
	if err != nil {
		return nil, err
	}
	out = append(out, manual...)
	sort.SliceStable(out, func(i, j int) bool {
		ti, _ := datactx.EpochOf(out[i].At)
		tj, _ := datactx.EpochOf(out[j].At)
		return ti.Before(tj)
	})
	return out, nil
}

func dispatchFallbackAt(ctx context.Context, tenant string, atMs int64) (DispatchFallbackView, error) {
	events, err := dispatchFallbackEvents(ctx, tenant)
	if err != nil {
		return DispatchFallbackView{}, err
	}
	return dispatchFallbackFrom(events, atMs)
}

// dispatchFallbackFrom is dispatchFallbackAt over events already read: a board reads them once, not once per case.
func dispatchFallbackFrom(events []DispatchFallbackEvent, atMs int64) (DispatchFallbackView, error) {
	outage := map[string]string{}
	var signalSince, maintenanceSince *string
	var lastSignal, lastSignalAt *string
	signalCause := ""
	for _, e := range events {
		et, err := datactx.EpochOf(e.At)
		if err != nil {
			continue
		}
		if et.UnixMilli() > atMs {
			break
		}
		switch e.Kind {
		case "outage":
			if e.Feed == "" {
				continue
			}
			if e.Active {
				if _, ok := outage[e.Feed]; !ok {
					at := e.At
					outage[e.Feed] = at
				}
			} else {
				delete(outage, e.Feed)
			}
		case "signal":
			sig := e.Signal
			lastSignal = &sig
			at := e.At
			lastSignalAt = &at
			if e.Signal == "fallback" {
				if signalSince == nil {
					at2 := e.At
					signalSince = &at2
					signalCause = e.Cause
				}
			} else {
				signalSince, signalCause = nil, ""
			}
		case "maintenance":
			if e.Active {
				if maintenanceSince == nil {
					at := e.At
					maintenanceSince = &at
				}
			} else {
				maintenanceSince = nil
			}
		}
	}
	outageActive := len(outage) > 0
	var starts []string
	for _, at := range outage {
		starts = append(starts, at)
	}
	if signalSince != nil {
		starts = append(starts, *signalSince)
	}
	if maintenanceSince != nil {
		starts = append(starts, *maintenanceSince)
	}
	sort.Strings(starts)
	reason := "none"
	if maintenanceSince != nil {
		reason = "maintenance"
	} else if signalSince != nil {
		reason = "manual"
		if r, ok := fallbackReasonOf[signalCause]; ok {
			reason = r
		}
	} else if outageActive {
		reason = "feed_outage"
	}
	var since *string
	if len(starts) > 0 {
		since = &starts[0]
	}
	return DispatchFallbackView{
		Active: outageActive || signalSince != nil || maintenanceSince != nil, Reason: reason, Since: since,
		OutageActive: outageActive, Maintenance: maintenanceSince != nil, LastSignal: lastSignal, LastSignalAt: lastSignalAt, SignalCause: signalCause,
	}, nil
}

// -------------------------------------------------
// The board: what each replay case looks like at a
// moment.
// -------------------------------------------------

// DispatchEnvironment mirrors Environment.
type DispatchEnvironment struct {
	Tenant        string
	FallbackLog   []DispatchFallbackEvent
	AtMs          int64
	DeadlineMs    int64 // OpenDispatch's own answer budget
	Stages        map[string]string
	Stored        map[string]Assignment
	Reassignments map[string]DispatchScriptEvent
}

func dispatchStoredDecisions(ctx context.Context, tenant string, caseIDs map[string]bool) (map[string]Assignment, error) {
	ids := make([]string, 0, len(caseIDs))
	for id := range caseIDs {
		ids = append(ids, id)
	}
	return assignmentStoreBackend.activeFor(ctx, tenant, ids)
}

func dispatchEnvironment(ctx context.Context, rc reqctx.RequestContext, atMs int64, cases []Case) (DispatchEnvironment, error) {
	stages, err := readZoneStages(ctx, rc)
	if err != nil {
		return DispatchEnvironment{}, err
	}
	stageMap := map[string]string{}
	for _, s := range stages {
		stageMap[s.ZoneID] = s.Stage
	}
	s, err := dispatchScript()
	if err != nil {
		return DispatchEnvironment{}, err
	}
	reassignments := map[string]DispatchScriptEvent{}
	for _, e := range s.Events {
		if e.Kind == "reassignment" && e.CaseID != "" && !dispatchFromFeeds() {
			reassignments[e.CaseID] = e
		}
	}
	ids := map[string]bool{}
	for _, c := range cases {
		ids[c.ID] = true
	}
	stored, err := dispatchStoredDecisions(ctx, rc.CustomerID, ids)
	if err != nil {
		return DispatchEnvironment{}, err
	}
	fallbackLog, err := dispatchFallbackEvents(ctx, rc.CustomerID)
	if err != nil {
		return DispatchEnvironment{}, err
	}
	return DispatchEnvironment{
		FallbackLog: fallbackLog, Tenant: rc.CustomerID, AtMs: atMs, DeadlineMs: decisionDeadlineMs(ctx, rc.CustomerID), Stages: stageMap,
		Stored: stored, Reassignments: reassignments,
	}, nil
}

// LiveRecommendation mirrors RecommendationSummary.
type LiveRecommendation struct {
	AgentID                string   `json:"agent_id"`
	EstimatedTravelSeconds int      `json:"estimated_travel_seconds"`
	EstimatedArrivalAt     string   `json:"estimated_arrival_at"`
	ReasonCodes            []string `json:"reason_codes"`
	ReasonText             string   `json:"reason_text"`
}

func dispatchRecommendationOf(output *AssignmentEngineOutput) *LiveRecommendation {
	if output == nil || output.Status != "ranked" || len(output.Ranking) == 0 {
		return nil
	}
	top := output.Ranking[0]
	return &LiveRecommendation{AgentID: top.AgentID, EstimatedTravelSeconds: top.EstimatedTravelSeconds, EstimatedArrivalAt: top.EstimatedArrivalAt, ReasonCodes: top.ReasonCodes, ReasonText: top.ReasonText}
}

// LiveCase mirrors the contract type.
type LiveCase struct {
	CaseID             string              `json:"case_id"`
	CaseNumber         string              `json:"case_number"`
	ZoneID             string              `json:"zone_id"`
	SubZoneID          *string             `json:"sub_zone_id"`
	RegisteredAt       string              `json:"registered_at"`
	Latitude           float64             `json:"latitude"`
	Longitude          float64             `json:"longitude"`
	PartiesInvolved    int                 `json:"parties_involved"`
	State              string              `json:"state"`
	Stage              string              `json:"stage"`
	AssignmentID       *string             `json:"assignment_id"`
	AssignedAgentID    *string             `json:"assigned_agent_id"`
	AssignmentSource   *string             `json:"assignment_source"`
	EstimatedArrivalAt *string             `json:"estimated_arrival_at"`
	Recommendation     *LiveRecommendation `json:"recommendation"`
	CustomerAgentID    *string             `json:"customer_agent_id"`
	Classification     *LiveClassification `json:"classification,omitempty"`
	// AISuggestion: latest, brief; never routes
	AISuggestion *AssistantCaseSuggestionSummary `json:"ai_suggestion,omitempty"`
	DataSource   string                          `json:"data_source"`
}

func dispatchLiveCase(c Case, env DispatchEnvironment, outputs map[string]AssignmentEngineOutput) (LiveCase, error) {
	var output *AssignmentEngineOutput
	if o, ok := outputs[c.ID]; ok {
		output = &o
	}
	reco := dispatchRecommendationOf(output)
	stage := env.Stages[c.ZoneID]
	if stage == "" {
		stage = "shadow"
	}
	var customer *string
	if c.AssignedAt != nil {
		at, err := datactx.EpochOf(*c.AssignedAt)
		if err == nil && at.UnixMilli() <= env.AtMs && c.AgentID != nil {
			id := *c.AgentID
			customer = &id
		}
	}
	regT, err := datactx.EpochOf(c.RegisteredAt)
	if err != nil {
		return LiveCase{}, err
	}
	fbAtReg, err := dispatchFallbackFrom(env.FallbackLog, regT.UnixMilli())
	if err != nil {
		return LiveCase{}, err
	}
	decisionMs := int64(1) << 62
	if output != nil {
		decisionMs = int64(output.DecisionTimeMs)
	}
	// The customer's own timer is not measured here.
	opendispatchAnswered := reco != nil && decisionMs <= env.DeadlineMs

	base := LiveCase{
		CaseID: c.ID, CaseNumber: c.CaseNumber, ZoneID: c.ZoneID, SubZoneID: strPtrOrNil(c.SubZoneID), RegisteredAt: c.RegisteredAt,
		Latitude: c.Latitude, Longitude: c.Longitude, PartiesInvolved: c.PartiesInvolved, Stage: stage, CustomerAgentID: customer, DataSource: c.DataSource,
		Recommendation: reco,
	}
	with := func(state string, extra func(*LiveCase)) LiveCase {
		lc := base
		lc.State = state
		if extra != nil {
			extra(&lc)
		}
		return lc
	}

	if stored, ok := env.Stored[c.ID]; ok {
		state := "assigned"
		if stored.Source == "MANUAL" {
			state = "overridden"
		} else if stored.Source == "CUSTOMER_FALLBACK" {
			state = "fallback_assigned"
		}
		return with(state, func(lc *LiveCase) {
			id := stored.ID
			lc.AssignmentID, lc.AssignedAgentID, lc.AssignmentSource, lc.EstimatedArrivalAt = &id, &stored.AgentID, &stored.Source, stored.EstimatedArrivalAt
		}), nil
	}
	if reassignment, ok := env.Reassignments[c.ID]; ok {
		reassignT, rerr := datactx.EpochOf(reassignment.At)
		if rerr == nil && stage != "shadow" && !fbAtReg.Active && reassignT.UnixMilli() <= env.AtMs {
			var arrival *string
			if output != nil {
				for _, r := range output.Ranking {
					if r.AgentID == reassignment.Request.AgentID {
						a := r.EstimatedArrivalAt
						arrival = &a
						break
					}
				}
			}
			return with("overridden", func(lc *LiveCase) {
				sid := reassignment.Request.AgentID
				src := "MANUAL"
				lc.AssignedAgentID, lc.AssignmentSource, lc.EstimatedArrivalAt = &sid, &src, arrival
			}), nil
		}
	}
	if fbAtReg.Active {
		return with("fallback_assigned", func(lc *LiveCase) {
			src := "CUSTOMER_FALLBACK"
			lc.AssignedAgentID, lc.AssignmentSource = customer, &src
		}), nil
	}
	if stage == "shadow" {
		if customer == nil {
			return with("waiting", nil), nil
		}
		return with("assigned", func(lc *LiveCase) {
			src := "CUSTOMER_FALLBACK"
			lc.AssignedAgentID, lc.AssignmentSource = customer, &src
		}), nil
	}
	// The customer's assignment is final.
	if customer != nil {
		return with("fallback_assigned", func(lc *LiveCase) {
			src := "CUSTOMER_FALLBACK"
			lc.AssignedAgentID, lc.AssignmentSource = customer, &src
		}), nil
	}
	if !opendispatchAnswered {
		return with("fallback_assigned", func(lc *LiveCase) {
			src := "CUSTOMER_FALLBACK"
			lc.AssignedAgentID, lc.AssignmentSource = customer, &src
		}), nil
	}
	if stage == "recommend" {
		return with("recommended", nil), nil
	}
	return with("assigned", func(lc *LiveCase) {
		src := "OPENDISPATCH"
		lc.AssignedAgentID, lc.AssignmentSource, lc.EstimatedArrivalAt = &reco.AgentID, &src, &reco.EstimatedArrivalAt
	}), nil
}

// DispatchSnapshot mirrors Snapshot.
type DispatchSnapshot struct {
	Clock    DispatchClock
	Replay   ReplayState
	Fallback FallbackState
	Stages   []ZoneStage
	Cases    []LiveCase
}

// ReplayState mirrors the contract type.
type ReplayState struct {
	Status           string  `json:"status"`
	ReplayDate       string  `json:"replay_date"`
	ReplayAt         string  `json:"replay_at"`
	Speed            float64 `json:"speed"`
	TotalCases       int     `json:"total_cases"`
	DeliveredCases   int     `json:"delivered_cases"`
	FeedOutageActive bool    `json:"feed_outage_active"`
	DataSource       string  `json:"data_source"`
}

// FallbackState mirrors the contract type.
type FallbackState struct {
	State                 string  `json:"state"`
	Reason                string  `json:"reason"`
	Since                 *string `json:"since"`
	TimeoutSeconds        int     `json:"timeout_seconds"`
	OpenDispatchHealthy   bool    `json:"opendispatch_healthy"`
	FallbackAssignedCount int     `json:"fallback_assigned_count"`
	LastSignal            *string `json:"last_signal"`
	LastSignalAt          *string `json:"last_signal_at"`
	DataSource            string  `json:"data_source"`
}

func dispatchSnapshot(ctx context.Context, rc reqctx.RequestContext) (DispatchSnapshot, error) {
	clock, err := readDispatchClock(ctx, rc.CustomerID)
	if err != nil {
		return DispatchSnapshot{}, err
	}
	all, outputs, err := dispatchCasesAndOutputs(ctx, rc.CustomerID)
	if err != nil {
		return DispatchSnapshot{}, err
	}
	var delivered []Case
	for _, c := range all {
		t, err := datactx.EpochOf(c.RegisteredAt)
		if err == nil && t.UnixMilli() <= clock.AtMs {
			delivered = append(delivered, c)
		}
	}
	var readable []Case
	for _, c := range delivered {
		zid := c.ZoneID
		if reqctx.CanReadZone(rc, &zid) {
			readable = append(readable, c)
		}
	}
	env, err := dispatchEnvironment(ctx, rc, clock.AtMs, readable)
	if err != nil {
		return DispatchSnapshot{}, err
	}
	classifier, err := newLiveClassifier(ctx, rc.CustomerID)
	if err != nil {
		return DispatchSnapshot{}, err
	}
	cases := make([]LiveCase, 0, len(readable))
	for _, c := range readable {
		lc, err := dispatchLiveCase(c, env, outputs)
		if err != nil {
			return DispatchSnapshot{}, err
		}
		cls := classifier.of(c, c.RegisteredAt)
		lc.Classification = &cls
		lc.AISuggestion = suggestionSummary(c)
		cases = append(cases, lc)
	}
	sort.SliceStable(cases, func(i, j int) bool {
		ti, _ := datactx.EpochOf(cases[i].RegisteredAt)
		tj, _ := datactx.EpochOf(cases[j].RegisteredAt)
		if !ti.Equal(tj) {
			return ti.After(tj)
		}
		return cases[i].CaseID < cases[j].CaseID
	})
	view, err := dispatchFallbackAt(ctx, rc.CustomerID, clock.AtMs)
	if err != nil {
		return DispatchSnapshot{}, err
	}
	fallbackAssigned := 0
	for _, c := range cases {
		if c.State == "fallback_assigned" {
			fallbackAssigned++
		}
	}
	state := "armed"
	if view.Maintenance {
		state = "maintenance"
	} else if view.Active {
		state = "active"
	}
	fallback := FallbackState{
		State: state, Reason: view.Reason, Since: view.Since, TimeoutSeconds: getFallbackTimeoutSeconds(ctx, rc.CustomerID),
		OpenDispatchHealthy: !view.OutageActive && view.SignalCause == "", FallbackAssignedCount: fallbackAssigned, LastSignal: view.LastSignal, LastSignalAt: view.LastSignalAt, DataSource: "SYNTHETIC",
	}
	s, err := dispatchScript()
	if err != nil {
		return DispatchSnapshot{}, err
	}
	replayDate := s.ReplayDate
	if dispatchFromFeeds() {
		replayDate = todayIn(ctx, rc.CustomerID)
	}
	replay := ReplayState{
		Status: clock.Status, ReplayDate: replayDate, ReplayAt: isoAtMs(clock.AtMs), Speed: clock.Speed,
		TotalCases: len(all), DeliveredCases: len(delivered), FeedOutageActive: view.OutageActive, DataSource: "SYNTHETIC",
	}
	stages, err := readZoneStages(ctx, rc)
	if err != nil {
		return DispatchSnapshot{}, err
	}
	return DispatchSnapshot{Clock: clock, Replay: replay, Fallback: fallback, Stages: stages, Cases: cases}, nil
}

// -------------------------------------------------
// Reads.
// -------------------------------------------------

// LiveBoardQuery mirrors getLiveBoard's query.
type LiveBoardQuery struct {
	Limit  int
	Cursor string
	ZoneID string
}

// LiveBoard mirrors the contract type.
type LiveBoard struct {
	AsOf       string           `json:"as_of"`
	Replay     ReplayState      `json:"replay"`
	Fallback   FallbackState    `json:"fallback"`
	Stages     []ZoneStage      `json:"stages"`
	Cases      []LiveCase       `json:"cases"`
	Page       datactx.PageInfo `json:"page"`
	DataSource string           `json:"data_source"`
}

// GetLiveBoard mirrors getLiveBoard.
func GetLiveBoard(rc reqctx.RequestContext, query LiveBoardQuery) (LiveBoard, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return LiveBoard{}, err
	}
	s, err := dispatchSnapshot(context.Background(), rc)
	if err != nil {
		return LiveBoard{}, err
	}
	var filteredCases []LiveCase
	for _, c := range s.Cases {
		if query.ZoneID == "" || c.ZoneID == query.ZoneID {
			filteredCases = append(filteredCases, c)
		}
	}
	page, err := datactx.Paginate(filteredCases, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
	if err != nil {
		return LiveBoard{}, err
	}
	stages := []ZoneStage{}
	for _, z := range s.Stages {
		if query.ZoneID == "" || z.ZoneID == query.ZoneID {
			stages = append(stages, z)
		}
	}
	return LiveBoard{AsOf: s.Replay.ReplayAt, Replay: s.Replay, Fallback: s.Fallback, Stages: stages, Cases: page.Items, Page: page.Page, DataSource: "SYNTHETIC"}, nil
}

// LiveCaseQuery mirrors listLiveCases's query.
type LiveCaseQuery struct {
	Limit  int
	Cursor string
	ZoneID string
	State  string
}

// ListLiveCases mirrors listLiveCases.
func ListLiveCases(rc reqctx.RequestContext, query LiveCaseQuery) (datactx.PageResult[LiveCase], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return datactx.PageResult[LiveCase]{}, err
	}
	s, err := dispatchSnapshot(context.Background(), rc)
	if err != nil {
		return datactx.PageResult[LiveCase]{}, err
	}
	var out []LiveCase
	for _, c := range s.Cases {
		if (query.ZoneID == "" || c.ZoneID == query.ZoneID) && (query.State == "" || c.State == query.State) {
			out = append(out, c)
		}
	}
	return datactx.Paginate(out, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// GetCaseRecommendation mirrors the TS function.
func GetCaseRecommendation(rc reqctx.RequestContext, caseID string) (AssignmentEngineOutput, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return AssignmentEngineOutput{}, err
	}
	if _, err := importutil.RequireID(caseID, "Case"); err != nil {
		return AssignmentEngineOutput{}, err
	}
	clock, err := readDispatchClock(context.Background(), rc.CustomerID)
	if err != nil {
		return AssignmentEngineOutput{}, err
	}
	allCases, outputs, err := dispatchCasesAndOutputFor(context.Background(), rc.CustomerID, caseID)
	if err != nil {
		return AssignmentEngineOutput{}, err
	}
	var found *Case
	for _, c := range allCases {
		zid := c.ZoneID
		t, terr := datactx.EpochOf(c.RegisteredAt)
		if c.ID == caseID && reqctx.CanReadZone(rc, &zid) && terr == nil && t.UnixMilli() <= clock.AtMs {
			row := c
			found = &row
			break
		}
	}
	if found == nil {
		return AssignmentEngineOutput{}, dataerr.NotFound("Case not found.")
	}
	out, ok := outputs[found.ID]
	if !ok {
		return AssignmentEngineOutput{}, dataerr.NotFound("Recommendation not found.")
	}
	return out, nil
}

// GetFallbackState mirrors getFallbackState.
func GetFallbackState(rc reqctx.RequestContext) (FallbackState, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return FallbackState{}, err
	}
	s, err := dispatchSnapshot(context.Background(), rc)
	if err != nil {
		return FallbackState{}, err
	}
	return s.Fallback, nil
}

// GetReplayState mirrors getReplayState.
func GetReplayState(rc reqctx.RequestContext) (ReplayState, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return ReplayState{}, err
	}
	s, err := dispatchSnapshot(context.Background(), rc)
	if err != nil {
		return ReplayState{}, err
	}
	return s.Replay, nil
}

// ListZoneStages mirrors listZoneStages.
func ListZoneStages(rc reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[ZoneStage], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return datactx.PageResult[ZoneStage]{}, err
	}
	stages, err := readZoneStages(context.Background(), rc)
	if err != nil {
		return datactx.PageResult[ZoneStage]{}, err
	}
	return datactx.Paginate(stages, query)
}

// -------------------------------------------------
// Agents: status/position from the generator's
// pure state function.
// -------------------------------------------------

type dispatchAgentOrder struct {
	Agent Agent
	Order int
}

func dispatchFieldAgentIndex(ctx context.Context, conn *tenancy.Connection, tenantID string) (map[string]dispatchAgentOrder, error) {
	rows, err := allAgents(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]dispatchAgentOrder, len(rows))
	for i, s := range rows {
		out[s.ID] = dispatchAgentOrder{Agent: s, Order: i}
	}
	return out, nil
}

// AgentStatus mirrors the contract type.
type AgentStatus struct {
	datactx.BaseRecord
	AgentID       string  `json:"agent_id"`
	Status        string  `json:"status"`
	Latitude      float64 `json:"latitude"`
	Longitude     float64 `json:"longitude"`
	PositionAt    string  `json:"position_at"`
	ZoneID        *string `json:"zone_id"`
	VehicleID     *string `json:"vehicle_id"`
	CurrentCaseID *string `json:"current_case_id"`
}

// AgentStatusQuery: the list-statuses query.
type AgentStatusQuery struct {
	Limit  int
	Cursor string
	ZoneID string
	Status string
}

// ListAgentStatuses mirrors listAgentStatuses.
func ListAgentStatuses(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query AgentStatusQuery) (datactx.PageResult[AgentStatus], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return datactx.PageResult[AgentStatus]{}, err
	}
	if dispatchFromFeeds() {
		return feedAgentStatusPage(ctx, rc, query)
	}
	clock, err := readDispatchClock(ctx, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[AgentStatus]{}, err
	}
	seed, err := fixtures.Seed()
	if err != nil {
		return datactx.PageResult[AgentStatus]{}, err
	}
	index, err := dispatchFieldAgentIndex(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[AgentStatus]{}, err
	}
	states, err := synthetic.AllAgentStatesAt(seed, isoAtMs(clock.AtMs))
	if err != nil {
		return datactx.PageResult[AgentStatus]{}, err
	}
	type ordered struct {
		Status AgentStatus
		Order  int
	}
	var rows []ordered
	for _, state := range states {
		known, ok := index[state.AgentID]
		zid := state.ZoneID
		if !ok || known.Agent.Kind != "field" || !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		if (query.ZoneID != "" && state.ZoneID != query.ZoneID) || (query.Status != "" && state.Status != query.Status) {
			continue
		}
		status := AgentStatus{
			BaseRecord: datactx.SystemRecord(rc, fmt.Sprintf("status|%s", state.AgentID), state.PositionAt), AgentID: state.AgentID, Status: state.Status,
			Latitude: state.Latitude, Longitude: state.Longitude, PositionAt: state.PositionAt, ZoneID: strPtrOrNil(state.ZoneID),
			VehicleID: state.VehicleID, CurrentCaseID: state.CurrentCaseID}
		rows = append(rows, ordered{Status: status, Order: known.Order})
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Order < rows[j].Order })
	out := make([]AgentStatus, len(rows))
	for i, r := range rows {
		out[i] = r.Status
	}
	return datactx.Paginate(out, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

const (
	dispatchHistoryStepSeconds    = 60
	dispatchHistoryDefaultMinutes = 30
	dispatchHistoryMaxPoints      = 240
)

// AgentPosition mirrors the contract type.
type AgentPosition struct {
	datactx.BaseRecord
	AgentID    string   `json:"agent_id"`
	RecordedAt string   `json:"recorded_at"`
	Latitude   float64  `json:"latitude"`
	Longitude  float64  `json:"longitude"`
	SpeedKmh   *float64 `json:"speed_kmh"`
}

// AgentPositionQuery: the list-positions query.
type AgentPositionQuery struct {
	Limit  int
	Cursor string
	From   string
	To     string
}

// ListAgentPositions: generated on the fly,
// nothing stored.
func ListAgentPositions(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, agentID string, query AgentPositionQuery) (datactx.PageResult[AgentPosition], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return datactx.PageResult[AgentPosition]{}, err
	}
	if _, err := importutil.RequireID(agentID, "Agent"); err != nil {
		return datactx.PageResult[AgentPosition]{}, err
	}
	row, err := oneAgent(ctx, conn, rc.CustomerID, agentID)
	if err != nil {
		return datactx.PageResult[AgentPosition]{}, err
	}
	agent, err := datactx.RequireFound(row, "Agent")
	if err != nil {
		return datactx.PageResult[AgentPosition]{}, err
	}
	if !reqctx.CanReadZone(rc, agent.HomeZoneID) || agent.Kind != "field" {
		return datactx.PageResult[AgentPosition]{}, dataerr.NotFound("Agent not found.")
	}
	clock, err := readDispatchClock(ctx, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[AgentPosition]{}, err
	}
	now := clock.AtMs
	toMs := now
	if query.To != "" {
		t, err := datactx.EpochOf(query.To)
		if err != nil {
			return datactx.PageResult[AgentPosition]{}, err
		}
		if t.UnixMilli() < now {
			toMs = t.UnixMilli()
		}
	}
	fromMs := toMs - dispatchHistoryDefaultMinutes*60_000
	if query.From != "" {
		t, err := datactx.EpochOf(query.From)
		if err != nil {
			return datactx.PageResult[AgentPosition]{}, err
		}
		fromMs = t.UnixMilli()
	}
	if fromMs > toMs {
		return datactx.PageResult[AgentPosition]{}, dataerr.Invalid("Positions: from is after to.")
	}
	if dispatchFromFeeds() {
		return feedPositionPage(ctx, rc, agentID, fromMs, toMs, query)
	}
	seed, err := fixtures.Seed()
	if err != nil {
		return datactx.PageResult[AgentPosition]{}, err
	}
	stepMs := int64(dispatchHistoryStepSeconds * 1000)
	first := ((fromMs + stepMs - 1) / stepMs) * stepMs
	var rows []AgentPosition
	for ms := first; ms <= toMs && len(rows) < dispatchHistoryMaxPoints; ms += stepMs {
		at := isoAtMs(ms)
		state, err := synthetic.AgentStateAt(seed, agentID, at)
		if err != nil {
			return datactx.PageResult[AgentPosition]{}, err
		}
		rows = append(rows, AgentPosition{
			BaseRecord: datactx.SystemRecord(rc, fmt.Sprintf("position|%s|%s", agentID, at), at), AgentID: agentID, RecordedAt: at,
			Latitude: state.Latitude, Longitude: state.Longitude, SpeedKmh: &state.SpeedKmh,
		})
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// -------------------------------------------------
// Assignments and their history (fixtures: the
// previous day; plus what dispatchers stored). All
// in-memory (demo mode), matching TS's own readAll/
// upsert from the old demo store, not store-api.
// -------------------------------------------------

// Assignment mirrors the contract type.
type Assignment struct {
	datactx.BaseRecord
	CaseID                 string         `json:"case_id"`
	AgentID                string         `json:"agent_id"`
	DecidedAt              string         `json:"decided_at"`
	Source                 string         `json:"source"`
	Stage                  string         `json:"stage"`
	State                  string         `json:"state"`
	ReasonCode             *string        `json:"reason_code"`
	ReasonNote             *string        `json:"reason_note,omitempty"`
	EstimatedArrivalAt     *string        `json:"estimated_arrival_at"`
	EstimatedTravelSeconds *int           `json:"estimated_travel_seconds"`
	DecidedByUserID        *string        `json:"decided_by_user_id"`
	ModelVersion           *string        `json:"model_version"`
	Extra                  map[string]any `json:"extra"`
}

// AssignmentEvent mirrors the contract type.
type AssignmentEvent struct {
	datactx.BaseRecord
	AssignmentID *string        `json:"assignment_id"`
	CaseID       string         `json:"case_id"`
	EventType    string         `json:"event_type"`
	OccurredAt   string         `json:"occurred_at"`
	Source       string         `json:"source"`
	ActorUserID  *string        `json:"actor_user_id"`
	ReasonCode   *string        `json:"reason_code,omitempty"`
	Note         *string        `json:"note"`
	Detail       map[string]any `json:"detail"`
}

// AssignmentComparison mirrors the contract type.
type AssignmentComparison struct {
	datactx.BaseRecord
	CaseID       string         `json:"case_id"`
	ZoneID       string         `json:"zone_id"`
	ComparedAt   string         `json:"compared_at"`
	SameAgent    bool           `json:"same_agent"`
	OpenDispatch ComparisonSide `json:"opendispatch"`
	Customer     ComparisonSide `json:"customer"`
}

// ComparisonSide mirrors the contract type.
type ComparisonSide struct {
	AgentID                *string          `json:"agent_id"`
	AssignedAt             *string          `json:"assigned_at"`
	EstimatedTravelSeconds *int             `json:"estimated_travel_seconds"`
	ActualTravelSeconds    *int             `json:"actual_travel_seconds,omitempty"`
	Reading                TenMinuteReading `json:"reading"`
}

// TenMinuteReading mirrors the contract type.
type TenMinuteReading struct {
	ThresholdSeconds       int   `json:"threshold_seconds"`
	FromRegistrationSecond *int  `json:"from_registration_seconds"`
	FromAssignmentSeconds  *int  `json:"from_assignment_seconds"`
	WithinFromRegistration *bool `json:"within_from_registration"`
	WithinFromAssignment   *bool `json:"within_from_assignment"`
}

var (
	assignmentMu    sync.Mutex
	assignmentStore []Assignment
	eventMu         sync.Mutex
	eventStore      []AssignmentEvent
	comparisonMu    sync.Mutex
	comparisonStore []AssignmentComparison
	assignSeeded    bool
	eventSeeded     bool
	comparisonSeed  bool
)

// ResetDispatchAssignmentsForTest: clear 3 stores.
func ResetDispatchAssignmentsForTest() {
	assignmentMu.Lock()
	assignmentStore, assignSeeded = nil, true
	assignmentMu.Unlock()
	eventMu.Lock()
	eventStore, eventSeeded = nil, true
	eventMu.Unlock()
	comparisonMu.Lock()
	comparisonStore, comparisonSeed = nil, true
	comparisonMu.Unlock()
}

// ReloadDispatchAssignmentsForTest: fixtures again.
func ReloadDispatchAssignmentsForTest() {
	assignmentMu.Lock()
	assignmentStore, assignSeeded = nil, false
	assignmentMu.Unlock()
	eventMu.Lock()
	eventStore, eventSeeded = nil, false
	eventMu.Unlock()
	comparisonMu.Lock()
	comparisonStore, comparisonSeed = nil, false
	comparisonMu.Unlock()
}

func seedAssignmentsLocked() {
	if assignSeeded {
		return
	}
	assignSeeded = true
	if rows, err := fixtures.Records[Assignment]("Assignment"); err == nil {
		assignmentStore = append(append([]Assignment(nil), rows...), assignmentStore...)
	}
}

func seedEventsLocked() {
	if eventSeeded {
		return
	}
	eventSeeded = true
	if rows, err := fixtures.Records[AssignmentEvent]("AssignmentEvent"); err == nil {
		eventStore = append(append([]AssignmentEvent(nil), rows...), eventStore...)
	}
}

func seedComparisonsLocked() {
	if comparisonSeed {
		return
	}
	comparisonSeed = true
	if rows, err := fixtures.Records[AssignmentComparison]("AssignmentComparison"); err == nil {
		comparisonStore = append(append([]AssignmentComparison(nil), rows...), comparisonStore...)
	}
}

// SeedAssignmentComparisonsForTest: seed rows.
func SeedAssignmentComparisonsForTest(rows []AssignmentComparison) {
	comparisonMu.Lock()
	comparisonStore, comparisonSeed = append([]AssignmentComparison(nil), rows...), true
	comparisonMu.Unlock()
}

func upsertAssignmentMemory(a Assignment) {
	assignmentMu.Lock()
	defer assignmentMu.Unlock()
	seedAssignmentsLocked()
	for i, x := range assignmentStore {
		if x.ID == a.ID {
			assignmentStore[i] = a
			return
		}
	}
	assignmentStore = append(assignmentStore, a)
}

func allAssignmentsMemory() []Assignment {
	assignmentMu.Lock()
	defer assignmentMu.Unlock()
	seedAssignmentsLocked()
	return append([]Assignment(nil), assignmentStore...)
}

func oneAssignmentMemory(id string) *Assignment {
	for _, a := range allAssignmentsMemory() {
		if a.ID == id {
			row := a
			return &row
		}
	}
	return nil
}

func appendAssignmentEventsMemory(rows []AssignmentEvent) {
	eventMu.Lock()
	defer eventMu.Unlock()
	seedEventsLocked()
	for _, e := range rows {
		found := false
		for i, x := range eventStore {
			if x.ID == e.ID {
				eventStore[i] = e
				found = true
				break
			}
		}
		if !found {
			eventStore = append(eventStore, e)
		}
	}
}

func allAssignmentEventsMemory() []AssignmentEvent {
	eventMu.Lock()
	defer eventMu.Unlock()
	seedEventsLocked()
	return append([]AssignmentEvent(nil), eventStore...)
}

func allAssignmentComparisonsMemory() []AssignmentComparison {
	comparisonMu.Lock()
	defer comparisonMu.Unlock()
	seedComparisonsLocked()
	return append([]AssignmentComparison(nil), comparisonStore...)
}

// dispatchCaseZones: zones of the named cases.
func dispatchCaseZones(ctx context.Context, conn *tenancy.Connection, tenantID string, rows []Assignment) (map[string]string, error) {
	ids := []string{}
	seen := map[string]bool{}
	for _, a := range rows {
		if canonicalUUID(a.CaseID) && !seen[a.CaseID] {
			seen[a.CaseID] = true
			ids = append(ids, a.CaseID)
		}
	}
	out := map[string]string{}
	if len(ids) > 0 {
		pairs, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([][2]string, error) {
			rows, err := tx.Query(ctx, `SELECT id::text, coalesce(zone_id::text, '') FROM cases WHERE id = ANY($1::uuid[])`, ids)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			var got [][2]string
			for rows.Next() {
				var p [2]string
				if err := rows.Scan(&p[0], &p[1]); err != nil {
					return nil, err
				}
				got = append(got, p)
			}
			return got, rows.Err()
		})
		if err != nil {
			return nil, err
		}
		for _, p := range pairs {
			out[p[0]] = p[1]
		}
	}
	for _, c := range allReplayCases() {
		out[c.ID] = c.ZoneID
	}
	return out, nil
}

// AssignmentQuery mirrors listAssignments's query.
type AssignmentQuery struct {
	Limit   int
	Cursor  string
	ZoneID  string
	From    string
	To      string
	CaseID  string
	AgentID string
	Source  string
}

// ListAssignments mirrors listAssignments.
func ListAssignments(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query AssignmentQuery) (datactx.PageResult[Assignment], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return datactx.PageResult[Assignment]{}, err
	}
	rows, err := loadAssignments(ctx, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[Assignment]{}, err
	}
	zones, err := dispatchCaseZones(ctx, conn, rc.CustomerID, rows)
	if err != nil {
		return datactx.PageResult[Assignment]{}, err
	}
	var out []Assignment
	for _, a := range rows {
		zone := zones[a.CaseID]
		var zonePtr *string
		if zone != "" {
			zonePtr = &zone
		}
		if !reqctx.CanReadZone(rc, zonePtr) {
			continue
		}
		if query.ZoneID != "" && zone != query.ZoneID {
			continue
		}
		if query.CaseID != "" && a.CaseID != query.CaseID {
			continue
		}
		if query.AgentID != "" && a.AgentID != query.AgentID {
			continue
		}
		if query.Source != "" && a.Source != query.Source {
			continue
		}
		inRange, err := datactx.InTimeRange(a.DecidedAt, query.From, query.To)
		if err != nil {
			return datactx.PageResult[Assignment]{}, err
		}
		if !inRange {
			continue
		}
		out = append(out, a)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].DecidedAt != out[j].DecidedAt {
			return out[i].DecidedAt > out[j].DecidedAt
		}
		return out[i].ID > out[j].ID
	})
	return datactx.Paginate(out, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

func dispatchZoneOfCase(ctx context.Context, conn *tenancy.Connection, tenantID, caseID string) (*string, error) {
	live, err := oneCaseLive(ctx, conn, tenantID, caseID)
	if err != nil {
		return nil, err
	}
	if live != nil {
		zid := live.ZoneID
		return &zid, nil
	}
	for _, c := range allReplayCases() {
		if c.ID == caseID {
			zid := c.ZoneID
			return &zid, nil
		}
	}
	return nil, nil
}

func dispatchReadableAssignment(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (Assignment, error) {
	found, err := loadAssignment(ctx, rc.CustomerID, id)
	if err != nil {
		return Assignment{}, err
	}
	a, err := datactx.RequireFound(found, "Assignment")
	if err != nil {
		return Assignment{}, err
	}
	zone, err := dispatchZoneOfCase(ctx, conn, rc.CustomerID, a.CaseID)
	if err != nil {
		return Assignment{}, err
	}
	if !reqctx.CanReadZone(rc, zone) {
		return Assignment{}, dataerr.NotFound("Assignment not found.")
	}
	return *a, nil
}

// GetAssignment mirrors getAssignment.
func GetAssignment(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (Assignment, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return Assignment{}, err
	}
	if _, err := importutil.RequireID(id, "Assignment"); err != nil {
		return Assignment{}, err
	}
	return dispatchReadableAssignment(ctx, conn, rc, id)
}

// ListAssignmentEvents mirrors listAssignmentEvents.
func ListAssignmentEvents(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, query datactx.PageQuery) (datactx.PageResult[AssignmentEvent], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return datactx.PageResult[AssignmentEvent]{}, err
	}
	if _, err := importutil.RequireID(id, "Assignment"); err != nil {
		return datactx.PageResult[AssignmentEvent]{}, err
	}
	assignment, err := dispatchReadableAssignment(ctx, conn, rc, id)
	if err != nil {
		return datactx.PageResult[AssignmentEvent]{}, err
	}
	var out []AssignmentEvent
	all, err := loadAssignmentEvents(ctx, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[AssignmentEvent]{}, err
	}
	for _, e := range all {
		if e.AssignmentID != nil && *e.AssignmentID == assignment.ID {
			out = append(out, e)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].OccurredAt != out[j].OccurredAt {
			return out[i].OccurredAt < out[j].OccurredAt
		}
		return out[i].ID < out[j].ID
	})
	return datactx.Paginate(out, query)
}

// ShadowComparisonQuery: the list-comparisons query.
type ShadowComparisonQuery struct {
	Limit  int
	Cursor string
	ZoneID string
	From   string
	To     string
}

func dispatchComparisons(ctx context.Context, rc reqctx.RequestContext, query ShadowComparisonQuery) ([]AssignmentComparison, error) {
	var out []AssignmentComparison
	all, err := loadAssignmentComparisons(ctx, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	for _, c := range all {
		zid := c.ZoneID
		if !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		if query.ZoneID != "" && c.ZoneID != query.ZoneID {
			continue
		}
		inRange, err := datactx.InTimeRange(c.ComparedAt, query.From, query.To)
		if err != nil {
			return nil, err
		}
		if !inRange {
			continue
		}
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].ComparedAt != out[j].ComparedAt {
			return out[i].ComparedAt > out[j].ComparedAt
		}
		return out[i].ID > out[j].ID
	})
	return out, nil
}

// ListShadowComparisons mirrors the TS function.
func ListShadowComparisons(rc reqctx.RequestContext, query ShadowComparisonQuery) (datactx.PageResult[AssignmentComparison], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return datactx.PageResult[AssignmentComparison]{}, err
	}
	rows, err := dispatchComparisons(context.Background(), rc, query)
	if err != nil {
		return datactx.PageResult[AssignmentComparison]{}, err
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

func dispatchMedian(values []float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	mid := len(sorted) / 2
	var m float64
	if len(sorted)%2 == 1 {
		m = sorted[mid]
	} else {
		m = (sorted[mid-1] + sorted[mid]) / 2
	}
	return &m
}

// (ServiceLevelReading already in dashboards.go.)

func dispatchReadingOf(flags []*bool) ServiceLevelReading {
	var known []bool
	for _, f := range flags {
		if f != nil {
			known = append(known, *f)
		}
	}
	within := 0
	for _, k := range known {
		if k {
			within++
		}
	}
	r := ServiceLevelReading{WithinCount: within, CaseCount: len(known)}
	if len(known) > 0 {
		s := float64(int(float64(within)/float64(len(known))*10_000+0.5)) / 10_000
		r.Share = &s
	}
	return r
}

// ShadowSideSummary mirrors the contract type.
type ShadowSideSummary struct {
	MedianTravelSeconds *float64            `json:"median_travel_seconds"`
	FromRegistration    ServiceLevelReading `json:"from_registration"`
	FromAssignment      ServiceLevelReading `json:"from_assignment"`
}

// ShadowComparisonSummary mirrors the contract type.
type ShadowComparisonSummary struct {
	ZoneID        *string           `json:"zone_id"`
	From          string            `json:"from"`
	To            string            `json:"to"`
	CasesCompared int               `json:"cases_compared"`
	DifferedCount int               `json:"differed_count"`
	OpenDispatch  ShadowSideSummary `json:"opendispatch"`
	Customer      ShadowSideSummary `json:"customer"`
	Illustrative  bool              `json:"illustrative"`
	DataSource    string            `json:"data_source"`
}

// GetShadowComparisonSummary: both 10-min readings
// for each side, always. Every figure Illustrative.
func GetShadowComparisonSummary(rc reqctx.RequestContext, query ShadowComparisonQuery) (ShadowComparisonSummary, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return ShadowComparisonSummary{}, err
	}
	rows, err := dispatchComparisons(context.Background(), rc, query)
	if err != nil {
		return ShadowComparisonSummary{}, err
	}
	var times []int64
	for _, r := range rows {
		t, err := datactx.EpochOf(r.ComparedAt)
		if err == nil {
			times = append(times, t.UnixMilli())
		}
	}
	side := func(pick func(AssignmentComparison) ComparisonSide, travel func(AssignmentComparison) *int) ShadowSideSummary {
		var travelVals []float64
		var fromReg, fromAssign []*bool
		for _, r := range rows {
			if v := travel(r); v != nil {
				travelVals = append(travelVals, float64(*v))
			}
			s := pick(r)
			fromReg = append(fromReg, s.Reading.WithinFromRegistration)
			fromAssign = append(fromAssign, s.Reading.WithinFromAssignment)
		}
		return ShadowSideSummary{MedianTravelSeconds: dispatchMedian(travelVals), FromRegistration: dispatchReadingOf(fromReg), FromAssignment: dispatchReadingOf(fromAssign)}
	}
	differed := 0
	for _, r := range rows {
		if !r.SameAgent {
			differed++
		}
	}
	clock, err := readDispatchClock(context.Background(), rc.CustomerID)
	if err != nil {
		return ShadowComparisonSummary{}, err
	}
	from, to := query.From, query.To
	if from == "" {
		if len(times) == 0 {
			from = isoAtMs(clock.AtMs)
		} else {
			min := times[0]
			for _, t := range times {
				if t < min {
					min = t
				}
			}
			from = isoAtMs(min)
		}
	}
	if to == "" {
		if len(times) == 0 {
			to = isoAtMs(clock.AtMs)
		} else {
			max := times[0]
			for _, t := range times {
				if t > max {
					max = t
				}
			}
			to = isoAtMs(max)
		}
	}
	var zonePtr *string
	if query.ZoneID != "" {
		zonePtr = &query.ZoneID
	}
	return ShadowComparisonSummary{
		ZoneID: zonePtr, From: from, To: to, CasesCompared: len(rows), DifferedCount: differed,
		OpenDispatch: side(func(c AssignmentComparison) ComparisonSide { return c.OpenDispatch }, func(c AssignmentComparison) *int { return c.OpenDispatch.EstimatedTravelSeconds }),
		Customer:     side(func(c AssignmentComparison) ComparisonSide { return c.Customer }, func(c AssignmentComparison) *int { return c.Customer.ActualTravelSeconds }),
		Illustrative: true, DataSource: "SYNTHETIC",
	}, nil
}

// -------------------------------------------------
// Decisions (writes): accept, override.
// -------------------------------------------------

// DispatchDecisionTarget mirrors DecisionTarget.
type DispatchDecisionTarget struct {
	C       Case
	Stage   string
	Output  *AssignmentEngineOutput
	AtMs    int64
	Current LiveCase
}

func dispatchDecisionTarget(ctx context.Context, rc reqctx.RequestContext, caseID string) (DispatchDecisionTarget, error) {
	clock, err := readDispatchClock(ctx, rc.CustomerID)
	if err != nil {
		return DispatchDecisionTarget{}, err
	}
	allCases, outputs, err := dispatchCasesAndOutputs(ctx, rc.CustomerID)
	if err != nil {
		return DispatchDecisionTarget{}, err
	}
	var found *Case
	for _, c := range allCases {
		t, terr := datactx.EpochOf(c.RegisteredAt)
		if c.ID == caseID && terr == nil && t.UnixMilli() <= clock.AtMs {
			row := c
			found = &row
			break
		}
	}
	c, err := datactx.RequireFound(found, "Case")
	if err != nil {
		return DispatchDecisionTarget{}, err
	}
	zid := c.ZoneID
	if err := reqctx.RequireWriteZone(rc, &zid); err != nil {
		return DispatchDecisionTarget{}, err
	}
	env, err := dispatchEnvironment(ctx, rc, clock.AtMs, []Case{*c})
	if err != nil {
		return DispatchDecisionTarget{}, err
	}
	var output *AssignmentEngineOutput
	if o, ok := outputs[c.ID]; ok {
		output = &o
	}
	stage := env.Stages[c.ZoneID]
	if stage == "" {
		stage = "shadow"
	}
	current, err := dispatchLiveCase(*c, env, outputs)
	if err != nil {
		return DispatchDecisionTarget{}, err
	}
	return DispatchDecisionTarget{C: *c, Stage: stage, Output: output, AtMs: clock.AtMs, Current: current}, nil
}

func dispatchEventRecord(rc reqctx.RequestContext, assignmentID, caseID, eventType string, atMs int64, source string, reason, note, actor *string, detail map[string]any) AssignmentEvent {
	at := datactx.NowISO()
	if detail == nil {
		detail = map[string]any{}
	}
	return AssignmentEvent{
		BaseRecord: datactx.NewRecord(rc, "", at), AssignmentID: &assignmentID, CaseID: caseID, EventType: eventType,
		OccurredAt: isoAtMs(atMs), Source: source, ActorUserID: actor, ReasonCode: reason, Note: note, Detail: detail,
	}
}

// dispatchRequireUnassigned: the operator fallback rule -- nothing is
// sent for a case that already has an assignment.
func dispatchRequireUnassigned(t DispatchDecisionTarget) error {
	if customerAssigned(t.Current) {
		return dataerr.Conflict(fmt.Sprintf("CUSTOMER_ASSIGNED: %s was assigned by %s dispatch; OpenDispatch sends nothing for it.", t.C.CaseNumber, customerEn()))
	}
	if t.Current.State == "assigned" || t.Current.State == "fallback_assigned" || t.Current.State == "overridden" {
		src := "no source"
		if t.Current.AssignmentSource != nil {
			src = *t.Current.AssignmentSource
		}
		return dataerr.Conflict(fmt.Sprintf("ALREADY_ASSIGNED: %s already has an assignment (%s).", t.C.CaseNumber, src))
	}
	return nil
}

// customerAssigned: The customer's feed shows its assignment.
func customerAssigned(c LiveCase) bool {
	return c.AssignmentID == nil && c.CustomerAgentID != nil && isCustomerSource(c)
}

// isCustomerSource: no OpenDispatch row is recorded for it.
func isCustomerSource(c LiveCase) bool {
	return c.AssignmentSource != nil && *c.AssignmentSource == "CUSTOMER_FALLBACK"
}

// auditAlreadyAssigned: the audit-every-write rule, refusal audited.
func auditAlreadyAssigned(rc reqctx.RequestContext, action, caseID string, err error) {
	var de *dataerr.DataError
	if !errors.As(err, &de) {
		return
	}
	reason := ""
	for _, r := range []string{"ALREADY_ASSIGNED", "CUSTOMER_ASSIGNED"} {
		if strings.HasPrefix(de.Message, r) {
			reason = r
		}
	}
	if reason == "" {
		return
	}
	_, _ = auditlog.RecordAudit(rc, auditlog.AuditInput{
		Action: action, EntityType: "case", EntityID: &caseID, SummaryEn: "Denied: " + de.Message, Outcome: "denied",
		Detail: map[string]any{"case_id": caseID, "reason": reason},
	}, "", "")
}

// AcceptRecommendation mirrors acceptRecommendation.
func AcceptRecommendation(rc reqctx.RequestContext, caseID string, body any) (Assignment, error) {
	out, err := acceptRecommendation(rc, caseID, body)
	auditAlreadyAssigned(rc, "assignment.accepted", caseID, err)
	return out, err
}

func acceptRecommendation(rc reqctx.RequestContext, caseID string, body any) (Assignment, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleOpsLiveDispatchBoard}, auditlog.WriteMeta{Action: "assignment.accepted", EntityType: "case", EntityID: &caseID}, func(ctx context.Context) (auditlog.AuditedWrite[Assignment], error) {
		if _, err := importutil.RequireID(caseID, "Case"); err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		o, err := datactx.Object(body, "Accept recommendation", []string{"agent_id"})
		if err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		agentID, err := datactx.UUID(o, "agent_id")
		if err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		t, err := dispatchDecisionTarget(ctx, rc, caseID)
		if err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		if t.Stage == "shadow" {
			return auditlog.AuditedWrite[Assignment]{}, dataerr.Conflict("This zone is in shadow stage: OpenDispatch decides silently and sends nothing.")
		}
		if err := dispatchRequireUnassigned(t); err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		var top *AssignmentEngineRanked
		if t.Output != nil && t.Output.Status == "ranked" && len(t.Output.Ranking) > 0 {
			top = &t.Output.Ranking[0]
		}
		if top == nil || t.Current.State != "recommended" {
			return auditlog.AuditedWrite[Assignment]{}, dataerr.Conflict("There is no recommendation to accept for this case.")
		}
		if top.AgentID != agentID {
			return auditlog.AuditedWrite[Assignment]{}, dataerr.Conflict("CONFLICT: the recommendation changed. Reload the case.")
		}
		at := datactx.NowISO()
		userID := rc.UserID
		var modelVersion *string
		if t.Output != nil {
			modelVersion = &t.Output.ModelVersion
		}
		arrival, travel := top.EstimatedArrivalAt, top.EstimatedTravelSeconds
		assignment := Assignment{
			BaseRecord: datactx.NewRecord(rc, "", at), CaseID: t.C.ID, AgentID: top.AgentID, DecidedAt: isoAtMs(t.AtMs),
			Source: "OPENDISPATCH", Stage: t.Stage, State: "assigned", EstimatedArrivalAt: &arrival, EstimatedTravelSeconds: &travel,
			DecidedByUserID: &userID, ModelVersion: modelVersion, Extra: map[string]any{"illustrative": true},
		}
		generatedAt := t.C.RegisteredAt
		if t.Output != nil {
			generatedAt = t.Output.GeneratedAt
		}
		genT, gerr := datactx.EpochOf(generatedAt)
		genMs := t.AtMs
		if gerr == nil {
			genMs = genT.UnixMilli()
		}
		if err := saveDecision(ctx, rc.CustomerID, []Assignment{assignment}, []AssignmentEvent{
			dispatchEventRecord(rc, assignment.ID, t.C.ID, "recommended", genMs, "OPENDISPATCH", nil, nil, nil, map[string]any{"rank": 1}),
			dispatchEventRecord(rc, assignment.ID, t.C.ID, "accepted", t.AtMs, "OPENDISPATCH", nil, nil, &userID, nil),
			dispatchEventRecord(rc, assignment.ID, t.C.ID, "sent", t.AtMs+2000, "OPENDISPATCH", nil, nil, nil, nil),
		}); err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		return auditlog.AuditedWrite[Assignment]{
			Result: assignment, EntityID: &t.C.ID, SummaryEn: fmt.Sprintf("Recommendation accepted for %s.", t.C.CaseNumber),
			Detail: map[string]any{"assignment_id": assignment.ID, "agent_id": top.AgentID, "source": "OPENDISPATCH"},
		}, nil
	})
}

func parseDispatchReasonCode(o datactx.Obj) (string, error) {
	if !datactx.Has(o, "reason_code") || o["reason_code"] == nil {
		return "", dataerr.Invalid("REASON_REQUIRED: a reason code is required for a manual change.")
	}
	return datactx.EnumOf(o, "reason_code", dispatchReasonCodes)
}

// OverrideAssignment mirrors overrideAssignment.
func OverrideAssignment(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, caseID string, body any) (Assignment, error) {
	out, err := overrideAssignment(ctx, conn, rc, caseID, body)
	auditAlreadyAssigned(rc, "assignment.overridden", caseID, err)
	return out, err
}

func overrideAssignment(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, caseID string, body any) (Assignment, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsLiveDispatchBoard}, auditlog.WriteMeta{Action: "assignment.overridden", EntityType: "case", EntityID: &caseID}, func(ctx context.Context) (auditlog.AuditedWrite[Assignment], error) {
		if _, err := importutil.RequireID(caseID, "Case"); err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		o, err := datactx.Object(body, "Override", []string{"agent_id", "reason_code", "note"})
		if err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		agentID, err := datactx.UUID(o, "agent_id")
		if err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		reason, err := parseDispatchReasonCode(o)
		if err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		note, err := datactx.NullableString(o, "note", datactx.StrOpts{HasMax: true, Max: 500})
		if err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		if reason == "other" && (note == nil || strings.TrimSpace(*note) == "") {
			return auditlog.AuditedWrite[Assignment]{}, dataerr.Invalid("REASON_REQUIRED: a note is required when the reason code is other.")
		}
		agentRow, err := oneAgent(ctx, conn, rc.CustomerID, agentID)
		if err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		agent, err := datactx.RequireFound(agentRow, "Agent")
		if err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		if agent.Kind != "field" || !agent.IsActive {
			return auditlog.AuditedWrite[Assignment]{}, dataerr.Invalid("Override: choose an active field agent.")
		}
		t, err := dispatchDecisionTarget(ctx, rc, caseID)
		if err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		if t.Stage == "shadow" {
			return auditlog.AuditedWrite[Assignment]{}, dataerr.Conflict("This zone is in shadow stage: OpenDispatch sends nothing, " + customerEn() + " dispatch assigns.")
		}
		var previous *Assignment
		if t.Current.AssignmentID != nil {
			previous, err = loadAssignment(ctx, rc.CustomerID, *t.Current.AssignmentID)
			if err != nil {
				return auditlog.AuditedWrite[Assignment]{}, err
			}
		}
		if (t.Current.State == "overridden" || customerAssigned(t.Current)) && previous == nil && t.Current.AssignedAgentID != nil && *t.Current.AssignedAgentID == agentID {
			return auditlog.AuditedWrite[Assignment]{}, dataerr.Conflict("The case is already assigned to this agent.")
		}
		var chosen *AssignmentEngineRanked
		if t.Output != nil {
			for i := range t.Output.Ranking {
				if t.Output.Ranking[i].AgentID == agentID {
					chosen = &t.Output.Ranking[i]
					break
				}
			}
		}
		at := datactx.NowISO()
		userID := rc.UserID
		var written []Assignment
		var events []AssignmentEvent

		if previous != nil {
			superseded := *previous
			superseded.State, superseded.UpdatedAt = "superseded", at
			written = append(written, superseded)
		} else if t.Output != nil && t.Output.Status == "ranked" && len(t.Output.Ranking) > 0 && t.Current.Recommendation != nil && !isCustomerSource(t.Current) {
			top := t.Output.Ranking[0]
			genT, gerr := datactx.EpochOf(t.Output.GeneratedAt)
			genMs := t.AtMs
			if gerr == nil {
				genMs = genT.UnixMilli()
			}
			modelVersion := t.Output.ModelVersion
			arrival, travel := top.EstimatedArrivalAt, top.EstimatedTravelSeconds
			recommended := Assignment{
				BaseRecord: datactx.NewRecord(rc, datactx.NewID(), at), CaseID: t.C.ID, AgentID: top.AgentID, DecidedAt: isoAtMs(genMs),
				Source: "OPENDISPATCH", Stage: t.Stage, State: "overridden", ReasonCode: &reason, ReasonNote: note,
				EstimatedArrivalAt: &arrival, EstimatedTravelSeconds: &travel, DecidedByUserID: &userID, ModelVersion: &modelVersion,
				Extra: map[string]any{"illustrative": true},
			}
			written = append(written, recommended)
			events = append(events, dispatchEventRecord(rc, recommended.ID, t.C.ID, "recommended", genMs, "OPENDISPATCH", nil, nil, nil, map[string]any{"rank": 1}))
		}
		manual := Assignment{
			BaseRecord: datactx.NewRecord(rc, datactx.NewID(), at), CaseID: t.C.ID, AgentID: agentID, DecidedAt: isoAtMs(t.AtMs),
			Source: "MANUAL", Stage: t.Stage, State: "assigned", ReasonCode: &reason, ReasonNote: note, DecidedByUserID: &userID,
			Extra: map[string]any{"illustrative": true},
		}
		if chosen != nil {
			arrival, travel := chosen.EstimatedArrivalAt, chosen.EstimatedTravelSeconds
			manual.EstimatedArrivalAt, manual.EstimatedTravelSeconds = &arrival, &travel
		}
		written = append(written, manual)
		fromAgent := t.Current.AssignedAgentID
		if fromAgent == nil && t.Current.Recommendation != nil {
			fromAgent = &t.Current.Recommendation.AgentID
		}
		events = append(events,
			dispatchEventRecord(rc, manual.ID, t.C.ID, "overridden", t.AtMs, "MANUAL", &reason, note, &userID, map[string]any{"from_agent_id": fromAgent, "to_agent_id": agentID}),
			dispatchEventRecord(rc, manual.ID, t.C.ID, "sent", t.AtMs+2000, "MANUAL", nil, nil, nil, nil),
		)
		if err := saveDecision(ctx, rc.CustomerID, written, events); err != nil {
			return auditlog.AuditedWrite[Assignment]{}, err
		}
		return auditlog.AuditedWrite[Assignment]{
			Result: manual, EntityID: &t.C.ID, SummaryEn: fmt.Sprintf("%s assigned to another agent (%s).", t.C.CaseNumber, strings.ReplaceAll(reason, "_", " ")),
			Detail: map[string]any{"assignment_id": manual.ID, "agent_id": agentID, "reason_code": reason, "note": note, "source": "MANUAL"},
		}, nil
	})
}

// -------------------------------------------------
// Replay controls and fallback controls (demo only;
// not available in oidc mode).
// -------------------------------------------------

// ControlReplay: only a denial is audited.
func ControlReplay(rc reqctx.RequestContext, body any) (ReplayState, error) {
	guard := auditlog.Guard{ModuleID: access.ModuleOpsLiveDispatchBoard}
	if err := auditlog.GuardWithAudit(rc, guard, auditlog.WriteMeta{Action: "replay.controlled", EntityType: "replay"}); err != nil {
		return ReplayState{}, err
	}
	if dispatchFromFeeds() {
		return ReplayState{}, dataerr.Conflict("Replay controls are off while the board reads the live feeds.")
	}
	o, err := datactx.Object(body, "Replay control", []string{"action", "replay_at", "speed"})
	if err != nil {
		return ReplayState{}, err
	}
	action, err := datactx.EnumOf(o, "action", []string{"play", "pause", "stop", "seek", "set_speed"})
	if err != nil {
		return ReplayState{}, err
	}
	clock, err := readDispatchClock(context.Background(), rc.CustomerID)
	if err != nil {
		return ReplayState{}, err
	}
	s, err := dispatchScript()
	if err != nil {
		return ReplayState{}, err
	}
	var speedGiven *float64
	if datactx.Has(o, "speed") && o["speed"] != nil {
		v, err := datactx.Number(o, "speed", datactx.NumOpts{HasMin: true, Min: dispatchMinSpeed, HasMax: true, Max: dispatchMaxSpeed})
		if err != nil {
			return ReplayState{}, err
		}
		speedGiven = &v
	}
	startT, err := datactx.EpochOf(s.DefaultStartAt)
	if err != nil {
		return ReplayState{}, err
	}
	startMs := startT.UnixMilli()
	wall := nowMs()
	switch action {
	case "play":
		atMs := clock.AtMs
		if clock.Status == "finished" {
			atMs = startMs
		}
		speed := clock.Speed
		if speedGiven != nil {
			speed = *speedGiven
		}
		w := wall
		if err := writeDispatchClock(context.Background(), rc.CustomerID, "playing", atMs, speed, &w); err != nil {
			return ReplayState{}, err
		}
	case "pause":
		status := "paused"
		if clock.Status == "stopped" {
			status = "stopped"
		}
		if err := writeDispatchClock(context.Background(), rc.CustomerID, status, clock.AtMs, clock.Speed, nil); err != nil {
			return ReplayState{}, err
		}
	case "stop":
		if err := writeDispatchClock(context.Background(), rc.CustomerID, "stopped", startMs, clock.Speed, nil); err != nil {
			return ReplayState{}, err
		}
		if err := settingsstore.Put(context.Background(), rc.CustomerID, "dispatch.fallback_log", []DispatchFallbackEvent{}); err != nil {
			return ReplayState{}, err
		}
	case "seek":
		if !datactx.Has(o, "replay_at") || o["replay_at"] == nil {
			return ReplayState{}, dataerr.Invalid("Replay: seek needs replay_at.")
		}
		target, err := datactx.String(o, "replay_at", datactx.StrOpts{})
		if err != nil {
			return ReplayState{}, err
		}
		ms, err := datactx.EpochOf(target)
		if err != nil {
			return ReplayState{}, err
		}
		dayStart, err := datactx.EpochOf(s.ReplayDate + "T00:00:00+03:00")
		if err != nil {
			return ReplayState{}, err
		}
		end, err := dispatchDayEndMs(s)
		if err != nil {
			return ReplayState{}, err
		}
		if ms.UnixMilli() < dayStart.UnixMilli() || ms.UnixMilli() > end {
			return ReplayState{}, dataerr.Invalid("Replay: replay_at is outside the replay day.")
		}
		status := "paused"
		var anchor *int64
		if clock.Status == "playing" {
			status = "playing"
			w := wall
			anchor = &w
		}
		if err := writeDispatchClock(context.Background(), rc.CustomerID, status, ms.UnixMilli(), clock.Speed, anchor); err != nil {
			return ReplayState{}, err
		}
	case "set_speed":
		if speedGiven == nil {
			return ReplayState{}, dataerr.Invalid("Replay: set_speed needs speed.")
		}
		status := clock.Status
		if status == "finished" {
			status = "paused"
		}
		var anchor *int64
		if clock.Status == "playing" {
			w := wall
			anchor = &w
		}
		if err := writeDispatchClock(context.Background(), rc.CustomerID, status, clock.AtMs, *speedGiven, anchor); err != nil {
			return ReplayState{}, err
		}
	}
	snap, err := dispatchSnapshot(context.Background(), rc)
	if err != nil {
		return ReplayState{}, err
	}
	return snap.Replay, nil
}

func dispatchAppendFallbackEvent(ctx context.Context, tenant string, e DispatchFallbackEvent) error {
	log, err := readSettingStrict(ctx, tenant, "dispatch.fallback_log", []DispatchFallbackEvent(nil))
	if err != nil {
		return err
	}
	return settingsstore.Put(ctx, tenant, "dispatch.fallback_log", append(append([]DispatchFallbackEvent(nil), log...), e))
}

// SimulateFeedOutage: demo only. Cases registered
// while a feed is down go to the customer's dispatch.
func SimulateFeedOutage(rc reqctx.RequestContext, body any) (FallbackState, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleOpsLiveDispatchBoard}, auditlog.WriteMeta{Action: "fallback.outage_simulated", EntityType: "integration"}, func(ctx context.Context) (auditlog.AuditedWrite[FallbackState], error) {
		if dispatchFromFeeds() {
			return auditlog.AuditedWrite[FallbackState]{}, dataerr.Conflict("A simulated outage is off while the board reads the live feeds.")
		}
		o, err := datactx.Object(body, "Feed outage", []string{"feed", "active"})
		if err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		feed, err := datactx.EnumOf(o, "feed", dispatchFeeds)
		if err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		active, err := datactx.Bool(o, "active")
		if err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		clock, err := readDispatchClock(ctx, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		if err := dispatchAppendFallbackEvent(ctx, rc.CustomerID, DispatchFallbackEvent{At: isoAtMs(clock.AtMs), Kind: "outage", Feed: feed, Active: active}); err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		snap, err := dispatchSnapshot(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		if active {
			raiseNotification(ctx, rc, "fallback_active", RaisedNotification{TitleEn: customerEnTitle() + " fallback is active", BodyEn: strPtrOrNil(fmt.Sprintf("The %s is down. %s dispatch is assigning cases.", strings.ReplaceAll(feed, "_", " "), customerEnTitle())), LinkPath: strPtr("/ops/live-dispatch-board")})
		}
		word := "recovery"
		if active {
			word = "outage"
		}
		return auditlog.AuditedWrite[FallbackState]{
			Result: snap.Fallback, EntityID: &feed, SummaryEn: fmt.Sprintf("Simulated %s of the %s; fallback is %s.", word, strings.ReplaceAll(feed, "_", " "), snap.Fallback.State),
			Detail: map[string]any{"feed": feed, "active": active},
		}, nil
	})
}

// SetMaintenanceMode mirrors setMaintenanceMode
// (admin.data_sources, DG6). While on, the customer's own
// dispatch assigns; audited even on a no-op repeat.
func SetMaintenanceMode(rc reqctx.RequestContext, body any) (FallbackState, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminDataSources}, auditlog.WriteMeta{Action: "fallback.maintenance_changed", EntityType: "fallback"}, func(ctx context.Context) (auditlog.AuditedWrite[FallbackState], error) {
		o, err := datactx.Object(body, "Maintenance mode", []string{"enabled"})
		if err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		enabled, err := datactx.Bool(o, "enabled")
		if err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		current, err := dispatchSnapshot(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		already := (current.Fallback.State == "maintenance") == enabled
		if !already {
			clock, err := readDispatchClock(ctx, rc.CustomerID)
			if err != nil {
				return auditlog.AuditedWrite[FallbackState]{}, err
			}
			if err := dispatchAppendFallbackEvent(ctx, rc.CustomerID, DispatchFallbackEvent{At: isoAtMs(clock.AtMs), Kind: "maintenance", Active: enabled}); err != nil {
				return auditlog.AuditedWrite[FallbackState]{}, err
			}
			if enabled {
				raiseNotification(ctx, rc, "fallback_active", RaisedNotification{TitleEn: customerEnTitle() + " fallback is active", BodyEn: strPtr("Maintenance mode is on. " + customerEnTitle() + " dispatch is assigning cases."), LinkPath: strPtr("/ops/live-dispatch-board")})
			}
		}
		snap, err := dispatchSnapshot(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		onOff := "off"
		if enabled {
			onOff = "on"
		}
		summary := fmt.Sprintf("Maintenance mode was already %s.", onOff)
		if !already {
			summary = fmt.Sprintf("Maintenance mode switched %s; fallback is %s.", onOff, snap.Fallback.State)
		}
		return auditlog.AuditedWrite[FallbackState]{Result: snap.Fallback, SummaryEn: summary, Detail: map[string]any{"enabled": enabled, "changed": !already}}, nil
	})
}

// SendFallbackSignal mirrors sendFallbackSignal
// (admin.data_sources): tells the customer's system to take
// over, or to hand control back.
func SendFallbackSignal(rc reqctx.RequestContext, body any) (FallbackState, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminDataSources}, auditlog.WriteMeta{Action: "fallback.signal_sent", EntityType: "fallback"}, func(ctx context.Context) (auditlog.AuditedWrite[FallbackState], error) {
		o, err := datactx.Object(body, "Fallback signal", []string{"signal", "reason"})
		if err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		signal, err := datactx.EnumOf(o, "signal", []string{"fallback", "resume"})
		if err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		reason, err := datactx.String(o, "reason", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 300})
		if err != nil {
			return auditlog.AuditedWrite[FallbackState]{}, err
		}
		return sendFallbackSignalIn(ctx, rc, DispatchFallbackEvent{Kind: "signal", Signal: signal, Reason: reason})
	})
}

// sendFallbackSignalIn: one path, person or system.
func sendFallbackSignalIn(ctx context.Context, rc reqctx.RequestContext, e DispatchFallbackEvent) (auditlog.AuditedWrite[FallbackState], error) {
	clock, err := readDispatchClock(ctx, rc.CustomerID)
	if err != nil {
		return auditlog.AuditedWrite[FallbackState]{}, err
	}
	e.At = isoAtMs(clock.AtMs)
	if err := dispatchAppendFallbackEvent(ctx, rc.CustomerID, e); err != nil {
		return auditlog.AuditedWrite[FallbackState]{}, err
	}
	snap, err := dispatchSnapshot(ctx, rc)
	if err != nil {
		return auditlog.AuditedWrite[FallbackState]{}, err
	}
	if e.Signal == "fallback" {
		reason := e.Reason
		raiseNotification(ctx, rc, "fallback_active", RaisedNotification{TitleEn: customerEnTitle() + " fallback is active", BodyEn: &reason, LinkPath: strPtr("/ops/live-dispatch-board")})
	}
	detail := map[string]any{"signal": e.Signal, "reason": e.Reason}
	if e.Cause != "" {
		detail["cause"], detail["zones"] = e.Cause, e.Zones
	}
	return auditlog.AuditedWrite[FallbackState]{
		Result: snap.Fallback, SummaryEn: fmt.Sprintf("Fallback signal sent: %s. %s", e.Signal, e.Reason), Detail: detail,
	}, nil
}
