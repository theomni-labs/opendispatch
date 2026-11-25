// SPDX-License-Identifier: AGPL-3.0-only

// Plain-language rule drafting (feature 1).
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

// ruleDraftField: the condition builder's fields.
type ruleDraftField struct {
	Field, Kind, Meaning, Words string
}

// Same list as condition.ts FIELDS.
var ruleDraftFields = []ruleDraftField{
	{"parties_involved", "num", "number of parties in the accident", "parties, أطراف"},
	{"injury_present", "bool", "someone is injured", "injury, hurt, إصابة, مصاب"},
	{"severity", "enum", "how bad the accident is (minor, moderate, severe)", "minor, light, simple, بسيط, طفيف, متوسط, شديد"},
	{"insured_party_count", "num", "number of insured parties", "insured, مؤمَّن"},
	{"estimated_damage_sar", "num", "the agent's estimate of the vehicle damage, in Saudi riyals (NOT the claim)", "damage estimate, تقدير الضرر"},
	{"claim_value_sar", "num", "the value of the insurance claim, in Saudi riyals", "claim, claim value, مطالبة, قيمة المطالبة"},
	{"damage_assessment_method", "enum", "how the damage is assessed", "photos, video, in person, صور, فيديو, حضوري"},
	{"multi_vehicle", "bool", "more than one vehicle", "multi-vehicle, عدة مركبات"},
	{"pedestrian_involved", "bool", "a pedestrian is involved", "pedestrian, مشاة, راجل"},
	{"location_type", "enum", "the kind of place", "urban, highway, rural, حضري, طريق سريع, ريفي"},
	{"highway_or_outside_city_limits", "bool", "on a highway or outside city limits", "highway, outside the city, خارج المدينة"},
	{"customer_preference", "enum", "what the customer prefers", "customer prefers, تفضيل العميل"},
	{"customer_requests_field_attendance", "bool", "the customer asks for an agent on site", "customer asks for an agent, طلب العميل"},
	{"case_type", "enum", "the case type", "case type, نوع البلاغ"},
}

// Same as condition.ts OPERATORS_BY_KIND.
var ruleDraftOperators = map[string][]string{
	"bool": {"eq", "neq"},
	"num":  {"eq", "neq", "lt", "lte", "gt", "gte", "in"},
	"enum": {"eq", "neq", "in"},
}

const (
	ruleDraftMaxPredicates = 8
	ruleDraftMaxUnmapped   = 8
)

// RuleDraft: a draft for the condition builder.
type RuleDraft struct {
	NameEn          string        `json:"name_en"`
	NameAr          *string       `json:"name_ar"`
	Condition       RuleCondition `json:"condition"`
	ConditionTextEn string        `json:"condition_text_en"`
	Outcome         string        `json:"outcome"`
}

// AssistantRuleDraft: POST /assistant/rule-draft.
type AssistantRuleDraft struct {
	Draft RuleDraft `json:"draft"`
	// Unmapped: phrases the draft leaves out
	Unmapped []string `json:"unmapped"`
	AssistantMeta
}

// ruleDraftCaseTypes: case type names; tests swap it.
var ruleDraftCaseTypes = func(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) ([]string, error) {
	page, err := ListCaseTypes(ctx, conn, rc, datactx.PageQuery{Limit: 200})
	if err != nil {
		return nil, err
	}
	var out []string
	for _, c := range page.Items {
		if c.IsActive {
			out = append(out, c.NameEn)
		}
	}
	sort.Strings(out)
	return out, nil
}

// enumValues: an enum field's allowed values.
func enumValues(field string, caseTypes []string) []string {
	if field == "case_type" {
		return caseTypes
	}
	return CaseCriteria[field]
}

