// SPDX-License-Identifier: AGPL-3.0-only

// Event notices into draft calendar events.
package business

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	noticeMaxText     = 4000
	noticeMaxEvents   = 10
	noticeMaxUnmapped = 20
	noticeAheadDays   = 400
)

// AssistantEventDraft mirrors the contract.
type AssistantEventDraft struct {
	NameEn            string   `json:"name_en"`
	NameAr            *string  `json:"name_ar"`
	NoticeType        string   `json:"notice_type"`
	ForecastEventType string   `json:"forecast_event_type"`
	City              *string  `json:"city"`
	ZoneIDs           []string `json:"zone_ids"`
	StartDate         string   `json:"start_date"`
	EndDate           string   `json:"end_date"`
	StartTime         *string  `json:"start_time"`
	EndTime           *string  `json:"end_time"`
	Impact            string   `json:"impact"`
	ImpactReason      string   `json:"impact_reason"`
	Quote             string   `json:"quote"`
	FromHijri         bool     `json:"from_hijri"`
}

// AssistantEventNoticeDraft: POST /assistant/event-notice.
type AssistantEventNoticeDraft struct {
	Events   []AssistantEventDraft `json:"events"`
	Unmapped []string              `json:"unmapped"`
	AssistantMeta
}

// textUpTo: trimmed, 1 to max characters.
func textUpTo(o datactx.Obj, key string, max int) (string, error) {
	s, _ := o[key].(string)
	s = strings.TrimSpace(s)
	if s == "" {
		return "", dataerr.Invalid(key + " is required.")
	}
	if utf8.RuneCountInString(s) > max {
		return "", dataerr.Invalid(fmt.Sprintf("%s must have at most %d characters.", key, max))
	}
	return s, nil
}

func noticeSystem(today string, zones []noticeZone) string {
	var b strings.Builder
	t, _ := time.Parse("2006-01-02", today)
	h := forecastcal.HijriOf(today)
	b.WriteString("You read an event notice (English or Arabic) pasted by a planner at Customer, Saudi Arabia, and list the events in it that could change road traffic and accidents, as JSON for the OpenDispatch planning calendar.\n")
	fmt.Fprintf(&b, "Today is %s, %s", t.Weekday(), today)
	if h != nil {
		fmt.Fprintf(&b, " (Umm al-Qura Hijri %04d-%02d-%02d)", h.Year, h.Month, h.Day)
	}
	b.WriteString(". Resolve relative dates (\"next Friday\", \"tomorrow\") from today. Times are local (Asia/Riyadh).\n")
	b.WriteString("Event types (notice_type): sports_match, festival, concert, conference, road_closure, public_holiday, other.\n")
	b.WriteString("Cities and their zones (code: name):\n")
	byCity := map[string][]string{}
	var cities []string
	for _, z := range zones {
		if _, ok := byCity[z.City]; !ok {
			cities = append(cities, z.City)
		}
		byCity[z.City] = append(byCity[z.City], z.Code+": "+z.NameEn)
	}
	for _, c := range cities {
		fmt.Fprintf(&b, "- %s: %s\n", c, strings.Join(byCity[c], "; "))
	}
	b.WriteString("city is one of those English city names (for Arabic text, الرياض is Riyadh, جدة is Jeddah, الدمام is Dammam), or null when the event applies to the whole country (for example a national public holiday). zones lists the codes of the zones the event touches; an empty list means every zone of the city. Pick specific zones only when the notice names a place you can place in them (for example a district or road named after a zone); otherwise leave zones empty.\n")
	b.WriteString("Dates: start_date and end_date as YYYY-MM-DD (Gregorian). When the notice gives a Hijri date, write it as hijri:YYYY-MM-DD (Hijri year-month-day) and do not convert it yourself. An event that runs past midnight ends on the next day. start_time and end_time are HH:MM or null when the notice gives no time.\n")
	b.WriteString("impact is low, medium or high: the expected effect on traffic and accidents (large crowds, closures and holidays are higher). impact_reason is one short English sentence. quote is the exact words of the notice the impact rests on: one continuous passage copied character for character from the notice (at most 200 characters, never translated, shortened inside or joined from separate places).\n")
	b.WriteString("Every event has start_date and end_date; never leave them empty.\n")
	b.WriteString("Every event in the notice becomes one item; a road closure that goes with a match is its own event. Anything in the notice that is not an event with a date (prices, parking advice, ticket links, gates) goes, in the notice's own words, into unmapped. Never invent an event, a date or a place the notice does not give; if an event has no date, put it into unmapped instead.\n")
	fmt.Fprintf(&b, "Answer with ONE JSON object and nothing else: {\"events\": [ ... at most %d items, each with exactly the keys name_en, name_ar, notice_type, city, zones, start_date, end_date, start_time, end_time, impact, impact_reason, quote ], \"unmapped\": [ ... ]}. name_en is a short English name (at most 80 characters), name_ar a short Arabic name. If the notice has no event, answer {\"events\": [], \"unmapped\": []}.\n", noticeMaxEvents)
	b.WriteString(`Example notice: "Concert at Mohammed Abdu Arena, Riyadh Boulevard, Friday 13 November 2026 from 20:00 to 23:30. Tickets from 150 SAR."
{"events":[{"name_en":"Concert at Mohammed Abdu Arena","name_ar":"حفل في مسرح محمد عبده","notice_type":"concert","city":"Riyadh","zones":[],"start_date":"2026-11-13","end_date":"2026-11-13","start_time":"20:00","end_time":"23:30","impact":"medium","impact_reason":"An evening concert draws a large crowd to one venue.","quote":"Concert at Mohammed Abdu Arena, Riyadh Boulevard, Friday 13 November 2026 from 20:00 to 23:30"}],"unmapped":["Tickets from 150 SAR."]}
`)
	return b.String()
}

