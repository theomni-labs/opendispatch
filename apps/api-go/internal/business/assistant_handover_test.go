// SPDX-License-Identifier: AGPL-3.0-only

// Handover and digest, with a fake provider.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func msAt(t *testing.T, hm string) int64 {
	t.Helper()
	at, err := datactx.EpochOf("2026-09-13T" + hm + ":00+03:00")
	if err != nil {
		t.Fatal(err)
	}
	return at.UnixMilli()
}

func handoverSample(t *testing.T) handoverInputs {
	t.Helper()
	nameAr := "الرياض الشمالية"
	north := Zone{ID: "z-n", NameEn: "Riyadh North", NameAr: &nameAr, Extra: map[string]any{"code": "RD-N"}}
	forecast := 71.4
	return handoverInputs{
		FromMs: msAt(t, "02:42"), ToMs: msAt(t, "10:42"), Hours: 8, Day: "2026-09-13", Zones: []Zone{north},
		Registered: 69, Assigned: 64, Waiting: 5, FallbackCases: 4, Forecast: &forecast,
		Customer: &ShadowSideSummary{FromAssignment: ServiceLevelReading{Share: share(0.78)}, FromRegistration: ServiceLevelReading{Share: share(0.61)}},
		Compared: 40, ReadingFrom: "2026-09-13 02:50", ReadingTo: "2026-09-13 10:40", ClockStart: "assignment", ThresholdMin: 10,
		Unmet:      map[string]int{"geography": 3, "people": 2},
		Periods:    []fallbackPeriod{{StartMs: msAt(t, "07:10"), EndMs: msAt(t, "07:24"), Reason: "feed_outage"}},
		Alerts:     []AssistantAlertGroup{{Category: "integration", Severity: "critical", Count: 1, LatestAt: "2026-09-13T09:00:00+03:00"}},
		Next:       &handoverGaps{Gaps: 6, Worst: &gapWorst{Delta: -2, Zone: north, Index: 68}, CauseCounts: map[string]int{"people": 4, "vehicles": 2}},
		NextFromMs: msAt(t, "10:42"), Overrides: map[string]int{"closer_agent_known": 3, "other": 1}, OverridesVisible: true, DataSource: "SYNTHETIC",
	}
}

func stubHandover(t *testing.T, in handoverInputs) {
	t.Helper()
	prev := gatherHandover
	gatherHandover = func(context.Context, *tenancy.Connection, reqctx.RequestContext, int) (handoverInputs, error) {
		return in, nil
	}
	t.Cleanup(func() { gatherHandover = prev })
}

func TestHandoverFactsCarryBothClocksPrimaryFirst(t *testing.T) {
	in := handoverSample(t)
	for _, tc := range []struct{ clock, first string }{{"assignment", "78%"}, {"registration", "61%"}} {
		in.ClockStart = tc.clock
		f := roundTrip(t, handoverFacts(in, "en"))
		clocks := factMap(f, "within_10_minutes")["clocks"].([]any)
		if len(clocks) != 2 || clocks[0].(map[string]any)["value"] != tc.first {
			t.Fatalf("%s: clocks %v", tc.clock, clocks)
		}
	}
}

func TestHandoverFactsArabicLabelsAndNoPersonalData(t *testing.T) {
	in := handoverSample(t)
	raw, _ := json.Marshal(handoverFacts(in, "ar"))
	s := string(raw)
	for _, want := range []string{"تسليم المناوبة", "الرياض الشمالية", "من الإسناد", "بعيد جدًا", "تغذية البلاغات متوقفة", "مندوب أقرب معروف", "حرج", "07:10", "17:00"} {
		if !strings.Contains(s, want) {
			t.Fatalf("lacks %q: %s", want, s)
		}
	}
	for _, banned := range []string{"z-n", "case_number", "agent_id", "RD-260913", "latitude"} {
		if strings.Contains(s, banned) {
			t.Fatalf("sent %q: %s", banned, s)
		}
	}
}

func TestHandoverFactsSayNotAvailable(t *testing.T) {
	in := handoverSample(t)
	in.Forecast, in.Next, in.OverridesVisible, in.Customer, in.ForecastHidden = nil, nil, false, nil, true
	f := handoverFacts(in, "en")
	if factStr(factMap(f, "forecast_cases"), "value") != "Not available for this role" || f["overrides"] != nil {
		t.Fatalf("facts %v", f)
	}
	if v := factStr(factMap(f, "within_10_minutes"), "value"); v != "No cases compared yet" {
		t.Fatalf("reading %q", v)
	}
	in.ForecastHidden = false
	if v := factStr(factMap(handoverFacts(in, "ar"), "forecast_cases"), "value"); v != "لا يوجد توقع لهذه الفترة" {
		t.Fatalf("forecast %q", v)
	}
	text := handoverFallback(handoverFacts(in, "en"), "en")
	if !strings.Contains(text, "No cases compared yet") || !strings.Contains(text, "No forecast for this window") {
		t.Fatalf("fallback %s", text)
	}
	if g := factStr(factMap(f, "next_shift"), "gaps"); g != "Not available for this role" {
		t.Fatalf("next %q", g)
	}
}

