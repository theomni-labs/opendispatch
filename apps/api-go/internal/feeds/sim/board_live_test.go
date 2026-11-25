// SPDX-License-Identifier: AGPL-3.0-only

// Live: the Live Dispatch Board driven from the feed tables.
package sim_test

import (
	"context"
	"errors"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds/sim"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

func supervisor(zones ...string) reqctx.RequestContext {
	rc := reqctx.RequestContext{CustomerID: tenant, UserID: "6c6f8c78-c511-44e5-8ecb-1077b8da8eea", Role: access.RoleDispatchSupervisor, InstallMode: access.InstallPrivate,
		ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}}
	if len(zones) > 0 {
		rc.ZoneScope = access.ZoneScope{Kind: access.ScopeAssignedZones, ZoneIDs: zones}
	}
	return rc
}

func allLiveCases(t *testing.T, rc reqctx.RequestContext, state string) []business.LiveCase {
	t.Helper()
	var out []business.LiveCase
	cursor := ""
	for {
		page, err := business.ListLiveCases(rc, business.LiveCaseQuery{Limit: 200, Cursor: cursor, State: state})
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, page.Items...)
		if page.Page.NextCursor == nil || *page.Page.NextCursor == "" {
			return out
		}
		cursor = *page.Page.NextCursor
	}
}

