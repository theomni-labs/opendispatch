// SPDX-License-Identifier: AGPL-3.0-only

// Update Manager (private installs). Matches
// openapi.yaml /updates/*; calls internal/business.
package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterUpdatesRoutes: the 36 update operations.
func RegisterUpdatesRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	handle := func(method, pattern string, withBody bool, run func(r *http.Request, rc reqctx.RequestContext, body any) (any, error)) {
		mux.HandleFunc(method+" /updates"+pattern, func(w http.ResponseWriter, r *http.Request) {
			rc, ok := requireContext(w, r, conn)
			if !ok {
				return
			}
			var body any
			if withBody {
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					writeJSONError(w, http.StatusBadRequest, "The request body is not valid JSON.")
					return
				}
			}
			result, err := run(r, rc, body)
			if err != nil {
				writeBusinessError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, result)
		})
	}
	version := func(r *http.Request) string { return r.PathValue("release_version") }
	optional := func(s string) *string {
		if s == "" {
			return nil
		}
		return &s
	}

	handle("GET", "/summary", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetUpdatesSummary(rc)
	})
	handle("GET", "/status", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetUpdateStatus(rc)
	})
	handle("GET", "/releases", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		q := r.URL.Query()
		return business.ListUpdateReleases(rc, datactx.PageQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")})
	})
	handle("GET", "/releases/{release_version}", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetUpdateRelease(rc, version(r))
	})
	handle("GET", "/releases/{release_version}/download", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetUpdateDownloadState(rc, version(r))
	})
	handle("GET", "/releases/{release_version}/preflight", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetUpdatePreflight(rc, version(r))
	})
	handle("GET", "/runs/{id}", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetUpdateRun(rc, r.PathValue("id"))
	})
	handle("GET", "/history", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		q := r.URL.Query()
		return business.ListUpdateHistory(rc, business.UpdateHistoryQuery{
			PageQuery: datactx.PageQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")},
			From:      optional(q.Get("from")), To: optional(q.Get("to")),
		})
	})
	handle("GET", "/settings", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetUpdateSettings(rc)
	})
	handle("GET", "/connection", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetUpdateConnection(rc)
	})
	handle("GET", "/offline-uploads/{id}", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetOfflineUpdateUpload(rc, r.PathValue("id"))
	})
	handle("GET", "/change-windows", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetUpdateChangeWindows(rc)
	})
	handle("GET", "/change-windows/next", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetNextUpdateWindow(rc)
	})
	handle("GET", "/change-policy", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetUpdateChangePolicy(rc)
	})
	handle("GET", "/recovery", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.GetUpdateRecovery(rc)
	})

	handle("POST", "/check", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.CheckForUpdatesNow(rc)
	})
	handle("POST", "/releases/{release_version}/download", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.StartUpdateDownload(rc, version(r))
	})
	handle("POST", "/releases/{release_version}/preflight", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.RunUpdatePreflight(rc, version(r))
	})
	handle("POST", "/releases/{release_version}/backup-confirmation", true, func(r *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.ConfirmUpdateBackup(rc, version(r), body)
	})
	handle("POST", "/releases/{release_version}/schedule", true, func(r *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.ScheduleUpdate(rc, version(r), body)
	})
	handle("DELETE", "/releases/{release_version}/schedule", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.CancelScheduledUpdate(rc, version(r))
	})
	handle("POST", "/releases/{release_version}/approve", true, func(r *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.ApproveUpdate(rc, version(r), body)
	})
	handle("POST", "/releases/{release_version}/reject", true, func(r *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.RejectUpdate(rc, version(r), body)
	})
	handle("POST", "/releases/{release_version}/apply", false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.ApplyUpdate(rc, version(r))
	})
	handle("POST", "/releases/{release_version}/skip", true, func(r *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.SkipUpdate(rc, version(r), body)
	})
	handle("POST", "/emergency-override", true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.RequestUpdateEmergencyOverride(rc, body)
	})
	handle("POST", "/recovery", true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.RequestUpdateRecovery(rc, body)
	})
	handle("POST", "/connection/test", false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.TestUpdateConnection(rc)
	})
	handle("POST", "/offline-uploads", true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.UploadOfflineUpdate(rc, body)
	})

	handle("PUT", "/settings", true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.UpdateUpdateSettings(rc, body)
	})
	handle("PUT", "/connection", true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.UpdateUpdateConnection(rc, body)
	})
	handle("PUT", "/change-windows", true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.UpdateUpdateChangeWindows(rc, body)
	})
	handle("PUT", "/change-policy", true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.UpdateUpdateChangePolicy(rc, body)
	})

	handle("PATCH", "/connection", true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.PatchUpdateConnection(rc, body)
	})
	handle("PATCH", "/change-windows", true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.PatchUpdateChangeWindows(rc, body)
	})
	handle("PATCH", "/change-policy", true, func(_ *http.Request, rc reqctx.RequestContext, body any) (any, error) {
		return business.PatchUpdateChangePolicy(rc, body)
	})
}
