// SPDX-License-Identifier: AGPL-3.0-only

// Live Postgres: suggestions never change a case.
package business

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// caseRowSnapshot: every column but extra.ai_suggestion.
func caseRowSnapshot(t *testing.T, ctx context.Context, conn *tenancy.Connection, tenant, id string) map[string]any {
	t.Helper()
	out, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (map[string]any, error) {
		var raw []byte
		if err := tx.QueryRow(ctx, `SELECT to_jsonb(c) - 'extra' || jsonb_build_object('extra', c.extra - 'ai_suggestion') FROM cases c WHERE id=$1`, id).Scan(&raw); err != nil {
			return nil, err
		}
		var m map[string]any
		return m, json.Unmarshal(raw, &m)
	})
	check(t, err)
	return out
}

func TestCaseSuggestionIsReadOnlyForTheCase(t *testing.T) {
	conn := openConn(t)
	admin, tenant := adminCtx(t)
	ctx := context.Background()
	fx := seedCaseFixture(t, ctx, conn, admin)
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `UPDATE cases SET severity='minor', injury_present=false, parties_involved=2, assigned_at='2026-09-14T10:03:00+03:00',
			extra='{"damage_assessment_method":"video","location_type":"urban","classification":{"outcome":"field_preferred","source":"rules"}}' WHERE id=$1`, fx.case1ID)
		return struct{}{}, err
	})
	check(t, err)
	before := caseRowSnapshot(t, ctx, conn, tenant, fx.case1ID)

	f := &fakeProvider{replies: []assistant.Reply{textReply(`{"handling":"remote","severity":"minor","injury_present":false,"damage_assessment_method":"video","confidence":0.9,"reason":"Light damage, no injury.","quote":"video call"}`)}}
	setupAssistant(t, f)
	dispatcher := reqctx.RequestContext{CustomerID: tenant, UserID: admin.UserID, Role: access.RoleDispatcher, ZoneScope: admin.ZoneScope, InstallMode: admin.InstallMode}
	s, err := SuggestCaseClassification(ctx, conn, dispatcher, fx.case1ID, map[string]any{"from": CaseScreenBoard, "locale": "en"})
	check(t, err)
	if s.Suggestion.Handling != "remote_inferred" || s.Rule.Handling != "field" || s.AgreesWithRules || s.Suggestion.InjuryPresent {
		t.Fatalf("suggestion %+v", s)
	}
	if after := caseRowSnapshot(t, ctx, conn, tenant, fx.case1ID); !reflect.DeepEqual(before, after) {
		t.Fatalf("the case changed:\nbefore %v\nafter  %v", before, after)
	}
	view, err := GetCaseSuggestion(ctx, conn, dispatcher, fx.case1ID, CaseScreenBoard)
	check(t, err)
	if view.Suggestion == nil || view.Suggestion.SuggestedAt != s.SuggestedAt || len(view.Photos) != 0 {
		t.Fatalf("view %+v", view)
	}
	if len(eventsWith("assistant.case_suggestion")) != 1 {
		t.Fatal("suggestion not audited")
	}

	// a viewer may not review; a dispatcher may
	viewer := dispatcher
	viewer.Role = access.RoleViewerAuditor
	if _, err := ReviewCaseSuggestion(ctx, conn, viewer, fx.case1ID, map[string]any{"from": CaseScreenBoard, "decision": "accepted", "suggested_at": s.SuggestedAt}); err == nil {
		t.Fatal("viewer reviewed")
	}
	if _, err := ReviewCaseSuggestion(ctx, conn, dispatcher, fx.case1ID, map[string]any{"from": CaseScreenBoard, "decision": "accepted", "suggested_at": "2000-01-01T00:00:00+03:00"}); err == nil {
		t.Fatal("stale review accepted")
	}
	r, err := ReviewCaseSuggestion(ctx, conn, dispatcher, fx.case1ID, map[string]any{"from": CaseScreenBoard, "decision": "accepted", "suggested_at": s.SuggestedAt})
	check(t, err)
	if r.Review == nil || r.Review.Decision != "accepted" {
		t.Fatalf("review %+v", r.Review)
	}
	if after := caseRowSnapshot(t, ctx, conn, tenant, fx.case1ID); !reflect.DeepEqual(before, after) {
		t.Fatalf("accepting changed the case:\nbefore %v\nafter  %v", before, after)
	}
	if len(eventsWith("assistant.case_review")) < 1 {
		t.Fatal("review not audited")
	}

	review, err := GetClassifierReview(ctx, conn, admin, ClassifierReviewQuery{Only: "all"})
	check(t, err)
	if review.CasesCompared != 1 || review.Disagreements != 1 || review.Reviewed != 1 || review.SeverityAgreed != 1 || len(review.Items) != 1 || !review.Illustrative {
		t.Fatalf("review %+v", review)
	}
}

func TestCaseSuggestionRespectsZoneScope(t *testing.T) {
	conn := openConn(t)
	admin, tenant := adminCtx(t)
	ctx := context.Background()
	fx := seedCaseFixture(t, ctx, conn, admin)
	setupAssistant(t, &fakeProvider{})
	outside := plannerCtx(tenant, admin.UserID, []string{"00000000-0000-4000-8000-000000000001"})
	if _, err := GetCaseSuggestion(ctx, conn, outside, fx.case1ID, CaseScreenQueue); err == nil {
		t.Fatal("a case outside the zones was read")
	}
}
