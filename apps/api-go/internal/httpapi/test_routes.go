// SPDX-License-Identifier: AGPL-3.0-only

// Dev/CI only: lets vitest reset Go's in-memory state per test, the
// same way it resets the demo store (apps/web's useTempDemoState).
package httpapi

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/session"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

var uuidShape = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// RegisterTestRoutes: no auth, matching /_internal's own CRUD routes.
func RegisterTestRoutes(mux *http.ServeMux, _ *tenancy.Connection) {
	mux.HandleFunc("GET /_internal/test/notifications", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, business.AllNotificationsForTest())
	})
	mux.HandleFunc("POST /_internal/test/clock", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Now *string `json:"now"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONError(w, http.StatusBadRequest, "The request body is not valid JSON.")
			return
		}
		if body.Now == nil {
			datactx.SetNowForTest(nil)
		} else {
			at, err := time.Parse(time.RFC3339, *body.Now)
			if err != nil {
				writeJSONError(w, http.StatusBadRequest, "now is not a date-time.")
				return
			}
			datactx.SetNowForTest(&at)
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /_internal/test/updates-state", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			IndexValidUntil *string           `json:"index_valid_until"`
			ReleaseStates   map[string]string `json:"release_states"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONError(w, http.StatusBadRequest, "The request body is not valid JSON.")
			return
		}
		tenantID, err := fixtures.TenantID()
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := business.PatchUpdatesForTest(tenantID, body.IndexValidUntil, body.ReleaseStates); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /_internal/test/audit-count", func(w http.ResponseWriter, r *http.Request) {
		tenantID, err := fixtures.TenantID()
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		events, err := auditlog.EventsOf(r.Context(), tenantID)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"count": len(events)})
	})
	// Seeds one arbitrary event for a test (the web tests used to append through the local writer).
	mux.HandleFunc("POST /_internal/test/audit-event", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Action      string         `json:"action"`
			EntityType  string         `json:"entity_type"`
			EntityID    *string        `json:"entity_id"`
			SummaryEn   string         `json:"summary_en"`
			Detail      map[string]any `json:"detail"`
			Outcome     string         `json:"outcome"`
			UserID      *string        `json:"user_id"`
			ActorUserID *string        `json:"actor_user_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONError(w, http.StatusBadRequest, "The request body is not valid JSON.")
			return
		}
		tenantID, err := fixtures.TenantID()
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		event, err := auditlog.RecordAudit(testAuditActor{tenant: tenantID, user: body.UserID}, auditlog.AuditInput{
			Action: body.Action, EntityType: body.EntityType, EntityID: body.EntityID, SummaryEn: body.SummaryEn, Detail: body.Detail, Outcome: body.Outcome,
			ActorUserID: body.ActorUserID, ActorUserIDGiven: body.ActorUserID != nil,
		}, "", "")
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, event)
	})
	// A demo session, unaudited: tests only.
	mux.HandleFunc("POST /_internal/test/demo-session", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			UserID       string   `json:"user_id"`
			AssignedRole string   `json:"assigned_role"`
			InstallMode  string   `json:"install_mode"`
			ZoneIDs      []string `json:"zone_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONError(w, http.StatusBadRequest, "The request body is not valid JSON.")
			return
		}
		if !access.IsRole(body.AssignedRole) || !access.IsInstallMode(body.InstallMode) {
			writeJSONError(w, http.StatusBadRequest, "assigned_role and install_mode are required.")
			return
		}
		tenantID, err := fixtures.TenantID()
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		zones := []string{}
		for _, id := range body.ZoneIDs {
			if uuidShape.MatchString(id) {
				zones = append(zones, id)
			}
		}
		user, err := business.DemoUserForTest(tenantID, body.UserID, access.Role(body.AssignedRole), zones)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		if user == nil {
			writeJSONError(w, http.StatusForbidden, "No active account holds that role.")
			return
		}
		token, _, err := auth.Sessions.CreateDemo(r.Context(), tenantID, user.ID, session.DemoScope{InstallMode: body.InstallMode, ZoneIDs: zones})
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"token": token, "user_id": user.ID})
	})
	mux.HandleFunc("POST /_internal/test/reset", func(w http.ResponseWriter, r *http.Request) {
		// A reset with nothing written since the last one would only cool the caches.
		if tracking.Load() && !dirty.Swap(false) && r.URL.Query().Get("force") != "1" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		business.ResetAllState()
		if err := auditlog.TruncateForTest(r.Context()); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "The audit log could not be cleared: "+err.Error())
			return
		}
		if business.TestResetDB != nil {
			if err := business.TestResetDB(r.Context()); err != nil {
				writeJSONError(w, http.StatusInternalServerError, "The database state could not be reset: "+err.Error())
				return
			}
		}
		if business.TestResetMasterDB != nil && r.URL.Query().Get("master") == "1" {
			if err := business.TestResetMasterDB(r.Context()); err != nil {
				writeJSONError(w, http.StatusInternalServerError, "The master data could not be reset: "+err.Error())
				return
			}
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// testAuditActor: what RecordAudit needs from a caller, for the test route.
type testAuditActor struct {
	tenant string
	user   *string
}

func (a testAuditActor) AuditCustomerID() string { return a.tenant }
func (a testAuditActor) AuditUserID() *string    { return a.user }

var (
	dirty    atomic.Bool
	tracking atomic.Bool
)

func init() { dirty.Store(true) }

// TrackWrites notes every request that may change state, so a test reset can be skipped when none did.
func TrackWrites(next http.Handler) http.Handler {
	tracking.Store(true)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions || strings.Contains(r.URL.Path, "export") {
			if r.URL.Path != "/_internal/test/reset" {
				dirty.Store(true)
			}
		}
		next.ServeHTTP(w, r)
	})
}
