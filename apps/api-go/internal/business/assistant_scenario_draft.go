// SPDX-License-Identifier: AGPL-3.0-only

// Scenarios in plain language (Scenario Lab).
package business

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	scenarioDraftDays     = 7
	scenarioShareBaseline = 30 // as the editor's REMOTE_SHARE_BASELINE
	scenarioDraftUnmapped = 20
)

// The editor's default patterns, by code.
var scenarioDefaultPatterns = []string{"DAY-A", "DAY-B", "NIGHT"}

// RemoteZoneChange: one zone's remote change.
type RemoteZoneChange struct {
	ZoneID       string `json:"zone_id"`
	RemoteAgents int    `json:"remote_agents"`
}

// ScenarioDraft: the editor's own fields.
type ScenarioDraft struct {
	Name               string             `json:"name"`
	BaseDate           string             `json:"base_date"`
	ZoneIDs            []string           `json:"zone_ids"`
	FieldAgents        int                `json:"field_agents"`
	Vehicles           int                `json:"vehicles"`
	RemoteMode         string             `json:"remote_mode"`
	RemoteAgents       int                `json:"remote_agents"`
	RemoteByZone       []RemoteZoneChange `json:"remote_by_zone"`
	RemoteSharePercent *int               `json:"remote_share_percent"`
	ShiftPatternIDs    []string           `json:"shift_pattern_ids"`
}

// AssistantScenarioDraft: POST /assistant/scenario-draft.
type AssistantScenarioDraft struct {
	Draft    ScenarioDraft `json:"draft"`
	Unmapped []string      `json:"unmapped"`
	AssistantMeta
}

type draftZone struct{ ID, Code, Name, City string }
type draftPattern struct{ ID, Code, Name string }

// scenarioDraftOptions: what the editor offers.
type scenarioDraftOptions struct {
	Zones    []draftZone
	Patterns []draftPattern
	Dates    []string
}

// scenarioOptions: tests swap it.
var scenarioOptions = func(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) (scenarioDraftOptions, error) {
	var out scenarioDraftOptions
	zones, err := noticeZones(ctx, conn, rc)
	if err != nil {
		return out, err
	}
	for _, z := range zones {
		id := z.ID
		if simZoneExists(z.ID) && reqctx.CanWriteZone(rc, &id) {
			out.Zones = append(out.Zones, draftZone{ID: z.ID, Code: z.Code, Name: z.NameEn, City: z.City})
		}
	}
	patterns, err := allShiftPatterns(ctx, conn, rc.CustomerID)
	if err != nil {
		return out, err
	}
	for _, p := range patterns {
		if p.Kind == ShiftKindField && p.Status == ShiftStatusActive {
			out.Patterns = append(out.Patterns, draftPattern{ID: p.ID, Code: p.Code, Name: p.NameEn})
		}
	}
	out.Dates = scenarioDates(Today(rc.CustomerID))
	return out, nil
}

// scenarioDates: the editor's seven base dates.
func scenarioDates(today string) []string {
	t, err := time.Parse("2006-01-02", today)
	if err != nil {
		return nil
	}
	out := make([]string, 0, scenarioDraftDays)
	for i := 1; i <= scenarioDraftDays; i++ {
		out = append(out, t.AddDate(0, 0, i).Format("2006-01-02"))
	}
	return out
}

// scenarioDraftCheck: the createScenario check.
var scenarioDraftCheck = func(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body map[string]any) error {
	_, err := parseScenarioInput(ctx, conn, rc, body)
	return err
}

