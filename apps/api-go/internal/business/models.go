// SPDX-License-Identifier: AGPL-3.0-only

// Ports models.ts (admin.forecast_model): model
// versions, pause/resume, retraining schedule,
// createForecastRun. Also settings.ts's
// getSettingsSnapshot/updateClockStart/
// updatePlanningLevel, re-exported by models.ts.
package business

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const modelStateKey = "model.state"

var modelCadences = []string{"manual", "daily", "weekly", "monthly"}

// RetrainingSchedule mirrors the contract type.
type RetrainingSchedule struct {
	Cadence   string `json:"cadence"`
	DayOfWeek *int   `json:"day_of_week"`
	TimeOfDay string `json:"time_of_day"`
}

var defaultRetrainDay = 5
var defaultRetrainingSchedule = RetrainingSchedule{Cadence: "weekly", DayOfWeek: &defaultRetrainDay, TimeOfDay: "02:00"}

// ModelState mirrors the contract type.
type ModelState struct {
	ActiveVersion      string             `json:"active_version"`
	IsPaused           bool               `json:"is_paused"`
	PausedAt           *string            `json:"paused_at"`
	PausedByUserID     *string            `json:"paused_by_user_id"`
	PauseReason        *string            `json:"pause_reason"`
	RetrainingSchedule RetrainingSchedule `json:"retraining_schedule"`
	LastForecastRunID  *string            `json:"last_forecast_run_id"`
	DataSource         string             `json:"data_source"`
}

// ModelVersion mirrors the contract type.
type ModelVersion struct {
	datactx.BaseRecord
	Version       string  `json:"version"`
	Status        string  `json:"status"`
	IsPlaceholder bool    `json:"is_placeholder"`
	EngineVersion *string `json:"engine_version"`
	TrainedAt     *string `json:"trained_at"`
	// DatasetSnapshotID: newest succeeded run's.
	DatasetSnapshotID *string `json:"dataset_snapshot_id,omitempty"`
	NotesEn           *string `json:"notes_en"`
}

var (
	modelVersionMu     sync.Mutex
	modelVersionStore  []ModelVersion
	modelVersionSeeded bool
)

// ResetModelVersionsForTest empties the version rows.
func ResetModelVersionsForTest() {
	modelVersionMu.Lock()
	modelVersionStore, modelVersionSeeded = nil, true
	modelVersionMu.Unlock()
	setFixtureRunsOn(false)
}

// ReloadModelVersionsForTest restores the fixtures.
func ReloadModelVersionsForTest() {
	modelVersionMu.Lock()
	modelVersionStore, modelVersionSeeded = nil, false
	modelVersionMu.Unlock()
}

// SeedModelVersionsForTest seeds a model version.
func SeedModelVersionsForTest(v ModelVersion) {
	modelVersionMu.Lock()
	modelVersionSeeded = true
	modelVersionMu.Unlock()
	upsertModelVersionRow(v)
}

func seedModelVersionsLocked() {
	if modelVersionSeeded {
		return
	}
	modelVersionSeeded = true
	if rows, err := fixtures.Records[ModelVersion]("ModelVersion"); err == nil {
		modelVersionStore = rows
	}
}

func upsertModelVersionRow(v ModelVersion) {
	modelVersionMu.Lock()
	defer modelVersionMu.Unlock()
	seedModelVersionsLocked()
	for i, x := range modelVersionStore {
		if x.ID == v.ID {
			modelVersionStore[i] = v
			return
		}
	}
	modelVersionStore = append(modelVersionStore, v)
}

func allModelVersionRows() []ModelVersion {
	modelVersionMu.Lock()
	seedModelVersionsLocked()
	out := append([]ModelVersion(nil), modelVersionStore...)
	modelVersionMu.Unlock()
	return out
}

func oneModelVersionRow(id string) *ModelVersion {
	for _, v := range allModelVersionRows() {
		if v.ID == id {
			row := v
			return &row
		}
	}
	return nil
}

// modelVersionsSorted mirrors versions(): trained_at
// (or created_at) desc, then version desc.
func modelVersionsSorted(ctx context.Context, tenant string) ([]ModelVersion, error) {
	rows, err := modelVersionData.versions(ctx, tenant)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(rows, func(i, j int) bool {
		ti, tj := rows[i].CreatedAt, rows[j].CreatedAt
		if rows[i].TrainedAt != nil {
			ti = *rows[i].TrainedAt
		}
		if rows[j].TrainedAt != nil {
			tj = *rows[j].TrainedAt
		}
		if ti != tj {
			return ti > tj
		}
		return rows[i].Version > rows[j].Version
	})
	return rows, nil
}