func TestFallbackPeriodsInsideTheWindow(t *testing.T) {
	ev := []DispatchFallbackEvent{
		{At: "2026-09-13T01:00:00+03:00", Kind: "outage", Feed: "cases", Active: true},
		{At: "2026-09-13T03:00:00+03:00", Kind: "outage", Feed: "cases", Active: false},
		{At: "2026-09-13T07:10:00+03:00", Kind: "outage", Feed: "cases", Active: true},
		{At: "2026-09-13T07:24:00+03:00", Kind: "outage", Feed: "cases", Active: false},
		{At: "2026-09-13T10:00:00+03:00", Kind: "maintenance", Active: true},
	}
	got := fallbackPeriods(ev, msAt(t, "02:42"), msAt(t, "10:42"))
	if len(got) != 3 {
		t.Fatalf("periods %+v", got)
	}
	if hmAt(got[0].StartMs) != "02:42" || hmAt(got[0].EndMs) != "03:00" || got[1].Reason != "feed_outage" || hmAt(got[1].EndMs) != "07:24" {
		t.Fatalf("periods %+v", got)
	}
	if !got[2].Ongoing || got[2].Reason != "maintenance" {
		t.Fatalf("last %+v", got[2])
	}
}

func handoverRun(t *testing.T, f *fakeProvider, locale string) AssistantHandover {
	t.Helper()
	setupAssistant(t, f)
	stubHandover(t, handoverSample(t))
	out, err := SummariseShiftHandover(context.Background(), nil, asstCtx(access.RoleDispatchSupervisor), map[string]any{"window_hours": float64(8), "locale": locale})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestHandoverNumberGuardPasses(t *testing.T) {
	text := "69 cases registered, 64 assigned; 71 were forecast.\nWithin 10 minutes: 78% from assignment, 61% from registration.\n5 cases out of reach: 3 too far, 2 no agent free.\nCustomer dispatch took over 07:10 to 07:24 (case feed down), 4 cases.\n1 critical alert unread.\nNext shift: 6 gap intervals, worst Riyadh North at 17:00, 2 agents short."
	f := &fakeProvider{replies: []assistant.Reply{textReply(text)}}
	out := handoverRun(t, f, "en")
	if len(f.seen) != 1 || out.Text != text || out.AnswerPath != explainPathChecked || out.WindowHours != 8 || !out.Suggestion || !out.Illustrative {
		t.Fatalf("out %+v calls %d", out, len(f.seen))
	}
	if !strings.Contains(f.seen[0].System, "5 to 8") || !strings.Contains(f.seen[0].Messages[0].Text, out.Sent) {
		t.Fatalf("prompt %q", f.seen[0].System)
	}
	ev := eventsWith("assistant.handover")
	if len(ev) != 1 || ev[0].Detail["answer_path"] != explainPathChecked || ev[0].Outcome != "success" {
		t.Fatalf("audit %+v", ev)
	}
	if _, ok := ev[0].Detail["text"]; ok {
		t.Fatal("audit keeps the answer text")
	}
}

func TestHandoverNumberGuardRetriesOnce(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply("تمت معالجة 93% من البلاغات، و70 بلاغًا."), textReply("سُجّل 69 بلاغًا وأُسند 64، والمتوقع 71.")}}
	out := handoverRun(t, f, "ar")
	if len(f.seen) != 2 || out.AnswerPath != explainPathRetried || !strings.HasPrefix(out.Text, "سُجّل 69") {
		t.Fatalf("out %+v", out)
	}
	if retry := f.seen[1].Messages; len(retry) != 3 || !strings.Contains(retry[2].Text, "93, 70") {
		t.Fatalf("retry %+v", retry)
	}
	if !strings.Contains(f.seen[0].System, "Arabic") {
		t.Fatal("not asked for Arabic")
	}
}

func TestHandoverNumberGuardFallsBackToTheFacts(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply("About 75 cases."), textReply("Still about 75.")}}
	for _, locale := range []string{"en", "ar"} {
		f.replies = []assistant.Reply{textReply("About 75 cases."), textReply("Still about 75.")}
		f.seen = nil
		out := handoverRun(t, f, locale)
		if out.AnswerPath != explainPathFallback || strings.Contains(out.Text, "75") {
			t.Fatalf("%s fallback %q", locale, out.Text)
		}
		var facts map[string]any
		if err := json.Unmarshal([]byte(out.Sent), &facts); err != nil {
			t.Fatal(err)
		}
		if bad := unknownNumbers(out.Text, allowedNumbers(facts)); len(bad) != 0 {
			t.Fatalf("%s fallback has %v: %s", locale, bad, out.Text)
		}
		for _, want := range []string{"69", "64", "71", "78%", "61%", "07:10", "17:00"} {
			if !strings.Contains(out.Text, want) {
				t.Fatalf("%s fallback lacks %q: %s", locale, want, out.Text)
			}
		}
	}
}

