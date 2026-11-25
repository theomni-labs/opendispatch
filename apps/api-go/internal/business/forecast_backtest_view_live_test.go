// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

type failingCaller struct{}

func (failingCaller) Call(context.Context, []byte) ([]byte, error) {
	return nil, errors.New("engine down")
}

func auditOutcomes(t *testing.T, w engineWorld, action string) []string {
	t.Helper()
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	page, err := ListAuditEvents(rc, AuditFilter{ActionPrefix: action})
	check(t, err)
	var out []string
	for _, e := range page.Items {
		if e.Action == action {
			out = append(out, e.Outcome)
		}
	}
	return out
}

func TestTheBacktestRunsInTheBackgroundAndTheReadShowsIt(t *testing.T) {
	w := newEngineWorld(t)
	useSharedAnswers(t, w.conn)
	dailyCases(t, w, 100)
	setForecastSetting(t, w.tenantID, KeyChampionModel, "ensemble-4", "")
	setForecastSetting(t, w.tenantID, KeyChallengerModel, "m-chal", "")
	noBlend(t, w.tenantID)
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID

	before, err := GetForecastBacktest(rc)
	check(t, err)
	if before.Latest != nil || before.Run.State != "idle" || before.ActiveModel != "ensemble-4" {
		t.Fatalf("before any run: %+v", before)
	}
	st, err := startBacktest(context.Background(), w.conn, rc, BacktestOptions{HeldOutDays: 7, EngineCaller: modelCaller{}})
	check(t, err)
	if st.Run.State != "running" || st.Run.StartedAt == nil {
		t.Fatalf("the start answers at once with a running run, got %+v", st.Run)
	}
	waitBacktest(w.tenantID)

	got, err := GetForecastBacktest(rc)
	check(t, err)
	v := got.Latest
	if got.Run.State != "succeeded" || got.Run.FinishedAt == nil || v == nil {
		t.Fatalf("after the run: %+v", got)
	}
	if v.ModelVersion != "ensemble-4" || !v.Illustrative || v.DataSource != "SYNTHETIC" || v.MixedSources || v.HeldOut.Days != 7 || v.HeldOut.From == nil {
		t.Fatalf("view %+v", v)
	}
	if v.Engine.WAPE == nil || v.Naive.WAPE == nil || v.Engine.RangeCoverage == nil || v.Naive.RangeCoverage != nil {
		t.Fatalf("engine %+v naive %+v", v.Engine, v.Naive)
	}
	if v.Segment == nil || v.Segment.WAPE == nil {
		t.Fatalf("segment %+v, want the customer's baseline scored", v.Segment)
	}
	if v.Gate.Result == "" || v.Gate.Baseline != "segment" {
		t.Fatalf("gate %+v", v.Gate)
	}
	c := v.Challenger
	if c == nil || c.Champion != "ensemble-4" || c.Challenger != "m-chal" || c.WAPELift == nil || *c.WAPELift <= 0.5 || c.Error != nil {
		t.Fatalf("challenger %+v", c)
	}
	if len(v.WeakestZones) == 0 || v.WeakestZones[0].ZoneID != w.zoneID {
		t.Fatalf("weakest %+v", v.WeakestZones)
	}
	if s := auditSummaries(t, w, "forecast.backtest_started"); len(s) != 1 || !strings.Contains(s[0], "ensemble-4") {
		t.Fatalf("start audit %v", s)
	}
	if o := auditOutcomes(t, w, "forecast.backtest_run"); len(o) != 1 || o[0] != "success" {
		t.Fatalf("result audit %v", o)
	}
}

func TestTheBacktestRunIsTheAdministratorsAndADenialIsAudited(t *testing.T) {
	w := newEngineWorld(t)
	planner := roleCtx(w.tenantID, "00000000-0000-4000-8000-000000000391", access.RolePlanner)
	_, err := startBacktest(context.Background(), w.conn, planner, BacktestOptions{EngineCaller: modelCaller{}})
	var de *dataerr.DataError
	if !errors.As(err, &de) || de.Code != dataerr.CodeForbidden {
		t.Fatalf("a planner got %v", err)
	}
	if _, err := GetForecastBacktest(planner); !errors.As(err, &de) || de.Code != dataerr.CodeForbidden {
		t.Fatalf("a planner read got %v", err)
	}
	if o := auditOutcomes(t, w, "forecast.backtest_run"); len(o) != 1 || o[0] != "denied" {
		t.Fatalf("denial audit %v", o)
	}
	if got := backtestRunOf(w.tenantID); got.State != "idle" {
		t.Fatalf("nothing should run, got %+v", got)
	}
}

func TestTheBacktestRefusesWithoutTheEngineAndWhileOneRuns(t *testing.T) {
	w := newEngineWorld(t)
	UseFixtureEngines()
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	var de *dataerr.DataError
	if _, err := StartForecastBacktest(context.Background(), w.conn, rc); !errors.As(err, &de) || de.Code != dataerr.CodeConflict {
		t.Fatalf("engines off: got %v", err)
	}
	backtestRuns.Lock()
	backtestRuns.m[w.tenantID] = &BacktestRun{State: "running"}
	backtestRuns.Unlock()
	t.Cleanup(func() {
		backtestRuns.Lock()
		delete(backtestRuns.m, w.tenantID)
		backtestRuns.Unlock()
	})
	if _, err := startBacktest(context.Background(), w.conn, rc, BacktestOptions{EngineCaller: modelCaller{}}); !errors.As(err, &de) || de.Code != dataerr.CodeConflict {
		t.Fatalf("a second run: got %v", err)
	}
}

func TestAFailedBacktestIsKeptAsFailedAndAudited(t *testing.T) {
	w := newEngineWorld(t)
	useSharedAnswers(t, w.conn)
	dailyCases(t, w, 100)
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	_, err := startBacktest(context.Background(), w.conn, rc, BacktestOptions{HeldOutDays: 7, EngineCaller: failingCaller{}})
	check(t, err)
	waitBacktest(w.tenantID)
	got, err := GetForecastBacktest(rc)
	check(t, err)
	if got.Run.State != "failed" || got.Run.ErrorClass == nil || got.Latest != nil {
		t.Fatalf("got %+v", got)
	}
	if o := auditOutcomes(t, w, "forecast.backtest_run"); len(o) != 1 || o[0] != "failure" {
		t.Fatalf("failure audit %v", o)
	}
}
