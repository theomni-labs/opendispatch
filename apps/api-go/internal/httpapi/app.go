// SPDX-License-Identifier: AGPL-3.0-only

// Route registration; mirrors app.ts's table list.
package httpapi

import (
	"net/http"
	"os"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// NewMux mirrors createApp.
func NewMux(conn *tenancy.Connection) *http.ServeMux {
	mux := http.NewServeMux()
	RegisterHealthRoute(mux, conn)

	// /_internal: raw CRUD, no access control or audit.
	// /cities etc.: the audited layer, added per module.
	reg := func(prefix, table string, cols ...string) {
		if !internalRoutesOn() {
			return // raw, unaudited CRUD: dev and CI only
		}
		RegisterResourceRoutes(mux, conn, "/_internal"+prefix, table, ResourceRouteOptions{WritableColumns: cols})
	}

	reg("/cities", "cities", "external_id", "case_code", "name_en", "name_ar", "is_active", "extra")
	reg("/zones", "zones", "external_id", "city_id", "name_en", "name_ar", "latitude", "longitude", "is_active", "extra")
	reg("/sub-zones", "sub_zones", "external_id", "zone_id", "name_en", "name_ar", "latitude", "longitude", "is_active", "extra")
	reg("/standby-points", "standby_points", "zone_id", "sub_zone_id", "name_en", "name_ar", "latitude", "longitude", "coverage_radius_m", "is_active", "extra")
	reg("/agents", "agents", "code", "name_en", "name_ar", "kind", "home_zone_id", "default_vehicle_id", "is_active", "extra")
	reg("/vehicles", "vehicles", "code", "plate_number", "zone_id", "is_active", "extra")
	reg("/agent-skills", "agent_skills", "agent_id", "skill_code")
	reg("/shift-patterns", "shift_patterns", "code", "name_en", "name_ar", "kind", "normal", "ramadan", "break_rule_id", "status", "extra")
	reg("/break-rules", "break_rules", "code", "name_en", "name_ar", "break_minutes", "after_consecutive_hours")
	reg("/holidays", "holidays", "name_en", "name_ar", "start_date", "end_date", "kind", "hijri_start", "hijri_end")
	reg("/leave-requests", "leave_requests", "agent_id", "start_date", "end_date", "leave_type", "status", "requested_at", "decided_at", "decided_by_user_id", "decision_note", "note")
	reg("/rosters", "rosters", "zone_id", "roster_date", "status", "forecast_run_id", "planning_level", "optimizer_status", "optimizer_source", "fallback_reason", "engine_version", "illustrative", "gap_count", "surplus_count", "approved_by_user_id", "approved_at", "published_at")
	reg("/roster-assignments", "roster_assignments", "roster_id", "agent_id", "shift_pattern_id", "zone_id", "roster_date", "start_at", "end_at", "vehicle_id", "break_start_at", "break_end_at", "standby_point_id", "is_override")
	reg("/cases", "cases", "external_id", "case_number", "registered_at", "city_id", "zone_id", "sub_zone_id", "latitude", "longitude", "case_type_id", "parties_involved", "assigned_at", "arrived_at", "closed_at", "handling", "agent_id", "vehicle_id", "severity", "injury_present", "estimated_damage_sar", "on_scene_completed_at", "remote_review_at", "channel", "extra")
	reg("/case-types", "case_types", "external_id", "name_en", "name_ar", "is_active", "extra")
	reg("/import-jobs", "import_jobs", "file_name", "mapping_version", "status", "row_count", "issue_count", "error_count", "warning_count", "storage_ref", "validated_at", "cut_over_at")
	reg("/data-quality-issues", "data_quality_issues", "import_job_id", "case_id", "row_number", "field", "issue_type", "severity", "status", "message")

	RegisterLocationsRoutes(mux, conn)
	RegisterAuditRoutes(mux, conn)
	RegisterPeopleRoutes(mux, conn)
	RegisterVehicleMaintenanceRoutes(mux, conn)
	RegisterShiftBreakRoutes(mux, conn)
	RegisterLeaveCalendarRoutes(mux, conn)
	RegisterTimeRoutes(mux, conn)
	RegisterLeaveRoutes(mux, conn)
	RegisterRostersRoutes(mux, conn)
	RegisterRulesRoutes(mux, conn)
	RegisterApprovalsRoutes(mux, conn)
	RegisterNotificationsRoutes(mux, conn)
	RegisterBreaksRoutes(mux, conn)
	RegisterCasesRoutes(mux, conn)
	RegisterImportsRoutes(mux, conn)
	RegisterImportUploadRoutes(mux, conn)
	RegisterSettingsRoutes(mux, conn)
	RegisterRemoteRoutes(mux, conn)
	RegisterDispatchRoutes(mux, conn)
	RegisterForecastRoutes(mux, conn)
	RegisterForecastInsightRoutes(mux, conn)
	RegisterForecastBacktestRoutes(mux, conn)
	RegisterRollingAccuracyRoutes(mux, conn)
	RegisterScenariosRoutes(mux, conn)
	RegisterSimulationRoutes(mux, conn)
	RegisterStandbyRoutes(mux, conn)
	RegisterDashboardsRoutes(mux, conn)
	RegisterFieldShareRoutes(mux, conn)
	RegisterSystemRoutes(mux, conn)
	RegisterUpdatesRoutes(mux, conn)
	RegisterUsersRoutes(mux, conn)
	RegisterIdentityRoutes(mux, conn)
	RegisterAssistantRoutes(mux, conn)
	RegisterAuthRoutes(mux, conn)
	if !oidcMode() {
		RegisterDemoAuthRoutes(mux, conn)
	}
	RegisterFeedRoutes(mux)
	// The test routes can wipe the database: only with an explicit opt-in, never in oidc mode.
	if !oidcMode() && os.Getenv("OPENDISPATCH_TEST_ROUTES") == "1" {
		RegisterTestRoutes(mux, conn)
	}

	return mux
}

// internalRoutesOn: demo or test opt-in, not oidc.
func internalRoutesOn() bool {
	if oidcMode() {
		return false
	}
	return demoMode() || os.Getenv("OPENDISPATCH_TEST_ROUTES") == "1"
}