func scenarioSystem(opt scenarioDraftOptions) string {
	var b strings.Builder
	b.WriteString("You turn a plain-language what-if question (English or Arabic) from a planner at Customer, Saudi Arabia, into a JSON draft for the OpenDispatch Scenario Lab editor. The editor can hold ONLY these fields:\n")
	b.WriteString("- name: a short English name for the scenario (at most 80 characters).\n")
	b.WriteString("- base_day: the weekday the person names, in English (Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday; Arabic الأحد Sunday, الاثنين Monday, الثلاثاء Tuesday, الأربعاء Wednesday, الخميس Thursday, الجمعة Friday, السبت Saturday), or null when no day is named. The editor plans the next such day. A repeating day (\"every Friday\", \"on Thursdays\", كل يوم جمعة) is that weekday, and the repetition goes into unmapped. A specific calendar date also goes into unmapped.\n")
	b.WriteString("- zones: 1 to 8 zone codes. A city means all its zones. With no place named, use every zone (at most 8). Zones (code: name, city):\n")
	for _, z := range opt.Zones {
		fmt.Fprintf(&b, "  %s: %s, %s\n", z.Code, z.Name, z.City)
	}
	b.WriteString("  (Arabic: الرياض is Riyadh, جدة is Jeddah, الدمام is Dammam; شمال north, جنوب south, شرق east, غرب west, وسط central.)\n")
	b.WriteString("- field_agents: whole number from -50 to 50, the change in field agents in EACH chosen zone (the same number for every zone).\n")
	b.WriteString("- vehicles: whole number from -50 to 50, the change in vehicles in EACH chosen zone.\n")
	b.WriteString("- remote_mode: company or zone. company: remote_agents is one change for the whole remote team. zone: remote_by_zone gives a change per zone code, e.g. {\"RD-N\": 2}.\n")
	b.WriteString("- remote_agents: whole number from -50 to 50 (remote_mode company; 0 otherwise). remote_by_zone: an object of zone code to whole number (remote_mode zone; {} otherwise).\n")
	fmt.Fprintf(&b, "- remote_share_percent: the share of cases handled remotely, a whole percent from 0 to 100 in steps of 5, or null for unchanged. Today it is %d%%: \"10%% more cases to remote\" or \"raise by 10 points\" means %d; \"remote share of 45%%\" means 45. Round to the nearest 5.\n", scenarioShareBaseline, scenarioShareBaseline+10)
	b.WriteString("- shift_patterns: the field shift pattern codes to plan with, from:")
	for _, p := range opt.Patterns {
		fmt.Fprintf(&b, " %s (%s)", p.Code, p.Name)
	}
	fmt.Fprintf(&b, ". With no shifts named, use [] (the editor's default %s).\n", strings.Join(scenarioDefaultPatterns, ", "))
	b.WriteString("Every change the person asks for must be in a field. Anything the fields cannot hold (a repeating day such as \"every Thursday\" beyond the one base date, different field numbers per zone, dispatchers, overtime, budgets, a date outside the list, a place with no zone) goes, in the person's own words, into unmapped; never drop it silently and never replace it with a different change.\n")
	b.WriteString("Never put a place the person did not name into zones. If the person names places and none of them has a zone in the list, answer {\"error\": \"<one short English sentence naming the place>\"} instead.\n")
	b.WriteString("Answer with ONE JSON object and nothing else, with exactly these keys: name, base_day, zones, field_agents, vehicles, remote_mode, remote_agents, remote_by_zone, remote_share_percent, shift_patterns, unmapped.\n")
	if len(opt.Zones) > 0 && len(opt.Dates) > 0 {
		z := opt.Zones[0]
		fmt.Fprintf(&b, "Example: \"Add 2 vehicles in %s and hire a dispatcher\"\n{\"name\":\"%s: +2 vehicles\",\"base_day\":null,\"zones\":[\"%s\"],\"field_agents\":0,\"vehicles\":2,\"remote_mode\":\"company\",\"remote_agents\":0,\"remote_by_zone\":{},\"remote_share_percent\":null,\"shift_patterns\":[],\"unmapped\":[\"hire a dispatcher\"]}\n", z.Name, z.Code, z.Code)
	}
	return b.String()
}

