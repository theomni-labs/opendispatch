// SPDX-License-Identifier: AGPL-3.0-only

// Shift handover: the last shift, summarised.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// AssistantHandover: POST /assistant/handover.
type AssistantHandover struct {
	WindowHours int    `json:"window_hours"`
	WindowFrom  string `json:"window_from"`
	WindowTo    string `json:"window_to"`
	Text        string `json:"text"`
	AnswerPath  string `json:"answer_path"`
	Sent        string `json:"sent"`
	AssistantMeta
}

const (
	nextShiftHours = 8
	minuteMs       = int64(60_000)
	hourMs         = 60 * minuteMs
)

// fallbackPeriod: one stretch of the customer fallback.
type fallbackPeriod struct {
	StartMs, EndMs int64
	Ongoing        bool
	Reason         string
}

// handoverGaps: next shift's gap intervals.
type handoverGaps struct {
	Gaps        int
	Worst       *gapWorst
	CauseCounts map[string]int
}

// handoverInputs: what the screens show, raw.
type handoverInputs struct {
	FromMs, ToMs     int64
	Hours            int
	Day              string
	Zones            []Zone
	Registered       int
	Assigned         int
	Waiting          int
	FallbackCases    int
	Forecast         *float64
	ForecastHidden   bool
	Customer         *ShadowSideSummary
	Compared         int
	ReadingFrom      string
	ReadingTo        string
	ClockStart       string
	ThresholdMin     int
	Unmet            map[string]int
	Periods          []fallbackPeriod
	FallbackActive   bool
	Alerts           []AssistantAlertGroup
	Next             *handoverGaps
	NextFromMs       int64
	Overrides        map[string]int
	OverridesVisible bool
	DataSource       string
}

func hmAt(ms int64) string { return time.UnixMilli(ms).In(riyadhZone).Format("15:04") }

// fallbackPeriods: active stretches in a window.
func fallbackPeriods(events []DispatchFallbackEvent, fromMs, toMs int64) []fallbackPeriod {
	var out []fallbackPeriod
	var cur *fallbackPeriod
	if v, err := dispatchFallbackFrom(events, fromMs); err == nil && v.Active {
		cur = &fallbackPeriod{StartMs: fromMs, Reason: v.Reason}
	}
	for _, e := range events {
		t, err := datactx.EpochOf(e.At)
		if err != nil || t.UnixMilli() <= fromMs || t.UnixMilli() > toMs {
			continue
		}
		v, err := dispatchFallbackFrom(events, t.UnixMilli())
		if err != nil {
			continue
		}
		switch {
		case v.Active && cur == nil:
			cur = &fallbackPeriod{StartMs: t.UnixMilli(), Reason: v.Reason}
		case !v.Active && cur != nil:
			cur.EndMs = t.UnixMilli()
			out = append(out, *cur)
			cur = nil
		}
	}
	if cur != nil {
		cur.EndMs, cur.Ongoing = toMs, true
		out = append(out, *cur)
	}
	return out
}

// countsOf: labelled counts, most first.
func countsOf(counts map[string]int, labels map[string][2]string, locale, key string) []map[string]any {
	keys := make([]string, 0, len(counts))
	for k, n := range counts {
		if n > 0 {
			keys = append(keys, k)
		}
	}
	sort.SliceStable(keys, func(i, j int) bool {
		if counts[keys[i]] != counts[keys[j]] {
			return counts[keys[i]] > counts[keys[j]]
		}
		return keys[i] < keys[j]
	})
	out := make([]map[string]any, 0, len(keys))
	for _, k := range keys {
		out = append(out, map[string]any{"label": labelOr(labels, k, locale), key: counts[k]})
	}
	return out
}

func sumCounts(m map[string]int) int {
	n := 0
	for _, v := range m {
		n += v
	}
	return n
}