const ruleDraftExamples = `Examples:
Text: "Minor damage, no injury, claim under 5000 SAR goes remote"
{"name_en":"Minor, no injury, claim under 5,000 SAR: remote","name_ar":"بسيط، دون إصابة، مطالبة أقل من 5,000 ريال: عن بُعد","match":"all","predicates":[{"field":"severity","operator":"eq","value":"minor"},{"field":"injury_present","operator":"eq","value":false},{"field":"claim_value_sar","operator":"lt","value":5000}],"condition_text_en":"Severity is minor, no injury, and the claim value is under 5,000 SAR.","outcome":"remote_eligible","unmapped":[]}
Text: "حادث بسيط بدون إصابات ومطالبة أقل من 5000 ريال يعالج عن بعد"
{"name_en":"Minor, no injury, claim under 5,000 SAR: remote","name_ar":"بسيط، دون إصابة، مطالبة أقل من 5,000 ريال: عن بُعد","match":"all","predicates":[{"field":"severity","operator":"eq","value":"minor"},{"field":"injury_present","operator":"eq","value":false},{"field":"claim_value_sar","operator":"lt","value":5000}],"condition_text_en":"Severity is minor, no injury, and the claim value is under 5,000 SAR.","outcome":"remote_eligible","unmapped":[]}
Text: "A pedestrian or a driver under 25 means an agent must go"
{"name_en":"Pedestrian: field mandatory","name_ar":"وجود مشاة: ميداني إلزامي","match":"any","predicates":[{"field":"pedestrian_involved","operator":"eq","value":true}],"condition_text_en":"A pedestrian is involved.","outcome":"field_mandatory","unmapped":["a driver under 25"]}
Text: "إذا كان الضرر المقدر 10000 ريال أو أكثر في الليل فيجب الحضور الميداني"
{"name_en":"Damage SAR 10,000 or more: field mandatory","name_ar":"ضرر 10,000 ريال أو أكثر: ميداني إلزامي","match":"all","predicates":[{"field":"estimated_damage_sar","operator":"gte","value":10000}],"condition_text_en":"The damage estimate is 10,000 SAR or more.","outcome":"field_mandatory","unmapped":["في الليل"]}
`

func ruleDraftSystem(caseTypes []string) string {
	var b strings.Builder
	b.WriteString("You turn a plain-language description of a case classification rule (English or Arabic) into a JSON draft for the OpenDispatch rule builder.\n")
	b.WriteString("Use ONLY these fields (name: kind, meaning; words people use for it):\n")
	for _, f := range ruleDraftFields {
		fmt.Fprintf(&b, "- %s: %s, %s; words: %s", f.Field, f.Kind, f.Meaning, f.Words)
		if vals := enumValues(f.Field, caseTypes); f.Kind == "enum" && len(vals) > 0 {
			fmt.Fprintf(&b, "; values: %s", strings.Join(vals, ", "))
		}
		b.WriteString("\n")
	}
	b.WriteString("Operators by kind: bool: eq, neq (value true or false); num: eq, neq, lt, lte, gt, gte (a number), in (a list of numbers); enum: eq, neq (one value), in (a list of values).\n")
	b.WriteString("A claim or claim value is claim_value_sar, never estimated_damage_sar. Minor, moderate or severe (and their Arabic words) is severity, even when said of the damage.\n")
	b.WriteString("Outcomes: field_mandatory (an agent must attend), field_preferred (an agent should attend), remote_eligible (can be handled remotely).\n")
	b.WriteString("Every condition the person states must become a predicate. A condition no field can express goes, in the person's own words, into unmapped; never drop a condition silently and never replace it with a different field.\n")
	fmt.Fprintf(&b, "Answer with ONE JSON object and nothing else, with exactly these keys: name_en (short English name, at most 80 characters), name_ar (short Arabic name), match (all or any), predicates (1 to %d objects with field, operator, value), condition_text_en (one English sentence, at most 200 characters), outcome, unmapped (a list of phrases, empty when every condition is in predicates).\n", ruleDraftMaxPredicates)
	b.WriteString("If no condition at all can be expressed with these fields and operators, answer {\"error\": \"<one short English sentence why>\"}.\n")
	b.WriteString(ruleDraftExamples)
	return b.String()
}

