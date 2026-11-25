// SPDX-License-Identifier: AGPL-3.0-only

// Event notices and scenario drafts, fake provider.
package business

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	tToday = "2026-10-04"
	zRC    = "00000000-0000-4000-8000-0000000000c1"
	zRN    = "00000000-0000-4000-8000-0000000000c2"
	zJN    = "00000000-0000-4000-8000-0000000000d1"
	pDayA  = "00000000-0000-4000-8000-0000000000a1"
	pDayB  = "00000000-0000-4000-8000-0000000000a2"
	pEve   = "00000000-0000-4000-8000-0000000000a3"
	pNight = "00000000-0000-4000-8000-0000000000a4"
)

var testZones = []noticeZone{
	{ID: zRC, Code: "RD-C", NameEn: "Riyadh Central", City: "Riyadh"},
	{ID: zRN, Code: "RD-N", NameEn: "Riyadh North", City: "Riyadh"},
	{ID: zJN, Code: "JD-N", NameEn: "Jeddah North", City: "Jeddah"},
}

func setupDrafts(t *testing.T, p assistant.Provider) reqctx.RequestContext {
	t.Helper()
	setupAssistant(t, p)
	settingsstore.ResetForTest()
	rc := asstCtx(access.RoleAdministrator)
	if err := settingsstore.Put(context.Background(), rc.CustomerID, "demo.today", tToday); err != nil {
		t.Fatal(err)
	}
	prevZones, prevOpt, prevCheck := noticeZones, scenarioOptions, scenarioDraftCheck
	noticeZones = func(context.Context, *tenancy.Connection, reqctx.RequestContext) ([]noticeZone, error) {
		return testZones, nil
	}
	scenarioOptions = func(context.Context, *tenancy.Connection, reqctx.RequestContext) (scenarioDraftOptions, error) {
		return scenarioDraftOptions{
			Zones:    []draftZone{{zRC, "RD-C", "Riyadh Central", "Riyadh"}, {zRN, "RD-N", "Riyadh North", "Riyadh"}, {zJN, "JD-N", "Jeddah North", "Jeddah"}},
			Patterns: []draftPattern{{pDayA, "DAY-A", "Day A"}, {pDayB, "DAY-B", "Day B"}, {pEve, "EVENING", "Evening"}, {pNight, "NIGHT", "Night"}},
			Dates:    scenarioDates(tToday),
		}, nil
	}
	checked := 0
	scenarioDraftCheck = func(_ context.Context, _ *tenancy.Connection, _ reqctx.RequestContext, body map[string]any) error {
		checked++
		if _, ok := body["adjustments"].(map[string]any); !ok {
			return fmt.Errorf("no adjustments")
		}
		return nil
	}
	t.Cleanup(func() { noticeZones, scenarioOptions, scenarioDraftCheck = prevZones, prevOpt, prevCheck })
	return rc
}

const noticeEN = `Al-Hilal v Al-Nassr at Kingdom Arena, Riyadh, Thursday 15 October 2026, kick-off 21:00, gates open 18:00. Expected attendance 26,000. Roads around the arena close from 17:00 to 01:00. Call 0501234567.`

const goodNotice = `{"events":[
{"name_en":"Al-Hilal v Al-Nassr","name_ar":"الهلال والنصر","notice_type":"sports_match","city":"Riyadh","zones":["RD-N"],"start_date":"2026-10-15","end_date":"2026-10-16","start_time":"18:00","end_time":"01:00","impact":"high","impact_reason":"A derby draws a large crowd.","quote":"Expected attendance 26,000."},
{"name_en":"Road closures, Kingdom Arena","name_ar":null,"notice_type":"road_closure","city":"riyadh","zones":[],"start_date":"2026-10-15","end_date":"2026-10-16","start_time":"17:00","end_time":"01:00","impact":"medium","impact_reason":"Closed roads slow traffic.","quote":"Roads around the arena close from 17:00 to 01:00"}],
"unmapped":["gates open 18:00"]}`