// handoverFacts: the screens' figures, labelled.
func handoverFacts(in handoverInputs, locale string) map[string]any {
	l := func(k string) string { return tr(handoverLabels[k], locale) }
	names := make([]string, 0, len(in.Zones))
	for _, z := range in.Zones {
		names = append(names, zoneName(z, locale))
	}
	facts := map[string]any{
		"screen": l("screen"), "zones_label": l("zones"), "zones": names,
		"window": map[string]any{"date": dateLabel(in.Day, locale), "from": hmAt(in.FromMs), "to": hmAt(in.ToMs), "hours": in.Hours},
		"cases": map[string]any{
			"registered": map[string]any{"value": in.Registered, "label": l("registered")},
			"assigned":   map[string]any{"value": in.Assigned, "label": l("assigned")},
			"waiting":    map[string]any{"value": in.Waiting, "label": l("waiting")},
		},
		"threshold_minutes": in.ThresholdMin, "data_source": in.DataSource, "illustrative": true,
	}
	if in.Forecast != nil {
		facts["forecast_cases"] = map[string]any{"value": int(math.Round(*in.Forecast)), "label": l("forecast")}
	} else if in.ForecastHidden {
		facts["forecast_cases"] = map[string]any{"label": l("forecast"), "value": l("not_available")}
	} else {
		facts["forecast_cases"] = map[string]any{"label": l("forecast"), "value": l("no_forecast")}
	}
	if in.Customer != nil && in.Compared > 0 {
		reading := func(r ServiceLevelReading) any {
			if r.Share == nil {
				return "-"
			}
			return percentOf(*r.Share)
		}
		order := []string{"from_assignment", "from_registration"}
		if in.ClockStart == "registration" {
			order = []string{"from_registration", "from_assignment"}
		}
		vals := map[string]any{"from_assignment": reading(in.Customer.FromAssignment), "from_registration": reading(in.Customer.FromRegistration)}
		clocks := make([]map[string]any, 0, 2)
		for _, k := range order {
			clocks = append(clocks, map[string]any{"label": l(k), "value": vals[k]})
		}
		facts["within_10_minutes"] = map[string]any{"label": l("ten"), "meaning": tr(handoverMeanings["ten"], locale), "clocks": clocks,
			"cases_compared": in.Compared, "period": in.ReadingFrom + " - " + in.ReadingTo}
	} else {
		facts["within_10_minutes"] = map[string]any{"label": l("ten"), "value": l("no_compared")}
	}
	facts["out_of_reach"] = map[string]any{"label": l("unmet"), "meaning": tr(handoverMeanings["unmet"], locale), "cases": sumCounts(in.Unmet),
		"by_cause": countsOf(in.Unmet, unmetCauseLabels, locale, "cases")}
	periods := make([]map[string]any, 0, len(in.Periods))
	for _, p := range in.Periods {
		end := hmAt(p.EndMs)
		if p.Ongoing {
			end = l("ongoing")
		}
		periods = append(periods, map[string]any{"from": hmAt(p.StartMs), "to": end, "reason": labelOr(fallbackReasonLabels, p.Reason, locale)})
	}
	now := l("armed")
	if in.FallbackActive {
		now = l("active")
	}
	facts["fallback"] = map[string]any{"label": l("fallback"), "meaning": tr(handoverMeanings["periods"], locale), "periods": periods,
		"cases": map[string]any{"value": in.FallbackCases, "label": l("fallback_cases")}, "now": now}
	facts["alerts"] = alertFacts(in.Alerts, locale)
	if in.Next == nil {
		facts["next_shift"] = map[string]any{"label": l("next"), "gaps": l("not_available")}
	} else {
		next := map[string]any{"label": l("next"), "from": hmAt(in.NextFromMs), "to": hmAt(in.NextFromMs + nextShiftHours*hourMs),
			"meaning": tr(handoverMeanings["next"], locale), "gap_intervals": in.Next.Gaps,
			"by_cause": countsOf(in.Next.CauseCounts, map[string][2]string{"people": gapLabels["cause.people"], "vehicles": gapLabels["cause.vehicles"], "geography": gapLabels["cause.geography"]}, locale, "gap_intervals")}
		if w := in.Next.Worst; w != nil {
			next["worst_gap"] = map[string]any{"label": tr(gapLabels["stat.worst"], locale), "agents_short": -w.Delta, "zone": zoneName(w.Zone, locale), "zone_code": zoneCodeOf(w.Zone), "interval_starts_at": intervalTime(w.Index)}
		}
		facts["next_shift"] = next
	}
	if in.OverridesVisible {
		facts["overrides"] = map[string]any{"label": l("overrides"), "count": sumCounts(in.Overrides), "by_reason": countsOf(in.Overrides, reasonCodeLabels, locale, "count")}
	}
	return facts
}

