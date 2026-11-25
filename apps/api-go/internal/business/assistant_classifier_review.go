// SPDX-License-Identifier: AGPL-3.0-only

// Classifier review: AI suggestions vs the rules.
package business

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	classifierRunMax  = 25
	classifierScanMax = 400
)

// ClassifierReviewItem mirrors the contract type.
type ClassifierReviewItem struct {
	CaseID           string                      `json:"case_id"`
	CaseNumber       string                      `json:"case_number"`
	ZoneID           string                      `json:"zone_id"`
	RegisteredAt     string                      `json:"registered_at"`
	Suggestion       AssistantCaseClassification `json:"suggestion"`
	Rule             AssistantRuleView           `json:"rule"`
	AgreesWithRules  bool                        `json:"agrees_with_rules"`
	RecordedSeverity *string                     `json:"recorded_severity"`
	Provider         string                      `json:"provider"`
	Model            string                      `json:"model"`
	Review           *AssistantCaseReview        `json:"review"`
	DataSource       string                      `json:"data_source"`
}

// ClassifierReview mirrors the contract type.
type ClassifierReview struct {
	From           string                 `json:"from"`
	To             string                 `json:"to"`
	CasesCompared  int                    `json:"cases_compared"`
	HandlingAgreed int                    `json:"handling_agreed"`
	SeverityAgreed int                    `json:"severity_agreed"`
	Disagreements  int                    `json:"disagreements"`
	Reviewed       int                    `json:"reviewed"`
	Items          []ClassifierReviewItem `json:"items"`
	Page           *datactx.PageInfo      `json:"page,omitempty"`
	Illustrative   bool                   `json:"illustrative"`
	DataSource     string                 `json:"data_source"`
}

// ClassifierReviewQuery: getClassifierReview's query.
type ClassifierReviewQuery struct {
	Days   int
	Only   string
	Limit  int
	Cursor string
}

// ClassifierRun mirrors the contract type.
type ClassifierRun struct {
	AssistantMeta
	Requested     int     `json:"requested"`
	Classified    int     `json:"classified"`
	Failed        int     `json:"failed"`
	StoppedReason *string `json:"stopped_reason"`
}

func reviewItemOf(c Case, s AssistantCaseSuggestion) ClassifierReviewItem {
	return ClassifierReviewItem{CaseID: c.ID, CaseNumber: c.CaseNumber, ZoneID: c.ZoneID, RegisteredAt: c.RegisteredAt,
		Suggestion: s.Suggestion, Rule: s.Rule, AgreesWithRules: s.AgreesWithRules, RecordedSeverity: c.Severity,
		Provider: s.Provider, Model: s.Model, Review: s.Review, DataSource: c.DataSource}
}

// GetClassifierReview: agreement over recent days.
func GetClassifierReview(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, q ClassifierReviewQuery) (ClassifierReview, error) {
	if err := reqctx.RequireAccess(rc, moduleClassificationRules, access.AccessView); err != nil {
		return ClassifierReview{}, err
	}
	days := q.Days
	if days == 0 {
		days = 7
	}
	if days < 1 || days > 31 {
		return ClassifierReview{}, dataerr.Invalid("days must be 1 to 31.")
	}
	only := q.Only
	if only == "" {
		only = "disagreements"
	}
	if only != "all" && only != "disagreements" {
		return ClassifierReview{}, dataerr.Invalid("only must be all or disagreements.")
	}
	to := time.Now()
	from := to.Add(-time.Duration(days) * 24 * time.Hour)
	rows, err := casesWhere(ctx, conn, rc.CustomerID, ` WHERE extra ? 'ai_suggestion' AND (extra->'ai_suggestion'->>'suggested_at')::timestamptz >= $1 ORDER BY registered_at DESC, id`, from)
	if err != nil {
		return ClassifierReview{}, err
	}
	out := ClassifierReview{From: datactx.ToRiyadhISO(from), To: datactx.ToRiyadhISO(to), Illustrative: true, DataSource: "SYNTHETIC", Items: []ClassifierReviewItem{}}
	sources := map[string]bool{}
	var items []ClassifierReviewItem
	for _, c := range rows {
		zid := c.ZoneID
		s := storedSuggestion(c)
		if s == nil || !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		sources[c.DataSource] = true
		out.CasesCompared++
		if s.AgreesWithRules {
			out.HandlingAgreed++
		} else {
			out.Disagreements++
		}
		if c.Severity != nil && *c.Severity == s.Suggestion.Severity {
			out.SeverityAgreed++
		}
		if s.Review != nil {
			out.Reviewed++
		}
		if only == "all" || !s.AgreesWithRules {
			items = append(items, reviewItemOf(c, *s))
		}
	}
	if len(sources) == 1 {
		for k := range sources {
			out.DataSource = k
		}
	}
	page, err := datactx.Paginate(items, datactx.PageQuery{Limit: q.Limit, Cursor: q.Cursor})
	if err != nil {
		return ClassifierReview{}, err
	}
	if page.Items != nil {
		out.Items = page.Items
	}
	info := page.Page
	out.Page = &info
	return out, nil
}

