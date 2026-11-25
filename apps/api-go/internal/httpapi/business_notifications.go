// SPDX-License-Identifier: AGPL-3.0-only

// Own notifications, rules, log, quiet hours and the
// approvals inbox. Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterApprovalsRoutes: the approvals inbox.
func RegisterApprovalsRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /approvals", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListApprovals(r.Context(), conn, rc, business.ApprovalQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), Status: q.Get("status"), SubjectType: q.Get("subject_type"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}

// RegisterNotificationsRoutes: own alerts, rules, log, raise.
func RegisterNotificationsRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	page := func(r *http.Request) datactx.PageQuery {
		q := r.URL.Query()
		return datactx.PageQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")}
	}
	handle := func(method, pattern string, withBody bool, run func(r *http.Request, rc reqctx.RequestContext, body any) (any, error)) {
		mux.HandleFunc(method+" "+pattern, func(w http.ResponseWriter, r *http.Request) {
			rc, ok := requireContext(w, r, conn)
			if !ok {
				return
			}
			var body any
			if withBody {
				if body, ok = decodeAnyBody(w, r); !ok {
					return
				}
			}
			result, err := run(r, rc, body)
			if err != nil {
				writeBusinessError(w, err)
				return
			}
			if result == nil {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			writeJSON(w, http.StatusOK, result)
		})
	}
	handle("GET", "/notifications", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		p := page(r)
		return business.ListMyNotifications(rc, business.NotificationQuery{Limit: p.Limit, Cursor: p.Cursor, UnreadOnly: r.URL.Query().Get("unread_only") == "true"})
	})
	// Not in the contract: the AppShell bell count.
	handle("GET", "/notifications/unread-count", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		n, err := business.CountUnreadNotifications(rc)
		return map[string]int{"count": n}, err
	})
	handle("GET", "/notifications/log", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		q, p := r.URL.Query(), page(r)
		return business.ListNotificationLog(rc, business.NotificationLogFilter{Limit: p.Limit, Cursor: p.Cursor, From: q.Get("from"), To: q.Get("to"), Category: q.Get("category"), Severity: q.Get("severity")})
	})
	handle("POST", "/notifications/read-all", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return nil, business.MarkAllNotificationsRead(rc)
	})
	handle("POST", "/notifications/{id}/read", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.MarkNotificationRead(rc, r.PathValue("id"))
	})
	handle("GET", "/notification-rules", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.ListNotificationRules(rc, page(r))
	})
	handle("PUT", "/notification-rules/{id}", true, func(r *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.UpdateNotificationRule(rc, r.PathValue("id"), body)
	})
	handle("POST", "/notification-rules/{id}/test", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.SendTestNotification(rc, r.PathValue("id"))
	})
	handle("GET", "/notification-quiet-hours", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetQuietHours(rc)
	})
	handle("PUT", "/notification-quiet-hours", true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.UpdateQuietHours(rc, body)
	})
	handle("POST", "/demo/reset", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.ResetDemoData(rc)
	})
	// Not in the contract: TS-side raisers (sign-in, updates).
	handle("POST", "/notify", true, func(_ *http.Request, rc reqctx.RequestContext, raw any) (any, error) {
		body, _ := raw.(map[string]any)
		str := func(k string) *string {
			if v, ok := body[k].(string); ok && v != "" {
				return &v
			}
			return nil
		}
		eventType, title, role := str("event_type"), str("title_en"), str("recipient_role")
		if title == nil || (eventType == nil) == (role == nil) {
			return nil, dataerr.Invalid("title_en and one of event_type or recipient_role are required.")
		}
		content := business.RaisedNotification{TitleEn: *title, BodyEn: str("body_en"), LinkPath: str("link_path")}
		if role != nil {
			category, severity := str("category"), str("severity")
			if category == nil || severity == nil {
				return nil, dataerr.Invalid("category and severity are required.")
			}
			n, err := business.NotifyRoleExternal(rc, *role, *category, *severity, content)
			return []business.Notification{n}, err
		}
		pre, _ := body["pre_session"].(bool)
		made, err := business.RaiseExternal(rc, pre, *eventType, content)
		if made == nil {
			made = []business.Notification{}
		}
		return made, err
	})
}
