// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
)

func useMockEngines(t *testing.T, deadline time.Duration) *enginetest.Server {
	t.Helper()
	srv := enginetest.New()
	urls := map[engines.Name]string{}
	for _, n := range engines.All {
		urls[n] = srv.URL
	}
	UseEngines(engines.Config{Mode: engines.ModeEngine, URLs: urls, AssignmentDeadline: deadline})
	t.Cleanup(func() {
		UseFixtureEngines()
		srv.Close()
	})
	return srv
}

func engineCase(id string) Case {
	return Case{ID: id, TenantID: tenantOfTest, DataSource: "SYNTHETIC", RegisteredAt: "2026-09-14T09:11:40+03:00", ZoneID: "z1", Latitude: 24.7, Longitude: 46.7, Handling: "field"}
}

func engineStates() []liveAgent {
	lat, lon := 24.71, 46.71
	return []liveAgent{{ID: "s1", Kind: "field", Status: "available", Lat: &lat, Lon: &lon, At: time.Now()}}
}

func rankedFor(caseID string) string {
	b, _ := json.Marshal(AssignmentEngineOutput{SchemaVersion: "1.0", RequestID: "r", Engine: AssignmentEngineRef{Name: "assignment", Version: "9"}, ModelVersion: "scorer-9",
		GeneratedAt: "2026-09-14T09:12:00+03:00", DataSource: "SYNTHETIC", Illustrative: true, CaseID: caseID, Status: "ranked", DecisionTimeMs: 40,
		Ranking: []AssignmentEngineRanked{{Rank: 1, AgentID: "s1", EstimatedTravelSeconds: 300, EstimatedArrivalAt: "2026-09-14T09:17:00+03:00", Score: 0.9, ReasonCodes: []string{"NEAREST_BY_TRAVEL_TIME"}, ReasonText: "x"}}})
	return string(b)
}

const tenantOfTest = "00000000-0000-4000-8000-0000000000aa"

func TestFixtureModeReadsTheFixturesAsBefore(t *testing.T) {
	UseFixtureEngines()
	var doc ForecasterEngineOutput
	found, err := readForecasterDocument(context.Background(), tenantOfTest, &doc)
	if err != nil || !found || doc.ModelVersion == "" {
		t.Fatalf("the forecaster fixture: found=%v err=%v", found, err)
	}
	for _, st := range EngineStatuses(tenantOfTest) {
		if st.Mode != engines.ModeFixture || st.Fallbacks != 0 {
			t.Fatalf("fixture mode: %+v", st)
		}
	}
}

func TestBatchEngineFailureIsCountedAsAFallback(t *testing.T) {
	srv := useMockEngines(t, time.Second)
	srv.Script(enginetest.Behavior{Kind: enginetest.Status500})
	var doc ForecasterEngineOutput
	build := func() ([]byte, error) { return []byte(`{}`), nil }
	found, err := engineDocument(context.Background(), tenantOfTest, engines.Forecaster, "forecaster.output", build, &doc)
	if err != nil || !found || doc.ModelVersion == "" {
		t.Fatalf("a failed call must still give the fixture: found=%v err=%v", found, err)
	}
	for _, st := range EngineStatuses(tenantOfTest) {
		if st.Name == engines.Forecaster && st.Fallbacks != 1 {
			t.Fatalf("a failed engine call is a fallback: %+v", st)
		}
	}
}

func TestBatchEngineWithoutARequestBuilderServesItsFixtureWithoutCountingAFallback(t *testing.T) {
	srv := useMockEngines(t, time.Second)
	var doc ForecasterEngineOutput
	found, err := readForecasterDocument(context.Background(), tenantOfTest, &doc)
	if err != nil || !found || doc.ModelVersion == "" {
		t.Fatalf("the fallback must still give the fixture: found=%v err=%v", found, err)
	}
	if n := len(srv.Requests()); n != 0 {
		t.Fatalf("no request can be built yet, but the engine saw %d", n)
	}
	for _, st := range EngineStatuses(tenantOfTest) {
		if st.Name == engines.Forecaster && st.Fallbacks != 0 {
			t.Fatalf("a read with nothing kept is not a fallback: %+v", st)
		}
	}
}

func TestAssignmentEngineAnswersAndItsRequestFollowsTheContract(t *testing.T) {
	srv := useMockEngines(t, time.Second)
	c := engineCase("c-answer")
	srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: rankedFor(c.ID)})
	out := engineAssignment(context.Background(), c, engineStates(), time.Now().UnixMilli(), "shadow")
	if out.Status != "ranked" || out.ModelVersion != "scorer-9" || len(out.Ranking) != 1 {
		t.Fatalf("the engine's answer must be used: %+v", out)
	}
	reqs := srv.Requests()
	if len(reqs) != 1 {
		t.Fatalf("%d requests", len(reqs))
	}
	var sent map[string]any
	if err := json.Unmarshal([]byte(reqs[0].Body), &sent); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"schema_version", "request_id", "requested_at", "data_source", "now", "case", "candidates", "decision_deadline_ms"} {
		if _, ok := sent[key]; !ok {
			t.Fatalf("the request lacks %s", key)
		}
	}
	if sent["decision_deadline_ms"].(float64) != 1000 {
		t.Fatalf("the deadline sent is %v", sent["decision_deadline_ms"])
	}
	// The same case is not asked again within the answer's life.
	engineAssignment(context.Background(), c, engineStates(), time.Now().UnixMilli(), "shadow")
	if n := len(srv.Requests()); n != 1 {
		t.Fatalf("a polled board asked again: %d requests", n)
	}
}

func TestAssignmentEngineThatIsLateOrWrongGivesNoAnswerNotAFixture(t *testing.T) {
	srv := useMockEngines(t, 60*time.Millisecond)
	slow := engineCase("c-slow")
	srv.Script(enginetest.Behavior{Kind: enginetest.Slow, Delay: 400 * time.Millisecond, Body: rankedFor(slow.ID)})
	out := engineAssignment(context.Background(), slow, engineStates(), time.Now().UnixMilli(), "shadow")
	if out.Status == "ranked" || len(out.Ranking) != 0 || !out.DeadlineExceeded {
		t.Fatalf("a late answer must be dropped and reported as a missed deadline: %+v", out)
	}
	// An answer for another case is refused.
	wrong := engineCase("c-wrong")
	srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: rankedFor("some-other-case")})
	if out := engineAssignment(context.Background(), wrong, engineStates(), time.Now().UnixMilli(), "shadow"); out.Status == "ranked" {
		t.Fatalf("an answer about another case was taken: %+v", out)
	}
	// Repeated failures open the breaker, and then the engine is not even asked.
	srv.Script(enginetest.Behavior{Kind: enginetest.Status500})
	for i := 0; i < 5; i++ {
		engineAssignment(context.Background(), engineCase("c-fail-"+string(rune('a'+i))), engineStates(), time.Now().UnixMilli(), "shadow")
	}
	var st EngineStatus
	for _, s := range EngineStatuses(tenantOfTest) {
		if s.Name == engines.Assignment {
			st = s
		}
	}
	if st.Stats.BreakerOpens < 1 || st.Stats.Rejected < 1 || st.Stats.Timeouts < 1 {
		t.Fatalf("the breaker and counters did not show the failures: %+v", st.Stats)
	}
	if !errors.Is(engines.ErrBreakerOpen, engines.ErrBreakerOpen) {
		t.Fatal("unreachable")
	}
}
