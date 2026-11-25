// SPDX-License-Identifier: AGPL-3.0-only

// Explain's number check and its safe fallback.
package business

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

var (
	numberToken  = regexp.MustCompile(`[0-9\x{0660}-\x{0669}\x{06F0}-\x{06F9}]+(?:[.,\x{066B}\x{066C}][0-9\x{0660}-\x{0669}\x{06F0}-\x{06F9}]+)*`)
	thousandsRun = regexp.MustCompile(`^\d{1,3}(,\d{3})+(\.\d+)?$`)
)

// asciiDigits: Arabic-Indic digits to 0-9.
func asciiDigits(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= 0x0660 && r <= 0x0669:
			return '0' + (r - 0x0660)
		case r >= 0x06F0 && r <= 0x06F9:
			return '0' + (r - 0x06F0)
		case r == 0x066B:
			return '.'
		case r == 0x066C:
			return ','
		}
		return r
	}, s)
}

type numberHit struct {
	Raw   string
	Value float64
}

// numbersIn: every number written in a text.
func numbersIn(s string) []numberHit {
	var out []numberHit
	for _, raw := range numberToken.FindAllString(s, -1) {
		tok := asciiDigits(raw)
		if thousandsRun.MatchString(tok) {
			tok = strings.ReplaceAll(tok, ",", "")
		}
		for _, part := range strings.Split(tok, ",") {
			if v, err := strconv.ParseFloat(part, 64); err == nil {
				out = append(out, numberHit{Raw: raw, Value: v})
				continue
			}
			for _, p := range strings.Split(part, ".") {
				if v, err := strconv.ParseFloat(p, 64); err == nil {
					out = append(out, numberHit{Raw: raw, Value: v})
				}
			}
		}
	}
	return out
}

// allowedNumbers: facts' numbers and equivalents.
func allowedNumbers(facts any) []float64 {
	var base []float64
	var walk func(v any)
	walk = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			for k, e := range x {
				walk(k)
				walk(e)
			}
		case []map[string]any:
			for _, e := range x {
				walk(e)
			}
		case []any:
			for _, e := range x {
				walk(e)
			}
		case []string:
			for _, e := range x {
				walk(e)
			}
		case []int:
			for _, e := range x {
				walk(e)
			}
		case []float64:
			for _, e := range x {
				walk(e)
			}
		case string:
			for _, n := range numbersIn(x) {
				base = append(base, n.Value)
			}
		case int:
			base = append(base, float64(x))
		case float64:
			base = append(base, x)
		}
	}
	walk(facts)
	var out []float64
	for _, v := range base {
		v = math.Abs(v)
		for _, w := range []float64{v, v * 100, v / 100} {
			out = append(out, w, math.Round(w), math.Round(w*10)/10, math.Round(w*100)/100)
		}
	}
	return out
}

// unknownNumbers: answer numbers not in the facts.
func unknownNumbers(text string, allowed []float64) []string {
	seen := map[string]bool{}
	var bad []string
	for _, n := range numbersIn(text) {
		ok := false
		for _, a := range allowed {
			if math.Abs(a-n.Value) < 1e-6 {
				ok = true
				break
			}
		}
		if !ok && !seen[n.Raw] {
			seen[n.Raw] = true
			bad = append(bad, n.Raw)
		}
	}
	return bad
}

// ---- Fallback: a summary from the facts ----

func factMap(m map[string]any, key string) map[string]any {
	v, _ := m[key].(map[string]any)
	return v
}