func TestHandoverChecksRoleAndWindow(t *testing.T) {
	setupAssistant(t, &fakeProvider{})
	stubHandover(t, handoverSample(t))
	_, err := SummariseShiftHandover(context.Background(), nil, asstCtx(access.RoleRemoteTeamLead), map[string]any{})
	if de, ok := err.(*dataerr.DataError); !ok || de.Code != dataerr.CodeForbidden {
		t.Fatalf("remote team lead: %v", err)
	}
	if ev := eventsWith("assistant.handover"); len(ev) != 1 || ev[0].Outcome != "denied" {
		t.Fatalf("audit %+v", ev)
	}
	for _, bad := range []any{float64(6), "8", float64(0)} {
		if _, err := SummariseShiftHandover(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"window_hours": bad}); err == nil {
			t.Fatalf("window %v accepted", bad)
		}
	}
	if _, err := SummariseShiftHandover(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"zone": "x"}); err == nil {
		t.Fatal("unknown key accepted")
	}
}

func TestHandoverOffSaysSo(t *testing.T) {
	setupAssistant(t, nil)
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "off")
	stubHandover(t, handoverSample(t))
	_, err := SummariseShiftHandover(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{})
	if reasonOf(err) != dataerr.ReasonAssistantOff {
		t.Fatalf("off: %v", err)
	}
}

func seedAlerts(t *testing.T, rc reqctx.RequestContext, rows ...[3]string) {
	t.Helper()
	ResetNotificationsForTest()
	t.Cleanup(ReloadNotificationsForTest)
	for i, r := range rows {
		user := rc.UserID
		UpsertNotificationForTest(Notification{
			BaseRecord: fakeBase(rc, fmt.Sprintf("n-%d", i), r[2]), RecipientUserID: &user,
			Category: r[0], Severity: r[1], TitleEn: "Agent Hala Al-Rasahi, 0551234567", IsRead: false,
		})
	}
}

func fakeBase(rc reqctx.RequestContext, id, at string) (b datactx.BaseRecord) {
	b.ID, b.TenantID, b.CreatedAt, b.UpdatedAt, b.DataSource = id, rc.CustomerID, at, at, "SYNTHETIC"
	return b
}

func TestAlertGroupsWorstFirst(t *testing.T) {
	rows := []Notification{
		{Category: "roster", Severity: "info"}, {Category: "roster", Severity: "info"},
		{Category: "fallback", Severity: "warning"}, {Category: "integration", Severity: "critical"},
	}
	g := alertGroups(rows)
	if len(g) != 3 || g[0].Category != "integration" || g[1].Severity != "warning" || g[2].Count != 2 {
		t.Fatalf("groups %+v", g)
	}
}

func TestAlertsDigestSendsNoTitlesAndChecksNumbers(t *testing.T) {
	rc := asstCtx(access.RoleDispatchSupervisor)
	f := &fakeProvider{replies: []assistant.Reply{textReply("17 unread alerts."), textReply("3 unread alerts: 1 critical integration alert, 2 roster notices.")}}
	setupAssistant(t, f)
	seedAlerts(t, rc, [3]string{"roster", "info", "2026-09-13T08:00:00+03:00"}, [3]string{"roster", "info", "2026-09-13T09:30:00+03:00"}, [3]string{"integration", "critical", "2026-09-13T07:00:00+03:00"})
	out, err := SummariseMyAlerts(context.Background(), nil, rc, map[string]any{"locale": "en"})
	if err != nil {
		t.Fatal(err)
	}
	if out.Unread != 3 || len(out.Groups) != 2 || out.Groups[0].Category != "integration" || out.AnswerPath != explainPathRetried {
		t.Fatalf("digest %+v", out)
	}
	if strings.Contains(out.Sent, "Hala") || strings.Contains(out.Sent, "0551234567") || !strings.Contains(out.Sent, "09:30") {
		t.Fatalf("sent %s", out.Sent)
	}
	if ev := eventsWith("assistant.alerts_digest"); len(ev) != 1 || ev[0].Outcome != "success" {
		t.Fatalf("audit %+v", ev)
	}
}

func TestAlertsDigestWithNothingUnreadSkipsTheModel(t *testing.T) {
	rc := asstCtx(access.RolePlanner)
	f := &fakeProvider{}
	setupAssistant(t, f)
	seedAlerts(t, rc)
	out, err := SummariseMyAlerts(context.Background(), nil, rc, map[string]any{"locale": "ar"})
	if err != nil || out.Unread != 0 || out.Text != "" || len(f.seen) != 0 || out.Groups == nil {
		t.Fatalf("digest %+v %v calls %d", out, err, len(f.seen))
	}
}

func TestAlertsDigestFallbackHoldsOnlyFactNumbers(t *testing.T) {
	for _, locale := range []string{"en", "ar"} {
		facts := alertFacts([]AssistantAlertGroup{{Category: "fallback", Severity: "warning", Count: 2, LatestAt: "2026-09-13T07:24:00+03:00"}}, locale)
		text := digestFallback(facts, locale)
		if bad := unknownNumbers(text, allowedNumbers(facts)); len(bad) != 0 || !strings.Contains(text, "07:24") {
			t.Fatalf("%s %q %v", locale, text, bad)
		}
	}
}
