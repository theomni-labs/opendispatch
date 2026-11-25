// SPDX-License-Identifier: AGPL-3.0-only

// Assistant features with a fake provider; no network.
package business

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// fakeProvider: scripted replies, records requests.
type fakeProvider struct {
	replies []assistant.Reply
	err     error
	seen    []assistant.Request
	repeat  bool
}

func (f *fakeProvider) Name() string  { return "fake" }
func (f *fakeProvider) Model() string { return "fake-1" }
func (f *fakeProvider) Complete(_ context.Context, req assistant.Request) (assistant.Reply, error) {
	f.seen = append(f.seen, req)
	if f.err != nil {
		return assistant.Reply{}, f.err
	}
	if len(f.replies) == 0 {
		return assistant.Reply{Stop: "end"}, nil
	}
	r := f.replies[0]
	if !f.repeat || len(f.replies) > 1 {
		f.replies = f.replies[1:]
	}
	if r.Message.Role == "" {
		r.Message = assistant.Message{Role: "assistant", Text: r.Text, ToolCalls: r.ToolCalls}
	}
	return r, nil
}

func textReply(s string) assistant.Reply { return assistant.Reply{Text: s, Stop: "end"} }

func setupAssistant(t *testing.T, p assistant.Provider) {
	t.Helper()
	auditlog.ResetForTest()
	assistant.Override(p)
	t.Cleanup(func() { assistant.Override(nil) })
	prevTypes := ruleDraftCaseTypes
	ruleDraftCaseTypes = func(context.Context, *tenancy.Connection, reqctx.RequestContext) ([]string, error) {
		return []string{"Customer", "Unlisted"}, nil
	}
	t.Cleanup(func() { ruleDraftCaseTypes = prevTypes })
}

func asstCtx(role access.Role) reqctx.RequestContext { return rulesCtx(role) }

func reasonOf(err error) string {
	var de *dataerr.DataError
	if errors.As(err, &de) {
		return de.Reason
	}
	return ""
}

func eventsWith(action string) []auditlog.AuditEvent {
	var out []auditlog.AuditEvent
	for _, e := range auditlog.AllEvents() {
		if e.Action == action {
			out = append(out, e)
		}
	}
	return out
}

const goodDraft = `{"name_en":"Injury goes to the field","name_ar":"إصابة","match":"all","predicates":[{"field":"injury_present","operator":"eq","value":true},{"field":"parties_involved","operator":"gte","value":3}],"condition_text_en":"Someone is injured and three or more parties","outcome":"field_mandatory"}`

func TestRuleDraftValidDraft(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply("```json\n" + goodDraft + "\n```")}}
	setupAssistant(t, f)
	out, err := DraftRuleWithAssistant(context.Background(), nil, asstCtx(access.RoleAdministrator), map[string]any{"text": "If someone is hurt and 3+ parties, call 0501234567", "locale": "en"})
	if err != nil {
		t.Fatal(err)
	}
	if out.Draft.Outcome != "field_mandatory" || len(out.Draft.Condition.Predicates) != 2 || out.Provider != "fake" || out.Model != "fake-1" || !out.Suggestion {
		t.Fatalf("draft %+v", out)
	}
	sent := f.seen[0].Messages[0].Text
	if strings.Contains(sent, "0501234567") || !strings.Contains(sent, "[removed]") || !f.seen[0].JSON {
		t.Fatalf("sent %q", sent)
	}
	if !strings.Contains(f.seen[0].System, "Unlisted") || !strings.Contains(f.seen[0].System, "customer_requests_field_attendance") {
		t.Fatal("system prompt lacks the builder's fields")
	}
	ev := eventsWith("assistant.rule_draft")
	if len(ev) != 1 || ev[0].Outcome != "success" || ev[0].Detail["provider"] != "fake" {
		t.Fatalf("audit %+v", ev)
	}
}