// activeForecastModel: active row, else champion.
func activeForecastModel(ctx context.Context, tenant string) (string, error) {
	v, err := activeModelVersion(ctx, tenant)
	if err != nil {
		return "", err
	}
	if v != nil {
		return v.Version, nil
	}
	return championModel(ctx, tenant), nil
}

func activeModelVersion(ctx context.Context, tenant string) (*ModelVersion, error) {
	rows, err := modelVersionsSorted(ctx, tenant)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.Status == "active" {
			row := r
			return &row, nil
		}
	}
	return nil, nil
}

// modelStoredState mirrors StoredState.
type modelStoredState struct {
	IsPaused       bool               `json:"is_paused"`
	PausedAt       *string            `json:"paused_at"`
	PausedByUserID *string            `json:"paused_by_user_id"`
	PauseReason    *string            `json:"pause_reason"`
	Retraining     RetrainingSchedule `json:"retraining_schedule"`
}

var defaultModelStoredState = modelStoredState{Retraining: defaultRetrainingSchedule}

func getModelStoredState(ctx context.Context, tenant string) modelStoredState {
	return readSetting(ctx, tenant, modelStateKey, defaultModelStoredState)
}

func currentModelState(ctx context.Context, tenant string) (ModelState, error) {
	stored := getModelStoredState(ctx, tenant)
	var lastRun *string
	runs, err := loadForecastRuns(ctx, tenant, true)
	if err != nil {
		return ModelState{}, err
	}
	for _, r := range runs {
		if r.Status == "succeeded" {
			id := r.ID
			lastRun = &id
			break
		}
	}
	active, err := activeModelVersion(ctx, tenant)
	if err != nil {
		return ModelState{}, err
	}
	activeVer := "none"
	if active != nil {
		activeVer = active.Version
	}
	return ModelState{
		ActiveVersion: activeVer, IsPaused: stored.IsPaused, PausedAt: stored.PausedAt,
		PausedByUserID: stored.PausedByUserID, PauseReason: stored.PauseReason,
		RetrainingSchedule: stored.Retraining, LastForecastRunID: lastRun, DataSource: recordsource.Get(),
	}, nil
}

// ListModelVersions mirrors listModelVersions.
func ListModelVersions(rc reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[ModelVersion], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminForecastModel, access.AccessView); err != nil {
		return datactx.PageResult[ModelVersion]{}, err
	}
	rows, err := modelVersionsSorted(context.Background(), rc.CustomerID)
	if err != nil {
		return datactx.PageResult[ModelVersion]{}, err
	}
	withVersionSnapshots(context.Background(), rc.CustomerID, rows)
	return datactx.Paginate(rows, query)
}

// withVersionSnapshots: each version's newest run.
func withVersionSnapshots(ctx context.Context, tenant string, rows []ModelVersion) {
	runs, err := loadForecastRuns(ctx, tenant, false)
	if err != nil {
		return
	}
	for i := range rows {
		for _, r := range runs {
			if r.ModelVersion == rows[i].Version && r.Status == "succeeded" && r.DatasetSnapshotID != nil {
				rows[i].DatasetSnapshotID = r.DatasetSnapshotID
				break
			}
		}
	}
}

// GetModelState mirrors getModelState.
func GetModelState(rc reqctx.RequestContext) (ModelState, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminForecastModel, access.AccessView); err != nil {
		return ModelState{}, err
	}
	return currentModelState(context.Background(), rc.CustomerID)
}

func parseModelAction(body any) (string, error) {
	o, err := datactx.Object(body, "Model action", []string{"reason"})
	if err != nil {
		return "", err
	}
	return datactx.String(o, "reason", datactx.StrOpts{Min: 1, HasMin: true, Max: 300, HasMax: true})
}

func modelDisplayName(ctx context.Context, tenantID, userID string) string {
	if u, err := oneUser(ctx, tenantID, userID); err == nil && u != nil {
		return u.DisplayName
	}
	return "an administrator"
}