func TestEventNoticeValidDrafts(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply("```json\n" + goodNotice + "\n```")}}
	rc := setupDrafts(t, f)
	out, err := ReadEventNoticeWithAssistant(context.Background(), nil, rc, map[string]any{"text": noticeEN, "locale": "en"})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Events) != 2 || !out.Suggestion || out.Provider != "fake" || len(out.Unmapped) != 1 {
		t.Fatalf("out %+v", out)
	}
	m := out.Events[0]
	if m.ForecastEventType != "season_event" || *m.City != "Riyadh" || len(m.ZoneIDs) != 1 || m.ZoneIDs[0] != zRN || *m.StartTime != "18:00" || m.FromHijri {
		t.Fatalf("match %+v", m)
	}
	r := out.Events[1]
	if r.ForecastEventType != "other" || len(r.ZoneIDs) != 2 || r.NameAr != nil {
		t.Fatalf("closure: an empty zone list is every zone of the city: %+v", r)
	}
	sent := f.seen[0].Messages[0].Text
	if strings.Contains(sent, "0501234567") || !f.seen[0].JSON || !strings.Contains(f.seen[0].System, "RD-C: Riyadh Central") || !strings.Contains(f.seen[0].System, tToday) {
		t.Fatalf("sent %q", sent)
	}
	ev := eventsWith("assistant.event_notice")
	if len(ev) != 1 || ev[0].Outcome != "success" || ev[0].Detail["events"] != 2 {
		t.Fatalf("audit %+v", ev)
	}
	if strings.Contains(fmt.Sprint(ev[0].Detail), "Kingdom") {
		t.Fatal("the notice text is not stored in the audit")
	}
}

func TestEventNoticeHijriAndArabicQuote(t *testing.T) {
	h := forecastcal.HijriOf("2026-10-20")
	hij := fmt.Sprintf("hijri:%04d-%02d-%02d", h.Year, h.Month, h.Day)
	notice := "يقام مهرجان جدة يوم ٢٠ أكتوبر، والحضور المتوقع ٣٠ ألف زائر."
	reply := `{"events":[{"name_en":"Jeddah festival","name_ar":"مهرجان جدة","notice_type":"festival","city":"Jeddah","zones":[],"start_date":"` + hij + `","end_date":"` + hij + `","start_time":null,"end_time":null,"impact":"medium","impact_reason":"Visitors.","quote":"«والحضور المتوقع 30 ألف زائر»"}],"unmapped":[]}`
	rc := setupDrafts(t, &fakeProvider{replies: []assistant.Reply{textReply(reply)}})
	out, err := ReadEventNoticeWithAssistant(context.Background(), nil, rc, map[string]any{"text": notice, "locale": "ar"})
	if err != nil {
		t.Fatal(err)
	}
	e := out.Events[0]
	if e.StartDate != "2026-10-20" || !e.FromHijri || e.StartTime != nil || len(e.ZoneIDs) != 1 || e.ZoneIDs[0] != zJN {
		t.Fatalf("event %+v", e)
	}
}

func TestEventNoticeNoEvents(t *testing.T) {
	rc := setupDrafts(t, &fakeProvider{replies: []assistant.Reply{textReply(`{"events":[],"unmapped":["Tickets from 50 SAR"]}`)}})
	out, err := ReadEventNoticeWithAssistant(context.Background(), nil, rc, map[string]any{"text": "Tickets from 50 SAR"})
	if err != nil || len(out.Events) != 0 || len(out.Unmapped) != 1 {
		t.Fatalf("out %+v err %v", out, err)
	}
}

