// SPDX-License-Identifier: AGPL-3.0-only

// Import help (2, 3): issues explained, checked.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	maxIssueGroups = 100
	maxRowRanges   = 8
	maxHelpItems   = 8
)

// AssistantIssueGroup mirrors the contract type.
type AssistantIssueGroup struct {
	IssueType string  `json:"issue_type"`
	Severity  string  `json:"severity"`
	Field     *string `json:"field"`
	Count     int     `json:"count"`
	Rows      string  `json:"rows"`
	// example: masked message, sent only
	example string
}

// AssistantImportIssues: POST /assistant/import-issues.
type AssistantImportIssues struct {
	ImportID      string                `json:"import_id"`
	Text          string                `json:"text"`
	Fixes         []string              `json:"fixes"`
	OwnerNote     string                `json:"owner_note"`
	CleaningRules []string              `json:"cleaning_rules"`
	Groups        []AssistantIssueGroup `json:"groups"`
	Fallback      bool                  `json:"fallback"`
	Sent          string                `json:"sent"`
	AssistantMeta
}

var issueTypeLabels = map[string][2]string{
	"assigned_before_registered": {"Assigned before registered", "إسناد قبل التسجيل"},
	"unusual_parties_count":      {"Unusual parties count", "عدد أطراف غير معتاد"},
	"missing_required_field":     {"Missing required field", "حقل إلزامي مفقود"},
	"unknown_reference":          {"Unknown reference", "مرجع غير معروف"},
	"out_of_range_coordinate":    {"Coordinate out of range", "إحداثي خارج النطاق"},
	"duplicate_external_id":      {"Duplicate case id", "معرّف بلاغ مكرر"},
	"inconsistent_name_case":     {"Inconsistent name case", "اختلاف حالة الأحرف في الاسم"},
	"other":                      {"Other", "أخرى"},
}

var severityLabels = map[string][2]string{
	"error": {"error", "خطأ"}, "warning": {"warning", "تحذير"}, "info": {"note", "ملاحظة"},
}

var (
	// cappedSummary: the "N rows in all" line
	cappedSummary = regexp.MustCompile(`^(\d+) rows in all`)
	quotedValue   = regexp.MustCompile(`"[^"]*"|'[^']*'`)
	// digitWord: a value such as an id or a number
	digitWord = regexp.MustCompile(`[^\s,;:()]*[0-9\x{0660}-\x{0669}][^\s,;:()]*`)
)

// maskMessage: a message with no values left.
func maskMessage(m string) string {
	m = quotedValue.ReplaceAllString(m, "\"…\"")
	m = digitWord.ReplaceAllString(m, "#")
	return truncateRunes(scrub(m), 200)
}

// rowRanges: 12-40, 55 (at most 8 ranges).
func rowRanges(rows []int) string {
	if len(rows) == 0 {
		return ""
	}
	sort.Ints(rows)
	var parts []string
	start, prev := rows[0], rows[0]
	flush := func() {
		if start == prev {
			parts = append(parts, strconv.Itoa(start))
		} else {
			parts = append(parts, fmt.Sprintf("%d-%d", start, prev))
		}
	}
	for _, r := range rows[1:] {
		if r == prev || r == prev+1 {
			prev = r
			continue
		}
		flush()
		start, prev = r, r
	}
	flush()
	if len(parts) > maxRowRanges {
		parts = append(parts[:maxRowRanges], "…")
	}
	return strings.Join(parts, ", ")
}

// issueGroups: counts per type, severity, column.
func issueGroups(issues []DataQualityIssue) []AssistantIssueGroup {
	type key struct{ t, s, f string }
	idx := map[key]int{}
	var out []AssistantIssueGroup
	rows := map[key][]int{}
	capped := map[key]int{}
	for _, i := range issues {
		f := ""
		if i.Field != nil {
			f = *i.Field
		}
		k := key{i.IssueType, i.Severity, f}
		at, ok := idx[k]
		if !ok {
			g := AssistantIssueGroup{IssueType: i.IssueType, Severity: i.Severity}
			if f != "" {
				ff := truncateRunes(f, maxSourceColumn)
				g.Field = &ff
			}
			out = append(out, g)
			at = len(out) - 1
			idx[k] = at
		}
		if m := cappedSummary.FindStringSubmatch(i.Message); m != nil && i.RowNumber == nil {
			n, _ := strconv.Atoi(m[1])
			capped[k] = n
			continue
		}
		out[at].Count++
		if i.RowNumber != nil {
			rows[k] = append(rows[k], *i.RowNumber)
		}
		if out[at].example == "" {
			out[at].example = maskMessage(i.Message)
		}
	}
	for k, at := range idx {
		if n := capped[k]; n > out[at].Count {
			out[at].Count = n
		}
		out[at].Rows = rowRanges(rows[k])
	}
	sort.SliceStable(out, func(a, b int) bool {
		if bySeverityOrder[out[a].Severity] != bySeverityOrder[out[b].Severity] {
			return bySeverityOrder[out[a].Severity] < bySeverityOrder[out[b].Severity]
		}
		return out[a].Count > out[b].Count
	})
	if len(out) > maxIssueGroups {
		out = out[:maxIssueGroups]
	}
	return out
}