// ReadEventNoticeWithAssistant: notice in, drafts out.
func ReadEventNoticeWithAssistant(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (AssistantEventNoticeDraft, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminLeavePolicyCalendar, access.AccessEdit); err != nil {
		_ = auditAssistant(rc, "assistant.event_notice", "denied", "Event notice refused: role.", nil)
		return AssistantEventNoticeDraft{}, err
	}
	o, err := datactx.Object(body, "Event notice request", []string{"text", "locale"})
	if err != nil {
		return AssistantEventNoticeDraft{}, err
	}
	text, err := textUpTo(o, "text", noticeMaxText)
	if err != nil {
		return AssistantEventNoticeDraft{}, err
	}
	locale := localeOf(o)
	p, err := activeProvider()
	if err != nil {
		return AssistantEventNoticeDraft{}, err
	}
	zones, err := noticeZones(ctx, conn, rc)
	if err != nil {
		return AssistantEventNoticeDraft{}, err
	}
	today := Today(rc.CustomerID)
	started := time.Now()
	sent := scrubNotice(text)
	var events []AssistantEventDraft
	var unmapped []string
	attempts, callErr, verr := completeChecked(ctx, p, assistant.Request{
		System:    noticeSystem(today, zones),
		Messages:  []assistant.Message{{Role: "user", Text: "The notice:\n" + sent}},
		MaxTokens: 4096,
		JSON:      true,
	}, func(reply string) error {
		var err error
		events, unmapped, err = validateNoticeDraft(reply, sent, today, zones)
		return err
	})
	meta := metaOf(p, started)
	detail := map[string]any{"provider": meta.Provider, "model": meta.Model, "duration_ms": meta.DurationMs, "text_chars": utf8.RuneCountInString(text), "locale": locale, "attempts": attempts}
	if callErr != nil {
		err := providerFailure(callErr)
		detail["error"] = err.Error()
		if aerr := auditAssistant(rc, "assistant.event_notice", "failure", "Event notice: the assistant did not answer.", detail); aerr != nil {
			return AssistantEventNoticeDraft{}, aerr
		}
		return AssistantEventNoticeDraft{}, err
	}
	if verr != nil {
		detail["error"] = verr.Error()
		if aerr := auditAssistant(rc, "assistant.event_notice", "rejected", "Event notice rejected: the assistant's events failed the calendar checks.", detail); aerr != nil {
			return AssistantEventNoticeDraft{}, aerr
		}
		return AssistantEventNoticeDraft{}, verr
	}
	detail["events"] = len(events)
	detail["unmapped"] = len(unmapped)
	if aerr := auditAssistant(rc, "assistant.event_notice", "success", "Event notice read by the assistant (nothing saved).", detail); aerr != nil {
		return AssistantEventNoticeDraft{}, aerr
	}
	return AssistantEventNoticeDraft{Events: events, Unmapped: unmapped, AssistantMeta: meta}, nil
}

