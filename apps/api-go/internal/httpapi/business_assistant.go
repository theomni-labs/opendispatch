// SPDX-License-Identifier: AGPL-3.0-only

// AI assistant routes (proposal: assistant-contract.md).
package httpapi

import (
	"net/http"
	"strconv"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterAssistantRoutes: assistant, admin, imports.
func RegisterAssistantRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /assistant/status", forecastGet(conn, func(_ *http.Request, rc reqctx.RequestContext) (business.AssistantStatus, error) {
		return business.GetAssistantStatus(rc)
	}))
	mux.HandleFunc("POST /assistant/rule-draft", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.AssistantRuleDraft, error) {
		return business.DraftRuleWithAssistant(r.Context(), conn, rc, body)
	}))
	mux.HandleFunc("POST /assistant/explain", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.AssistantExplanation, error) {
		return business.ExplainWithAssistant(r.Context(), conn, rc, body)
	}))
	mux.HandleFunc("POST /assistant/event-notice", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.AssistantEventNoticeDraft, error) {
		return business.ReadEventNoticeWithAssistant(r.Context(), conn, rc, body)
	}))
	mux.HandleFunc("POST /assistant/scenario-draft", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.AssistantScenarioDraft, error) {
		return business.DraftScenarioWithAssistant(r.Context(), conn, rc, body)
	}))
	mux.HandleFunc("POST /assistant/ask", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.AssistantAnswer, error) {
		return business.AskWithAssistant(r.Context(), conn, rc, body)
	}))
	mux.HandleFunc("GET /assistant/overview", forecastGet(conn, func(_ *http.Request, rc reqctx.RequestContext) (business.AssistantOverview, error) {
		return business.GetAssistantOverview(rc)
	}))
	// No body: the test takes no input
	mux.HandleFunc("POST /assistant/test", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (business.AssistantTestResult, error) {
		return business.TestAssistantConnection(r.Context(), rc)
	}))
	mux.HandleFunc("POST /assistant/import-mapping", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.AssistantMappingSuggestion, error) {
		return business.SuggestImportMappingWithAssistant(r.Context(), conn, rc, body)
	}))
	mux.HandleFunc("POST /assistant/import-issues", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.AssistantImportIssues, error) {
		return business.ExplainImportIssuesWithAssistant(r.Context(), conn, rc, body)
	}))
	mux.HandleFunc("POST /assistant/handover", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.AssistantHandover, error) {
		return business.SummariseShiftHandover(r.Context(), conn, rc, body)
	}))
	mux.HandleFunc("POST /assistant/alerts-digest", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.AssistantAlertsDigest, error) {
		return business.SummariseMyAlerts(r.Context(), conn, rc, body)
	}))
	registerCaseSuggestionRoutes(mux, conn)
}

// registerCaseSuggestionRoutes: classify cases.
func registerCaseSuggestionRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /assistant/case-suggestions/{id}", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (business.AssistantCaseView, error) {
		return business.GetCaseSuggestion(r.Context(), conn, rc, r.PathValue("id"), r.URL.Query().Get("from"))
	}))
	mux.HandleFunc("POST /assistant/case-suggestions/{id}", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.AssistantCaseSuggestion, error) {
		return business.SuggestCaseClassification(r.Context(), conn, rc, r.PathValue("id"), body)
	}))
	mux.HandleFunc("POST /assistant/case-suggestions/{id}/review", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.AssistantCaseSuggestion, error) {
		return business.ReviewCaseSuggestion(r.Context(), conn, rc, r.PathValue("id"), body)
	}))
	mux.HandleFunc("GET /assistant/classifier-review", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (business.ClassifierReview, error) {
		q := r.URL.Query()
		days := 0
		if s := q.Get("days"); s != "" {
			n, err := strconv.Atoi(s)
			if err != nil {
				n = -1
			}
			days = n
		}
		p := pageQueryOf(r)
		return business.GetClassifierReview(r.Context(), conn, rc, business.ClassifierReviewQuery{Days: days, Only: q.Get("only"), Limit: p.Limit, Cursor: p.Cursor})
	}))
	mux.HandleFunc("POST /assistant/classifier-review/run", forecastWrite(conn, http.StatusOK, func(r *http.Request, rc reqctx.RequestContext, body any) (business.ClassifierRun, error) {
		return business.RunClassifierReview(r.Context(), conn, rc, body)
	}))
}
