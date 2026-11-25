// SPDX-License-Identifier: AGPL-3.0-only

// admin settings HTTP routes: the snapshot, its writes and raw reads.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"
	"net/url"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterSettingsRoutes: settings snapshot, writes, vocabularies, raw values.
func RegisterSettingsRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	get := func(pattern string, run func(r *http.Request, rc reqctx.RequestContext) (any, error)) {
		mux.HandleFunc("GET "+pattern, func(w http.ResponseWriter, r *http.Request) {
			rc, ok := requireContext(w, r, conn)
			if !ok {
				return
			}
			result, err := run(r, rc)
			if err != nil {
				writeBusinessError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, result)
		})
	}
	put := func(pattern string, run func(r *http.Request, rc reqctx.RequestContext, body any) (any, error)) {
		mux.HandleFunc("PUT "+pattern, func(w http.ResponseWriter, r *http.Request) {
			rc, ok := requireContext(w, r, conn)
			if !ok {
				return
			}
			body, ok := decodeAnyBody(w, r)
			if !ok {
				return
			}
			result, err := run(r, rc, body)
			if err != nil {
				writeBusinessError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, result)
		})
	}
	get("/settings", func(_ *http.Request, rc reqctx.RequestContext) (any, error) { return business.GetSettingsSnapshot(rc) })
	put("/settings/clock-start", func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdateClockStart(rc, b)
	})
	put("/settings/planning-level", func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdatePlanningLevel(rc, b)
	})
	put("/settings/optimizer-model", func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdateOptimizerModel(rc, b)
	})
	put("/settings/remote-handling", func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdateRemoteHandling(rc, b)
	})
	put("/settings/break-prayer", func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdateBreakPrayerPolicy(rc, b)
	})
	put("/settings/live-assignment", func(_ *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.UpdateLiveAssignmentSettings(rc, b)
	})
	put("/settings/live-assignment/stages/{zone_id}", func(r *http.Request, rc reqctx.RequestContext, b any) (any, error) {
		return business.SetZoneStage(rc, r.PathValue("zone_id"), b)
	})
	get("/settings/all", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		q := r.URL.Query()
		return business.ListSettings(rc, datactx.PageQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")})
	})
	get("/settings/reason-codes", func(_ *http.Request, rc reqctx.RequestContext) (any, error) {
		return business.GetOverrideReasonCodes(rc)
	})
	get("/settings/skills", func(_ *http.Request, rc reqctx.RequestContext) (any, error) { return business.GetSkillVocabulary(rc) })
	get("/settings/demo-today", func(_ *http.Request, rc reqctx.RequestContext) (any, error) {
		d, err := business.GetDemoToday(rc)
		return map[string]string{"date": d}, err
	})
	get("/settings/zone-stages", func(_ *http.Request, rc reqctx.RequestContext) (any, error) { return business.ReadZoneStages(rc) })
	get("/settings/zone-stages/{zone_id}", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		s, err := business.GetZoneStage(rc, r.PathValue("zone_id"))
		return map[string]string{"stage": s}, err
	})
	get("/settings/raw/{key}", func(r *http.Request, rc reqctx.RequestContext) (any, error) {
		key, err := url.PathUnescape(r.PathValue("key"))
		if err != nil {
			return nil, err
		}
		v, found, err := business.GetRawSetting(rc, key)
		return map[string]any{"found": found, "value": v}, err
	})
	mux.HandleFunc("PUT /settings/raw/{key}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeBody(w, r)
		if !ok {
			return
		}
		key, err := url.PathUnescape(r.PathValue("key"))
		if err != nil {
			writeBusinessError(w, dataerr.Invalid("Setting key is not valid."))
			return
		}
		if err := business.PutRawSetting(rc, key, body["value"]); err != nil {
			writeBusinessError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