func invalidNotice(format string, args ...any) error {
	return dataerr.Invalid("The assistant's events did not pass the calendar checks: " + fmt.Sprintf(format, args...)).WithReason(dataerr.ReasonAssistantInvalid)
}

var (
	noticeSpace = regexp.MustCompile(`\s+`)
	noticeMarks = regexp.MustCompile(`[\x{064B}-\x{065F}\x{0670}\x{0640}]`)
)

// normQuote: compare quotes loosely, never words.
func normQuote(s string) string {
	s = noticeMarks.ReplaceAllString(s, "")
	s = strings.Map(func(r rune) rune {
		switch {
		case r >= '٠' && r <= '٩':
			return '0' + (r - '٠')
		case r >= '۰' && r <= '۹':
			return '0' + (r - '۰')
		case strings.ContainsRune("\"'«»“”‘’`", r):
			return -1
		case r == '،':
			return ','
		}
		return unicode.ToLower(r)
	}, s)
	s = noticeSpace.ReplaceAllString(strings.TrimSpace(s), " ")
	return strings.Trim(s, " .,;:!?…")
}

var quoteSplit = regexp.MustCompile(`\.\.\.|…|[.!?؟]+\s+`)

// quoteInText: each sentence verbatim, in order.
func quoteInText(quote, normSent string) bool {
	from, found := 0, 0
	for _, part := range quoteSplit.Split(quote, -1) {
		p := normQuote(part)
		if p == "" {
			continue
		}
		i := strings.Index(normSent[from:], p)
		if i < 0 {
			return false
		}
		from += i + len(p)
		found++
	}
	return found > 0
}

var noticeDateToken = regexp.MustCompile(`[0-9\x{0660}-\x{0669}]{4}[-/][0-9\x{0660}-\x{0669}]{1,2}[-/][0-9\x{0660}-\x{0669}]{1,2}|[0-9\x{0660}-\x{0669}]{1,2}[-/][0-9\x{0660}-\x{0669}]{1,2}[-/][0-9\x{0660}-\x{0669}]{2,4}`)

// scrubNotice: masks contacts, keeps the dates.
func scrubNotice(s string) string {
	var kept []string
	s = noticeDateToken.ReplaceAllStringFunc(s, func(m string) string {
		kept = append(kept, m)
		return fmt.Sprintf("\x00%d\x00", len(kept)-1)
	})
	s = scrub(s)
	for i, m := range kept {
		s = strings.Replace(s, fmt.Sprintf("\x00%d\x00", i), m, 1)
	}
	return s
}