func TestEventNoticeRejectsInvalidOutput(t *testing.T) {
	cases := map[string]string{
		"not json":        "There is a match on Thursday.",
		"extra key":       strings.Replace(goodNotice, `"unmapped"`, `"sql":"x","unmapped"`, 1),
		"event key":       strings.Replace(goodNotice, `"impact":"high"`, `"impact":"high","priority":1`, 1),
		"bad type":        strings.Replace(goodNotice, "sports_match", "riot", 1),
		"bad impact":      strings.Replace(goodNotice, `"impact":"high"`, `"impact":"huge"`, 1),
		"unknown city":    strings.Replace(goodNotice, `"city":"Riyadh"`, `"city":"Abha"`, 1),
		"zone of other":   strings.Replace(goodNotice, `"zones":["RD-N"]`, `"zones":["JD-N"]`, 1),
		"zones no city":   strings.Replace(goodNotice, `"city":"Riyadh"`, `"city":null`, 1),
		"bad date":        strings.Replace(goodNotice, `"start_date":"2026-10-15"`, `"start_date":"2026-02-30"`, 1),
		"end before":      strings.Replace(goodNotice, `"end_date":"2026-10-16","start_time":"18:00"`, `"end_date":"2026-10-14","start_time":"18:00"`, 1),
		"in the past":     strings.Replace(strings.Replace(goodNotice, `"start_date":"2026-10-15","end_date":"2026-10-16","start_time":"18:00"`, `"start_date":"2026-09-01","end_date":"2026-09-02","start_time":"18:00"`, 1), "", "", 1),
		"too far":         strings.Replace(goodNotice, `"start_date":"2026-10-15","end_date":"2026-10-16","start_time":"18:00"`, `"start_date":"2028-10-15","end_date":"2028-10-16","start_time":"18:00"`, 1),
		"too long":        strings.Replace(goodNotice, `"end_date":"2026-10-16","start_time":"18:00"`, `"end_date":"2027-01-16","start_time":"18:00"`, 1),
		"bad hijri":       strings.Replace(goodNotice, `"start_date":"2026-10-15"`, `"start_date":"hijri:1448-13-01"`, 1),
		"bad time":        strings.Replace(goodNotice, `"start_time":"18:00"`, `"start_time":"6pm"`, 1),
		"quote not there": strings.Replace(goodNotice, "Expected attendance 26,000.", "Expected attendance 60,000.", 1),
		"no reason":       strings.Replace(goodNotice, `"impact_reason":"A derby draws a large crowd."`, `"impact_reason":""`, 1),
	}
	for name, reply := range cases {
		t.Run(name, func(t *testing.T) {
			rc := setupDrafts(t, &fakeProvider{replies: []assistant.Reply{textReply(reply)}})
			_, err := ReadEventNoticeWithAssistant(context.Background(), nil, rc, map[string]any{"text": noticeEN})
			if errCode(err) != dataerr.CodeInvalid || reasonOf(err) != dataerr.ReasonAssistantInvalid {
				t.Fatalf("got %v", err)
			}
			if ev := eventsWith("assistant.event_notice"); len(ev) != 1 || ev[0].Outcome != "rejected" {
				t.Fatalf("audit %+v", ev)
			}
		})
	}
}

func TestEventNoticeRoleTextAndOff(t *testing.T) {
	rc := setupDrafts(t, &fakeProvider{})
	_, err := ReadEventNoticeWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"text": "x"})
	if errCode(err) != dataerr.CodeForbidden || eventsWith("assistant.event_notice")[0].Outcome != "denied" {
		t.Fatalf("planner: %v", err)
	}
	if _, err := ReadEventNoticeWithAssistant(context.Background(), nil, rc, map[string]any{"text": strings.Repeat("a", 4001)}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("long: %v", err)
	}
	if _, err := ReadEventNoticeWithAssistant(context.Background(), nil, rc, map[string]any{"text": "x", "url": "https://example.com"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("no url field: %v", err)
	}
	assistant.Override(nil)
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "off")
	if _, err := ReadEventNoticeWithAssistant(context.Background(), nil, rc, map[string]any{"text": "x"}); reasonOf(err) != dataerr.ReasonAssistantOff {
		t.Fatalf("off: %v", err)
	}
}

func noticeBody(name string, zones []any, impact string) map[string]any {
	return map[string]any{"kind": "notice", "name": name, "name_ar": "مباراة", "start_date": "2026-10-15", "end_date": "2026-10-16",
		"notice": map[string]any{"notice_type": "sports_match", "zone_ids": zones, "start_time": "18:00", "end_time": "01:00", "impact": impact, "impact_reason": "Crowd.", "quote": "Expected attendance 26,000.", "assisted": true}}
}

