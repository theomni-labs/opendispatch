// SPDX-License-Identifier: AGPL-3.0-only

// Self-signalled fallback.
package business

import (
	"context"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

const healthCase = "00000000-0000-4000-8000-000000000861"

// healthRig: one open case in z1 at the stage.
func healthRig(t *testing.T, stage string, decisionMs int) (reqctx.RequestContext, string) {
	t.Helper()
	resetDispatchDeps()
	ResetDispatchHealthForTest()
	UseFixtureEngines()
	t.Cleanup(UseFixtureEngines)
	t.Cleanup(ResetDispatchEngineOutputsForTest)
	_, tenantID := adminCtx(t)
	rc := roleCtx(tenantID, "00000000-0000-4000-8000-000000000862", access.RoleDispatchSupervisor)
	SeedReplayCasesForTest([]Case{{ID: healthCase, CaseNumber: "RD-H", ZoneID: "z1", RegisteredAt: "2026-09-13T06:58:00+03:00", DataSource: "SYNTHETIC"}})
	seekTo(t, rc, "2026-09-13T07:00:00+03:00")
	SeedSettingsZonesForTest([]string{"z1"}, datactx.NowISO())
	PutZoneStageForTest(ZoneStage{ZoneID: "z1", Stage: stage, DataSource: "SYNTHETIC"})
	setHealthOutput(decisionMs)
	auditlog.ResetForTest()
	return rc, tenantID
}

func seekTo(t *testing.T, rc reqctx.RequestContext, at string) {
	t.Helper()
	if _, err := ControlReplay(rc, map[string]any{"action": "seek", "replay_at": at}); err != nil {
		t.Fatal(err)
	}
}

func setHealthOutput(decisionMs int) {
	engineOutputsMu.Lock()
	engineOutputsCache = map[string]AssignmentEngineOutput{healthCase: {CaseID: healthCase, Status: "ranked", DecisionTimeMs: decisionMs,
		Ranking: []AssignmentEngineRanked{{AgentID: "00000000-0000-4000-8000-000000000863", EstimatedArrivalAt: "2026-09-13T07:10:00+03:00"}}}}
	engineOutputsMu.Unlock()
}

func mustCheck(t *testing.T, tenant, want string) {
	t.Helper()
	got, err := CheckDispatchFallback(context.Background(), tenant)
	check(t, err)
	if got != want {
		t.Fatalf("health check sent %q, want %q", got, want)
	}
}

func systemSignals(t *testing.T) []auditlog.AuditEvent {
	t.Helper()
	var out []auditlog.AuditEvent
	for _, e := range auditlog.AllEvents() {
		if e.Action == "fallback.signal_sent" {
			if e.ActorType != "system" || e.ActorUserID != nil {
				t.Fatalf("got %+v, want actor System with no user", e)
			}
			out = append(out, e)
		}
	}
	return out
}

func TestCheckDispatchFallback_MissedDeadlineAtAutomaticSignalsOnceAndAPersonResumes(t *testing.T) {
	rc, tenant := healthRig(t, "automatic", 5000)
	mustCheck(t, tenant, "fallback")
	state, err := GetFallbackState(rc)
	check(t, err)
	if state.State != "active" || state.Reason != "opendispatch_timeout" || state.OpenDispatchHealthy || state.LastSignal == nil || *state.LastSignal != "fallback" {
		t.Fatalf("got %+v, want active fallback with reason opendispatch_timeout", state)
	}
	sent := systemSignals(t)
	if len(sent) != 1 || sent[0].Detail["cause"] != causeDeadlineMissed || sent[0].Detail["signal"] != "fallback" {
		t.Fatalf("got %+v, want one System fallback signal with the cause", sent)
	}
	mustCheck(t, tenant, "")

	// The cause clears; auto resume is off by default.
	setHealthOutput(50)
	mustCheck(t, tenant, "")
	seekTo(t, rc, "2026-09-13T07:05:00+03:00")
	mustCheck(t, tenant, "")
	if state, _ := GetFallbackState(rc); state.State != "active" {
		t.Fatalf("got %+v, want fallback kept until a person resumes", state)
	}
	if len(systemSignals(t)) != 1 {
		t.Fatal("a resume was sent with auto resume off")
	}
}

func TestCheckDispatchFallback_AutoResumeAfterTheClearPeriod(t *testing.T) {
	rc, tenant := healthRig(t, "automatic", 5000)
	ctx := context.Background()
	check(t, settingsstore.Put(ctx, tenant, autoResumeKey, true))
	check(t, settingsstore.Put(ctx, tenant, autoResumeAfterKey, 60))
	mustCheck(t, tenant, "fallback")
	setHealthOutput(50)
	mustCheck(t, tenant, "")
	seekTo(t, rc, "2026-09-13T07:00:30+03:00")
	mustCheck(t, tenant, "")
	seekTo(t, rc, "2026-09-13T07:01:10+03:00")
	mustCheck(t, tenant, "resume")
	state, err := GetFallbackState(rc)
	check(t, err)
	if state.State != "armed" || !state.OpenDispatchHealthy || *state.LastSignal != "resume" {
		t.Fatalf("got %+v, want armed after the automatic resume", state)
	}
	sent := systemSignals(t)
	if len(sent) != 2 || sent[1].Detail["signal"] != "resume" {
		t.Fatalf("got %+v, want the resume audited as System", sent)
	}
}

func TestCheckDispatchFallback_NeverResumesAPersonsSignalAndSkipsShadowOnly(t *testing.T) {
	rc, tenant := healthRig(t, "automatic", 50)
	ctx := context.Background()
	check(t, settingsstore.Put(ctx, tenant, autoResumeKey, true))
	admin := roleCtx(tenant, "00000000-0000-4000-8000-000000000864", access.RoleAdministrator)
	_, err := SendFallbackSignal(admin, map[string]any{"signal": "fallback", "reason": "Planned work."})
	check(t, err)
	mustCheck(t, tenant, "")
	seekTo(t, rc, "2026-09-13T08:00:00+03:00")
	mustCheck(t, tenant, "")
	if state, _ := GetFallbackState(rc); state.State != "active" || state.Reason != "manual" {
		t.Fatalf("got %+v, want a person's signal left alone", state)
	}

	// Shadow everywhere: OpenDispatch assigns nothing, so it signals nothing.
	_, tenant2 := healthRig(t, "shadow", 5000)
	mustCheck(t, tenant2, "")
}

func TestCheckDispatchFallback_AnOpenScorerBreakerIsAHealthFailure(t *testing.T) {
	rc, tenant := healthRig(t, "recommend", 50)
	UseEngines(engines.Config{Mode: engines.ModeEngine, URLs: map[engines.Name]string{engines.Assignment: "http://127.0.0.1:1"}, AssignmentDeadline: 200 * time.Millisecond})
	g, err := engineGuard(tenant, engines.Assignment)
	check(t, err)
	for i := 0; i < 3; i++ {
		_, _ = g.Call(context.Background(), []byte(`{}`))
	}
	mustCheck(t, tenant, "fallback")
	state, err := GetFallbackState(rc)
	check(t, err)
	if state.Reason != "health_check_failed" || state.OpenDispatchHealthy {
		t.Fatalf("got %+v, want health_check_failed", state)
	}
}
