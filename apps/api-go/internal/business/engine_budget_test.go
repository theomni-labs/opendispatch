// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
)

// caseEngine answers after delay; hangs if < 0.
type caseEngine struct {
	*httptest.Server
	delay   time.Duration
	status  string
	release chan struct{}
	mu      sync.Mutex
	asked   map[string]int
}

func newCaseEngine(t *testing.T, deadline, delay time.Duration) *caseEngine {
	t.Helper()
	e := &caseEngine{delay: delay, status: "ranked", release: make(chan struct{}), asked: map[string]int{}}
	e.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var in struct {
			Case struct {
				ID string `json:"case_id"`
			} `json:"case"`
		}
		_ = json.Unmarshal(raw, &in)
		e.mu.Lock()
		e.asked[in.Case.ID]++
		e.mu.Unlock()
		if delay < 0 {
			select {
			case <-r.Context().Done():
			case <-e.release:
			}
			return
		}
		select {
		case <-time.After(delay):
		case <-r.Context().Done():
			return
		}
		e.mu.Lock()
		status := e.status
		e.mu.Unlock()
		if status == "500" {
			http.Error(w, "x", http.StatusInternalServerError)
			return
		}
		body := rankedFor(in.Case.ID)
		if status != "ranked" {
			var o AssignmentEngineOutput
			_ = json.Unmarshal([]byte(body), &o)
			o.Status, o.Ranking = status, []AssignmentEngineRanked{}
			b, _ := json.Marshal(o)
			body = string(b)
		}
		_, _ = w.Write([]byte(body))
	}))
	urls := map[engines.Name]string{}
	for _, n := range engines.All {
		urls[n] = e.URL
	}
	UseEngines(engines.Config{Mode: engines.ModeEngine, URLs: urls, AssignmentDeadline: deadline})
	t.Cleanup(func() {
		close(e.release)
		UseFixtureEngines()
		e.Server.Close()
	})
	return e
}

func (e *caseEngine) set(status string) {
	e.mu.Lock()
	e.status = status
	e.mu.Unlock()
}

func (e *caseEngine) requests() (total int, max int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, n := range e.asked {
		total += n
		if n > max {
			max = n
		}
	}
	return
}

func waitingCases(n int) []Case {
	cs := make([]Case, n)
	for i := range cs {
		cs[i] = engineCase(fmt.Sprintf("c-pool-%02d", i))
	}
	return cs
}

func countStatus(outs map[string]AssignmentEngineOutput, status string) int {
	n := 0
	for _, o := range outs {
		if o.Status == status {
			n++
		}
	}
	return n
}

func TestWaitingCasesAreAskedInParallelInsideOneBudget(t *testing.T) {
	e := newCaseEngine(t, 2*time.Second, 100*time.Millisecond)
	start := time.Now()
	outs := engineAssignments(context.Background(), waitingCases(25), engineStates(), time.Now().UnixMilli(), "shadow")
	took := time.Since(start)
	if took > 1200*time.Millisecond {
		t.Fatalf("25 cases took %v, want about 7 waves of 100 ms, never 25 x 100 ms", took)
	}
	if len(outs) != 25 || countStatus(outs, "ranked") != 25 {
		t.Fatalf("every case must be answered: %d outputs, %d ranked", len(outs), countStatus(outs, "ranked"))
	}
	if total, _ := e.requests(); total != 25 {
		t.Fatalf("%d engine requests, want 25", total)
	}
}

func TestHungEngineGivesNoDecisionWithinTheBudget(t *testing.T) {
	deadline := 300 * time.Millisecond
	e := newCaseEngine(t, deadline, -1)
	start := time.Now()
	outs := engineAssignments(context.Background(), waitingCases(25), engineStates(), time.Now().UnixMilli(), "shadow")
	took := time.Since(start)
	if took > deadline+assignmentBudgetMargin+300*time.Millisecond {
		t.Fatalf("the read took %v, budget is %v", took, deadline+assignmentBudgetMargin)
	}
	if len(outs) != 25 {
		t.Fatalf("%d outputs, want one per case", len(outs))
	}
	for id, o := range outs {
		if o.Status != "no_eligible_agent" || len(o.Ranking) != 0 || o.ModelVersion != "none" {
			t.Fatalf("case %s must have no decision: %+v", id, o)
		}
	}
	_ = e
}