func TestRuleDraftRejectsInvalidOutput(t *testing.T) {
	cases := map[string]string{
		"not json":       "Sure, here is a rule: injury means field.",
		"broken json":    `{"name_en": "x", "match": "all"`,
		"unknown field":  strings.Replace(goodDraft, "injury_present", "driver_age", 1),
		"wrong operator": strings.Replace(goodDraft, `"operator":"eq","value":true`, `"operator":"gt","value":true`, 1),
		"wrong kind":     strings.Replace(goodDraft, `"value":3`, `"value":"three"`, 1),
		"bad case type":  strings.Replace(goodDraft, `{"field":"parties_involved","operator":"gte","value":3}`, `{"field":"case_type","operator":"eq","value":"Theft"}`, 1),
		"bad outcome":    strings.Replace(goodDraft, "field_mandatory", "send_police", 1),
		"extra key":      strings.Replace(goodDraft, `"match":"all"`, `"match":"all","sql":"drop"`, 1),
		"no predicates":  `{"name_en":"x","match":"all","predicates":[],"condition_text_en":"x","outcome":"remote_eligible"}`,
		"model refused":  `{"error":"There is no field for the driver's age."}`,
	}
	for name, text := range cases {
		t.Run(name, func(t *testing.T) {
			setupAssistant(t, &fakeProvider{replies: []assistant.Reply{textReply(text)}})
			_, err := DraftRuleWithAssistant(context.Background(), nil, asstCtx(access.RoleAdministrator), map[string]any{"text": "a rule"})
			if err == nil || ruleErrCode(err) != dataerr.CodeInvalid || reasonOf(err) != dataerr.ReasonAssistantInvalid {
				t.Fatalf("want invalid, got %v", err)
			}
			if ev := eventsWith("assistant.rule_draft"); len(ev) != 1 || ev[0].Outcome != "rejected" {
				t.Fatalf("audit %+v", ev)
			}
		})
	}
}

func TestRuleDraftNeedsEditAndAProvider(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply(goodDraft)}}
	setupAssistant(t, f)
	_, err := DraftRuleWithAssistant(context.Background(), nil, asstCtx(access.RoleDispatchSupervisor), map[string]any{"text": "x"})
	if ruleErrCode(err) != dataerr.CodeForbidden || len(f.seen) != 0 {
		t.Fatalf("supervisor: %v, calls %d", err, len(f.seen))
	}
	if ev := eventsWith("assistant.rule_draft"); len(ev) != 1 || ev[0].Outcome != "denied" {
		t.Fatalf("audit %+v", ev)
	}
	assistant.Override(nil)
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "off")
	_, err = DraftRuleWithAssistant(context.Background(), nil, asstCtx(access.RoleAdministrator), map[string]any{"text": "x"})
	if reasonOf(err) != dataerr.ReasonAssistantOff {
		t.Fatalf("off: %v", err)
	}
	_, err = DraftRuleWithAssistant(context.Background(), nil, asstCtx(access.RoleAdministrator), map[string]any{"text": strings.Repeat("a", 501)})
	if ruleErrCode(err) != dataerr.CodeInvalid {
		t.Fatalf("long text: %v", err)
	}
}

func TestProviderFailureIsUnavailable(t *testing.T) {
	setupAssistant(t, &fakeProvider{err: &assistant.ProviderError{Msg: "The model server answered 529 (overloaded_error)."}})
	_, err := DraftRuleWithAssistant(context.Background(), nil, asstCtx(access.RoleAdministrator), map[string]any{"text": "x"})
	if reasonOf(err) != dataerr.ReasonAssistantUnavailable || !strings.Contains(err.Error(), "529") {
		t.Fatalf("got %v", err)
	}
	if ev := eventsWith("assistant.rule_draft"); len(ev) != 1 || ev[0].Outcome != "failure" {
		t.Fatalf("audit %+v", ev)
	}
}

func stubExplainFacts(t *testing.T) {
	prevF, prevG := explainForecastFacts, explainGapFacts
	explainForecastFacts = func(_ context.Context, _ *tenancy.Connection, rc reqctx.RequestContext, zoneID, date, locale string) (map[string]any, error) {
		if err := reqctx.RequireAccess(rc, access.ModuleOpsForecastExplorer, access.AccessView); err != nil {
			return nil, err
		}
		g := loadExplainGolden(t)
		return forecastFacts(forecastScreenOf(g.forecastTimeline(), g.forecastSplit(), g.Forecast.ZoneID), &g.Forecast.Explanation, zoneName(g.Zones[0], locale), date, "SYNTHETIC", locale), nil
	}
	explainGapFacts = func(_ context.Context, _ *tenancy.Connection, rc reqctx.RequestContext, zoneID, date, locale string) (map[string]any, error) {
		if err := reqctx.RequireAccess(rc, access.ModuleOpsGapSurplus, access.AccessView); err != nil {
			return nil, err
		}
		g := loadExplainGolden(t)
		return gapFacts(g.gapView(), shownZones(g.Zones, zoneID), zoneID, locale), nil
	}
	t.Cleanup(func() { explainForecastFacts, explainGapFacts = prevF, prevG })
}