// ---- Gathering, through the screens' reads ----

// gatherHandover: same reads the screens use.
var gatherHandover = func(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, hours int) (handoverInputs, error) {
	board, err := GetLiveBoard(rc, LiveBoardQuery{Limit: datactx.MaxLimit})
	if err != nil {
		return handoverInputs{}, err
	}
	toT, err := datactx.EpochOf(board.Replay.ReplayAt)
	if err != nil {
		return handoverInputs{}, err
	}
	in := handoverInputs{Hours: hours, Day: board.Replay.ReplayDate, ToMs: toT.UnixMilli(), DataSource: board.DataSource, FallbackActive: board.Fallback.State != "armed"}
	// Feeds mode: wall clock, the demo's day label
	wallDay := time.UnixMilli(in.ToMs).In(riyadhZone).Format("2006-01-02")
	dayStart, err := datactx.EpochOf(wallDay + "T00:00:00+03:00")
	if err != nil {
		return handoverInputs{}, err
	}
	// The board holds one day only
	in.FromMs = max(in.ToMs-int64(hours)*hourMs, dayStart.UnixMilli())
	from, to := isoAtMs(in.FromMs), isoAtMs(in.ToMs)
	if in.Zones, err = readableZones(ctx, conn, rc); err != nil {
		return handoverInputs{}, err
	}
	cases, err := everyLiveCase(rc)
	if err != nil {
		return handoverInputs{}, err
	}
	for _, c := range cases {
		if ok, _ := datactx.InTimeRange(c.RegisteredAt, from, to); !ok {
			continue
		}
		in.Registered++
		switch c.State {
		case "waiting", "recommended":
			in.Waiting++
		default:
			in.Assigned++
		}
		if c.State == "fallback_assigned" {
			in.FallbackCases++
		}
	}
	in.ForecastHidden = !canView(rc, access.ModuleOpsForecastExplorer)
	in.Forecast = windowForecast(rc, in.Zones, in.Day, dayStart.UnixMilli(), in.FromMs, in.ToMs)
	in.ClockStart = getClockStart(ctx, rc.CustomerID)
	if err := handoverReading(rc, &in, from, to); err != nil {
		return handoverInputs{}, err
	}
	unmet, err := ListUnmetDemand(rc, UnmetDemandQuery{Limit: datactx.MaxLimit, Date: in.Day})
	if err != nil {
		return handoverInputs{}, err
	}
	in.ThresholdMin, in.Unmet = int(math.Round(float64(unmet.ThresholdSeconds)/60)), map[string]int{}
	for _, u := range unmet.Items {
		if ok, _ := datactx.InTimeRange(u.RegisteredAt, from, to); ok {
			in.Unmet[u.Cause]++
		}
	}
	events, err := dispatchFallbackEvents(ctx, rc.CustomerID)
	if err != nil {
		return handoverInputs{}, err
	}
	in.Periods = fallbackPeriods(events, in.FromMs, in.ToMs)
	notes, err := unreadNotifications(rc)
	if err != nil {
		return handoverInputs{}, err
	}
	in.Alerts = alertGroups(notes)
	in.NextFromMs = in.ToMs
	in.Next = nextShiftGaps(ctx, conn, rc, in.Zones, in.ToMs, dayShift(wallDay, in.Day))
	in.Overrides, in.OverridesVisible = windowOverrides(ctx, conn, rc, from, to)
	return in, nil
}

// everyLiveCase: the board's cases, every page.
func everyLiveCase(rc reqctx.RequestContext) ([]LiveCase, error) {
	var out []LiveCase
	cursor := ""
	for {
		page, err := ListLiveCases(rc, LiveCaseQuery{Limit: datactx.MaxLimit, Cursor: cursor})
		if err != nil {
			return nil, err
		}
		out = append(out, page.Items...)
		if !page.Page.HasMore || page.Page.NextCursor == nil {
			return out, nil
		}
		cursor = *page.Page.NextCursor
	}
}

