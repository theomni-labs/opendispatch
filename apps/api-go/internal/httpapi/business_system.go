// SPDX-License-Identifier: AGPL-3.0-only

// System health, security, API/webhook and integration routes.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"encoding/base64"
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

type systemRun func(r *http.Request, rc reqctx.RequestContext, body any) (any, error)

// RegisterSystemRoutes: health, security, webhooks, integrations, localization.
func RegisterSystemRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	handle := func(method, pattern string, status int, withBody bool, run systemRun) {
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
			if status == http.StatusNoContent {
				w.WriteHeader(status)
				return
			}
			writeJSON(w, status, result)
		})
	}
	get := func(pattern string, run func(r *http.Request, rc reqctx.RequestContext) (any, error)) {
		handle("GET", pattern, http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) { return run(r, rc) })
	}
	page := func(r *http.Request) datactx.PageQuery {
		q := r.URL.Query()
		return datactx.PageQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")}
	}

	get("/health/jobs", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		q := r.URL.Query()
		p := page(r)
		return business.ListJobRuns(rc, business.JobRunQuery{Limit: p.Limit, Cursor: p.Cursor, From: q.Get("from"), To: q.Get("to"), Status: q.Get("status"), Kind: q.Get("kind")})
	})
	get("/health/overview", func(_ *http.Request, rc reqctx.RequestContext) (any, error) { return business.GetSystemHealth(rc) })
	get("/system/engines", func(_ *http.Request, rc reqctx.RequestContext) (any, error) { return business.GetEngineStatuses(rc) })
	get("/health/storage", func(_ *http.Request, rc reqctx.RequestContext) (any, error) { return business.GetStorageStatus(rc) })
	get("/health/backups", func(_ *http.Request, rc reqctx.RequestContext) (any, error) { return business.GetBackupStatus(rc) })
	handle("POST", "/health/backups/confirm", http.StatusOK, true, func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.ConfirmBackup(rc, b)
	})
	handle("POST", "/health/diagnostics", http.StatusCreated, false, func(_ *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.CreateDiagnosticsBundle(rc)
	})
	mux.HandleFunc("GET /health/diagnostics/{id}/download", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		file, err := business.DownloadDiagnosticsBundle(rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		raw, err := base64.StdEncoding.DecodeString(file.ContentBase64)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.Header().Set("Content-Type", file.ContentType)
		w.Header().Set("Content-Disposition", `attachment; filename="`+file.FileName+`"`)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(raw)
	})
	get("/health/diagnostics/{id}/download-base64", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.DownloadDiagnosticsBundle(rc, r.PathValue("id"))
	})
	get("/healthz", func(_ *http.Request, rc reqctx.RequestContext) (any, error) { return business.GetLiveness(rc) })
	get("/readyz", func(_ *http.Request, rc reqctx.RequestContext) (any, error) { return business.GetReadiness(rc) })

	get("/security/controls", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		p := page(r)
		return business.ListControlEvidence(rc, business.ControlEvidenceQuery{Limit: p.Limit, Cursor: p.Cursor, Framework: r.URL.Query().Get("framework")})
	})
	handle("PUT", "/security/controls/{id}", http.StatusOK, true, func(r *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdateControlEvidence(rc, r.PathValue("id"), b)
	})
	get("/security/session-policy", func(_ *http.Request, rc reqctx.RequestContext) (any, error) { return business.GetSessionPolicy(rc) })
	handle("PUT", "/security/session-policy", http.StatusOK, true, func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdateSessionPolicy(rc, b)
	})
	get("/security/support-access", func(_ *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.GetSupportAccessSetting(rc)
	})
	handle("PUT", "/security/support-access", http.StatusOK, true, func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdateSupportAccessSetting(rc, b)
	})
	handle("POST", "/security/support-access/grants", http.StatusCreated, true, func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.GrantSupportAccess(rc, b)
	})
	handle("POST", "/security/support-access/log/{id}/end", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.EndSupportAccess(rc, r.PathValue("id"))
	})
	get("/security/support-access/log", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.ListSupportAccessEvents(rc, page(r))
	})

	get("/api-clients", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		p := page(r)
		return business.ListApiClients(rc, business.ApiClientQuery{Limit: p.Limit, Cursor: p.Cursor})
	})
	handle("POST", "/api-clients", http.StatusCreated, true, func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.CreateApiClient(rc, b)
	})
	handle("DELETE", "/api-clients/{id}", http.StatusNoContent, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return nil, business.RevokeApiClient(rc, r.PathValue("id"))
	})
	handle("POST", "/api-clients/{id}/rotate", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.RotateApiClient(rc, r.PathValue("id"))
	})
	get("/webhooks", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		p := page(r)
		return business.ListWebhooks(rc, business.WebhookQuery{Limit: p.Limit, Cursor: p.Cursor})
	})
	get("/webhooks/{id}", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.GetWebhook(rc, r.PathValue("id"))
	})
	handle("POST", "/webhooks", http.StatusCreated, true, func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.CreateWebhook(rc, b)
	})
	handle("PUT", "/webhooks/{id}", http.StatusOK, true, func(r *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdateWebhook(rc, r.PathValue("id"), b)
	})
	handle("DELETE", "/webhooks/{id}", http.StatusNoContent, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return nil, business.DeleteWebhook(rc, r.PathValue("id"))
	})
	get("/webhooks/{id}/deliveries", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		p := page(r)
		return business.ListWebhookDeliveries(rc, r.PathValue("id"), business.WebhookDeliveryQuery{Limit: p.Limit, Cursor: p.Cursor})
	})
	get("/api-rate-limits", func(_ *http.Request, rc reqctx.RequestContext) (any, error) { return business.GetRateLimits(rc) })
	handle("PUT", "/api-rate-limits", http.StatusOK, true, func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdateRateLimits(rc, b)
	})
	handle("POST", "/webhooks/{id}/test", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.TestWebhook(rc, r.PathValue("id"))
	})
	handle("POST", "/webhook-deliveries/{id}/retry", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.RetryWebhookDelivery(rc, r.PathValue("id"))
	})

	get("/integrations", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		p := page(r)
		return business.ListIntegrations(rc, business.IntegrationQuery{Limit: p.Limit, Cursor: p.Cursor})
	})
	get("/integrations/health", func(_ *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.GetIntegrationsHealth(rc)
	})
	get("/integrations/{id}", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.GetIntegration(rc, r.PathValue("id"))
	})
	handle("PATCH", "/integrations/{id}", http.StatusOK, true, func(r *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdateIntegration(rc, r.PathValue("id"), b)
	})
	handle("POST", "/integrations/{id}/test", http.StatusOK, false, func(r *http.Request, rc reqctx.RequestContext, _ any) (any, error) {
		return business.TestIntegration(rc, r.PathValue("id"))
	})

	get("/settings/localization", func(_ *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.GetLocalizationSettings(rc)
	})
	handle("PUT", "/settings/localization", http.StatusOK, true, func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdateLocalizationSettings(rc, b)
	})
}