const asstZone = "6c0e2a4e-1b7a-4c8e-9f00-000000000001"

func TestExplainChecksRoleAndTarget(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply("x")}}
	setupAssistant(t, f)
	stubExplainFacts(t)
	_, err := ExplainWithAssistant(context.Background(), nil, asstCtx(access.RoleDispatcher), map[string]any{"target": "gap_surplus", "date": "2026-09-14"})
	if ruleErrCode(err) != dataerr.CodeForbidden || len(f.seen) != 0 {
		t.Fatalf("dispatcher: %v", err)
	}
	_, err = ExplainWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"target": "users"})
	if ruleErrCode(err) != dataerr.CodeInvalid {
		t.Fatalf("target: %v", err)
	}
	_, err = ExplainWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"target": "forecast_explorer", "date": "2026-09-14"})
	if ruleErrCode(err) != dataerr.CodeInvalid {
		t.Fatalf("no zone: %v", err)
	}
}

func stubAskTools(t *testing.T, runs *int) {
	prev := askToolsFor
	askToolsFor = func(context.Context, *tenancy.Connection, reqctx.RequestContext) ([]askTool, []string) {
		mk := func(name string, m access.ModuleID) askTool {
			return askTool{Def: assistant.ToolDef{Name: name, Schema: objSchema(map[string]any{})}, Module: m, Run: func(map[string]any) (any, error) {
				*runs++
				return map[string]any{"gap_intervals": 3, "illustrative": true}, nil
			}}
		}
		return []askTool{mk("gap_summary", access.ModuleOpsGapSurplus), mk("forecast_summary", access.ModuleOpsForecastExplorer)}, []string{"Riyadh North"}
	}
	t.Cleanup(func() { askToolsFor = prev })
}

func toolReply(name string) assistant.Reply {
	tc := []assistant.ToolCall{{ID: "c1", Name: name, Input: map[string]any{"zone": "Riyadh North"}}}
	return assistant.Reply{ToolCalls: tc, Stop: "tool_use"}
}

func TestAskUsesToolsAndListsThem(t *testing.T) {
	runs := 0
	f := &fakeProvider{replies: []assistant.Reply{toolReply("gap_summary"), textReply("Riyadh North has 3 gap intervals tomorrow.")}}
	setupAssistant(t, f)
	stubAskTools(t, &runs)
	out, err := AskWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"question": "Where are the gaps tomorrow?"})
	if err != nil {
		t.Fatal(err)
	}
	if out.Refused || out.Capped || len(out.ToolCalls) != 1 || out.ToolCalls[0].Name != "gap_summary" || !out.ToolCalls[0].OK || runs != 1 {
		t.Fatalf("out %+v", out)
	}
	if len(f.seen[0].Tools) != 2 || !strings.Contains(f.seen[0].System, "Riyadh North") {
		t.Fatalf("tools offered %d", len(f.seen[0].Tools))
	}
	if len(eventsWith("assistant.tool_call")) != 1 || len(eventsWith("assistant.ask")) != 1 {
		t.Fatalf("audit %+v", auditlog.AllEvents())
	}
}

func TestAskCapsToolCallsAtFive(t *testing.T) {
	runs := 0
	f := &fakeProvider{replies: []assistant.Reply{toolReply("gap_summary")}, repeat: true}
	setupAssistant(t, f)
	stubAskTools(t, &runs)
	out, err := AskWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"question": "Keep looking"})
	if err != nil {
		t.Fatal(err)
	}
	if !out.Capped || runs != assistantMaxCalls || len(out.ToolCalls) != assistantMaxCalls || len(eventsWith("assistant.tool_call")) != assistantMaxCalls {
		t.Fatalf("capped %v runs %d calls %d", out.Capped, runs, len(out.ToolCalls))
	}
}