// DraftScenarioWithAssistant: text in, editor draft out.
func DraftScenarioWithAssistant(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (AssistantScenarioDraft, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsScenarioLab, access.AccessEdit); err != nil {
		_ = auditAssistant(rc, "assistant.scenario_draft", "denied", "Scenario draft refused: role.", nil)
		return AssistantScenarioDraft{}, err
	}
	o, err := datactx.Object(body, "Scenario draft request", []string{"text", "locale"})
	if err != nil {
		return AssistantScenarioDraft{}, err
	}
	text, err := textUpTo(o, "text", assistantMaxText)
	if err != nil {
		return AssistantScenarioDraft{}, err
	}
	locale := localeOf(o)
	p, err := activeProvider()
	if err != nil {
		return AssistantScenarioDraft{}, err
	}
	opt, err := scenarioOptions(ctx, conn, rc)
	if err != nil {
		return AssistantScenarioDraft{}, err
	}
	if len(opt.Zones) == 0 || len(opt.Dates) == 0 {
		return AssistantScenarioDraft{}, dataerr.Invalid("Scenario draft: no zone or date to plan.")
	}
	started := time.Now()
	var draft ScenarioDraft
	var unmapped []string
	attempts, callErr, verr := completeChecked(ctx, p, assistant.Request{
		System:    scenarioSystem(opt),
		Messages:  []assistant.Message{{Role: "user", Text: fmt.Sprintf("The planner wrote in %s:\n%s", languageName(locale), scrub(text))}},
		MaxTokens: 2048,
		JSON:      true,
	}, func(reply string) error {
		var err error
		if draft, unmapped, err = validateScenarioDraft(reply, opt); err != nil {
			return err
		}
		if cerr := scenarioDraftCheck(ctx, conn, rc, scenarioWriteOf(draft)); cerr != nil {
			return invalidScenario("%s", cerr.Error())
		}
		return nil
	})
	meta := metaOf(p, started)
	detail := map[string]any{"provider": meta.Provider, "model": meta.Model, "duration_ms": meta.DurationMs, "text_chars": utf8.RuneCountInString(text), "locale": locale, "attempts": attempts}
	if callErr != nil {
		err := providerFailure(callErr)
		detail["error"] = err.Error()
		if aerr := auditAssistant(rc, "assistant.scenario_draft", "failure", "Scenario draft: the assistant did not answer.", detail); aerr != nil {
			return AssistantScenarioDraft{}, aerr
		}
		return AssistantScenarioDraft{}, err
	}
	if verr != nil {
		detail["error"] = verr.Error()
		if aerr := auditAssistant(rc, "assistant.scenario_draft", "rejected", "Scenario draft rejected: the assistant's draft failed the editor checks.", detail); aerr != nil {
			return AssistantScenarioDraft{}, aerr
		}
		return AssistantScenarioDraft{}, verr
	}
	detail["zones"] = len(draft.ZoneIDs)
	detail["unmapped"] = len(unmapped)
	if aerr := auditAssistant(rc, "assistant.scenario_draft", "success", "Scenario drafted by the assistant (not saved).", detail); aerr != nil {
		return AssistantScenarioDraft{}, aerr
	}
	return AssistantScenarioDraft{Draft: draft, Unmapped: unmapped, AssistantMeta: meta}, nil
}

func invalidScenario(format string, args ...any) error {
	return dataerr.Invalid("The assistant's draft did not pass the scenario checks: " + fmt.Sprintf(format, args...)).WithReason(dataerr.ReasonAssistantInvalid)
}

func wholeIn(v any, key string, lo, hi int) (int, error) {
	n, ok := v.(float64)
	if !ok || math.IsNaN(n) || n != math.Trunc(n) || n < float64(lo) || n > float64(hi) {
		return 0, invalidScenario("%s must be a whole number from %d to %d.", key, lo, hi)
	}
	return int(n), nil
}