// windowForecast: expected cases in the window.
func windowForecast(rc reqctx.RequestContext, zones []Zone, day string, dayStartMs, fromMs, toMs int64) *float64 {
	if !canView(rc, access.ModuleOpsForecastExplorer) || len(zones) == 0 {
		return nil
	}
	sum, any := 0.0, false
	for _, z := range zones {
		tl, err := GetForecastTimeline(rc, ForecastTimelineQuery{ZoneID: z.ID, Date: day})
		if err != nil {
			log.Printf("assistant: handover forecast: %v", err)
			continue
		}
		for _, iv := range tl.Intervals {
			start := dayStartMs + int64(iv.IntervalIndex)*15*minuteMs
			if start >= fromMs && start < toMs {
				sum += iv.Expected
				any = true
			}
		}
	}
	if !any {
		return nil
	}
	return &sum
}

// handoverReading: the board's 10-minute reading.
func handoverReading(rc reqctx.RequestContext, in *handoverInputs, from, to string) error {
	s, err := GetShadowComparisonSummary(rc, ShadowComparisonQuery{From: from, To: to})
	if err != nil {
		return err
	}
	if s.CasesCompared == 0 {
		// None in the window: the board's own
		if s, err = GetShadowComparisonSummary(rc, ShadowComparisonQuery{}); err != nil {
			return err
		}
	}
	if s.CasesCompared > 0 {
		customer := s.Customer
		in.Customer, in.Compared = &customer, s.CasesCompared
		in.ReadingFrom, in.ReadingTo = readingStamp(s.From), readingStamp(s.To)
	}
	return nil
}

// readingStamp: "2026-09-13 10:42" in Riyadh.
func readingStamp(iso string) string {
	t, err := datactx.EpochOf(iso)
	if err != nil {
		return iso
	}
	return t.In(riyadhZone).Format("2006-01-02 15:04")
}

// nextShiftGaps: gaps after the window.
func nextShiftGaps(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, zones []Zone, fromMs int64, shift int) *handoverGaps {
	if !canView(rc, access.ModuleOpsGapSurplus) {
		return nil
	}
	toMs := fromMs + nextShiftHours*hourMs
	byID := map[string]Zone{}
	for _, z := range zones {
		byID[z.ID] = z
	}
	out := &handoverGaps{CauseCounts: map[string]int{}}
	read := false
	for _, day := range riyadhDaysOf(fromMs, toMs) {
		view, err := GetGapSurplus(ctx, conn, rc, GapQuery{Date: shiftDate(day, shift)})
		if err != nil {
			continue
		}
		read = true
		dayStart, err := datactx.EpochOf(day + "T00:00:00+03:00")
		if err != nil {
			continue
		}
		for _, c := range view.Cells {
			start := dayStart.UnixMilli() + int64(c.IntervalIndex)*15*minuteMs
			z, ok := byID[c.ZoneID]
			if !ok || start+15*minuteMs <= fromMs || start >= toMs || c.Kind != "gap" {
				continue
			}
			out.Gaps++
			if c.Cause != nil {
				out.CauseCounts[*c.Cause]++
			}
			if out.Worst == nil || c.Delta < out.Worst.Delta {
				out.Worst = &gapWorst{Delta: c.Delta, Zone: z, Index: c.IntervalIndex}
			}
		}
	}
	if !read {
		return nil
	}
	return out
}

// dayShift: days from the wall date to the label.
func dayShift(wall, label string) int {
	w, err1 := time.Parse("2006-01-02", wall)
	l, err2 := time.Parse("2006-01-02", label)
	if err1 != nil || err2 != nil {
		return 0
	}
	return int(l.Sub(w).Hours() / 24)
}

// shiftDate: a YYYY-MM-DD date moved by days.
func shiftDate(day string, days int) string {
	d, err := time.Parse("2006-01-02", day)
	if err != nil || days == 0 {
		return day
	}
	return d.AddDate(0, 0, days).Format("2006-01-02")
}

// riyadhDaysOf: Riyadh dates a span touches.
func riyadhDaysOf(fromMs, toMs int64) []string {
	first := time.UnixMilli(fromMs).In(riyadhZone).Format("2006-01-02")
	last := time.UnixMilli(toMs - 1).In(riyadhZone).Format("2006-01-02")
	if first == last {
		return []string{first}
	}
	return []string{first, last}
}