func TestAskOffersOnlyTheRolesTools(t *testing.T) {
	runs := 0
	f := &fakeProvider{replies: []assistant.Reply{toolReply("gap_summary"), textReply("I cannot see gaps.")}}
	setupAssistant(t, f)
	stubAskTools(t, &runs)
	out, err := AskWithAssistant(context.Background(), nil, asstCtx(access.RoleDispatcher), map[string]any{"question": "gaps?"})
	if err != nil {
		t.Fatal(err)
	}
	if len(f.seen[0].Tools) != 1 || f.seen[0].Tools[0].Name != "forecast_summary" || runs != 0 || out.ToolCalls[0].OK {
		t.Fatalf("dispatcher got tools %+v, ran %d", f.seen[0].Tools, runs)
	}
	if ev := eventsWith("assistant.tool_call"); len(ev) != 1 || ev[0].Outcome != "denied" {
		t.Fatalf("audit %+v", ev)
	}
}

func TestAskRefusesOutOfScopeAndRolesWithoutOps(t *testing.T) {
	runs := 0
	setupAssistant(t, &fakeProvider{replies: []assistant.Reply{textReply("OUT_OF_SCOPE")}})
	stubAskTools(t, &runs)
	out, err := AskWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"question": "Write me a poem"})
	if err != nil || !out.Refused || out.Answer != "" {
		t.Fatalf("out %+v err %v", out, err)
	}
	_, err = AskWithAssistant(context.Background(), nil, asstCtx(access.RoleChangeApprover), map[string]any{"question": "gaps?"})
	if ruleErrCode(err) != dataerr.CodeForbidden {
		t.Fatalf("change approver: %v", err)
	}
}

func TestStatusFeaturesByRole(t *testing.T) {
	assistant.Override(nil)
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "")
	st, err := GetAssistantStatus(asstCtx(access.RoleAdministrator))
	if err != nil || st.Configured || st.Provider != "off" || !st.Features.RuleDraft || !st.Features.Ask {
		t.Fatalf("admin %+v", st)
	}
	st, _ = GetAssistantStatus(asstCtx(access.RoleDispatcher))
	if st.Features.RuleDraft || len(st.Features.Explain) != 1 || st.Features.Explain[0] != ExplainForecastExplorer {
		t.Fatalf("dispatcher %+v", st.Features)
	}
	st, _ = GetAssistantStatus(asstCtx(access.RoleChangeApprover))
	if st.Features.Ask || len(st.Features.Explain) != 0 {
		t.Fatalf("approver %+v", st.Features)
	}
}

func TestPlainTextStripsMarkdown(t *testing.T) {
	in := "## الملخص\n\n**الطلب المتوقع** 247.6 بلاغ، *أقل* من المعتاد.\n* أولًا\n+ ثانيًا\n| zone | cases |\n|---|---|\n| Riyadh | 41 |\n```\ncode\n```\nuse `x` __now__"
	got := plainText(in)
	for _, bad := range []string{"#", "*", "`", "__", "|", "---"} {
		if strings.Contains(got, bad) {
			t.Fatalf("%q left in %q", bad, got)
		}
	}
	for _, want := range []string{"الملخص", "الطلب المتوقع 247.6", "أقل من", "- أولًا", "- ثانيًا", "Riyadh, 41", "use x now"} {
		if !strings.Contains(got, want) {
			t.Fatalf("want %q in %q", want, got)
		}
	}
	if plainText("2 * 3 = 6, x0.94") != "2 * 3 = 6, x0.94" {
		t.Fatal("a lone asterisk is not emphasis")
	}
}

func TestAskAndExplainAnswersArePlainText(t *testing.T) {
	runs := 0
	f := &fakeProvider{replies: []assistant.Reply{textReply("**الرياض الوسطى**: 3 فترات عجز.")}}
	setupAssistant(t, f)
	stubAskTools(t, &runs)
	out, err := AskWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"question": "أين العجز؟", "locale": "ar"})
	if err != nil || out.Answer != "الرياض الوسطى: 3 فترات عجز." {
		t.Fatalf("answer %q err %v", out.Answer, err)
	}
	if !strings.Contains(f.seen[0].System, "never Markdown") {
		t.Fatal("ask prompt lacks the plain-text rule")
	}
	f2 := &fakeProvider{replies: []assistant.Reply{textReply("# Forecast\n**7** cases.")}}
	setupAssistant(t, f2)
	stubExplainFacts(t)
	ex, err := ExplainWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"target": "forecast_explorer", "zone_id": asstZone, "date": "2026-09-14"})
	if err != nil || ex.Text != "Forecast\n7 cases." || !strings.Contains(f2.seen[0].System, "never Markdown") {
		t.Fatalf("explain %q err %v", ex.Text, err)
	}
}