// validateScenarioDraft: the model's JSON, checked strictly.
func validateScenarioDraft(text string, opt scenarioDraftOptions) (ScenarioDraft, []string, error) {
	var d ScenarioDraft
	obj, ok := extractJSON(text)
	if !ok {
		return d, nil, invalidScenario("the answer was not one JSON object.")
	}
	if why, ok := obj["error"].(string); ok {
		return d, nil, refusedByModel{dataerr.Invalid("The assistant could not draft this scenario with the editor's fields: " + strings.TrimSpace(truncateRunes(why, 200))).WithReason(dataerr.ReasonAssistantInvalid)}
	}
	allowed := []string{"name", "base_day", "zones", "field_agents", "vehicles", "remote_mode", "remote_agents", "remote_by_zone", "remote_share_percent", "shift_patterns", "unmapped"}
	for k := range obj {
		if !stringInList(k, allowed) {
			return d, nil, invalidScenario("unknown key %q.", truncateRunes(k, 40))
		}
	}
	unmapped, err := phraseList(obj["unmapped"], scenarioDraftUnmapped)
	if err != nil {
		return d, nil, invalidScenario("unmapped must be a list of at most %d phrases.", scenarioDraftUnmapped)
	}
	name, _ := obj["name"].(string)
	if d.Name = strings.TrimSpace(name); d.Name == "" || utf8.RuneCountInString(d.Name) > 120 {
		return d, nil, invalidScenario("name must have 1 to 120 characters.")
	}
	if d.BaseDate, err = baseDateOf(obj["base_day"], opt.Dates); err != nil {
		return d, nil, err
	}
	byCode := map[string]draftZone{}
	for _, z := range opt.Zones {
		byCode[z.Code] = z
	}
	codes, ok := obj["zones"].([]any)
	if !ok || len(codes) == 0 || len(codes) > maxScenarioZones {
		return d, nil, invalidScenario("zones must list 1 to %d zone codes.", maxScenarioZones)
	}
	d.ZoneIDs = []string{}
	chosen := map[string]bool{}
	for _, c := range codes {
		code, _ := c.(string)
		z, ok := byCode[strings.TrimSpace(code)]
		if !ok {
			return d, nil, invalidScenario("%q is not a zone of the editor.", truncateRunes(code, 20))
		}
		if !chosen[z.ID] {
			chosen[z.ID] = true
			d.ZoneIDs = append(d.ZoneIDs, z.ID)
		}
	}
	if d.FieldAgents, err = wholeIn(obj["field_agents"], "field_agents", -maxHeadcountStep, maxHeadcountStep); err != nil {
		return d, nil, err
	}
	if d.Vehicles, err = wholeIn(obj["vehicles"], "vehicles", -maxHeadcountStep, maxHeadcountStep); err != nil {
		return d, nil, err
	}
	mode, _ := obj["remote_mode"].(string)
	if mode != "company" && mode != "zone" {
		return d, nil, invalidScenario("remote_mode must be company or zone.")
	}
	d.RemoteMode = mode
	d.RemoteByZone = []RemoteZoneChange{}
	if mode == "company" {
		if d.RemoteAgents, err = wholeIn(obj["remote_agents"], "remote_agents", -maxHeadcountStep, maxHeadcountStep); err != nil {
			return d, nil, err
		}
		if m, ok := obj["remote_by_zone"].(map[string]any); ok && len(m) > 0 {
			return d, nil, invalidScenario("remote_by_zone goes with remote_mode zone.")
		}
	} else {
		if err := remoteZonesOf(obj["remote_by_zone"], byCode, chosen, &d); err != nil {
			return d, nil, err
		}
		if n, _ := obj["remote_agents"].(float64); n != 0 {
			return d, nil, invalidScenario("remote_agents goes with remote_mode company.")
		}
	}
	if v := obj["remote_share_percent"]; v != nil {
		n, err := wholeIn(v, "remote_share_percent", 0, 100)
		if err != nil || n%5 != 0 {
			return d, nil, invalidScenario("remote_share_percent must be 0 to 100 in steps of 5, or null.")
		}
		d.RemoteSharePercent = &n
	}
	if err := patternsOf(obj["shift_patterns"], opt, &d); err != nil {
		return d, nil, err
	}
	return d, unmapped, nil
}

