// SPDX-License-Identifier: AGPL-3.0-only

// Admin AI Assistant with the fake provider.
package business

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func seedAssistantEvent(t *testing.T, action, outcome string, detail map[string]any) {
	t.Helper()
	rc := asstCtx(access.RoleAdministrator)
	if _, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: action, EntityType: assistantEntity, SummaryEn: "seed", Detail: detail, Outcome: outcome}, "", ""); err != nil {
		t.Fatal(err)
	}
}

func TestAssistantOverviewCountsUsageFromAudit(t *testing.T) {
	setupAssistant(t, &fakeProvider{})
	seedAssistantEvent(t, "assistant.rule_draft", "success", map[string]any{"duration_ms": int64(3000)})
	seedAssistantEvent(t, "assistant.rule_draft", "rejected", map[string]any{"duration_ms": int64(5000)})
	seedAssistantEvent(t, "assistant.explain", "success", map[string]any{"duration_ms": int64(4000), "answer_path": explainPathChecked})
	seedAssistantEvent(t, "assistant.explain", "success", map[string]any{"duration_ms": int64(12000), "answer_path": explainPathRetried})
	seedAssistantEvent(t, "assistant.explain", "success", map[string]any{"duration_ms": float64(9000), "answer_path": explainPathFallback})
	seedAssistantEvent(t, "assistant.ask", "failure", map[string]any{"duration_ms": int64(30000)})
	seedAssistantEvent(t, "assistant.ask", "denied", nil)
	seedAssistantEvent(t, "assistant.tool_call", "success", map[string]any{"tool": "gap_summary"})
	seedAssistantEvent(t, "rule.create", "success", nil)

	got, err := GetAssistantOverview(asstCtx(access.RoleAdministrator))
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "on" || got.Provider != "fake" || got.SetIn != "server_environment" || got.WindowDays != 7 || got.DataSource != "SYNTHETIC" {
		t.Fatalf("header: %+v", got)
	}
	if len(got.Usage) != 4 || got.Usage[0].Feature != "rule_draft" || got.Usage[1].Feature != "explain" || got.Usage[2].Feature != "ask" || got.Usage[3].Feature != "tool_call" {
		t.Fatalf("usage order: %+v", got.Usage)
	}
	rd, ex, ask, tool := got.Usage[0], got.Usage[1], got.Usage[2], got.Usage[3]
	if rd.Calls != 2 || rd.Successes != 1 || rd.Rejected == nil || *rd.Rejected != 1 || rd.Retried != nil {
		t.Errorf("rule_draft: %+v", rd)
	}
	if ex.Calls != 3 || ex.Successes != 3 || *ex.Retried != 2 || *ex.Fallbacks != 1 || ex.Rejected != nil {
		t.Errorf("explain: %+v", ex)
	}
	if *ex.MedianMs != 9000 || *ex.P90Ms != 12000 {
		t.Errorf("explain durations: %d %d", *ex.MedianMs, *ex.P90Ms)
	}
	if ask.Calls != 2 || ask.Failures != 1 || ask.Denied != 1 || *ask.MedianMs != 30000 {
		t.Errorf("ask: %+v", ask)
	}
	if tool.Calls != 1 || tool.MedianMs != nil || tool.P90Ms != nil {
		t.Errorf("tool_call: %+v", tool)
	}
	if got.Totals.Calls != 7 || got.Totals.Successes != 4 || got.Totals.Within10s != 3 {
		t.Errorf("totals: %+v", got.Totals)
	}
	if got.LastTest != nil {
		t.Errorf("last test: %+v", got.LastTest)
	}
}

func TestAssistantOverviewWindowIsSevenDays(t *testing.T) {
	setupAssistant(t, &fakeProvider{})
	seedAssistantEvent(t, "assistant.ask", "success", map[string]any{"duration_ms": int64(1000)})
	prev := assistantNow
	assistantNow = func() time.Time { return time.Now().Add(8 * 24 * time.Hour) }
	t.Cleanup(func() { assistantNow = prev })
	got, err := GetAssistantOverview(asstCtx(access.RoleAdministrator))
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Usage) != 0 || got.Totals.Calls != 0 {
		t.Fatalf("old events counted: %+v", got)
	}
}

func TestAssistantOverviewAccess(t *testing.T) {
	setupAssistant(t, &fakeProvider{})
	if _, err := GetAssistantOverview(asstCtx(access.RoleViewerAuditor)); err != nil {
		t.Fatalf("viewer: %v", err)
	}
	for _, role := range []access.Role{access.RolePlanner, access.RoleDispatchSupervisor, access.RoleChangeApprover} {
		_, err := GetAssistantOverview(asstCtx(role))
		var de *dataerr.DataError
		if err == nil || !errors.As(err, &de) || de.Code != dataerr.CodeForbidden {
			t.Errorf("%s: want forbidden, got %v", role, err)
		}
	}
}

