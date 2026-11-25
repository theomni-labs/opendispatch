// SPDX-License-Identifier: AGPL-3.0-only

// Explain this (feature 2): the screen's own data.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// AssistantExplanation: POST /assistant/explain.
type AssistantExplanation struct {
	Target string `json:"target"`
	Text   string `json:"text"`
	// Sent: the exact summary the model saw
	Sent string `json:"sent"`
	AssistantMeta
}

// Answer paths, audited as answer_path.
const (
	explainPathChecked  = "checked"
	explainPathRetried  = "checked_after_retry"
	explainPathFallback = "fallback_summary"
)

// intervalTime: "HH:MM" of a 0-95 interval.
func intervalTime(i int) string {
	m := ((i*15)%1440 + 1440) % 1440
	return fmt.Sprintf("%02d:%02d", m/60, m%60)
}

// percentOf: formatPercent's whole percent.
func percentOf(share float64) string {
	return fmt.Sprintf("%d%%", int(math.Round(share*100)))
}

func zoneCodeOf(z Zone) string {
	if c, ok := codeOfExtra(z.Extra); ok {
		return c
	}
	return z.ID
}

// ---- Gap and Surplus ----

// gapScreen: the screen's stats (view.ts).
type gapScreen struct {
	Gaps, Surplus int
	Met, Out      *float64
	Worst         *gapWorst
	MainCause     string
	CauseCounts   map[string]int
	Zones         []Zone
}

type gapWorst struct {
	Delta int
	Zone  Zone
	Index int
}

// gapScreenOf: the screen's stats, no filters.
func gapScreenOf(view GapSurplusView, zones []Zone) gapScreen {
	byZone := map[string][]GapCell{}
	for _, c := range view.Cells {
		byZone[c.ZoneID] = append(byZone[c.ZoneID], c)
	}
	s := gapScreen{CauseCounts: map[string]int{"people": 0, "vehicles": 0, "geography": 0}}
	var required, met, outW, out float64
	anyReach := false
	for _, z := range zones {
		cells := byZone[z.ID]
		s.Zones = append(s.Zones, z)
		sort.SliceStable(cells, func(i, j int) bool { return cells[i].IntervalIndex < cells[j].IntervalIndex })
		for _, c := range cells {
			switch c.Kind {
			case "gap":
				s.Gaps++
				if c.Cause != nil {
					s.CauseCounts[*c.Cause]++
				}
				if s.Worst == nil || c.Delta < s.Worst.Delta {
					s.Worst = &gapWorst{Delta: c.Delta, Zone: z, Index: c.IntervalIndex}
				}
			case "surplus":
				s.Surplus++
			}
			if c.Required > 0 {
				required += float64(c.Required)
				met += math.Max(0, math.Min(float64(c.Planned), float64(c.Required)))
			}
			if c.ReachShare != nil {
				anyReach = true
				w := math.Max(0, float64(c.Required))
				outW += w
				out += w * math.Max(0, math.Min(1, 1-*c.ReachShare))
			}
		}
	}
	if required > 0 {
		v := met / required
		s.Met = &v
	}
	if anyReach {
		v := 0.0
		if outW > 0 {
			v = out / outW
		}
		s.Out = &v
	}
	if s.Gaps > 0 {
		c := s.CauseCounts
		switch {
		case c["people"] >= c["vehicles"] && c["people"] >= c["geography"]:
			s.MainCause = "people"
		case c["geography"] >= c["vehicles"]:
			s.MainCause = "geography"
		default:
			s.MainCause = "vehicles"
		}
	}
	return s
}

func causeFact(key, locale string) map[string]any {
	return map[string]any{"label": tr(gapLabels["cause."+key], locale), "meaning": tr(explainMeanings["cause."+key], locale)}
}