// baseDateOf: the named weekday's next date.
func baseDateOf(v any, dates []string) (string, error) {
	if v == nil {
		return dates[0], nil
	}
	day, ok := v.(string)
	day = strings.TrimSpace(day)
	for _, d := range dates {
		t, _ := time.Parse("2006-01-02", d)
		if ok && strings.EqualFold(t.Weekday().String(), day) {
			return d, nil
		}
	}
	return "", invalidScenario("base_day must be a weekday in English, or null.")
}

func remoteZonesOf(v any, byCode map[string]draftZone, chosen map[string]bool, d *ScenarioDraft) error {
	m, ok := v.(map[string]any)
	if !ok || len(m) == 0 {
		return invalidScenario("remote_mode zone needs remote_by_zone, zone code to number.")
	}
	codes := make([]string, 0, len(m))
	for code := range m {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	for _, code := range codes {
		z, ok := byCode[code]
		if !ok || !chosen[z.ID] {
			return invalidScenario("remote_by_zone names %q, not one of the scenario's zones.", truncateRunes(code, 20))
		}
		n, err := wholeIn(m[code], "remote_by_zone "+code, -maxHeadcountStep, maxHeadcountStep)
		if err != nil {
			return err
		}
		if n != 0 {
			d.RemoteByZone = append(d.RemoteByZone, RemoteZoneChange{ZoneID: z.ID, RemoteAgents: n})
		}
	}
	return nil
}

func patternsOf(v any, opt scenarioDraftOptions, d *ScenarioDraft) error {
	byCode := map[string]string{}
	for _, p := range opt.Patterns {
		byCode[p.Code] = p.ID
	}
	var codes []string
	if v != nil {
		list, ok := v.([]any)
		if !ok {
			return invalidScenario("shift_patterns must be a list of pattern codes.")
		}
		for _, c := range list {
			s, _ := c.(string)
			if _, ok := byCode[s]; !ok {
				return invalidScenario("%q is not an active field shift pattern.", truncateRunes(s, 20))
			}
			codes = append(codes, s)
		}
	}
	if len(codes) == 0 {
		codes = scenarioDefaultPatterns
	}
	d.ShiftPatternIDs = []string{}
	seen := map[string]bool{}
	for _, c := range codes {
		if id, ok := byCode[c]; ok && !seen[id] {
			seen[id] = true
			d.ShiftPatternIDs = append(d.ShiftPatternIDs, id)
		}
	}
	return nil
}

// scenarioWriteOf: the body Save would send.
func scenarioWriteOf(d ScenarioDraft) map[string]any {
	remote := map[string]int{}
	if d.RemoteMode == "company" {
		if d.RemoteAgents != 0 && len(d.ZoneIDs) > 0 {
			remote[d.ZoneIDs[0]] = d.RemoteAgents
		}
	} else {
		for _, r := range d.RemoteByZone {
			remote[r.ZoneID] = r.RemoteAgents
		}
	}
	delta := []any{}
	zones := []any{}
	for _, z := range d.ZoneIDs {
		zones = append(zones, z)
		e := map[string]any{"zone_id": z}
		if d.FieldAgents != 0 {
			e["field_agents"] = float64(d.FieldAgents)
		}
		if n, ok := remote[z]; ok {
			e["remote_agents"] = float64(n)
		}
		if d.Vehicles != 0 {
			e["vehicles"] = float64(d.Vehicles)
		}
		if len(e) > 1 {
			delta = append(delta, e)
		}
	}
	patterns := []any{}
	for _, p := range d.ShiftPatternIDs {
		patterns = append(patterns, p)
	}
	var share any
	if d.RemoteSharePercent != nil {
		share = float64(*d.RemoteSharePercent) / 100
	}
	return map[string]any{
		"name": d.Name, "base_date": d.BaseDate, "zone_ids": zones,
		"adjustments": map[string]any{"headcount_delta": delta, "shift_pattern_ids": patterns, "remote_share": share},
	}
}