func TestCalendarNoticeEventsSaveListAndForecast(t *testing.T) {
	rc := setupDrafts(t, &fakeProvider{})
	auditlog.ResetForTest()
	ev, err := CreateCalendarEvent(rc, noticeBody("Al-Hilal v Al-Nassr", []any{zRN, zRC}, "high"))
	check(t, err)
	if ev.Kind != "notice" || *ev.EventType != "season_event" || ev.Notice == nil || len(ev.Notice.ZoneIDs) != 2 || ev.Scope.Cities[0] != "Riyadh" || !ev.Notice.Assisted || *ev.NameAr != "مباراة" {
		t.Fatalf("created %+v", ev)
	}
	if _, err := CreateCalendarEvent(rc, noticeBody("Al-Hilal v Al-Nassr", []any{zRN, zRC}, "high")); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("duplicate: %v", err)
	}
	// Overlap with another notice is fine
	other, err := CreateCalendarEvent(rc, noticeBody("Jeddah derby", []any{zJN}, "medium"))
	check(t, err)
	a := eventsWith("calendar_event.created")
	if len(a) != 2 || a[0].Detail["assisted"] != true {
		t.Fatalf("audit %+v", a)
	}
	list, err := ListCalendarEvents(rc, "2026-10-01", "2026-10-31")
	check(t, err)
	if got := eventsOf(list.Items, "notice"); len(got) != 2 {
		t.Fatalf("listed %+v", got)
	}
	cfg := forecastCalendarConfig(context.Background(), rc.CustomerID)
	var found []forecastcal.Event
	for _, e := range cfg.For("2026-10-16").Events {
		if e.Name == "Al-Hilal v Al-Nassr" || e.Name == "Jeddah derby" {
			found = append(found, e)
		}
	}
	if len(found) != 2 || found[0].Type != "season_event" || len(found[0].ZoneIDs) == 0 {
		t.Fatalf("forecaster events %+v", found)
	}
	upd := noticeBody("Jeddah derby", []any{zJN}, "low")
	upd["notice"].(map[string]any)["notice_type"] = "road_closure"
	changed, err := UpdateCalendarEvent(rc, other.ID, upd)
	check(t, err)
	if *changed.EventType != "other" || changed.Notice.Impact != "low" {
		t.Fatalf("updated %+v", changed)
	}
	check(t, DeleteCalendarEvent(rc, changed.ID))
	if got := storedNotices(context.Background(), rc.CustomerID); len(got) != 1 {
		t.Fatalf("after delete %+v", got)
	}
	bad := []map[string]any{
		noticeBody("x", []any{"00000000-0000-4000-8000-0000000000ff"}, "high"),
		noticeBody("x", []any{zRN}, "extreme"),
		{"kind": "season", "name": "x", "start_date": "2026-10-15", "end_date": "2026-10-16", "notice": map[string]any{}},
		{"kind": "notice", "name": "x", "start_date": "2026-10-15", "end_date": "2026-10-16"},
	}
	for i, b := range bad {
		if _, err := CreateCalendarEvent(rc, b); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("bad %d: %v", i, err)
		}
	}
}

func TestGregorianOfHijri(t *testing.T) {
	for _, d := range []string{"2026-10-04", "2027-03-10", "2026-05-27"} {
		h := forecastcal.HijriOf(d)
		if g, ok := forecastcal.GregorianOfHijri(h.Year, h.Month, h.Day); !ok || g != d {
			t.Fatalf("%s: %s %v", d, g, ok)
		}
	}
	if _, ok := forecastcal.GregorianOfHijri(1448, 13, 1); ok {
		t.Fatal("month 13")
	}
}

const goodScenario = `{"name":"Riyadh North: +5 field, remote 40%","base_day":"Thursday","zones":["RD-N","RD-C"],"field_agents":5,"vehicles":0,"remote_mode":"company","remote_agents":0,"remote_by_zone":{},"remote_share_percent":40,"shift_patterns":[],"unmapped":["on Thursdays"]}`

func TestScenarioDraftValid(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply(goodScenario)}}
	rc := setupDrafts(t, f)
	out, err := DraftScenarioWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"text": "What if we add 5 agents in Riyadh on Thursdays and move 10% of cases to remote?", "locale": "en"})
	if err != nil {
		t.Fatal(err)
	}
	d := out.Draft
	if d.BaseDate != "2026-10-08" || len(d.ZoneIDs) != 2 || d.FieldAgents != 5 || *d.RemoteSharePercent != 40 || d.RemoteMode != "company" || len(d.ShiftPatternIDs) != 3 || d.ShiftPatternIDs[2] != pNight {
		t.Fatalf("draft %+v", d)
	}
	if len(out.Unmapped) != 1 || out.Unmapped[0] != "on Thursdays" || !out.Suggestion {
		t.Fatalf("out %+v", out)
	}
	sys := f.seen[0].System
	if !strings.Contains(sys, "base_day") || !strings.Contains(sys, "RD-N: Riyadh North, Riyadh") || !strings.Contains(sys, "Today it is 30%") {
		t.Fatalf("system %q", sys)
	}
	body := scenarioWriteOf(d)
	adj := body["adjustments"].(map[string]any)
	if adj["remote_share"] != 0.4 || len(adj["headcount_delta"].([]any)) != 2 {
		t.Fatalf("body %+v", body)
	}
	_ = rc
	if ev := eventsWith("assistant.scenario_draft"); len(ev) != 1 || ev[0].Outcome != "success" {
		t.Fatalf("audit %+v", ev)
	}
}