// gapFacts: the screen's figures, labelled.
func gapFacts(view GapSurplusView, zones []Zone, zoneID, locale string) map[string]any {
	s := gapScreenOf(view, zones)
	scope := tr(explainMeanings["all_zones"], locale)
	if zoneID != "" && len(s.Zones) == 1 {
		scope = zoneName(s.Zones[0], locale)
	}
	names := make([]string, 0, len(s.Zones))
	for _, z := range s.Zones {
		names = append(names, zoneName(z, locale))
	}
	facts := map[string]any{
		"screen": tr(screenTitles[ExplainGapSurplus], locale), "date": dateLabel(view.RosterDate, locale), "day_name": dayName(view.RosterDate, locale),
		"scope": scope, "zones_shown": names, "interval_minutes": 15,
		"gap_intervals":     map[string]any{"value": s.Gaps, "label": tr(gapLabels["stat.gaps"], locale), "meaning": tr(explainMeanings["gap_intervals"], locale)},
		"surplus_intervals": map[string]any{"value": s.Surplus, "label": tr(gapLabels["stat.surplus"], locale), "meaning": tr(explainMeanings["surplus_intervals"], locale)},
		"data_source":       view.DataSource, "illustrative": true,
	}
	if s.Met != nil {
		facts["demand_met_share"] = map[string]any{"value": percentOf(*s.Met), "label": tr(gapLabels["stat.met"], locale), "meaning": tr(explainMeanings["demand_met"], locale)}
	}
	if s.Out != nil {
		facts["out_of_10_minute_reach_share"] = map[string]any{"value": percentOf(*s.Out), "label": tr(gapLabels["stat.reach"], locale), "meaning": tr(explainMeanings["out_of_reach"], locale)}
	}
	if s.Worst != nil {
		facts["worst_gap"] = map[string]any{"agents_short": -s.Worst.Delta, "zone": zoneName(s.Worst.Zone, locale), "zone_code": zoneCodeOf(s.Worst.Zone),
			"interval_starts_at": intervalTime(s.Worst.Index), "label": tr(gapLabels["stat.worst"], locale), "meaning": tr(explainMeanings["worst_gap"], locale)}
	}
	if s.MainCause != "" {
		mc := causeFact(s.MainCause, locale)
		mc["title"] = tr(gapLabels["stat.cause"], locale)
		facts["main_cause"] = mc
	}
	byCause := make([]map[string]any, 0, 3)
	for _, k := range []string{"people", "vehicles", "geography"} {
		c := causeFact(k, locale)
		c["gap_intervals"] = s.CauseCounts[k]
		byCause = append(byCause, c)
	}
	facts["gap_intervals_by_cause"] = byCause
	return facts
}

// explainGapFacts: what Gap and Surplus shows.
var explainGapFacts = func(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, zoneID, date, locale string) (map[string]any, error) {
	view, err := GetGapSurplus(ctx, conn, rc, GapQuery{ZoneID: zoneID, Date: date})
	if err != nil {
		return nil, err
	}
	zones, err := readableZones(ctx, conn, rc)
	if err != nil {
		return nil, err
	}
	return gapFacts(view, shownZones(zones, zoneID), zoneID, locale), nil
}

// shownZones: the screen's rows for a zone filter.
func shownZones(zones []Zone, zoneID string) []Zone {
	if zoneID == "" {
		return zones
	}
	var out []Zone
	for _, z := range zones {
		if z.ID == zoneID {
			out = append(out, z)
		}
	}
	return out
}

// ---- Forecast Explorer ----

// forecastScreen: the screen's stats (view.ts).
type forecastScreen struct {
	Expected, PeakIndex, RangeLow, RangeHigh int
	FieldShare                               float64
	HasIntervals                             bool
}

// forecastScreenOf: the screen's stats.
func forecastScreenOf(tl ForecastTimeline, split ForecastSplit, zoneID string) forecastScreen {
	low, exp, high := make([]float64, 96), make([]float64, 96), make([]float64, 96)
	for _, iv := range tl.Intervals {
		if iv.IntervalIndex >= 0 && iv.IntervalIndex < 96 {
			low[iv.IntervalIndex], exp[iv.IntervalIndex], high[iv.IntervalIndex] = iv.Low, iv.Expected, iv.High
		}
	}
	s := forecastScreen{HasIntervals: len(tl.Intervals) > 0}
	sum := 0.0
	for i, v := range exp {
		sum += v
		if v > exp[s.PeakIndex] {
			s.PeakIndex = i
		}
	}
	s.Expected = int(math.Round(sum))
	s.RangeLow, s.RangeHigh = int(math.Round(low[s.PeakIndex])), int(math.Round(high[s.PeakIndex]))
	for _, z := range split.Zones {
		if z.ZoneID == zoneID && z.FieldShare != nil {
			s.FieldShare = *z.FieldShare
		}
	}
	return s
}