// windowOverrides: manual changes by reason.
func windowOverrides(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, from, to string) (map[string]int, bool) {
	out := map[string]int{}
	cursor := ""
	for {
		page, err := ListAssignments(ctx, conn, rc, AssignmentQuery{Limit: datactx.MaxLimit, Cursor: cursor, From: from, To: to, Source: "MANUAL"})
		if err != nil {
			return nil, false
		}
		for _, a := range page.Items {
			reason := "other"
			if a.ReasonCode != nil && *a.ReasonCode != "" {
				reason = *a.ReasonCode
			}
			out[reason]++
		}
		if !page.Page.HasMore || page.Page.NextCursor == nil {
			return out, true
		}
		cursor = *page.Page.NextCursor
	}
}

// ---- The model call, checked ----

const handoverSystem = "You write a shift handover for a dispatch supervisor at Customer (Saudi Arabia), which handles motor accident reports for insurers. " +
	"Customer agents handle each case on site (field) or remotely. Call them cases and agents; never use a medical word. " +
	"Use only the JSON facts given. Quote only numbers that appear in the facts, exactly as written there. " +
	"Never calculate, add, subtract, convert, count or estimate a number of your own. " +
	"Use names and labels exactly as given (zones, labels, cause labels, reasons, times): copy them verbatim, never translate or rephrase them. The JSON keys are not words to show. " +
	"Cover, in this order and one point per line: cases registered and assigned against the forecast; within 10 minutes, both clocks, the first one listed is primary; " +
	"cases out of 10-minute reach and their causes; fallback to operator dispatch (periods, reason, cases); unread alerts; the next shift's gap intervals and the worst gap; manual overrides. " +
	"A figure whose value is text, not a number, is not available: say it with that text in a few words, or leave the point out; never describe it otherwise. " +
	"Keep each number next to its own label: never attach a number to another label. " +
	"Write times exactly as given (HH:MM) and numbers with Western digits (0-9). All numbers are synthetic and illustrative. " +
	"Write 5 to 8 short plain lines, one fact per line, no heading, no greeting, no advice. " + plainRule + " Answer in %s."

// handoverFallback: plain lines from the facts.
func handoverFallback(facts map[string]any, locale string) string {
	sep := ft("sep", locale)
	lines := []string{ft("lead", locale)}
	w := factMap(facts, "window")
	lines = append(lines, factStr(facts, "screen")+sep+factStr(w, "date")+" "+factStr(w, "from")+" - "+factStr(w, "to")+".")
	c := factMap(facts, "cases")
	parts := []string{}
	for _, k := range []string{"registered", "assigned", "waiting"} {
		m := factMap(c, k)
		parts = append(parts, factStr(m, "label")+": "+factStr(m, "value"))
	}
	f := factMap(facts, "forecast_cases")
	parts = append(parts, factStr(f, "label")+": "+factStr(f, "value"))
	lines = append(lines, strings.Join(parts, sep)+".")
	if r := factMap(facts, "within_10_minutes"); factStr(r, "value") != "" {
		lines = append(lines, factStr(r, "label")+": "+factStr(r, "value")+".")
	} else if r != nil {
		parts = []string{}
		clocks, _ := r["clocks"].([]map[string]any)
		for _, k := range clocks {
			parts = append(parts, factStr(k, "label")+": "+factStr(k, "value"))
		}
		lines = append(lines, factStr(r, "label")+": "+strings.Join(parts, sep)+".")
	}
	u := factMap(facts, "out_of_reach")
	lines = append(lines, factStr(u, "label")+": "+factStr(u, "cases")+causeList(u["by_cause"], "cases", sep)+".")
	fb := factMap(facts, "fallback")
	periods, _ := fb["periods"].([]map[string]any)
	parts = []string{}
	for _, p := range periods {
		parts = append(parts, fmt.Sprintf("%s - %s (%s)", p["from"], p["to"], p["reason"]))
	}
	fc := factMap(fb, "cases")
	line := factStr(fb, "label") + ": " + factStr(fb, "now")
	if len(parts) > 0 {
		line += sep + strings.Join(parts, sep)
	}
	lines = append(lines, line+sep+factStr(fc, "label")+": "+factStr(fc, "value")+".")
	a := factMap(facts, "alerts")
	lines = append(lines, factStr(a, "label")+": "+factStr(a, "unread")+".")
	if n := factMap(facts, "next_shift"); n != nil {
		if g := factStr(n, "gaps"); g != "" {
			lines = append(lines, factStr(n, "label")+": "+g+".")
		} else {
			line := factStr(n, "label") + " (" + factStr(n, "from") + " - " + factStr(n, "to") + "): " + tr(gapLabels["stat.gaps"], locale) + " " + factStr(n, "gap_intervals")
			if wg := factMap(n, "worst_gap"); wg != nil {
				line += sep + fmt.Sprintf(ft("worst", locale), factStr(wg, "label"), factStr(wg, "agents_short"), factStr(wg, "zone"), factStr(wg, "interval_starts_at"))
				line = strings.TrimSuffix(line, ".")
			}
			lines = append(lines, line+".")
		}
	}
	if o := factMap(facts, "overrides"); o != nil {
		lines = append(lines, factStr(o, "label")+": "+factStr(o, "count")+causeList(o["by_reason"], "count", sep)+".")
	}
	lines = append(lines, ft("end", locale))
	return strings.Join(lines, "\n")
}