// recentUnsuggested: newest readable cases to read.
func recentUnsuggested(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, n int) ([]Case, error) {
	rows, err := casesWhere(ctx, conn, rc.CustomerID, fmt.Sprintf(` WHERE NOT (extra ? 'ai_suggestion') AND registered_at <= $1 ORDER BY registered_at DESC, id LIMIT %d`, classifierScanMax), time.Now())
	if err != nil {
		return nil, err
	}
	var out []Case
	for _, c := range rows {
		zid := c.ZoneID
		if !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		if en, ar := caseNarrative(c); en == nil && ar == nil {
			continue
		}
		out = append(out, c)
		if len(out) == n {
			break
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].RegisteredAt > out[j].RegisteredAt })
	return out, nil
}

// RunClassifierReview: classify recent cases, in turn.
func RunClassifierReview(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (ClassifierRun, error) {
	if err := reqctx.RequireAccess(rc, moduleClassificationRules, access.AccessEdit); err != nil {
		_ = auditAssistant(rc, "assistant.classifier_run", "denied", "Classifier run refused: role.", nil)
		return ClassifierRun{}, err
	}
	o, err := datactx.Object(body, "Classifier run request", []string{"count", "locale"})
	if err != nil {
		return ClassifierRun{}, err
	}
	n, ok := o["count"].(float64)
	if !ok || n != float64(int(n)) || n < 1 || n > classifierRunMax {
		return ClassifierRun{}, dataerr.Invalid("count must be a whole number from 1 to 25.")
	}
	locale := localeOf(o)
	p, err := activeProvider()
	if err != nil {
		return ClassifierRun{}, err
	}
	cases, err := recentUnsuggested(ctx, conn, rc, int(n))
	if err != nil {
		return ClassifierRun{}, err
	}
	classifier, err := newLiveClassifier(ctx, rc.CustomerID)
	if err != nil {
		return ClassifierRun{}, err
	}
	started := time.Now()
	run := ClassifierRun{Requested: int(n)}
	guard := func() error { return reqctx.RequireAccess(rc, moduleClassificationRules, access.AccessEdit) }
	for _, c := range cases {
		_, err := suggestForCase(ctx, conn, rc, p, c, classifier, locale, guard)
		if err == nil {
			run.Classified++
			continue
		}
		var de *dataerr.DataError
		if de, ok = err.(*dataerr.DataError); ok && de.Reason == dataerr.ReasonAssistantInvalid {
			run.Failed++
			continue
		}
		msg := shortText(err.Error(), 200)
		run.StoppedReason = &msg
		break
	}
	run.AssistantMeta = metaOf(p, started)
	detail := map[string]any{"provider": p.Name(), "model": p.Model(), "duration_ms": run.DurationMs, "locale": locale,
		"requested": run.Requested, "classified": run.Classified, "failed": run.Failed, "stopped": run.StoppedReason != nil}
	if aerr := auditAssistant(rc, "assistant.classifier_run", outcomeOfRun(run), fmt.Sprintf("Classifier run: %d of %d cases classified (handling unchanged).", run.Classified, run.Requested), detail); aerr != nil {
		return ClassifierRun{}, aerr
	}
	return run, nil
}

func outcomeOfRun(r ClassifierRun) string {
	if r.StoppedReason != nil {
		return "failure"
	}
	return "success"
}