// forecastFacts: the screen's figures, labelled.
func forecastFacts(s forecastScreen, ex *ForecastExplanation, zone, date, source, locale string) map[string]any {
	facts := map[string]any{
		"screen": tr(screenTitles[ExplainForecastExplorer], locale), "zone": zone, "date": dateLabel(date, locale), "day_name": dayName(date, locale),
		"interval_minutes": 15, "data_source": source, "illustrative": true,
		"expected_cases":       map[string]any{"value": s.Expected, "label": tr(forecastLabels["stat.expected"], locale), "meaning": tr(explainMeanings["expected"], locale)},
		"peak_interval":        map[string]any{"starts_at": intervalTime(s.PeakIndex), "label": tr(forecastLabels["stat.peak"], locale), "meaning": tr(explainMeanings["peak"], locale)},
		"likely_range_at_peak": map[string]any{"low_cases": s.RangeLow, "high_cases": s.RangeHigh, "label": tr(forecastLabels["stat.range"], locale), "meaning": tr(explainMeanings["range"], locale)},
		"field_share":          map[string]any{"value": percentOf(s.FieldShare), "label": tr(forecastLabels["stat.field"], locale), "meaning": tr(explainMeanings["field"], locale)},
	}
	if ex != nil {
		drivers := make([]map[string]any, 0, len(ex.Drivers))
		for _, d := range ex.Drivers {
			drivers = append(drivers, map[string]any{"label": driverLabel(d.Driver, date, locale), "multiplier": math.Round(d.Multiplier*100) / 100})
		}
		facts["why_this_forecast"] = map[string]any{
			"typical_day_cases": map[string]any{"value": int(math.Round(ex.Base)), "label": tr(forecastLabels["why.base"], locale)},
			"drivers":           drivers,
			"this_day_cases":    map[string]any{"value": int(math.Round(ex.Expected)), "label": tr(forecastLabels["why.total"], locale)},
			"meaning":           tr(explainMeanings["why"], locale),
		}
	}
	return facts
}

// explainForecastFacts: what the screen shows.
var explainForecastFacts = func(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, zoneID, date, locale string) (map[string]any, error) {
	tl, err := GetForecastTimeline(rc, ForecastTimelineQuery{ZoneID: zoneID, Date: date})
	if err != nil {
		return nil, err
	}
	split, err := GetForecastSplit(rc, ForecastSplitQuery{ZoneID: zoneID, Date: date})
	if err != nil {
		return nil, err
	}
	zones, err := readableZones(ctx, conn, rc)
	if err != nil {
		return nil, err
	}
	shown := shownZones(zones, zoneID)
	if len(shown) == 0 {
		return nil, dataerr.NotFound("Zone not found.")
	}
	zone := zoneName(shown[0], locale)
	var ex *ForecastExplanation
	if e, err := GetForecastExplanation(rc, ForecastExplanationQuery{ZoneID: zoneID, Date: date}); err == nil {
		ex = &e
	}
	return forecastFacts(forecastScreenOf(tl, split, zoneID), ex, zone, date, tl.DataSource, locale), nil
}

// ---- The model call, checked ----

const explainSystem = "You explain one OpenDispatch planning screen to a planner at Customer (Saudi Arabia), which handles motor accident reports for insurers. " +
	"The domain: motor accident cases (traffic accidents reported to Customer). Customer agents handle each case, either on site (field) or remotely. " +
	"Call them cases and agents. Never write patients, patient load, hospital or any medical word. " +
	"Use only the JSON facts given. Quote only numbers that appear in the facts, exactly as written there. " +
	"Never calculate, add, subtract, convert, count or estimate a number of your own, and add no numbers that are not in the facts. " +
	"Use every name and label exactly as given in the facts (screen, zone, date, day_name, labels, cause labels, driver labels): " +
	"copy them verbatim, never translate, transliterate or rephrase them. The JSON keys are not words to show. " +
	"Each figure has a meaning; follow it. out_of_10_minute_reach_share is the share that CANNOT be reached within 10 minutes, never the share that can. " +
	"A cause label means what its meaning says (people: not enough agents on shift), never more people or crowds. " +
	"A driver multiplier below 1 lowers the day and above 1 raises it; the weekday driver is the effect of this day of the week only. " +
	"Write times exactly as given (HH:MM). Write numbers with Western digits (0-9). " +
	"All numbers are synthetic and illustrative: never present them as measured accuracy or attainment. " +
	"Write 3 to 5 short sentences in plain language, no headings, no lists. " + plainRule + " Answer in %s."