// noticeDate: Gregorian, or hijri: converted.
func noticeDate(v any, what string) (string, bool, error) {
	s, _ := v.(string)
	s = strings.TrimSpace(s)
	if rest, ok := strings.CutPrefix(s, "hijri:"); ok {
		var y, m, d int
		if n, err := fmt.Sscanf(rest, "%d-%d-%d", &y, &m, &d); err != nil || n != 3 {
			return "", true, invalidNotice("%s %q is not a Hijri date.", what, truncateRunes(s, 20))
		}
		g, ok := forecastcal.GregorianOfHijri(y, m, d)
		if !ok {
			return "", true, invalidNotice("%s %q is not a real Umm al-Qura date.", what, truncateRunes(s, 20))
		}
		return g, true, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil || t.Format("2006-01-02") != s {
		return "", false, invalidNotice("%s %q is not a date.", what, truncateRunes(s, 20))
	}
	return s, false, nil
}

func noticeClock(v any, what string) (*string, error) {
	if v == nil {
		return nil, nil
	}
	s, ok := v.(string)
	if s = strings.TrimSpace(s); ok && s == "" {
		return nil, nil
	}
	if !ok || !hhmmPattern.MatchString(s) {
		return nil, invalidNotice("%s must be HH:MM or null.", what)
	}
	return &s, nil
}

func cityOf(name string, zones []noticeZone) (string, bool) {
	n := strings.ToLower(strings.TrimSpace(name))
	for _, z := range zones {
		if strings.ToLower(z.City) == n {
			return z.City, true
		}
	}
	return "", false
}

// validateNoticeDraft: the model's JSON, checked strictly.
func validateNoticeDraft(text, sent, today string, zones []noticeZone) ([]AssistantEventDraft, []string, error) {
	obj, ok := extractJSON(text)
	if !ok {
		return nil, nil, invalidNotice("the answer was not one JSON object.")
	}
	for k := range obj {
		if k != "events" && k != "unmapped" {
			return nil, nil, invalidNotice("unknown key %q.", truncateRunes(k, 40))
		}
	}
	unmapped, err := phraseList(obj["unmapped"], noticeMaxUnmapped)
	if err != nil {
		return nil, nil, err
	}
	list, ok := obj["events"].([]any)
	if !ok || len(list) > noticeMaxEvents {
		return nil, nil, invalidNotice("events must be a list of at most %d events.", noticeMaxEvents)
	}
	todayT, _ := time.Parse("2006-01-02", today)
	latest := todayT.AddDate(0, 0, noticeAheadDays).Format("2006-01-02")
	normSent := normQuote(sent)
	out := []AssistantEventDraft{}
	allowed := []string{"name_en", "name_ar", "notice_type", "city", "zones", "start_date", "end_date", "start_time", "end_time", "impact", "impact_reason", "quote"}
	for i, item := range list {
		e, ok := item.(map[string]any)
		if !ok {
			return nil, nil, invalidNotice("event %d is not an object.", i+1)
		}
		for k := range e {
			if !stringInList(k, allowed) {
				return nil, nil, invalidNotice("event %d has the unknown key %q.", i+1, truncateRunes(k, 40))
			}
		}
		d, err := noticeEventDraft(i+1, e, zones)
		if err != nil {
			return nil, nil, err
		}
		if d.EndDate < today || d.StartDate > latest {
			return nil, nil, invalidNotice("event %d (%s) is not between today and %d days ahead.", i+1, d.NameEn, noticeAheadDays)
		}
		if !quoteInText(d.Quote, normSent) {
			return nil, nil, invalidNotice("the quote for event %d (%s) is not in the notice.", i+1, d.NameEn)
		}
		out = append(out, d)
	}
	return out, unmapped, nil
}

func noticeEventDraft(n int, e map[string]any, zones []noticeZone) (AssistantEventDraft, error) {
	var d AssistantEventDraft
	name, _ := e["name_en"].(string)
	if d.NameEn = strings.TrimSpace(name); d.NameEn == "" || utf8.RuneCountInString(d.NameEn) > 120 {
		return d, invalidNotice("event %d: name_en must have 1 to 120 characters.", n)
	}
	if s, ok := e["name_ar"].(string); ok && strings.TrimSpace(s) != "" {
		s = strings.TrimSpace(s)
		if utf8.RuneCountInString(s) > 120 {
			return d, invalidNotice("event %d: name_ar must have at most 120 characters.", n)
		}
		d.NameAr = &s
	} else if v, has := e["name_ar"]; has && v != nil && !ok {
		return d, invalidNotice("event %d: name_ar must be text.", n)
	}
	typ, _ := e["notice_type"].(string)
	if !stringInList(typ, forecastcal.NoticeTypes) {
		return d, invalidNotice("event %d: %q is not an event type.", n, truncateRunes(typ, 30))
	}
	d.NoticeType, d.ForecastEventType = typ, forecastcal.NoticeEventType(typ)
	impact, _ := e["impact"].(string)
	if !stringInList(impact, forecastcal.Impacts) {
		return d, invalidNotice("event %d: impact must be low, medium or high.", n)
	}
	d.Impact = impact
	reason, _ := e["impact_reason"].(string)
	if d.ImpactReason = strings.TrimSpace(reason); d.ImpactReason == "" || utf8.RuneCountInString(d.ImpactReason) > 300 {
		return d, invalidNotice("event %d: impact_reason must have 1 to 300 characters.", n)
	}
	quote, _ := e["quote"].(string)
	if d.Quote = strings.TrimSpace(quote); d.Quote == "" || utf8.RuneCountInString(d.Quote) > 300 {
		return d, invalidNotice("event %d: quote must have 1 to 300 characters.", n)
	}
	var h1, h2 bool
	var err error
	if d.StartDate, h1, err = noticeDate(e["start_date"], "start_date"); err != nil {
		return d, err
	}
	if d.EndDate, h2, err = noticeDate(e["end_date"], "end_date"); err != nil {
		return d, err
	}
	d.FromHijri = h1 || h2
	if d.StartTime, err = noticeClock(e["start_time"], "start_time"); err != nil {
		return d, err
	}
	if d.EndTime, err = noticeClock(e["end_time"], "end_time"); err != nil {
		return d, err
	}
	if err := checkNoticeZones(n, e, zones, &d); err != nil {
		return d, err
	}
	// The saved event's own check, as for a save
	r := forecastcal.NoticeRange{Start: d.StartDate, End: d.EndDate, Name: d.NameEn, Type: d.NoticeType, Impact: d.Impact, ZoneIDs: d.ZoneIDs, ImpactReason: d.ImpactReason}
	if d.StartTime != nil {
		r.StartTime = *d.StartTime
	}
	if d.EndTime != nil {
		r.EndTime = *d.EndTime
	}
	if err := r.Check(); err != nil {
		return d, invalidNotice("event %d (%s) %s.", n, d.NameEn, err.Error())
	}
	return d, nil
}

func checkNoticeZones(n int, e map[string]any, zones []noticeZone, d *AssistantEventDraft) error {
	d.ZoneIDs = []string{}
	codes := []string{}
	if v, has := e["zones"]; has && v != nil {
		list, ok := v.([]any)
		if !ok {
			return invalidNotice("event %d: zones must be a list of zone codes.", n)
		}
		for _, c := range list {
			s, ok := c.(string)
			if !ok {
				return invalidNotice("event %d: zones must be a list of zone codes.", n)
			}
			codes = append(codes, strings.TrimSpace(s))
		}
	}
	cityName, _ := e["city"].(string)
	if strings.TrimSpace(cityName) == "" {
		if v, has := e["city"]; has && v != nil {
			if _, isStr := v.(string); !isStr {
				return invalidNotice("event %d: city must be a city name or null.", n)
			}
		}
		if len(codes) > 0 {
			return invalidNotice("event %d: zones need a city.", n)
		}
		return nil
	}
	city, ok := cityOf(cityName, zones)
	if !ok {
		return invalidNotice("event %d: %q is not one of this customer's cities.", n, truncateRunes(cityName, 40))
	}
	d.City = &city
	seen := map[string]bool{}
	for _, z := range zones {
		if z.City != city {
			continue
		}
		if len(codes) == 0 || stringInList(z.Code, codes) {
			d.ZoneIDs = append(d.ZoneIDs, z.ID)
			seen[z.Code] = true
		}
	}
	for _, c := range codes {
		if !seen[c] {
			return invalidNotice("event %d: zone %q is not a zone of %s.", n, truncateRunes(c, 20), city)
		}
	}
	if len(d.ZoneIDs) == 0 {
		return invalidNotice("event %d: %s has no active zone.", n, city)
	}
	return nil
}

// phraseList: unmapped phrases, at most max.
func phraseList(v any, max int) ([]string, error) {
	out := []string{}
	if v == nil {
		return out, nil
	}
	list, ok := v.([]any)
	if !ok || len(list) > max {
		return nil, invalidNotice("unmapped must be a list of at most %d phrases.", max)
	}
	for _, item := range list {
		s, ok := item.(string)
		if !ok {
			return nil, invalidNotice("unmapped must hold text.")
		}
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, truncateRunes(s, 200))
		}
	}
	return out, nil
}