func TestTheBoardReadsTheFeeds(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	day, err := sim.LoadDay(filepath.Join("..", "..", "..", "..", "..", "fixtures"))
	if err != nil {
		t.Fatal(err)
	}
	day.ShiftToEnd(time.Now().Add(-time.Minute))
	business.UseFeedsDispatch(r.store.Conn, 48*time.Hour)
	t.Cleanup(business.UseReplayDispatch)

	if _, err := r.sender.Replay(ctx, "/feeds/v1/cases", sim.Raw(day.Cases), sim.Options{BatchSize: 200}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := r.sender.Replay(ctx, "/feeds/v1/agent-status", sim.Raw(day.Statuses), sim.Options{BatchSize: 200}, nil); err != nil {
		t.Fatal(err)
	}
	r.drainAll(t)

	rc := supervisor()
	board, err := business.GetLiveBoard(rc, business.LiveBoardQuery{Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if board.Replay.TotalCases != day.Cases759 || board.Replay.DeliveredCases != day.Cases759 || board.Replay.Status != "playing" {
		t.Fatalf("the board counts %d/%d cases (%s), want %d", board.Replay.DeliveredCases, board.Replay.TotalCases, board.Replay.Status, day.Cases759)
	}
	cases := allLiveCases(t, rc, "")
	if len(cases) != day.Cases759 {
		t.Fatalf("the board lists %d cases, want %d", len(cases), day.Cases759)
	}
	var reco *business.LiveCase
	for i := range cases {
		c := cases[i]
		if c.State == "" || c.Stage == "" || c.DataSource != "SYNTHETIC" {
			t.Fatalf("a case without state, stage or data source: %+v", c)
		}
		if c.Recommendation != nil && reco == nil {
			reco = &cases[i]
		}
	}
	if reco == nil {
		t.Fatal("no case has a recommendation")
	}
	out, err := business.GetCaseRecommendation(rc, reco.CaseID)
	if err != nil {
		t.Fatal(err)
	}
	if !out.Illustrative || out.ModelVersion != "nearest-baseline-0.1" || out.Status != "ranked" || len(out.Ranking) == 0 {
		t.Fatalf("the placeholder ranking must say it is one: %+v", out)
	}
	for i := 1; i < len(out.Ranking); i++ {
		if out.Ranking[i].EstimatedTravelSeconds < out.Ranking[i-1].EstimatedTravelSeconds {
			t.Fatal("the ranking is not nearest first")
		}
	}

	// Zone scope: a person scoped to one zone sees only that zone's cases.
	zone := cases[0].ZoneID
	scoped := allLiveCases(t, supervisor(zone), "")
	if len(scoped) == 0 || len(scoped) >= len(cases) {
		t.Fatalf("a one-zone view has %d of %d cases", len(scoped), len(cases))
	}
	for _, c := range scoped {
		if c.ZoneID != zone {
			t.Fatalf("a case of zone %s in the view of zone %s", c.ZoneID, zone)
		}
	}

	// Agents: one row each, at the newest status the feed gave.
	newest := map[string]string{}
	at := map[string]time.Time{}
	for _, e := range day.Statuses {
		if !e.OccurredAt.Before(at[e.AgentCode]) {
			at[e.AgentCode], newest[e.AgentCode] = e.OccurredAt, e.Status
		}
	}
	statuses, err := business.ListAgentStatuses(ctx, r.store.Conn, rc, business.AgentStatusQuery{Limit: 200})
	if err != nil {
		t.Fatal(err)
	}
	if len(statuses.Items) == 0 {
		t.Fatal("no agent on the board")
	}
	var history *business.AgentStatus
	for i, s := range statuses.Items {
		if s.Latitude == 0 || s.PositionAt == "" || s.ZoneID == nil {
			t.Fatalf("a status without a position or zone: %+v", s)
		}
		if i == 0 {
			history = &statuses.Items[i]
		}
	}
	positions, err := business.ListAgentPositions(ctx, r.store.Conn, rc, history.AgentID, business.AgentPositionQuery{Limit: 200, From: time.Now().Add(-72 * time.Hour).Format(time.RFC3339)})
	if err != nil {
		t.Fatal(err)
	}
	if len(positions.Items) == 0 {
		t.Fatal("no position history for an agent on the board")
	}

	// The demo's replay controls are off while the board is live.
	_, err = business.ControlReplay(rc, map[string]any{"action": "play"})
	var de *dataerr.DataError
	if !errors.As(err, &de) {
		t.Fatalf("replay control must be refused with a data error: %v", err)
	}
}

func TestADispatcherAcceptsTheRecommendationForAFedCase(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	business.UseFeedsDispatch(r.store.Conn, 24*time.Hour)
	t.Cleanup(business.UseReplayDispatch)
	t.Cleanup(business.ResetDispatchAssignmentsForTest)

	var zoneID string
	if err := r.owner.QueryRow(ctx, `SELECT id::text FROM zones WHERE tenant_id = $1 AND external_id = '2001'`, tenant).Scan(&zoneID); err != nil {
		t.Fatal(err)
	}
	var agentID string
	if err := r.owner.QueryRow(ctx, `SELECT id::text FROM agents WHERE tenant_id = $1 AND code = 'SVR-RD-C-001'`, tenant).Scan(&agentID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	lat, lon := 24.7136, 46.6753
	post := func(path, body string) {
		if resp := r.post(t, path, []byte(body), nil); resp.StatusCode != 202 {
			t.Fatalf("%s answered %d", path, resp.StatusCode)
		}
	}
	post("/feeds/v1/agent-status", `{"events":[{"idempotency_key":"board-s1","occurred_at":"`+now.Add(-2*time.Minute).Format(time.RFC3339)+`","agent_code":"SVR-RD-C-001","status":"available","latitude":24.7140,"longitude":46.6750}]}`)
	registered := now.Add(-time.Minute).Format(time.RFC3339)
	post("/feeds/v1/cases", `{"events":[{"idempotency_key":"board-c1","occurred_at":"`+registered+`","case":{"external_id":"http-board-1","case_number":"T-BOARD-1","registered_at":"`+registered+`","updated_at":"`+registered+`","zone_external_id":"2001","case_type_external_id":"1","latitude":`+fmtF(lat)+`,"longitude":`+fmtF(lon)+`,"handling":"field"}}]}`)
	r.drainAll(t)

	admin := reqctx.RequestContext{CustomerID: tenant, UserID: "00000000-0000-4000-8000-000000000002", Role: access.RoleAdministrator, InstallMode: access.InstallPrivate, ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}}
	if _, err := business.SetZoneStage(admin, zoneID, map[string]any{"stage": "recommend", "reason": "board test"}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = business.SetZoneStage(admin, zoneID, map[string]any{"stage": "shadow", "reason": "board test over"})
	})

	rc := supervisor()
	recommended := allLiveCases(t, rc, "recommended")
	var mine *business.LiveCase
	for i := range recommended {
		if recommended[i].CaseNumber == "T-BOARD-1" {
			mine = &recommended[i]
		}
	}
	if mine == nil || mine.Recommendation == nil || mine.Recommendation.AgentID != agentID {
		t.Fatalf("the new case should wait for a decision with the placed agent recommended: %+v", mine)
	}
	if _, err := business.AcceptRecommendation(rc, mine.CaseID, map[string]any{"agent_id": agentID}); err != nil {
		t.Fatal(err)
	}
	assigned := allLiveCases(t, rc, "assigned")
	ok := false
	for _, c := range assigned {
		if c.CaseID == mine.CaseID && c.AssignmentSource != nil && *c.AssignmentSource == "OPENDISPATCH" && c.AssignedAgentID != nil && *c.AssignedAgentID == agentID {
			ok = true
		}
	}
	if !ok {
		t.Fatal("the accepted case is not shown as assigned by OpenDispatch to that agent")
	}
	// Rule 19: nothing is sent twice for one case.
	if _, err := business.AcceptRecommendation(rc, mine.CaseID, map[string]any{"agent_id": agentID}); err == nil || !strings.Contains(err.Error(), "ALREADY_ASSIGNED") {
		t.Fatalf("a second accept must be refused as already assigned: %v", err)
	}
}

func TestACaseCustomerAssignedIsCustomersAtEveryStage(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	business.UseFeedsDispatch(r.store.Conn, 24*time.Hour)
	t.Cleanup(business.UseReplayDispatch)
	t.Cleanup(business.ResetDispatchAssignmentsForTest)

	var zoneID, customerID, otherID string
	if err := r.owner.QueryRow(ctx, `SELECT id::text FROM zones WHERE tenant_id = $1 AND external_id = '2001'`, tenant).Scan(&zoneID); err != nil {
		t.Fatal(err)
	}
	if err := r.owner.QueryRow(ctx, `SELECT id::text FROM agents WHERE tenant_id = $1 AND code = 'SVR-RD-C-002'`, tenant).Scan(&customerID); err != nil {
		t.Fatal(err)
	}
	if err := r.owner.QueryRow(ctx, `SELECT id::text FROM agents WHERE tenant_id = $1 AND code = 'SVR-RD-C-001'`, tenant).Scan(&otherID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	post := func(path, body string) {
		if resp := r.post(t, path, []byte(body), nil); resp.StatusCode != 202 {
			t.Fatalf("%s answered %d", path, resp.StatusCode)
		}
	}
	post("/feeds/v1/agent-status", `{"events":[{"idempotency_key":"customer-s1","occurred_at":"`+now.Add(-2*time.Minute).Format(time.RFC3339)+`","agent_code":"SVR-RD-C-001","status":"available","latitude":24.7140,"longitude":46.6750}]}`)
	registered, assigned := now.Add(-2*time.Minute).Format(time.RFC3339), now.Add(-time.Minute).Format(time.RFC3339)
	post("/feeds/v1/cases", `{"events":[{"idempotency_key":"customer-c1","occurred_at":"`+assigned+`","case":{"external_id":"http-customer-1","case_number":"T-CUSTOMER-1","registered_at":"`+registered+`","updated_at":"`+assigned+`","assigned_at":"`+assigned+`","agent_code":"SVR-RD-C-002","zone_external_id":"2001","case_type_external_id":"1","latitude":24.7136,"longitude":46.6753,"handling":"field"}}]}`)
	r.drainAll(t)

	admin := reqctx.RequestContext{CustomerID: tenant, UserID: "00000000-0000-4000-8000-000000000002", Role: access.RoleAdministrator, InstallMode: access.InstallPrivate, ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}}
	t.Cleanup(func() {
		_, _ = business.SetZoneStage(admin, zoneID, map[string]any{"stage": "shadow", "reason": "customer test over"})
	})
	rc := supervisor()
	find := func() business.LiveCase {
		for _, c := range allLiveCases(t, rc, "") {
			if c.CaseNumber == "T-CUSTOMER-1" {
				return c
			}
		}
		t.Fatal("the fed case is not on the board")
		return business.LiveCase{}
	}
	for _, stage := range []string{"recommend", "automatic"} {
		if _, err := business.SetZoneStage(admin, zoneID, map[string]any{"stage": stage, "reason": "customer test"}); err != nil {
			t.Fatal(err)
		}
		c := find()
		if c.State != "fallback_assigned" || c.AssignmentSource == nil || *c.AssignmentSource != "CUSTOMER_FALLBACK" || c.AssignedAgentID == nil || *c.AssignedAgentID != customerID {
			t.Fatalf("%s: got %+v, want the customer's agent with source CUSTOMER_FALLBACK", stage, c)
		}
		// Rule 19: no OpenDispatch assignment for a case the customer assigned.
		if _, err := business.AcceptRecommendation(rc, c.CaseID, map[string]any{"agent_id": otherID}); err == nil || !strings.Contains(err.Error(), "CUSTOMER_ASSIGNED") {
			t.Fatalf("%s: an accept must be refused as Customer-assigned: %v", stage, err)
		}
	}
}

func TestASilentCaseFeedMakesOpenDispatchSignalFallback(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	business.UseFeedsDispatch(r.store.Conn, 24*time.Hour)
	t.Cleanup(business.UseReplayDispatch)
	business.ResetDispatchHealthForTest()
	business.FeedStateSource = func(ctx context.Context, tenantID string) ([]business.FeedState, error) {
		h, err := r.store.Health(ctx, tenantID)
		out := make([]business.FeedState, len(h))
		for i, x := range h {
			out[i] = business.FeedState{Feed: x.Feed, LastReceived: x.LastReceived, LastApplied: x.LastApplied}
		}
		return out, err
	}
	t.Cleanup(func() { business.FeedStateSource = nil })

	now := time.Now().UTC().Truncate(time.Second).Format(time.RFC3339)
	if resp := r.post(t, "/feeds/v1/cases", []byte(`{"events":[{"idempotency_key":"silent-c1","occurred_at":"`+now+`","case":{"external_id":"http-silent-1","case_number":"T-SILENT-1","registered_at":"`+now+`","updated_at":"`+now+`","zone_external_id":"2001","case_type_external_id":"1","latitude":24.7136,"longitude":46.6753,"handling":"field"}}]}`), nil); resp.StatusCode != 202 {
		t.Fatalf("cases answered %d", resp.StatusCode)
	}
	r.drainAll(t)
	var zoneID string
	if err := r.owner.QueryRow(ctx, `SELECT id::text FROM zones WHERE tenant_id = $1 AND external_id = '2001'`, tenant).Scan(&zoneID); err != nil {
		t.Fatal(err)
	}
	admin := reqctx.RequestContext{CustomerID: tenant, UserID: "00000000-0000-4000-8000-000000000002", Role: access.RoleAdministrator, InstallMode: access.InstallPrivate, ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}}
	if _, err := business.SetZoneStage(admin, zoneID, map[string]any{"stage": "recommend", "reason": "silence test"}); err != nil {
		t.Fatal(err)
	}
	if _, err := business.UpdateLiveAssignmentSettings(admin, map[string]any{"dispatch_fallback_after_silence_seconds": 5.0}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = business.SendFallbackSignal(admin, map[string]any{"signal": "resume", "reason": "silence test over"})
		_, _ = business.SetZoneStage(admin, zoneID, map[string]any{"stage": "shadow", "reason": "silence test over"})
		_, _ = business.UpdateLiveAssignmentSettings(admin, map[string]any{"dispatch_fallback_after_silence_seconds": 120.0})
	})
	if early, _ := business.CheckDispatchFallback(ctx, tenant); early != "" {
		t.Fatalf("sent %q while the feeds are fresh", early)
	}
	time.Sleep(6 * time.Second)

	sent, err := business.CheckDispatchFallback(ctx, tenant)
	if err != nil || sent != "fallback" {
		t.Fatalf("a silent case feed must send the fallback signal: %q %v", sent, err)
	}
	state, err := business.GetFallbackState(supervisor())
	if err != nil || state.State != "active" || state.Reason != "feed_outage" || state.OpenDispatchHealthy {
		t.Fatalf("got %+v %v, want active fallback for the silent feed", state, err)
	}
	if again, _ := business.CheckDispatchFallback(ctx, tenant); again != "" {
		t.Fatalf("a second check sent %q, want nothing while fallback is active", again)
	}
}

func fmtF(f float64) string { return strconv.FormatFloat(f, 'f', 6, 64) }
