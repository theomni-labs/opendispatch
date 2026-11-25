// SPDX-License-Identifier: AGPL-3.0-only

// Alerts digest: the caller's unread alerts.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// AssistantAlertGroup: unread alerts of one kind.
type AssistantAlertGroup struct {
	Category string `json:"category"`
	Severity string `json:"severity"`
	Count    int    `json:"count"`
	LatestAt string `json:"latest_at"`
}

// AssistantAlertsDigest: the digest answer.
type AssistantAlertsDigest struct {
	Unread     int                   `json:"unread"`
	Groups     []AssistantAlertGroup `json:"groups"`
	Text       string                `json:"text"`
	AnswerPath string                `json:"answer_path"`
	Sent       string                `json:"sent"`
	AssistantMeta
}

var severityRank = map[string]int{"critical": 0, "warning": 1, "info": 2}

// unreadNotifications: every page, unread only.
func unreadNotifications(rc reqctx.RequestContext) ([]Notification, error) {
	var out []Notification
	cursor := ""
	for {
		page, err := ListMyNotifications(rc, NotificationQuery{Limit: datactx.MaxLimit, Cursor: cursor, UnreadOnly: true})
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

// alertGroups: by kind, worst first.
func alertGroups(rows []Notification) []AssistantAlertGroup {
	byKey := map[string]*AssistantAlertGroup{}
	for _, n := range rows {
		k := n.Category + "|" + n.Severity
		g, ok := byKey[k]
		if !ok {
			g = &AssistantAlertGroup{Category: n.Category, Severity: n.Severity}
			byKey[k] = g
		}
		g.Count++
		if n.CreatedAt > g.LatestAt {
			g.LatestAt = n.CreatedAt
		}
	}
	out := make([]AssistantAlertGroup, 0, len(byKey))
	for _, g := range byKey {
		out = append(out, *g)
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if severityRank[a.Severity] != severityRank[b.Severity] {
			return severityRank[a.Severity] < severityRank[b.Severity]
		}
		if a.Count != b.Count {
			return a.Count > b.Count
		}
		return a.Category < b.Category
	})
	return out
}

// hmOf: "HH:MM" in Riyadh time.
func hmOf(iso string) string {
	t, err := datactx.EpochOf(iso)
	if err != nil {
		return ""
	}
	return t.In(riyadhZone).Format("15:04")
}

// alertFacts: labelled groups, never titles.
func alertFacts(groups []AssistantAlertGroup, locale string) map[string]any {
	total, bySev := 0, map[string]int{}
	items := make([]map[string]any, 0, len(groups))
	for _, g := range groups {
		total += g.Count
		bySev[g.Severity] += g.Count
		items = append(items, map[string]any{
			"category": labelOr(alertCategoryLabels, g.Category, locale), "severity": labelOr(alertSeverityLabels, g.Severity, locale),
			"count": g.Count, "latest_at": hmOf(g.LatestAt),
		})
	}
	sev := map[string]any{}
	for _, s := range []string{"critical", "warning", "info"} {
		sev[labelOr(alertSeverityLabels, s, locale)] = bySev[s]
	}
	return map[string]any{"label": tr(handoverLabels["alerts"], locale), "unread": total, "by_severity": sev, "groups": items}
}

const digestSystem = "You summarise a dispatcher's unread in-app alerts in OpenDispatch, the customer's accident demand planning system (Saudi Arabia). " +
	"Use only the JSON facts given: alert groups with a category, a severity, a count and the time of the latest one. " +
	"Quote only numbers that appear in the facts, exactly as written there; never add, subtract or count anything yourself. " +
	"Use category and severity labels exactly as given, never translated or rephrased. Critical first, then warnings, then info. " +
	"You do not know what each alert says, only its kind: never invent details, people, places or causes. " +
	"Write 2 to 4 short sentences, plain language, Western digits (0-9). " + plainRule + " Answer in %s."

// digestLanguage: the language line, with terms.
func digestLanguage(locale string) string {
	if locale == "ar" {
		return "Arabic. In Arabic say تنبيه and تنبيهات for alerts, never بلاغ"
	}
	return "English"
}

// digestFallback: plain lines from the groups.
func digestFallback(facts map[string]any, locale string) string {
	lines := []string{fmt.Sprintf(tr([2]string{"%s: %v.", "%s: %v."}, locale), factStr(facts, "label"), facts["unread"])}
	groups, _ := facts["groups"].([]map[string]any)
	for _, g := range groups {
		lines = append(lines, fmt.Sprintf("- %s, %s: %v (%s)", g["category"], g["severity"], g["count"], g["latest_at"]))
	}
	return strings.Join(lines, "\n")
}

// SummariseMyAlerts: the digest, numbers checked.
func SummariseMyAlerts(ctx context.Context, _ *tenancy.Connection, rc reqctx.RequestContext, body any) (AssistantAlertsDigest, error) {
	o, err := datactx.Object(body, "Alerts digest request", []string{"locale"})
	if err != nil {
		return AssistantAlertsDigest{}, err
	}
	locale := localeOf(o)
	rows, err := unreadNotifications(rc)
	if err != nil {
		_ = auditAssistant(rc, "assistant.alerts_digest", outcomeOf(err), "Alerts digest refused.", map[string]any{"locale": locale})
		return AssistantAlertsDigest{}, err
	}
	p, err := activeProvider()
	if err != nil {
		return AssistantAlertsDigest{}, err
	}
	groups := alertGroups(rows)
	started := time.Now()
	out := AssistantAlertsDigest{Unread: len(rows), Groups: groups, AnswerPath: explainPathChecked}
	detail := map[string]any{"locale": locale, "provider": p.Name(), "model": p.Model(), "unread": len(rows), "groups": len(groups)}
	if len(rows) == 0 {
		out.AssistantMeta = metaOf(p, started)
		detail["duration_ms"], detail["answer_path"] = out.DurationMs, "no_unread"
		if aerr := auditAssistant(rc, "assistant.alerts_digest", "success", "Alerts digest: nothing unread.", detail); aerr != nil {
			return AssistantAlertsDigest{}, aerr
		}
		return out, nil
	}
	facts := alertFacts(groups, locale)
	sentBytes, err := json.Marshal(facts)
	if err != nil {
		return AssistantAlertsDigest{}, err
	}
	out.Sent = string(sentBytes)
	detail["sent_chars"] = len(out.Sent)
	req := assistant.Request{
		System:    fmt.Sprintf(digestSystem, digestLanguage(locale)),
		Messages:  []assistant.Message{{Role: "user", Text: "Summarise these unread alerts.\nFacts: " + out.Sent}},
		MaxTokens: 512,
	}
	g, callErr := guardedAnswer(ctx, p, req, allowedNumbers(facts), func() string { return digestFallback(facts, locale) })
	if callErr != nil {
		err := providerFailure(callErr)
		detail["duration_ms"], detail["error"] = metaOf(p, started).DurationMs, err.Error()
		if aerr := auditAssistant(rc, "assistant.alerts_digest", "failure", "Alerts digest: the assistant did not answer.", detail); aerr != nil {
			return AssistantAlertsDigest{}, aerr
		}
		return AssistantAlertsDigest{}, err
	}
	out.AssistantMeta = metaOf(p, started)
	out.Text, out.AnswerPath = truncateRunes(g.Text, 1200), g.Path
	detail["duration_ms"], detail["answer_path"], detail["first_unverified"] = out.DurationMs, g.Path, g.FirstBad
	if g.Retried {
		detail["retry_unverified"] = g.RetryBad
	}
	if aerr := auditAssistant(rc, "assistant.alerts_digest", "success", "Alerts digest ("+g.Path+").", detail); aerr != nil {
		return AssistantAlertsDigest{}, aerr
	}
	return out, nil
}