// issueFacts: what the model sees; no values.
func issueFacts(job ImportJob, mapping *ImportMapping, groups []AssistantIssueGroup, locale string) map[string]any {
	gs := make([]map[string]any, 0, len(groups))
	for _, g := range groups {
		m := map[string]any{"issue": tr(issueTypeLabels[g.IssueType], locale), "severity": tr(severityLabels[g.Severity], locale),
			"rows_affected": g.Count, "example_message_values_masked": g.example}
		if g.Field != nil {
			m["column"] = *g.Field
		}
		if g.Rows != "" {
			m["listed_rows"] = g.Rows
		}
		gs = append(gs, m)
	}
	limits := map[string]any{"latitude_range": []int{-90, 90}, "longitude_range": []int{-180, 180}, "far_from_sub_zone_km": farFromSubZoneKm,
		"max_arrival_hours": maxArrivalHours, "max_closing_days": maxClosingDays}
	if mapping != nil && mapping.ServiceArea != nil {
		limits["service_area"] = map[string]any{"latitude": mapping.ServiceArea.Latitude, "longitude": mapping.ServiceArea.Longitude}
	}
	return map[string]any{
		"checks": limits, "mapping": job.MappingVersion, "data_rows": job.RowCount, "errors": job.ErrorCount, "warnings": job.WarningCount,
		"notes": max(job.IssueCount-job.ErrorCount-job.WarningCount, 0), "groups": gs,
		"rules_in_force": []string{"rows with an error are not imported", "duplicate case ids: the first row without errors is imported", "rows with only warnings are imported unchanged"},
	}
}

const issuesSystem = "You help an administrator at Customer (Saudi Arabia) understand the data-quality issues found in one uploaded extract of motor accident cases. " +
	"Use only the JSON facts given. Quote only numbers that appear in the facts, exactly as written there; never add up, calculate or estimate a number. " +
	"Copy issue labels, column names and row ranges verbatim. Values were masked as # or …: never guess them and never write # or … yourself; name the column instead. " +
	"Answer with one JSON object and nothing else: {\"summary\":\"2 to 4 plain sentences\",\"fixes\":[\"at most 6 short fixes for the data owner, each naming the column and rows\"]," +
	"\"owner_note\":\"a short polite note to the data owner listing what to correct in the extract\",\"cleaning_rules\":[\"at most 5 short draft cleaning rules for the mapping notes, written as conditions and actions\"]}. " +
	"Where a pattern suggests a cause (for example coordinates far from their sub-zone: latitude and longitude may be swapped) say so as a possibility. " +
	"Write numbers with Western digits (0-9). " + plainRule + " Write everything in %s."

// issueAnswer: the parsed, capped answer.
type issueAnswer struct {
	Summary, OwnerNote string
	Fixes, Rules       []string
}

func helpList(v any) []string {
	list, _ := v.([]any)
	out := []string{}
	for _, item := range list {
		if s, ok := item.(string); ok {
			if s = strings.TrimSpace(strings.TrimPrefix(plainText(s), "- ")); s != "" && len(out) < maxHelpItems {
				out = append(out, truncateRunes(scrub(s), 300))
			}
		}
	}
	return out
}

// parseIssueAnswer: the model's JSON, shape only.
func parseIssueAnswer(text string) (issueAnswer, bool) {
	obj, ok := extractJSON(text)
	if !ok {
		return issueAnswer{}, false
	}
	summary, _ := obj["summary"].(string)
	note, _ := obj["owner_note"].(string)
	a := issueAnswer{Summary: truncateRunes(scrub(plainText(summary)), 2000), OwnerNote: truncateRunes(scrub(plainText(note)), 2000),
		Fixes: helpList(obj["fixes"]), Rules: helpList(obj["cleaning_rules"])}
	return a, a.Summary != ""
}

// all: every text of the answer, for the guard.
func (a issueAnswer) all() string {
	return strings.Join(append(append([]string{a.Summary, a.OwnerNote}, a.Fixes...), a.Rules...), "\n")
}

var issueFallbackText = map[string][2]string{
	"lead": {"Summary of the issues (the assistant's answer could not be checked, so it is not shown).", "ملخّص المشكلات (تعذّر التحقق من إجابة المساعد، لذا لم تُعرض)."},
	"line": {"%s (%s), %s: %d rows%s.", "%s (%s)، %s: %d صفوف%s."},
	"rows": {"; rows %s", "؛ الصفوف %s"},
	"any":  {"any column", "أي عمود"},
}

