// SPDX-License-Identifier: AGPL-3.0-only

// AI assistant layer, shared parts.
package business

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

const (
	assistantMaxText  = 500
	assistantMaxCalls = 5
	assistantEntity   = "assistant"
)

// Explain targets: the screens with Explain this.
const (
	ExplainForecastExplorer = "forecast_explorer"
	ExplainGapSurplus       = "gap_surplus"
)

// AssistantFeatures: what this role may use.
type AssistantFeatures struct {
	RuleDraft bool     `json:"rule_draft"`
	Explain   []string `json:"explain"`
	Ask       bool     `json:"ask"`
	// import help on Data Import and Quality
	ImportMapping bool `json:"import_mapping"`
	ImportIssues  bool `json:"import_issues"`
	// Optional in the contract
	EventNotice   bool `json:"event_notice"`
	ScenarioDraft bool `json:"scenario_draft"`
	// CaseSuggestion: board or queue view
	CaseSuggestion bool `json:"case_suggestion"`
	// ClassifierReview: view on Classification Rules
	ClassifierReview bool `json:"classifier_review"`
	Handover         bool `json:"handover"`
	// AlertsDigest: any signed-in role
	AlertsDigest bool `json:"alerts_digest"`
}

// AssistantStatus: GET /assistant/status.
type AssistantStatus struct {
	assistant.Status
	Features AssistantFeatures `json:"features"`
}

// AssistantMeta: who answered, on every answer.
type AssistantMeta struct {
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	DurationMs   int64  `json:"duration_ms"`
	Suggestion   bool   `json:"suggestion"`
	Illustrative bool   `json:"illustrative"`
	DataSource   string `json:"data_source"`
}

func canView(rc reqctx.RequestContext, m access.ModuleID) bool {
	return access.CanAccess(rc.Role, m, rc.InstallMode, access.AccessView)
}

func featuresFor(rc reqctx.RequestContext) AssistantFeatures {
	f := AssistantFeatures{Explain: []string{}}
	f.RuleDraft = access.CanAccess(rc.Role, access.ModuleAdminClassificationRules, rc.InstallMode, access.AccessEdit)
	if canView(rc, access.ModuleOpsForecastExplorer) {
		f.Explain = append(f.Explain, ExplainForecastExplorer)
	}
	if canView(rc, access.ModuleOpsGapSurplus) {
		f.Explain = append(f.Explain, ExplainGapSurplus)
	}
	f.Ask = len(askModules(rc)) > 0
	f.ImportMapping = access.CanAccess(rc.Role, access.ModuleAdminDataImportQuality, rc.InstallMode, access.AccessEdit)
	f.ImportIssues = canView(rc, access.ModuleAdminDataImportQuality)
	f.EventNotice = access.CanAccess(rc.Role, access.ModuleAdminLeavePolicyCalendar, rc.InstallMode, access.AccessEdit)
	f.ScenarioDraft = access.CanAccess(rc.Role, access.ModuleOpsScenarioLab, rc.InstallMode, access.AccessEdit)
	f.CaseSuggestion = canSuggestCases(rc)
	f.ClassifierReview = canView(rc, moduleClassificationRules)
	f.Handover = canView(rc, access.ModuleOpsLiveDispatchBoard)
	f.AlertsDigest = true
	return f
}

// GetAssistantStatus: provider, model, features.
func GetAssistantStatus(rc reqctx.RequestContext) (AssistantStatus, error) {
	if rc.UserID == "" || !access.IsRole(string(rc.Role)) {
		return AssistantStatus{}, dataerr.Unauthenticated("")
	}
	_, st := assistant.Active()
	return AssistantStatus{Status: st, Features: featuresFor(rc)}, nil
}

// activeProvider: the provider, or ASSISTANT_OFF.
func activeProvider() (assistant.Provider, error) {
	p, st := assistant.Active()
	if p == nil {
		msg := "The assistant is not configured."
		if st.Reason != "" {
			msg += " " + st.Reason
		}
		return nil, dataerr.Conflict(msg).WithReason(dataerr.ReasonAssistantOff)
	}
	return p, nil
}

func providerFailure(err error) error {
	var pe *assistant.ProviderError
	if errors.As(err, &pe) {
		return dataerr.Conflict(pe.Msg).WithReason(dataerr.ReasonAssistantUnavailable)
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return dataerr.Conflict("The assistant took too long to answer.").WithReason(dataerr.ReasonAssistantUnavailable)
	}
	return dataerr.Conflict("The assistant could not answer.").WithReason(dataerr.ReasonAssistantUnavailable)
}

func metaOf(p assistant.Provider, started time.Time) AssistantMeta {
	return AssistantMeta{Provider: p.Name(), Model: p.Model(), DurationMs: time.Since(started).Milliseconds(), Suggestion: true, Illustrative: true, DataSource: "SYNTHETIC"}
}

// auditAssistant: one audit event; fails closed.
func auditAssistant(rc reqctx.RequestContext, action, outcome, summary string, detail map[string]any) error {
	_, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: action, EntityType: assistantEntity, SummaryEn: summary, Detail: detail, Outcome: outcome}, "", "")
	return err
}

func outcomeOf(err error) string {
	if err == nil {
		return "success"
	}
	var de *dataerr.DataError
	if errors.As(err, &de) && de.Code == dataerr.CodeForbidden {
		return "denied"
	}
	return "failure"
}

// localeOf: en or ar, never anything else.
func localeOf(o datactx.Obj) string {
	if s, _ := o["locale"].(string); s == "ar" {
		return "ar"
	}
	return "en"
}

// requireText: trimmed, 1 to 500 characters.
func requireText(o datactx.Obj, key string) (string, error) {
	s, _ := o[key].(string)
	s = strings.TrimSpace(s)
	if s == "" {
		return "", dataerr.Invalid(key + " is required.")
	}
	if utf8.RuneCountInString(s) > assistantMaxText {
		return "", dataerr.Invalid(key + " must have at most 500 characters.")
	}
	return s, nil
}

var (
	emailInText = regexp.MustCompile(`[^\s@]+@[^\s@]+\.[^\s@]+`)
	digitsRun   = regexp.MustCompile(`[+]?[0-9\x{0660}-\x{0669}][0-9\x{0660}-\x{0669} -]{6,}[0-9\x{0660}-\x{0669}]`)
)

// scrub: masks emails and long digit runs.
func scrub(s string) string {
	s = emailInText.ReplaceAllString(s, "[removed]")
	return digitsRun.ReplaceAllString(s, "[removed]")
}

func languageName(locale string) string {
	if locale == "ar" {
		return "Arabic"
	}
	return "English"
}

// extractJSON: the one JSON object in a reply.
func extractJSON(text string) (map[string]any, bool) {
	s := strings.TrimSpace(text)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(strings.TrimSpace(s), "```")
	start, end := strings.Index(s, "{"), strings.LastIndex(s, "}")
	if start < 0 || end <= start {
		return nil, false
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(s[start:end+1]), &out); err != nil {
		return nil, false
	}
	return out, true
}