// DraftRuleWithAssistant: text in, validated draft out.
func DraftRuleWithAssistant(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (AssistantRuleDraft, error) {
	if err := reqctx.RequireAccess(rc, moduleClassificationRules, access.AccessEdit); err != nil {
		_ = auditAssistant(rc, "assistant.rule_draft", "denied", "Rule draft refused: role.", nil)
		return AssistantRuleDraft{}, err
	}
	o, err := datactx.Object(body, "Rule draft request", []string{"text", "locale"})
	if err != nil {
		return AssistantRuleDraft{}, err
	}
	text, err := requireText(o, "text")
	if err != nil {
		return AssistantRuleDraft{}, err
	}
	locale := localeOf(o)
	p, err := activeProvider()
	if err != nil {
		return AssistantRuleDraft{}, err
	}
	caseTypes, err := ruleDraftCaseTypes(ctx, conn, rc)
	if err != nil {
		return AssistantRuleDraft{}, err
	}
	started := time.Now()
	sent := scrub(text)
	reply, callErr := p.Complete(ctx, assistant.Request{
		System:    ruleDraftSystem(caseTypes),
		Messages:  []assistant.Message{{Role: "user", Text: fmt.Sprintf("The person wrote in %s:\n%s", languageName(locale), sent)}},
		MaxTokens: 2048,
		JSON:      true,
	})
	meta := metaOf(p, started)
	detail := map[string]any{"provider": meta.Provider, "model": meta.Model, "duration_ms": meta.DurationMs, "text_chars": utf8.RuneCountInString(text), "locale": locale}
	if callErr != nil {
		err := providerFailure(callErr)
		detail["error"] = err.Error()
		if aerr := auditAssistant(rc, "assistant.rule_draft", "failure", "Rule draft: the assistant did not answer.", detail); aerr != nil {
			return AssistantRuleDraft{}, aerr
		}
		return AssistantRuleDraft{}, err
	}
	draft, unmapped, verr := validateRuleDraft(reply.Text, caseTypes)
	if verr != nil {
		detail["error"] = verr.Error()
		if aerr := auditAssistant(rc, "assistant.rule_draft", "rejected", "Rule draft rejected: the assistant's draft failed the rule checks.", detail); aerr != nil {
			return AssistantRuleDraft{}, aerr
		}
		return AssistantRuleDraft{}, verr
	}
	detail["outcome"] = draft.Outcome
	detail["predicates"] = len(draft.Condition.Predicates)
	detail["unmapped"] = len(unmapped)
	if aerr := auditAssistant(rc, "assistant.rule_draft", "success", "Rule drafted by the assistant (not saved).", detail); aerr != nil {
		return AssistantRuleDraft{}, aerr
	}
	return AssistantRuleDraft{Draft: draft, Unmapped: unmapped, AssistantMeta: meta}, nil
}

func invalidDraft(format string, args ...any) error {
	return dataerr.Invalid("The assistant's draft did not pass the rule checks: " + fmt.Sprintf(format, args...)).WithReason(dataerr.ReasonAssistantInvalid)
}

func fieldKind(field string) (string, bool) {
	for _, f := range ruleDraftFields {
		if f.Field == field {
			return f.Kind, true
		}
	}
	return "", false
}

func wholeOrNumber(v any) (float64, bool) {
	n, ok := v.(float64)
	return n, ok && !math.IsNaN(n) && !math.IsInf(n, 0)
}

func checkDraftValue(field, kind, op string, v any, caseTypes []string) error {
	if op == "in" {
		list, ok := v.([]any)
		if !ok || len(list) == 0 || len(list) > 20 {
			return invalidDraft("%s in needs a list of 1 to 20 values.", field)
		}
		for _, item := range list {
			if err := checkDraftValue(field, kind, "eq", item, caseTypes); err != nil {
				return err
			}
		}
		return nil
	}
	switch kind {
	case "bool":
		if _, ok := v.(bool); !ok {
			return invalidDraft("%s takes true or false.", field)
		}
	case "num":
		n, ok := wholeOrNumber(v)
		if !ok || n < 0 || n > 1e9 {
			return invalidDraft("%s takes a number from 0.", field)
		}
	case "enum":
		s, ok := v.(string)
		if vals := enumValues(field, caseTypes); !ok || !stringInList(s, vals) {
			return invalidDraft("%s must be one of %s.", field, strings.Join(vals, ", "))
		}
	}
	return nil
}

// unmappedOf: the phrases the model could not map.
func unmappedOf(v any) ([]string, error) {
	out := []string{}
	if v == nil {
		return out, nil
	}
	list, ok := v.([]any)
	if !ok || len(list) > ruleDraftMaxUnmapped {
		return nil, invalidDraft("unmapped must be a list of at most %d phrases.", ruleDraftMaxUnmapped)
	}
	for _, item := range list {
		s, ok := item.(string)
		if !ok {
			return nil, invalidDraft("unmapped must hold text.")
		}
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, truncateRunes(s, 120))
		}
	}
	return out, nil
}