func TestRuleDraftPromptListsTheBuilderFields(t *testing.T) {
	sys := ruleDraftSystem([]string{"Customer", "Unlisted"})
	for _, want := range []string{"severity: enum", "values: minor, moderate, severe", "claim_value_sar: num", "estimated_damage_sar: num", "NOT the claim", "location_type", "customer_preference", "values: Customer, Unlisted", "unmapped", "طفيف", "Minor damage, no injury, claim under 5000 SAR"} {
		if !strings.Contains(sys, want) {
			t.Fatalf("system prompt lacks %q", want)
		}
	}
	for _, f := range ruleDraftFields {
		if !strings.Contains(sys, "- "+f.Field+":") {
			t.Fatalf("field %s missing", f.Field)
		}
	}
}

func TestRuleDraftReturnsUnmappedPhrases(t *testing.T) {
	reply := `{"name_en":"Minor, no injury, claim under 5,000 SAR: remote","name_ar":"بسيط","match":"all","predicates":[{"field":"severity","operator":"eq","value":"minor"},{"field":"injury_present","operator":"eq","value":false},{"field":"claim_value_sar","operator":"lt","value":5000}],"condition_text_en":"Minor, no injury, claim under 5,000 SAR.","outcome":"remote_eligible","unmapped":["at night"," "]}`
	setupAssistant(t, &fakeProvider{replies: []assistant.Reply{textReply(reply)}})
	out, err := DraftRuleWithAssistant(context.Background(), nil, asstCtx(access.RoleAdministrator), map[string]any{"text": "Minor damage, no injury, claim under 5000 SAR at night goes remote"})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Unmapped) != 1 || out.Unmapped[0] != "at night" || len(out.Draft.Condition.Predicates) != 3 {
		t.Fatalf("out %+v", out)
	}
	setupAssistant(t, &fakeProvider{replies: []assistant.Reply{textReply(goodDraft)}})
	out, err = DraftRuleWithAssistant(context.Background(), nil, asstCtx(access.RoleAdministrator), map[string]any{"text": "x"})
	if err != nil || out.Unmapped == nil || len(out.Unmapped) != 0 {
		t.Fatalf("no unmapped: %+v %v", out.Unmapped, err)
	}
	for name, text := range map[string]string{
		"bad severity":  strings.Replace(reply, `"value":"minor"`, `"value":"tiny"`, 1),
		"unmapped text": strings.Replace(reply, `["at night"," "]`, `"at night"`, 1),
	} {
		setupAssistant(t, &fakeProvider{replies: []assistant.Reply{textReply(text)}})
		if _, err := DraftRuleWithAssistant(context.Background(), nil, asstCtx(access.RoleAdministrator), map[string]any{"text": "x"}); reasonOf(err) != dataerr.ReasonAssistantInvalid {
			t.Fatalf("%s: %v", name, err)
		}
	}
}

func TestDriverLabelsMatchTheScreen(t *testing.T) {
	for i, locale := range []string{"en", "ar"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "web", "messages", "ops", "forecast_explorer", locale+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var msgs struct {
			Why struct {
				D map[string]string `json:"d"`
			} `json:"why"`
		}
		if err := json.Unmarshal(raw, &msgs); err != nil {
			t.Fatal(err)
		}
		if len(msgs.Why.D) != len(driverLabels) {
			t.Fatalf("%s: %d screen labels, %d here", locale, len(msgs.Why.D), len(driverLabels))
		}
		for k, v := range msgs.Why.D {
			if driverLabels[k][i] != v {
				t.Fatalf("%s %s: %q here, %q on screen", locale, k, driverLabels[k][i], v)
			}
		}
	}
}