func factStr(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	switch v := m[key].(type) {
	case string:
		return v
	case int:
		return strconv.Itoa(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return ""
}

var fallbackText = map[string][2]string{
	"lead":     {"Summary of the screen's figures (the assistant's answer could not be checked, so it is not shown).", "ملخّص لأرقام الشاشة (تعذّر التحقق من إجابة المساعد، لذا لم تُعرض)."},
	"each":     {"%s: %s; %s: %s (15 minutes each).", "%s: %s، %s: %s (كل فترة 15 دقيقة)."},
	"reach":    {"%s: %s of field demand cannot be reached within 10 minutes.", "%s: %s من الطلب الميداني لا يمكن الوصول إليه خلال 10 دقائق."},
	"worst":    {"%s: %s agents short in %s at %s.", "%s: نقص %s من المندوبين في %s عند %s."},
	"peak":     {"%s: starts at %s. %s: %s to %s cases.", "%s: تبدأ عند %s. %s: %s إلى %s."},
	"field":    {"%s: %s (inferred).", "%s: %s (مستنتَجة)."},
	"why":      {"%s: %s cases; %s: %s cases.", "%s: %s؛ %s: %s."},
	"end":      {"All figures are illustrative.", "كل الأرقام توضيحية."},
	"sep":      {", ", "، "},
	"pair":     {"%s: %s.", "%s: %s."},
	"causeFmt": {"%s: %s (%s).", "%s: %s (%s)."},
}

func ft(key, locale string) string { return tr(fallbackText[key], locale) }

// fallbackSummary: plain sentences, facts only.
func fallbackSummary(target string, facts map[string]any, locale string) string {
	sep := ft("sep", locale)
	lines := []string{ft("lead", locale)}
	if target == ExplainGapSurplus {
		lines = append(lines, factStr(facts, "screen")+sep+factStr(facts, "day_name")+" "+factStr(facts, "date")+sep+factStr(facts, "scope")+".")
		g, s := factMap(facts, "gap_intervals"), factMap(facts, "surplus_intervals")
		lines = append(lines, fmt.Sprintf(ft("each", locale), factStr(g, "label"), factStr(g, "value"), factStr(s, "label"), factStr(s, "value")))
		if m := factMap(facts, "demand_met_share"); m != nil {
			lines = append(lines, fmt.Sprintf(ft("pair", locale), factStr(m, "label"), factStr(m, "value")))
		}
		if r := factMap(facts, "out_of_10_minute_reach_share"); r != nil {
			lines = append(lines, fmt.Sprintf(ft("reach", locale), factStr(r, "label"), factStr(r, "value")))
		}
		if w := factMap(facts, "worst_gap"); w != nil {
			lines = append(lines, fmt.Sprintf(ft("worst", locale), factStr(w, "label"), factStr(w, "agents_short"), factStr(w, "zone"), factStr(w, "interval_starts_at")))
		}
		if c := factMap(facts, "main_cause"); c != nil {
			lines = append(lines, fmt.Sprintf(ft("causeFmt", locale), factStr(c, "title"), factStr(c, "label"), factStr(c, "meaning")))
		}
	} else {
		lines = append(lines, factStr(facts, "screen")+sep+factStr(facts, "zone")+sep+factStr(facts, "day_name")+" "+factStr(facts, "date")+".")
		e := factMap(facts, "expected_cases")
		lines = append(lines, fmt.Sprintf(ft("pair", locale), factStr(e, "label"), factStr(e, "value")))
		p, r := factMap(facts, "peak_interval"), factMap(facts, "likely_range_at_peak")
		lines = append(lines, fmt.Sprintf(ft("peak", locale), factStr(p, "label"), factStr(p, "starts_at"), factStr(r, "label"), factStr(r, "low_cases"), factStr(r, "high_cases")))
		f := factMap(facts, "field_share")
		lines = append(lines, fmt.Sprintf(ft("field", locale), factStr(f, "label"), factStr(f, "value")))
		if w := factMap(facts, "why_this_forecast"); w != nil {
			b, t := factMap(w, "typical_day_cases"), factMap(w, "this_day_cases")
			lines = append(lines, fmt.Sprintf(ft("why", locale), factStr(b, "label"), factStr(b, "value"), factStr(t, "label"), factStr(t, "value")))
		}
	}
	lines = append(lines, ft("end", locale))
	return strings.Join(lines, "\n")
}