// explainLanguage: the language line, with terms.
func explainLanguage(locale string) string {
	if locale == "ar" {
		return "Arabic. In Arabic say بلاغات for cases and المندوبون for agents"
	}
	return "English"
}

// ExplainWithAssistant: a short explanation of a screen.
func ExplainWithAssistant(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (AssistantExplanation, error) {
	o, err := datactx.Object(body, "Explain request", []string{"target", "zone_id", "date", "locale"})
	if err != nil {
		return AssistantExplanation{}, err
	}
	target, _ := o["target"].(string)
	zoneID, _ := o["zone_id"].(string)
	date, _ := o["date"].(string)
	locale := localeOf(o)
	if zoneID != "" {
		if _, err := importutil.RequireID(zoneID, "Zone"); err != nil {
			return AssistantExplanation{}, err
		}
	}
	if date != "" {
		if err := validateDateString(date); err != nil {
			return AssistantExplanation{}, err
		}
	}
	var gather func(context.Context, *tenancy.Connection, reqctx.RequestContext, string, string, string) (map[string]any, error)
	switch target {
	case ExplainForecastExplorer:
		if zoneID == "" || date == "" {
			return AssistantExplanation{}, dataerr.Invalid("zone_id and date are required for forecast_explorer.")
		}
		gather = explainForecastFacts
	case ExplainGapSurplus:
		gather = explainGapFacts
	default:
		return AssistantExplanation{}, dataerr.Invalid("target must be forecast_explorer or gap_surplus.")
	}
	// The screen's own read checks role and zones
	facts, err := gather(ctx, conn, rc, zoneID, date, locale)
	if err != nil {
		_ = auditAssistant(rc, "assistant.explain", outcomeOf(err), "Explain refused: "+target+".", map[string]any{"target": target})
		return AssistantExplanation{}, err
	}
	p, err := activeProvider()
	if err != nil {
		return AssistantExplanation{}, err
	}
	sentBytes, err := json.Marshal(facts)
	if err != nil {
		return AssistantExplanation{}, err
	}
	sent := string(sentBytes)
	allowed := allowedNumbers(facts)
	started := time.Now()
	req := assistant.Request{
		System:    fmt.Sprintf(explainSystem, explainLanguage(locale)),
		Messages:  []assistant.Message{{Role: "user", Text: "Explain this screen.\nFacts: " + sent}},
		MaxTokens: 1024,
	}
	g, callErr := guardedAnswer(ctx, p, req, allowed, func() string { return fallbackSummary(target, facts, locale) })
	detail := map[string]any{"target": target, "zone_id": zoneID, "date": date, "locale": locale, "provider": p.Name(), "model": p.Model(), "sent_chars": len(sent)}
	if callErr != nil {
		meta := metaOf(p, started)
		err := providerFailure(callErr)
		detail["duration_ms"], detail["error"] = meta.DurationMs, err.Error()
		if aerr := auditAssistant(rc, "assistant.explain", "failure", "Explain: the assistant did not answer.", detail); aerr != nil {
			return AssistantExplanation{}, aerr
		}
		return AssistantExplanation{}, err
	}
	text, path := g.Text, g.Path
	detail["first_unverified"] = g.FirstBad
	if g.Retried {
		detail["retry_unverified"] = g.RetryBad
	}
	meta := metaOf(p, started)
	detail["duration_ms"], detail["answer_path"] = meta.DurationMs, path
	if aerr := auditAssistant(rc, "assistant.explain", "success", "Explained "+target+" ("+path+").", detail); aerr != nil {
		return AssistantExplanation{}, aerr
	}
	return AssistantExplanation{Target: target, Text: truncateRunes(text, 2000), Sent: sent, AssistantMeta: meta}, nil
}

// retryNote: the corrective turn.
func retryNote(bad []string) string {
	return "Your answer contains numbers that are not in the facts: " + strings.Join(bad, ", ") + ". " +
		"Rewrite the whole answer. Quote only numbers that appear in the facts, exactly as written there; do not calculate, add up, convert or estimate any number."
}