// causeList: " (a 3, b 2)" from labelled counts.
func causeList(v any, key, sep string) string {
	items, _ := v.([]map[string]any)
	if len(items) == 0 {
		return ""
	}
	parts := make([]string, 0, len(items))
	for _, it := range items {
		parts = append(parts, fmt.Sprintf("%v %v", it["label"], it[key]))
	}
	return " (" + strings.Join(parts, sep) + ")"
}

// SummariseShiftHandover: numbers checked.
func SummariseShiftHandover(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (AssistantHandover, error) {
	o, err := datactx.Object(body, "Handover request", []string{"window_hours", "locale"})
	if err != nil {
		return AssistantHandover{}, err
	}
	locale := localeOf(o)
	hours := 8
	if v, ok := o["window_hours"]; ok && v != nil {
		f, isNum := v.(float64)
		if !isNum || (f != 4 && f != 8 && f != 12) {
			return AssistantHandover{}, dataerr.Invalid("window_hours must be 4, 8 or 12.")
		}
		hours = int(f)
	}
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		_ = auditAssistant(rc, "assistant.handover", "denied", "Handover refused.", map[string]any{"window_hours": hours})
		return AssistantHandover{}, err
	}
	in, err := gatherHandover(ctx, conn, rc, hours)
	if err != nil {
		_ = auditAssistant(rc, "assistant.handover", outcomeOf(err), "Handover refused.", map[string]any{"window_hours": hours})
		return AssistantHandover{}, err
	}
	p, err := activeProvider()
	if err != nil {
		return AssistantHandover{}, err
	}
	facts := handoverFacts(in, locale)
	sentBytes, err := json.Marshal(facts)
	if err != nil {
		return AssistantHandover{}, err
	}
	sent := string(sentBytes)
	started := time.Now()
	req := assistant.Request{
		System:    fmt.Sprintf(handoverSystem, explainLanguage(locale)),
		Messages:  []assistant.Message{{Role: "user", Text: "Write the shift handover.\nFacts: " + sent}},
		MaxTokens: 1024,
	}
	detail := map[string]any{"window_hours": hours, "locale": locale, "provider": p.Name(), "model": p.Model(), "sent_chars": len(sent)}
	g, callErr := guardedAnswer(ctx, p, req, allowedNumbers(facts), func() string { return handoverFallback(facts, locale) })
	if callErr != nil {
		err := providerFailure(callErr)
		detail["duration_ms"], detail["error"] = metaOf(p, started).DurationMs, err.Error()
		if aerr := auditAssistant(rc, "assistant.handover", "failure", "Handover: the assistant did not answer.", detail); aerr != nil {
			return AssistantHandover{}, aerr
		}
		return AssistantHandover{}, err
	}
	meta := metaOf(p, started)
	detail["duration_ms"], detail["answer_path"], detail["first_unverified"] = meta.DurationMs, g.Path, g.FirstBad
	if g.Retried {
		detail["retry_unverified"] = g.RetryBad
	}
	if aerr := auditAssistant(rc, "assistant.handover", "success", "Shift handover ("+g.Path+").", detail); aerr != nil {
		return AssistantHandover{}, aerr
	}
	return AssistantHandover{
		WindowHours: hours, WindowFrom: isoAtMs(in.FromMs), WindowTo: isoAtMs(in.ToMs),
		Text: truncateRunes(g.Text, 2000), AnswerPath: g.Path, Sent: sent, AssistantMeta: meta,
	}, nil
}