// validateRuleDraft: the model's JSON, checked strictly.
func validateRuleDraft(text string, caseTypes []string) (RuleDraft, []string, error) {
	obj, ok := extractJSON(text)
	if !ok {
		return RuleDraft{}, nil, invalidDraft("the answer was not one JSON object.")
	}
	if why, ok := obj["error"].(string); ok {
		return RuleDraft{}, nil, dataerr.Invalid("The assistant could not express this rule with the builder's fields: " + strings.TrimSpace(truncateRunes(why, 200))).WithReason(dataerr.ReasonAssistantInvalid)
	}
	unmapped, err := unmappedOf(obj["unmapped"])
	if err != nil {
		return RuleDraft{}, nil, err
	}
	allowed := []string{"name_en", "name_ar", "match", "predicates", "condition_text_en", "outcome", "unmapped"}
	for k := range obj {
		if !stringInList(k, allowed) {
			return RuleDraft{}, nil, invalidDraft("unknown key %q.", truncateRunes(k, 40))
		}
	}
	name, _ := obj["name_en"].(string)
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 120 {
		return RuleDraft{}, nil, invalidDraft("name_en must have 1 to 120 characters.")
	}
	var nameAr *string
	if s, ok := obj["name_ar"].(string); ok && strings.TrimSpace(s) != "" {
		s = strings.TrimSpace(s)
		if utf8.RuneCountInString(s) > 120 {
			return RuleDraft{}, nil, invalidDraft("name_ar must have at most 120 characters.")
		}
		nameAr = &s
	} else if v, has := obj["name_ar"]; has && v != nil {
		if _, isStr := v.(string); !isStr {
			return RuleDraft{}, nil, invalidDraft("name_ar must be text.")
		}
	}
	condText, _ := obj["condition_text_en"].(string)
	condText = strings.TrimSpace(condText)
	if condText == "" || utf8.RuneCountInString(condText) > 500 {
		return RuleDraft{}, nil, invalidDraft("condition_text_en must have 1 to 500 characters.")
	}
	outcome, _ := obj["outcome"].(string)
	if !stringInList(outcome, ruleOutcomes) {
		return RuleDraft{}, nil, invalidDraft("outcome must be field_mandatory, field_preferred or remote_eligible.")
	}
	list, ok := obj["predicates"].([]any)
	if !ok || len(list) == 0 || len(list) > ruleDraftMaxPredicates {
		return RuleDraft{}, nil, invalidDraft("predicates must be a list of 1 to %d conditions.", ruleDraftMaxPredicates)
	}
	for _, item := range list {
		p, ok := item.(map[string]any)
		if !ok {
			return RuleDraft{}, nil, invalidDraft("each predicate must be an object.")
		}
		for k := range p {
			if k != "field" && k != "operator" && k != "value" {
				return RuleDraft{}, nil, invalidDraft("a predicate has the unknown key %q.", truncateRunes(k, 40))
			}
		}
		field, _ := p["field"].(string)
		kind, known := fieldKind(field)
		if !known {
			return RuleDraft{}, nil, invalidDraft("%q is not a field of the rule builder.", truncateRunes(field, 64))
		}
		op, _ := p["operator"].(string)
		if !stringInList(op, ruleDraftOperators[kind]) {
			return RuleDraft{}, nil, invalidDraft("%s does not take the operator %q.", field, truncateRunes(op, 16))
		}
		if err := checkDraftValue(field, kind, op, p["value"], caseTypes); err != nil {
			return RuleDraft{}, nil, err
		}
	}
	// The data layer's own check, as for a save
	cond, err := parseCondition(map[string]any{"match": obj["match"], "predicates": list})
	if err != nil {
		return RuleDraft{}, nil, invalidDraft("%s", err.Error())
	}
	return RuleDraft{NameEn: name, NameAr: nameAr, Condition: cond, ConditionTextEn: condText, Outcome: outcome}, unmapped, nil
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}