func TestAssistantOverviewOffNeverShowsKey(t *testing.T) {
	auditlog.ResetForTest()
	assistant.Override(nil)
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "openai")
	t.Setenv("OPENDISPATCH_ASSISTANT_MODEL", "local-model")
	t.Setenv("OPENDISPATCH_ASSISTANT_OPENAI_URL", "")
	t.Setenv("OPENDISPATCH_ASSISTANT_API_KEY", "")
	got, err := GetAssistantOverview(asstCtx(access.RoleAdministrator))
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "not_configured" || got.Key != "not_configured" || got.Offline {
		t.Fatalf("no key: %+v", got)
	}
	t.Setenv("OPENDISPATCH_ASSISTANT_OPENAI_URL", "http://127.0.0.1:1/v1")
	t.Setenv("OPENDISPATCH_ASSISTANT_API_KEY", "placeholder-value")
	got, _ = GetAssistantOverview(asstCtx(access.RoleAdministrator))
	raw, _ := json.Marshal(got)
	if got.Status != "on" || got.Key != "configured" || strings.Contains(string(raw), "placeholder-value") {
		t.Fatalf("key leaked or wrong: %s", raw)
	}
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "off")
	got, _ = GetAssistantOverview(asstCtx(access.RoleAdministrator))
	if got.Status != "off" || got.Key != "not_needed" || !got.Offline {
		t.Fatalf("off: %+v", got)
	}
}

func TestAssistantConnectionOKIsAudited(t *testing.T) {
	fake := &fakeProvider{replies: []assistant.Reply{textReply("OK")}}
	setupAssistant(t, fake)
	got, err := TestAssistantConnection(context.Background(), asstCtx(access.RoleAdministrator))
	if err != nil {
		t.Fatal(err)
	}
	if !got.OK || got.ErrorCode != nil || got.TestedAt == "" || got.Model != "fake-1" {
		t.Fatalf("result: %+v", got)
	}
	if len(fake.seen) != 1 || fake.seen[0].MaxTokens > 16 || len(fake.seen[0].Tools) != 0 {
		t.Fatalf("request: %+v", fake.seen)
	}
	ev := eventsWith("assistant.test")
	if len(ev) != 1 || ev[0].Outcome != "success" {
		t.Fatalf("audit: %+v", ev)
	}
	over, _ := GetAssistantOverview(asstCtx(access.RoleAdministrator))
	if over.LastTest == nil || !over.LastTest.OK || over.Totals.Calls != 0 || len(over.Usage) != 0 {
		t.Fatalf("overview after test: %+v", over)
	}
}

func TestAssistantConnectionFailureCodes(t *testing.T) {
	cases := []struct {
		p    *fakeProvider
		code string
	}{
		{&fakeProvider{err: &assistant.ProviderError{Msg: "status 401 secret-ish"}}, "provider_error"},
		{&fakeProvider{err: context.DeadlineExceeded}, "timeout"},
		{&fakeProvider{replies: []assistant.Reply{textReply("  ")}}, "empty_answer"},
	}
	for _, c := range cases {
		setupAssistant(t, c.p)
		got, err := TestAssistantConnection(context.Background(), asstCtx(access.RoleAdministrator))
		if err != nil {
			t.Fatal(err)
		}
		if got.OK || got.ErrorCode == nil || *got.ErrorCode != c.code {
			t.Errorf("%s: %+v", c.code, got)
		}
		ev := eventsWith("assistant.test")
		raw, _ := json.Marshal(ev)
		if len(ev) != 1 || ev[0].Outcome != "failure" || strings.Contains(string(raw), "secret-ish") {
			t.Errorf("%s audit: %s", c.code, raw)
		}
	}
}

func TestAssistantConnectionOffMakesNoCall(t *testing.T) {
	auditlog.ResetForTest()
	assistant.Override(nil)
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "off")
	got, err := TestAssistantConnection(context.Background(), asstCtx(access.RoleAdministrator))
	if err != nil || got.OK || *got.ErrorCode != "off" || got.DurationMs != 0 {
		t.Fatalf("off: %+v %v", got, err)
	}
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "openai")
	t.Setenv("OPENDISPATCH_ASSISTANT_OPENAI_URL", "")
	got, _ = TestAssistantConnection(context.Background(), asstCtx(access.RoleAdministrator))
	if *got.ErrorCode != "not_configured" {
		t.Fatalf("no key: %+v", got)
	}
	if len(eventsWith("assistant.test")) != 2 {
		t.Fatal("each test is audited")
	}
}

func TestAssistantConnectionViewerIsDeniedAndAudited(t *testing.T) {
	fake := &fakeProvider{replies: []assistant.Reply{textReply("OK")}}
	setupAssistant(t, fake)
	_, err := TestAssistantConnection(context.Background(), asstCtx(access.RoleViewerAuditor))
	var de *dataerr.DataError
	if err == nil || !errors.As(err, &de) || de.Code != dataerr.CodeForbidden {
		t.Fatalf("want forbidden, got %v", err)
	}
	if len(fake.seen) != 0 {
		t.Fatal("a denied test must not call the provider")
	}
	ev := eventsWith("assistant.test")
	if len(ev) != 1 || ev[0].Outcome != "denied" {
		t.Fatalf("audit: %+v", ev)
	}
}