func TestNoGoroutinesLeakAfterAHungEngine(t *testing.T) {
	deadline := 150 * time.Millisecond
	e := newCaseEngine(t, deadline, -1)
	before := runtime.NumGoroutine()
	engineAssignments(context.Background(), waitingCases(25), engineStates(), time.Now().UnixMilli(), "shadow")
	var left int
	for i := 0; i < 60; i++ {
		engineMu.Lock()
		left = len(engineFlights)
		engineMu.Unlock()
		if left == 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if left != 0 {
		t.Fatalf("%d flights still running long after every call's deadline", left)
	}
	e.CloseClientConnections()
	http.DefaultTransport.(*http.Transport).CloseIdleConnections()
	var after int
	for i := 0; i < 60; i++ {
		after = runtime.NumGoroutine()
		if after <= before+2 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("goroutines before %d, after %d", before, after)
}

func TestSameCaseAskedTwiceMakesOneEngineRequest(t *testing.T) {
	e := newCaseEngine(t, 2*time.Second, 300*time.Millisecond)
	c := engineCase("c-dup")
	var wg sync.WaitGroup
	var ranked atomic.Int32
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if engineAssignment(context.Background(), c, engineStates(), time.Now().UnixMilli(), "shadow").Status == "ranked" {
				ranked.Add(1)
			}
		}()
	}
	wg.Wait()
	if total, _ := e.requests(); total != 1 || ranked.Load() != 6 {
		t.Fatalf("%d requests, %d of 6 callers answered", total, ranked.Load())
	}
	engineMu.Lock()
	n := len(engineFlights)
	engineMu.Unlock()
	if n != 0 {
		t.Fatalf("%d flights left behind", n)
	}
}

func TestLateAnswerFillsTheCacheForTheNextRead(t *testing.T) {
	e := newCaseEngine(t, 400*time.Millisecond, 300*time.Millisecond)
	cases := waitingCases(25)
	first := engineAssignments(context.Background(), cases, engineStates(), time.Now().UnixMilli(), "shadow")
	r1 := countStatus(first, "ranked")
	if r1 == 25 || r1 < 8 || len(first) != 25 {
		t.Fatalf("the first read must miss the budget for some cases: %d ranked of %d", r1, len(first))
	}
	time.Sleep(450 * time.Millisecond)
	second := engineAssignments(context.Background(), cases, engineStates(), time.Now().UnixMilli(), "shadow")
	if r2 := countStatus(second, "ranked"); r2 <= r1 {
		t.Fatalf("late answers must reach the next read: %d then %d ranked", r1, r2)
	}
	if total, most := e.requests(); most != 1 || total > 25 {
		t.Fatalf("a case was asked twice: %d requests, at most %d for one case", total, most)
	}
}

func TestFailureAndBadAnswersMeanNoDecisionAndAlreadyAssignedIsOnlyReturned(t *testing.T) {
	e := newCaseEngine(t, time.Second, 10*time.Millisecond)
	e.set("already_assigned")
	outs := engineAssignments(context.Background(), waitingCases(3), engineStates(), time.Now().UnixMilli(), "shadow")
	if countStatus(outs, "already_assigned") != 3 {
		t.Fatalf("already_assigned is passed on as it is: %+v", outs)
	}
	for _, o := range outs {
		if len(o.Ranking) != 0 {
			t.Fatalf("no ranking to act on: %+v", o)
		}
	}
	e.set("bogus")
	bad := engineAssignments(context.Background(), []Case{engineCase("c-bogus")}, engineStates(), time.Now().UnixMilli(), "shadow")
	if o := bad["c-bogus"]; o.Status != "no_eligible_agent" || o.ModelVersion != "none" {
		t.Fatalf("a bad answer means no decision: %+v", o)
	}
	e.set("500")
	down := engineAssignments(context.Background(), []Case{engineCase("c-500")}, engineStates(), time.Now().UnixMilli(), "shadow")
	if o := down["c-500"]; o.Status != "no_eligible_agent" || o.ModelVersion != "none" {
		t.Fatalf("an engine error means no decision: %+v", o)
	}
}

func TestABudgetMissAloneDoesNotCountAsAnEngineFailure(t *testing.T) {
	e := newCaseEngine(t, 400*time.Millisecond, 300*time.Millisecond)
	engineAssignments(context.Background(), waitingCases(25), engineStates(), time.Now().UnixMilli(), "shadow")
	time.Sleep(500 * time.Millisecond)
	if st := assignmentStatus(tenantOfTest); st.Stats.Failures != 0 || st.Stats.Timeouts != 0 || st.Stats.BreakerOpens != 0 {
		t.Fatalf("answers that came late were not failures: %+v", st.Stats)
	}
	_ = e
}
