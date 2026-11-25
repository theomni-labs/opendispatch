// SPDX-License-Identifier: AGPL-3.0-only

// ops.live_dispatch_board HTTP routes.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterDispatchRoutes: board, agents, assignments, replay, fallback.
func RegisterDispatchRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	type reader func(ctx context.Context, r *http.Request, rc reqctx.RequestContext) (any, error)
	type writer func(ctx context.Context, r *http.Request, rc reqctx.RequestContext, body any) (any, error)
	get := func(pattern string, run reader) {
		mux.HandleFunc("GET "+pattern, func(w http.ResponseWriter, r *http.Request) {
			rc, ok := requireContext(w, r, conn)
			if !ok {
				return
			}
			result, err := run(r.Context(), r, rc)
			if err != nil {
				writeBusinessError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, result)
		})
	}
	send := func(method, pattern string, run writer) {
		mux.HandleFunc(method+" "+pattern, func(w http.ResponseWriter, r *http.Request) {
			rc, ok := requireContext(w, r, conn)
			if !ok {
				return
			}
			// Any JSON: shape checked after the guard.
			var body any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeJSONError(w, http.StatusBadRequest, "The request body is not valid JSON.")
				return
			}
			result, err := run(r.Context(), r, rc, body)
			if err != nil {
				writeBusinessError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, result)
		})
	}
	page := func(r *http.Request) datactx.PageQuery {
		q := r.URL.Query()
		return datactx.PageQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")}
	}
	shadowQuery := func(r *http.Request) business.ShadowComparisonQuery {
		q := r.URL.Query()
		p := page(r)
		return business.ShadowComparisonQuery{Limit: p.Limit, Cursor: p.Cursor, ZoneID: q.Get("zone_id"), From: q.Get("from"), To: q.Get("to")}
	}

	get("/live/board", func(_ context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		p := page(r)
		return business.GetLiveBoard(rc, business.LiveBoardQuery{Limit: p.Limit, Cursor: p.Cursor, ZoneID: r.URL.Query().Get("zone_id")})
	})
	get("/live/cases", func(_ context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		p, q := page(r), r.URL.Query()
		return business.ListLiveCases(rc, business.LiveCaseQuery{Limit: p.Limit, Cursor: p.Cursor, ZoneID: q.Get("zone_id"), State: q.Get("state")})
	})
	get("/live/cases/{id}/recommendation", func(_ context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.GetCaseRecommendation(rc, r.PathValue("id"))
	})
	send("POST", "/live/cases/{id}/accept", func(_ context.Context, r *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.AcceptRecommendation(rc, r.PathValue("id"), b)
	})
	send("POST", "/live/cases/{id}/override", func(ctx context.Context, r *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.OverrideAssignment(ctx, conn, rc, r.PathValue("id"), b)
	})
	get("/live/agents", func(ctx context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		p, q := page(r), r.URL.Query()
		return business.ListAgentStatuses(ctx, conn, rc, business.AgentStatusQuery{Limit: p.Limit, Cursor: p.Cursor, ZoneID: q.Get("zone_id"), Status: q.Get("status")})
	})
	get("/live/agents/{id}/positions", func(ctx context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		p, q := page(r), r.URL.Query()
		return business.ListAgentPositions(ctx, conn, rc, r.PathValue("id"), business.AgentPositionQuery{Limit: p.Limit, Cursor: p.Cursor, From: q.Get("from"), To: q.Get("to")})
	})
	get("/live/waiting-spots", func(ctx context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.ListWaitingSpots(ctx, conn, rc, r.URL.Query().Get("zone_id"))
	})
	get("/live/stages", func(_ context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.ListZoneStages(rc, page(r))
	})
	get("/live/fallback", func(_ context.Context, _ *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.GetFallbackState(rc)
	})
	send("POST", "/live/fallback/signal", func(_ context.Context, _ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.SendFallbackSignal(rc, b)
	})
	get("/live/shadow-comparisons", func(_ context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.ListShadowComparisons(rc, shadowQuery(r))
	})
	get("/live/shadow-comparisons/summary", func(_ context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.GetShadowComparisonSummary(rc, shadowQuery(r))
	})
	get("/live/unmet-demand", func(_ context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		p, q := page(r), r.URL.Query()
		return business.ListUnmetDemand(rc, business.UnmetDemandQuery{Limit: p.Limit, Cursor: p.Cursor, ZoneID: q.Get("zone_id"), Date: q.Get("date"), Cause: q.Get("cause")})
	})
	get("/live/replay", func(_ context.Context, _ *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.GetReplayState(rc)
	})
	send("POST", "/live/replay", func(_ context.Context, _ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.ControlReplay(rc, b)
	})
	send("POST", "/live/replay/outage", func(_ context.Context, _ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.SimulateBoardFeedOutage(rc, b)
	})
	send("PUT", "/settings/maintenance-mode", func(_ context.Context, _ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.SetMaintenanceMode(rc, b)
	})
	get("/assignments", func(ctx context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		p, q := page(r), r.URL.Query()
		return business.ListAssignments(ctx, conn, rc, business.AssignmentQuery{
			Limit: p.Limit, Cursor: p.Cursor, ZoneID: q.Get("zone_id"), From: q.Get("from"), To: q.Get("to"),
			CaseID: q.Get("case_id"), AgentID: q.Get("agent_id"), Source: q.Get("source"),
		})
	})
	get("/assignments/{id}", func(ctx context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.GetAssignment(ctx, conn, rc, r.PathValue("id"))
	})
	get("/assignments/{id}/events", func(ctx context.Context, r *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.ListAssignmentEvents(ctx, conn, rc, r.PathValue("id"), page(r))
	})
}