// raiseModelNotifications mirrors models.ts's own
// raiseNotifications (own role/severity fallback,
// unlike notify.ts's raiseNotification).
func raiseModelNotifications(ctx context.Context, rc reqctx.RequestContext, eventType, fallbackSeverity, titleEn, bodyEn string) ([]Notification, error) {
	rule, err := notificationRuleFor(ctx, rc.CustomerID, eventType)
	if err != nil {
		return nil, err
	}
	if rule != nil && (!rule.IsEnabled || !hasChannel(rule.Channels, "in_app")) {
		return nil, nil
	}
	roles := []access.Role{access.RoleAdministrator, access.RolePlanner}
	severity := fallbackSeverity
	if rule != nil {
		roles, severity = rule.RecipientRoles, rule.Severity
	}
	at, body := datactx.NowISO(), truncateStr(bodyEn, 500)
	var created []Notification
	for _, role := range roles {
		roleStr, userID := string(role), rc.UserID
		n := Notification{
			BaseRecord:    datactx.BaseRecord{ID: datactx.NewID(), TenantID: rc.CustomerID, CreatedAt: at, UpdatedAt: at, CreatedBy: &userID, DataSource: recordsource.Get()},
			RecipientRole: &roleStr, Category: "model", Severity: severity,
			TitleEn: titleEn, BodyEn: &body, LinkPath: strPtr("/admin/forecast-model"), IsRead: false,
		}
		created = append(created, n)
	}
	return created, saveNotifications(ctx, rc.CustomerID, created...)
}