func TestScenarioDraftPerZoneRemote(t *testing.T) {
	reply := strings.NewReplacer(`"remote_mode":"company"`, `"remote_mode":"zone"`, `"remote_by_zone":{}`, `"remote_by_zone":{"RD-N":2,"RD-C":-1}`, `"shift_patterns":[]`, `"shift_patterns":["EVENING"]`).Replace(goodScenario)
	setupDrafts(t, &fakeProvider{replies: []assistant.Reply{textReply(reply)}})
	out, err := DraftScenarioWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"text": "x"})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Draft.RemoteByZone) != 2 || out.Draft.ShiftPatternIDs[0] != pEve {
		t.Fatalf("draft %+v", out.Draft)
	}
	delta := scenarioWriteOf(out.Draft)["adjustments"].(map[string]any)["headcount_delta"].([]any)
	if delta[0].(map[string]any)["remote_agents"] != float64(2) {
		t.Fatalf("delta %+v", delta)
	}
}

func TestScenarioDraftRejectsInvalidOutput(t *testing.T) {
	cases := map[string]string{
		"not json":            "Add five agents.",
		"extra key":           strings.Replace(goodScenario, `"vehicles":0`, `"vehicles":0,"overtime":4`, 1),
		"bad day":             strings.Replace(goodScenario, `"Thursday"`, `"Someday"`, 1),
		"unknown zone":        strings.Replace(goodScenario, `"RD-C"]`, `"MK-1"]`, 1),
		"no zones":            strings.Replace(goodScenario, `["RD-N","RD-C"]`, `[]`, 1),
		"too many":            strings.Replace(goodScenario, `"field_agents":5`, `"field_agents":500`, 1),
		"fraction":            strings.Replace(goodScenario, `"field_agents":5`, `"field_agents":2.5`, 1),
		"share step":          strings.Replace(goodScenario, `"remote_share_percent":40`, `"remote_share_percent":42`, 1),
		"share as share":      strings.Replace(goodScenario, `"remote_share_percent":40`, `"remote_share_percent":0.4`, 1),
		"bad mode":            strings.Replace(goodScenario, `"remote_mode":"company"`, `"remote_mode":"city"`, 1),
		"zone map in company": strings.Replace(goodScenario, `"remote_by_zone":{}`, `"remote_by_zone":{"RD-N":1}`, 1),
		"zone mode empty":     strings.Replace(goodScenario, `"remote_mode":"company"`, `"remote_mode":"zone"`, 1),
		"remote outside":      strings.NewReplacer(`"remote_mode":"company"`, `"remote_mode":"zone"`, `"remote_by_zone":{}`, `"remote_by_zone":{"JD-N":1}`).Replace(goodScenario),
		"bad pattern":         strings.Replace(goodScenario, `"shift_patterns":[]`, `"shift_patterns":["RAMADAN-X"]`, 1),
	}
	for name, reply := range cases {
		t.Run(name, func(t *testing.T) {
			setupDrafts(t, &fakeProvider{replies: []assistant.Reply{textReply(reply)}})
			_, err := DraftScenarioWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"text": "x"})
			if errCode(err) != dataerr.CodeInvalid || reasonOf(err) != dataerr.ReasonAssistantInvalid {
				t.Fatalf("got %v", err)
			}
			if ev := eventsWith("assistant.scenario_draft"); len(ev) != 1 || ev[0].Outcome != "rejected" {
				t.Fatalf("audit %+v", ev)
			}
		})
	}
}

