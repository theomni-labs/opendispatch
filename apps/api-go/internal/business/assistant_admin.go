// SPDX-License-Identifier: AGPL-3.0-only

// Admin AI Assistant: overview and test (Admin 18).
package business

import (
	"context"
	"errors"
	"math"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

const (
	moduleAIAssistant    = access.ModuleAdminAIAssistant
	assistantWindowDays  = 7
	assistantFastMs      = 10_000
	assistantTestTimeout = 30 * time.Second
)

// Feature order of the usage table.
var assistantFeatures = []string{"rule_draft", "explain", "ask", "tool_call"}

// assistantNow: the clock; tests replace it.
var assistantNow = time.Now

// AssistantUsageRow: one feature's last 7 days.
type AssistantUsageRow struct {
	Feature   string `json:"feature"`
	Calls     int    `json:"calls"`
	Successes int    `json:"successes"`
	Failures  int    `json:"failures"`
	Denied    int    `json:"denied"`
	Rejected  *int   `json:"rejected"`
	Retried   *int   `json:"retried"`
	Fallbacks *int   `json:"fallbacks"`
	MedianMs  *int64 `json:"median_ms"`
	P90Ms     *int64 `json:"p90_ms"`
}

// AssistantTotals: requests only, no lookups.
type AssistantTotals struct {
	Calls     int `json:"calls"`
	Successes int `json:"successes"`
	Within10s int `json:"within_10s"`
}

// AssistantLastTest: the latest assistant.test.
type AssistantLastTest struct {
	OK         bool    `json:"ok"`
	DurationMs int64   `json:"duration_ms"`
	ErrorCode  *string `json:"error_code"`
	TestedAt   string  `json:"tested_at"`
}

// AssistantOverview: GET /assistant/overview.
type AssistantOverview struct {
	Status     string              `json:"status"`
	Provider   string              `json:"provider"`
	Model      string              `json:"model"`
	Offline    bool                `json:"offline"`
	Key        string              `json:"key"`
	SetIn      string              `json:"set_in"`
	WindowDays int                 `json:"window_days"`
	Totals     AssistantTotals     `json:"totals"`
	Usage      []AssistantUsageRow `json:"usage"`
	LastTest   *AssistantLastTest  `json:"last_test"`
	DataSource string              `json:"data_source"`
}

// AssistantTestResult: POST /assistant/test.
type AssistantTestResult struct {
	OK         bool    `json:"ok"`
	Provider   string  `json:"provider"`
	Model      string  `json:"model"`
	DurationMs int64   `json:"duration_ms"`
	ErrorCode  *string `json:"error_code"`
	TestedAt   string  `json:"tested_at"`
}

// assistantState: status and key, never the key.
func assistantState(st assistant.Status) (status, key string) {
	switch {
	case st.Provider == assistant.ProviderOff:
		status = "off"
	case st.Configured:
		status = "on"
	default:
		status = "not_configured"
	}
	key = "not_needed"
	if st.Provider == assistant.ProviderOpenAI {
		switch {
		case !st.Configured:
			key = "not_configured"
		case strings.TrimSpace(os.Getenv("OPENDISPATCH_ASSISTANT_API_KEY")) != "":
			key = "configured"
		}
	}
	return status, key
}

// GetAssistantOverview: status, config and usage.
func GetAssistantOverview(rc reqctx.RequestContext) (AssistantOverview, error) {
	if err := reqctx.RequireAccess(rc, moduleAIAssistant, access.AccessView); err != nil {
		return AssistantOverview{}, err
	}
	_, st := assistant.Active()
	status, key := assistantState(st)
	events, err := tenantEvents(rc)
	if err != nil {
		return AssistantOverview{}, err
	}
	since := assistantNow().Add(-assistantWindowDays * 24 * time.Hour)
	var recent []auditlog.AuditEvent
	for _, e := range events {
		if !strings.HasPrefix(e.Action, "assistant.") {
			continue
		}
		at, err := datactx.EpochOf(e.OccurredAt)
		if err != nil || at.Before(since) {
			continue
		}
		recent = append(recent, e)
	}
	usage, totals := assistantUsage(recent)
	return AssistantOverview{
		Status: status, Provider: st.Provider, Model: st.Model, Offline: st.Provider != assistant.ProviderOpenAI,
		Key: key, SetIn: "server_environment", WindowDays: assistantWindowDays,
		Totals: totals, Usage: usage, LastTest: lastAssistantTest(recent), DataSource: "SYNTHETIC",
	}, nil
}

// assistantUsage: rows per feature and totals.
func assistantUsage(events []auditlog.AuditEvent) ([]AssistantUsageRow, AssistantTotals) {
	rows := map[string]*AssistantUsageRow{}
	durations := map[string][]int64{}
	var totals AssistantTotals
	for _, e := range events {
		feature := strings.TrimPrefix(e.Action, "assistant.")
		if feature == "test" {
			continue
		}
		row := rows[feature]
		if row == nil {
			row = &AssistantUsageRow{Feature: feature}
			switch feature {
			case "rule_draft":
				row.Rejected = new(int)
			case "explain":
				row.Retried, row.Fallbacks = new(int), new(int)
			}
			rows[feature] = row
		}
		row.Calls++
		ms, hasMs := detailInt(e.Detail, "duration_ms")
		switch e.Outcome {
		case "success":
			row.Successes++
		case "denied":
			row.Denied++
		case "rejected":
			if row.Rejected != nil {
				*row.Rejected++
			} else {
				row.Failures++
			}
		default:
			row.Failures++
		}
		if feature == "explain" && e.Outcome == "success" {
			switch e.Detail["answer_path"] {
			case explainPathRetried:
				*row.Retried++
			case explainPathFallback:
				*row.Retried++
				*row.Fallbacks++
			}
		}
		if hasMs && e.Outcome != "denied" {
			durations[feature] = append(durations[feature], ms)
		}
		if feature != "tool_call" {
			totals.Calls++
			if e.Outcome == "success" {
				totals.Successes++
				if hasMs && ms <= assistantFastMs {
					totals.Within10s++
				}
			}
		}
	}
	usage := []AssistantUsageRow{}
	for _, f := range assistantFeatures {
		row := rows[f]
		if row == nil {
			continue
		}
		row.MedianMs, row.P90Ms = percentile(durations[f], 0.5), percentile(durations[f], 0.9)
		usage = append(usage, *row)
	}
	return usage, totals
}

// percentile: nearest rank; nil when empty.
func percentile(xs []int64, p float64) *int64 {
	if len(xs) == 0 {
		return nil
	}
	s := append([]int64(nil), xs...)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	i := int(math.Ceil(p*float64(len(s)))) - 1
	if i < 0 {
		i = 0
	}
	v := s[i]
	return &v
}

// detailInt: a number from JSON or memory.
func detailInt(d map[string]any, key string) (int64, bool) {
	switch v := d[key].(type) {
	case int64:
		return v, true
	case int:
		return int64(v), true
	case float64:
		return int64(v), true
	}
	return 0, false
}

// lastAssistantTest: events are newest first.
func lastAssistantTest(events []auditlog.AuditEvent) *AssistantLastTest {
	for _, e := range events {
		if e.Action != "assistant.test" || e.Outcome == "denied" {
			continue
		}
		ms, _ := detailInt(e.Detail, "duration_ms")
		out := &AssistantLastTest{OK: e.Outcome == "success", DurationMs: ms, TestedAt: e.OccurredAt}
		if code, ok := e.Detail["error_code"].(string); ok && code != "" {
			out.ErrorCode = &code
		}
		return out
	}
	return nil
}

// TestAssistantConnection: one tiny call, audited.
func TestAssistantConnection(ctx context.Context, rc reqctx.RequestContext) (AssistantTestResult, error) {
	if err := reqctx.RequireAccess(rc, moduleAIAssistant, access.AccessEdit); err != nil {
		_ = auditAssistant(rc, "assistant.test", "denied", "Assistant test refused: role.", nil)
		return AssistantTestResult{}, err
	}
	p, st := assistant.Active()
	res := AssistantTestResult{Provider: st.Provider, Model: st.Model}
	code := ""
	if p == nil {
		code = "off"
		if st.Provider != assistant.ProviderOff {
			code = "not_configured"
		}
	} else {
		cctx, cancel := context.WithTimeout(ctx, assistantTestTimeout)
		started := time.Now()
		reply, err := p.Complete(cctx, assistant.Request{
			System:    "Reply with the single word OK.",
			Messages:  []assistant.Message{{Role: "user", Text: "Connection test."}},
			MaxTokens: 16,
		})
		cancel()
		res.DurationMs = time.Since(started).Milliseconds()
		code = testErrorCode(err, reply.Text)
	}
	res.OK = code == ""
	detail := map[string]any{"provider": res.Provider, "model": res.Model, "duration_ms": res.DurationMs}
	outcome, summary := "success", "Assistant connection test passed."
	if !res.OK {
		res.ErrorCode = &code
		detail["error_code"] = code
		outcome, summary = "failure", "Assistant connection test failed: "+code+"."
	}
	ev, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: "assistant.test", EntityType: assistantEntity, SummaryEn: summary, Detail: detail, Outcome: outcome}, "", "")
	if err != nil {
		return AssistantTestResult{}, err
	}
	res.TestedAt = ev.OccurredAt
	return res, nil
}

// testErrorCode: a code only, never the message.
func testErrorCode(err error, text string) string {
	switch {
	case err == nil && strings.TrimSpace(text) == "":
		return "empty_answer"
	case err == nil:
		return ""
	case errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled):
		return "timeout"
	default:
		return "provider_error"
	}
}