// SwitchModelVersion mirrors switchModelVersion.
func SwitchModelVersion(rc reqctx.RequestContext, id string, body any) (ModelState, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, auditlog.WriteMeta{Action: "model.version_switched", EntityType: "model_version", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[ModelState], error) {
		if _, err := importutil.RequireID(id, "Model version"); err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		reason, err := parseModelAction(body)
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		all, err := modelVersionData.versions(ctx, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		var found *ModelVersion
		for _, v := range all {
			if v.ID == id {
				row := v
				found = &row
			}
		}
		target, err := datactx.RequireFound(found, "Model version")
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		if target.Status == "active" {
			return auditlog.AuditedWrite[ModelState]{}, dataerr.Conflict(fmt.Sprintf("%s is already the active version.", target.Version))
		}
		if target.IsPlaceholder && engineMode() == engines.ModeEngine {
			refused := fmt.Sprintf("Forecast model %s not made active: placeholder_not_allowed.", target.Version)
			_, _ = auditlog.RecordAudit(rc, auditlog.AuditInput{Action: "model.version_switched", EntityType: "model_version", EntityID: &id, SummaryEn: "Denied: " + refused, Detail: map[string]any{"to": target.Version, "reason": reason, "refused": "placeholder_not_allowed"}, Outcome: "denied"}, "", "")
			return auditlog.AuditedWrite[ModelState]{}, dataerr.Conflict("placeholder_not_allowed")
		}
		previous, err := activeModelVersion(ctx, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		at := datactx.NowISO()
		prevVersion := "none"
		var changed []ModelVersion
		if previous != nil {
			prevVersion = previous.Version
			retired := *previous
			retired.Status, retired.UpdatedAt = "retired", at
			changed = append(changed, retired)
		}
		next := *target
		next.Status, next.UpdatedAt = "active", at
		changed = append(changed, next)
		if err := modelVersionData.save(ctx, rc.CustomerID, changed); err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		champion, err := makeChampion(ctx, rc.CustomerID, next.Version)
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		if _, err := raiseModelNotifications(ctx, rc, "model_switched", "info", "Forecast model switched",
			fmt.Sprintf("%s switched the forecast from %s to %s: %s", modelDisplayName(ctx, rc.CustomerID, rc.UserID), prevVersion, next.Version, reason)); err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		state, err := currentModelState(ctx, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		var fromPtr *string
		if previous != nil {
			fromPtr = &prevVersion
		}
		nextID := next.ID
		return auditlog.AuditedWrite[ModelState]{
			Result: state, EntityID: &nextID,
			SummaryEn: fmt.Sprintf("Forecast model %s made active (was %s).", next.Version, prevVersion),
			Detail:    map[string]any{"from": fromPtr, "to": next.Version, "reason": reason, "champion_model": champion},
		}, nil
	})
}

// PauseModel mirrors pauseModel.
func PauseModel(rc reqctx.RequestContext, body any) (ModelState, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, auditlog.WriteMeta{Action: "model.paused", EntityType: "model", EntityID: strPtr("forecast")}, func(ctx context.Context) (auditlog.AuditedWrite[ModelState], error) {
		reason, err := parseModelAction(body)
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		stored := getModelStoredState(ctx, rc.CustomerID)
		if stored.IsPaused {
			return auditlog.AuditedWrite[ModelState]{}, dataerr.Conflict("The forecast is already paused.")
		}
		at := datactx.NowISO()
		var pausedBy *string
		if rc.UserID != "" {
			id := rc.UserID
			pausedBy = &id
		}
		next := stored
		next.IsPaused, next.PausedAt, next.PausedByUserID, next.PauseReason = true, &at, pausedBy, &reason
		if err := settingsstore.Put(ctx, rc.CustomerID, modelStateKey, next); err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		alerts, err := raiseModelNotifications(ctx, rc, "model_paused", "warning", "Forecast paused", fmt.Sprintf("%s paused the forecast: %s", modelDisplayName(ctx, rc.CustomerID, rc.UserID), reason))
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		state, err := currentModelState(ctx, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		return auditlog.AuditedWrite[ModelState]{
			Result:    state,
			SummaryEn: fmt.Sprintf("Forecast paused: %s", reason),
			Detail:    map[string]any{"reason": reason, "notifications": len(alerts)},
		}, nil
	})
}

// ResumeModel mirrors resumeModel.
func ResumeModel(rc reqctx.RequestContext, body any) (ModelState, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, auditlog.WriteMeta{Action: "model.resumed", EntityType: "model", EntityID: strPtr("forecast")}, func(ctx context.Context) (auditlog.AuditedWrite[ModelState], error) {
		reason, err := parseModelAction(body)
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		stored := getModelStoredState(ctx, rc.CustomerID)
		if !stored.IsPaused {
			return auditlog.AuditedWrite[ModelState]{}, dataerr.Conflict("The forecast is not paused.")
		}
		next := stored
		next.IsPaused, next.PausedAt, next.PausedByUserID, next.PauseReason = false, nil, nil, nil
		if err := settingsstore.Put(ctx, rc.CustomerID, modelStateKey, next); err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		state, err := currentModelState(ctx, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		return auditlog.AuditedWrite[ModelState]{
			Result: state, SummaryEn: fmt.Sprintf("Forecast resumed: %s", reason),
			Detail: map[string]any{"reason": reason},
		}, nil
	})
}

func parseRetrainingSchedule(body any) (RetrainingSchedule, error) {
	o, err := datactx.Object(body, "Retraining schedule", []string{"cadence", "day_of_week", "time_of_day"})
	if err != nil {
		return RetrainingSchedule{}, err
	}
	cadence, err := datactx.EnumOf(o, "cadence", modelCadences)
	if err != nil {
		return RetrainingSchedule{}, err
	}
	var day *int
	if datactx.Has(o, "day_of_week") && o["day_of_week"] != nil {
		d, err := datactx.Int(o, "day_of_week", datactx.NumOpts{Min: 0, HasMin: true, Max: 6, HasMax: true})
		if err != nil {
			return RetrainingSchedule{}, err
		}
		day = &d
	}
	if cadence == "weekly" && day == nil {
		return RetrainingSchedule{}, dataerr.Invalid("Retraining schedule: a weekly cadence needs day_of_week (0 = Sunday to 6 = Saturday).")
	}
	timeOfDay, err := datactx.Time(o, "time_of_day")
	if err != nil {
		return RetrainingSchedule{}, err
	}
	if cadence != "weekly" {
		day = nil
	}
	return RetrainingSchedule{Cadence: cadence, DayOfWeek: day, TimeOfDay: timeOfDay}, nil
}

// UpdateRetrainingSchedule mirrors the TS function.
func UpdateRetrainingSchedule(rc reqctx.RequestContext, body any) (ModelState, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, auditlog.WriteMeta{Action: "model.retraining_schedule_changed", EntityType: "model", EntityID: strPtr("forecast")}, func(ctx context.Context) (auditlog.AuditedWrite[ModelState], error) {
		schedule, err := parseRetrainingSchedule(body)
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		before := getModelStoredState(ctx, rc.CustomerID)
		next := before
		next.Retraining = schedule
		if err := settingsstore.Put(ctx, rc.CustomerID, modelStateKey, next); err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		summary := fmt.Sprintf("Retraining schedule changed to %s.", schedule.Cadence)
		if schedule.Cadence != "manual" {
			summary = fmt.Sprintf("Retraining schedule changed to %s at %s.", schedule.Cadence, schedule.TimeOfDay)
		}
		state, err := currentModelState(ctx, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[ModelState]{}, err
		}
		return auditlog.AuditedWrite[ModelState]{
			Result: state, SummaryEn: summary,
			Detail: map[string]any{"from": before.Retraining, "to": schedule},
		}, nil
	})
}

func parseForecastRunCreate(body any) (string, int, error) {
	o, err := datactx.Object(body, "Forecast run", []string{"horizon_start_date", "horizon_days"})
	if err != nil {
		return "", 0, err
	}
	date, err := datactx.Date(o, "horizon_start_date")
	if err != nil {
		return "", 0, err
	}
	days, err := datactx.Int(o, "horizon_days", datactx.NumOpts{Min: 1, HasMin: true, Max: 30, HasMax: true})
	if err != nil {
		return "", 0, err
	}
	return date, days, nil
}

// upsertForecastRunRow: the real write path (only
// test seeding existed before this module).
func upsertForecastRunRow(r ForecastRun) {
	forecastRunMu.Lock()
	defer forecastRunMu.Unlock()
	for i, x := range forecastRunStore {
		if x.ID == r.ID {
			forecastRunStore[i] = r
			return
		}
	}
	forecastRunStore = append(forecastRunStore, r)
}

// CreateForecastRun mirrors createForecastRun. Also
// writes the run to Postgres (see ForecastRun) so a
// roster built against it satisfies the real FK.
func CreateForecastRun(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (ForecastRun, error) {
	// a run finishes even if the client leaves
	ctx = context.WithoutCancel(ctx)
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, auditlog.WriteMeta{Action: "forecast.run_created", EntityType: "forecast_run"}, func(ctx context.Context) (auditlog.AuditedWrite[ForecastRun], error) {
		date, days, err := parseForecastRunCreate(body)
		if err != nil {
			return auditlog.AuditedWrite[ForecastRun]{}, err
		}
		if getModelStoredState(ctx, rc.CustomerID).IsPaused {
			return auditlog.AuditedWrite[ForecastRun]{}, dataerr.Conflict("The forecast is paused. Resume it before running the forecast.")
		}
		if engineMode() == engines.ModeEngine {
			return createEngineForecastRun(ctx, conn, rc, date, days)
		}
		active, err := activeModelVersion(ctx, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[ForecastRun]{}, err
		}
		modelVersion, engineVersion := "none", "0.1.0"
		if active != nil {
			modelVersion = active.Version
			if active.EngineVersion != nil {
				engineVersion = *active.EngineVersion
			}
		}
		shares, err := getFieldShare(ctx, rc, FieldShareOptions{Date: date})
		if err != nil {
			return auditlog.AuditedWrite[ForecastRun]{}, err
		}
		shifted, err := placeholderRuleValues(ctx, rc, date)
		if err != nil {
			return auditlog.AuditedWrite[ForecastRun]{}, err
		}
		at, ruleSetVersion := datactx.NowISO(), shares.RuleSetVersion
		run := ForecastRun{
			BaseRecord: datactx.NewRecord(rc, "", at), ModelVersion: modelVersion,
			EngineVersion: &engineVersion, RuleSetVersion: &ruleSetVersion, Status: "succeeded",
			HorizonStartDate: date, HorizonDays: days, RangeCoverage: 0.8, Illustrative: true,
			InputDataSources: []string{"SYNTHETIC"}, StartedAt: &at, FinishedAt: &at,
		}
		// Postgres first: a failure here must not leave
		// a phantom "succeeded" run in the in-memory
		// store, which the worker's idempotency check
		// (and latestRun()) would then trust as real.
		if !forecastInPostgres() {
			if err := upsertForecastRunLive(ctx, conn, rc.CustomerID, run); err != nil {
				return auditlog.AuditedWrite[ForecastRun]{}, err
			}
		}
		if err := forecastRunBackendInUse.save(ctx, rc.CustomerID, run); err != nil {
			return auditlog.AuditedWrite[ForecastRun]{}, err
		}
		if shifted != nil {
			doc := ForecasterEngineOutput{DataSource: "SYNTHETIC", Values: shifted}
			if err := storeEngineForecastValues(ctx, conn, rc, run, doc, at); err != nil {
				return auditlog.AuditedWrite[ForecastRun]{}, err
			}
		}
		runID := run.ID
		return auditlog.AuditedWrite[ForecastRun]{
			Result: run, EntityID: &runID,
			SummaryEn: fmt.Sprintf("Forecast run for %d day(s) from %s finished (placeholder model %s, Illustrative).", days, date, modelVersion),
			Detail:    map[string]any{"horizon_start_date": date, "horizon_days": days, "model_version": modelVersion},
		}, nil
	})
}