func TestScenarioDraftRoleAndSaveCheck(t *testing.T) {
	setupDrafts(t, &fakeProvider{replies: []assistant.Reply{textReply(goodScenario)}, repeat: true})
	if _, err := DraftScenarioWithAssistant(context.Background(), nil, asstCtx(access.RoleDispatcher), map[string]any{"text": "x"}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("dispatcher: %v", err)
	}
	scenarioDraftCheck = func(context.Context, *tenancy.Connection, reqctx.RequestContext, map[string]any) error {
		return dataerr.Invalid("Scenario: an unknown zone.")
	}
	_, err := DraftScenarioWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"text": "x"})
	if reasonOf(err) != dataerr.ReasonAssistantInvalid || !strings.Contains(err.Error(), "unknown zone") {
		t.Fatalf("save check: %v", err)
	}
}

func TestAssistantStatusDraftFeatures(t *testing.T) {
	setupDrafts(t, &fakeProvider{})
	admin, _ := GetAssistantStatus(asstCtx(access.RoleAdministrator))
	planner, _ := GetAssistantStatus(asstCtx(access.RolePlanner))
	if !admin.Features.EventNotice || admin.Features.ScenarioDraft || planner.Features.EventNotice || !planner.Features.ScenarioDraft {
		t.Fatalf("admin %+v planner %+v", admin.Features, planner.Features)
	}
}

func TestScrubNoticeKeepsDates(t *testing.T) {
	got := scrubNotice("من 2026-09-23 إلى ٢٦/٠٩/٢٠٢٦، اتصل 0501234567 أو info@example.com، 17/4/1448هـ")
	for _, want := range []string{"2026-09-23", "٢٦/٠٩/٢٠٢٦", "17/4/1448"} {
		if !strings.Contains(got, want) {
			t.Fatalf("%q lost %q", got, want)
		}
	}
	if strings.Contains(got, "0501234567") || strings.Contains(got, "example.com") {
		t.Fatalf("contacts kept: %q", got)
	}
}

func TestEventNoticeRepairTurnAndStitchedQuote(t *testing.T) {
	stitched := strings.Replace(goodNotice, `"quote":"Expected attendance 26,000."`, `"quote":"Al-Hilal v Al-Nassr at Kingdom Arena, Riyadh, Thursday 15 October 2026, kick-off 21:00. Expected attendance 26,000."`, 1)
	f := &fakeProvider{replies: []assistant.Reply{textReply("not json"), textReply(stitched)}}
	rc := setupDrafts(t, f)
	out, err := ReadEventNoticeWithAssistant(context.Background(), nil, rc, map[string]any{"text": noticeEN})
	if err != nil || len(out.Events) != 2 || len(f.seen) != 2 {
		t.Fatalf("out %+v err %v calls %d", out, err, len(f.seen))
	}
	if last := f.seen[1].Messages; len(last) != 3 || !strings.Contains(last[2].Text, "did not pass the checks") {
		t.Fatalf("repair turn %+v", last)
	}
	if ev := eventsWith("assistant.event_notice"); ev[0].Detail["attempts"] != 2 {
		t.Fatalf("audit %+v", ev[0].Detail)
	}
	if quoteInText("Expected attendance 26,000. Al-Hilal v Al-Nassr", normQuote(noticeEN)) {
		t.Fatal("sentences out of order")
	}
}

func TestScenarioDraftModelRefusesNoRepair(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply(`{"error":"Makkah has no zone in the editor."}`)}, repeat: true}
	setupDrafts(t, f)
	_, err := DraftScenarioWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"text": "add 3 in Makkah"})
	if reasonOf(err) != dataerr.ReasonAssistantInvalid || !strings.Contains(err.Error(), "Makkah") || len(f.seen) != 1 {
		t.Fatalf("err %v calls %d", err, len(f.seen))
	}
}

func TestScenarioBaseDay(t *testing.T) {
	dates := scenarioDates(tToday)
	for in, want := range map[any]string{nil: "2026-10-05", "friday": "2026-10-09", "Sunday": "2026-10-11"} {
		if got, err := baseDateOf(in, dates); err != nil || got != want {
			t.Fatalf("%v: %s %v", in, got, err)
		}
	}
	if _, err := baseDateOf("2026-10-09", dates); reasonOf(err) != dataerr.ReasonAssistantInvalid {
		t.Fatalf("a date is not a day: %v", err)
	}
}