// issuesFallback: plain lines from the groups.
func issuesFallback(groups []AssistantIssueGroup, locale string) string {
	lines := []string{tr(issueFallbackText["lead"], locale)}
	for _, g := range groups {
		col := tr(issueFallbackText["any"], locale)
		if g.Field != nil {
			col = *g.Field
		}
		rows := ""
		if g.Rows != "" {
			rows = fmt.Sprintf(tr(issueFallbackText["rows"], locale), g.Rows)
		}
		lines = append(lines, fmt.Sprintf(tr(issueFallbackText["line"], locale), tr(issueTypeLabels[g.IssueType], locale), tr(severityLabels[g.Severity], locale), col, g.Count, rows))
	}
	return strings.Join(lines, "\n")
}

// readImportIssues: the job and all its issues.
var readImportIssues = func(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (ImportJob, []DataQualityIssue, error) {
	job, err := importJobFor(ctx, conn, rc, id)
	if err != nil {
		return ImportJob{}, nil, err
	}
	issues, err := issuesOf(ctx, conn, rc.CustomerID, &id)
	return job, issues, err
}

// ExplainImportIssuesWithAssistant: read only.
func ExplainImportIssuesWithAssistant(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (AssistantImportIssues, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminDataImportQuality, access.AccessView); err != nil {
		_ = auditAssistant(rc, "assistant.import_issues", "denied", "Issue explanation refused.", nil)
		return AssistantImportIssues{}, err
	}
	o, err := datactx.Object(body, "Import help request", []string{"import_id", "locale"})
	if err != nil {
		return AssistantImportIssues{}, err
	}
	id, _ := o["import_id"].(string)
	if _, err := importutil.RequireID(id, "Import job"); err != nil {
		return AssistantImportIssues{}, err
	}
	locale := localeOf(o)
	job, issues, err := readImportIssues(ctx, conn, rc, id)
	if err != nil {
		return AssistantImportIssues{}, err
	}
	if len(issues) == 0 {
		return AssistantImportIssues{}, dataerr.Conflict("This import has no issues to explain.")
	}
	p, err := activeProvider()
	if err != nil {
		return AssistantImportIssues{}, err
	}
	groups := issueGroups(issues)
	mapping, err := mappingFor(ctx, conn, rc.CustomerID, job.MappingVersion)
	if err != nil {
		return AssistantImportIssues{}, err
	}
	facts := issueFacts(job, mapping, groups, locale)
	sentBytes, err := json.Marshal(facts)
	if err != nil {
		return AssistantImportIssues{}, err
	}
	sent := string(sentBytes)
	allowed := allowedNumbers(facts)
	started := time.Now()
	req := assistant.Request{
		System:    fmt.Sprintf(issuesSystem, explainLanguage(locale)),
		Messages:  []assistant.Message{{Role: "user", Text: "Explain these issues.\nFacts: " + sent}},
		MaxTokens: 2048,
	}
	detail := map[string]any{"import_id": id, "locale": locale, "provider": p.Name(), "model": p.Model(), "sent_chars": len(sent), "groups": len(groups)}
	reply, callErr := p.Complete(ctx, req)
	if callErr != nil {
		return AssistantImportIssues{}, failAssistant(rc, "assistant.import_issues", "Issue explanation: the assistant did not answer.", p, started, detail, callErr)
	}
	path := explainPathChecked
	answer, ok := parseIssueAnswer(reply.Text)
	bad := []string{"(not JSON)"}
	if ok {
		bad = unknownNumbers(answer.all(), allowed)
	}
	detail["first_unverified"] = bad
	if len(bad) > 0 {
		path = explainPathRetried
		note := "Your answer was not the JSON object asked for. Answer again with the JSON object only."
		if ok {
			note = retryNote(bad) + " Keep the same JSON shape."
		}
		req.Messages = append(req.Messages, assistant.Message{Role: "assistant", Text: reply.Text}, assistant.Message{Role: "user", Text: note})
		again, againErr := p.Complete(ctx, req)
		bad = []string{"(no answer)"}
		if againErr == nil {
			if answer, ok = parseIssueAnswer(again.Text); ok {
				bad = unknownNumbers(answer.all(), allowed)
			}
		}
		detail["retry_unverified"] = bad
	}
	fallback := len(bad) > 0
	if fallback {
		path = explainPathFallback
		text := issuesFallback(groups, locale)
		answer = issueAnswer{Summary: text, OwnerNote: text, Fixes: []string{}, Rules: []string{}}
	}
	meta := metaOf(p, started)
	meta.DataSource = job.DataSource
	detail["duration_ms"], detail["answer_path"] = meta.DurationMs, path
	if aerr := auditAssistant(rc, "assistant.import_issues", "success", fmt.Sprintf("Issues of import %s explained (%s).", job.FileName, path), detail); aerr != nil {
		return AssistantImportIssues{}, aerr
	}
	return AssistantImportIssues{ImportID: id, Text: answer.Summary, Fixes: answer.Fixes, OwnerNote: answer.OwnerNote, CleaningRules: answer.Rules,
		Groups: groups, Fallback: fallback, Sent: sent, AssistantMeta: meta}, nil
}
