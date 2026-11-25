// SPDX-License-Identifier: AGPL-3.0-only

// Ports settings.ts: the settings snapshot, the stage per zone
// and the raw settings other modules read.
package business

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecasthist"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

const stageKeyPrefix = "live_assignment.stage."

var (
	modelClockStarts   = []string{"assignment", "registration"}
	modelPlanningLevel = []string{"zone", "sub_zone", "city"}
	settingsStages     = []string{"shadow", "recommend", "automatic"}
)

// ZoneStage mirrors the contract type.
type ZoneStage struct {
	ZoneID     string  `json:"zone_id"`
	Stage      string  `json:"stage"`
	UpdatedAt  string  `json:"updated_at"`
	UpdatedBy  *string `json:"updated_by"`
	DataSource string  `json:"data_source"`
}

// Setting mirrors the contract type.
type Setting struct {
	datactx.BaseRecord
	Key   string `json:"key"`
	Value any    `json:"value"`
}

// SettingsSnapshot mirrors the contract type.
type SettingsSnapshot struct {
	ClockStart             string               `json:"clock_start"`
	PlanningLevel          string               `json:"planning_level"`
	LiveAssignmentStages   []ZoneStage          `json:"live_assignment_stages"`
	FallbackTimeoutSeconds int                  `json:"fallback_timeout_seconds"`
	DecisionDeadlineMs     *int                 `json:"decision_deadline_ms,omitempty"`
	AutoResume             bool                 `json:"dispatch_auto_resume"`
	AutoResumeAfterSeconds int                  `json:"dispatch_auto_resume_after_seconds"`
	FallbackAfterSilenceS  int                  `json:"dispatch_fallback_after_silence_seconds"`
	Reposition             bool                 `json:"dispatch_reposition"`
	RepositionMaxMoveKm    float64              `json:"dispatch_reposition_max_move_km"`
	PrayerPenalty          bool                 `json:"dispatch_prayer_penalty"`
	Localization           LocalizationSettings `json:"localization"`
	InstallMode            access.InstallMode   `json:"install_mode"`
	TargetShare            float64              `json:"service_level_target_share"`
	OptimizerModel         string               `json:"optimizer_model"`
	OptimizerModels        []string             `json:"optimizer_models"`
	BreakPrayerPolicy      string               `json:"break_prayer_policy"`
	PrayerWindowMinutes    int                  `json:"prayer_window_minutes"`
	RemoteHandlingSource   string               `json:"remote_handling_source,omitempty"`
	RemoteHandlingFixedMin *float64             `json:"remote_handling_fixed_minutes,omitempty"`
	UpdatedAt              string               `json:"updated_at"`
	TenMinuteThresholdS    int                  `json:"ten_minute_threshold_seconds"`
}

// ReasonCodeInfo: one override reason code with its labels.
type ReasonCodeInfo struct {
	Code         string  `json:"code"`
	NameEn       string  `json:"name_en"`
	NameAr       *string `json:"name_ar"`
	RequiresNote bool    `json:"requires_note"`
}

// SkillInfo: one entry of the skills vocabulary.
type SkillInfo struct {
	Code   string  `json:"code"`
	NameEn string  `json:"name_en"`
	NameAr *string `json:"name_ar"`
}

// settingsZoneRow: a fixtures snapshot, as TS reads the demo store's Zone here.
type settingsZoneRow struct {
	ID        string
	UpdatedAt string
	NameEn    string
	Code      string
}

var (
	settingsZoneMu     sync.Mutex
	settingsZoneRows   []settingsZoneRow
	settingsZoneSeeded bool
)

// ResetSettingsZonesForTest clears the zone rows.
func ResetSettingsZonesForTest() {
	settingsZoneMu.Lock()
	settingsZoneRows, settingsZoneSeeded = nil, true
	settingsZoneMu.Unlock()
}

// SeedSettingsZonesForTest seeds the zone ids.
func SeedSettingsZonesForTest(ids []string, updatedAt string) {
	settingsZoneMu.Lock()
	defer settingsZoneMu.Unlock()
	settingsZoneRows, settingsZoneSeeded = nil, true
	for _, id := range ids {
		settingsZoneRows = append(settingsZoneRows, settingsZoneRow{ID: id, UpdatedAt: updatedAt, NameEn: id, Code: id})
	}
}

// ReloadSettingsZonesForTest: back to the fixtures.
func ReloadSettingsZonesForTest() {
	settingsZoneMu.Lock()
	settingsZoneRows, settingsZoneSeeded = nil, false
	settingsZoneMu.Unlock()
}

func allSettingsZoneRows() []settingsZoneRow {
	settingsZoneMu.Lock()
	defer settingsZoneMu.Unlock()
	if !settingsZoneSeeded {
		settingsZoneSeeded = true
		if zones, err := fixtures.Records[Zone]("Zone"); err == nil {
			for _, z := range zones {
				code, _ := z.Extra["code"].(string)
				if code == "" {
					code = z.ID
				}
				settingsZoneRows = append(settingsZoneRows, settingsZoneRow{ID: z.ID, UpdatedAt: z.UpdatedAt, NameEn: z.NameEn, Code: code})
			}
		}
	}
	return append([]settingsZoneRow(nil), settingsZoneRows...)
}

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

func stageKeyFor(z settingsZoneRow) string {
	return stageKeyPrefix + nonAlnum.ReplaceAllString(strings.ToLower(z.Code), "_")
}

func validStage(s string) bool {
	for _, v := range settingsStages {
		if v == s {
			return true
		}
	}
	return false
}

// storedStage: the stored stage of a zone and its key.
func storedStage(ctx context.Context, tenant, zoneID string) (*ZoneStage, string, error) {
	all, err := storedStages(ctx, tenant)
	if err != nil {
		return nil, "", err
	}
	if st, ok := all[zoneID]; ok {
		return &st.stage, st.key, nil
	}
	return nil, "", nil
}

type storedStageEntry struct {
	stage ZoneStage
	key   string
}

// storedStages reads every stored stage at once, by zone.
func storedStages(ctx context.Context, tenant string) (map[string]storedStageEntry, error) {
	entries, err := settingsstore.WithPrefix(ctx, tenant, stageKeyPrefix)
	if err != nil {
		return nil, err
	}
	out := map[string]storedStageEntry{}
	for _, e := range entries {
		s, ok := settingsstore.Convert[ZoneStage](e.Value)
		if _, dup := out[s.ZoneID]; ok && validStage(s.Stage) && !dup {
			out[s.ZoneID] = storedStageEntry{stage: s, key: e.Key}
		}
	}
	return out, nil
}

// PutZoneStageForTest seeds a stage (memory backend: the customer is ignored).
func PutZoneStageForTest(s ZoneStage) {
	_, key, _ := storedStage(context.Background(), "", s.ZoneID)
	if key == "" {
		key = stageKeyPrefix + nonAlnum.ReplaceAllString(strings.ToLower(s.ZoneID), "_")
	}
	_ = settingsstore.Put(context.Background(), "", key, s)
}

// ResetZoneStagesForTest drops every stored stage.
func ResetZoneStagesForTest() {
	_ = settingsstore.DeletePrefix(context.Background(), "", stageKeyPrefix)
}

// readZoneStages mirrors readZoneStages.
func readZoneStages(ctx context.Context, rc reqctx.RequestContext) ([]ZoneStage, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformSession); err != nil {
		return nil, err
	}
	out := []ZoneStage{}
	stored, err := storedStages(ctx, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	for _, z := range allSettingsZoneRows() {
		zid := z.ID
		if !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		if s, ok := stored[z.ID]; ok {
			out = append(out, s.stage)
			continue
		}
		out = append(out, ZoneStage{ZoneID: z.ID, Stage: "shadow", UpdatedAt: z.UpdatedAt, DataSource: recordsource.Get()})
	}
	return out, nil
}

func getFallbackTimeoutSeconds(ctx context.Context, tenant string) int {
	v := readSetting(ctx, tenant, "fallback_timeout_seconds", 5)
	if v >= 1 && v <= 300 {
		return v
	}
	return 5
}

// getDecisionDeadlineMs: nil when unset.
func getDecisionDeadlineMs(ctx context.Context, tenant string) *int {
	v := readSetting(ctx, tenant, "decision_deadline_ms", -1)
	if v < 0 {
		return nil
	}
	return &v
}

// decisionDeadlineMs: setting, else engine config.
func decisionDeadlineMs(ctx context.Context, tenant string) int64 {
	if d := getDecisionDeadlineMs(ctx, tenant); d != nil {
		return int64(*d)
	}
	engineMu.Lock()
	d := engineCfg.Deadline(engines.Assignment)
	engineMu.Unlock()
	if d <= 0 {
		d = engines.DefaultAssignmentDeadline
	}
	return d.Milliseconds()
}

// GetSettingsSnapshot mirrors getSettingsSnapshot.
func GetSettingsSnapshot(rc reqctx.RequestContext) (SettingsSnapshot, error) {
	return settingsSnapshot(context.Background(), rc)
}

// settingsSnapshot: the snapshot inside ctx's unit.
func settingsSnapshot(ctx context.Context, rc reqctx.RequestContext) (SettingsSnapshot, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformSession); err != nil {
		return SettingsSnapshot{}, err
	}
	stages, err := readZoneStages(ctx, rc)
	if err != nil {
		return SettingsSnapshot{}, err
	}
	updated := ""
	entries, err := settingsstore.Entries(ctx, rc.CustomerID)
	if err != nil {
		return SettingsSnapshot{}, err
	}
	for _, e := range entries {
		if e.UpdatedAt > updated {
			updated = e.UpdatedAt
		}
	}
	if updated == "" {
		updated = datactx.NowISO()
	}
	pol := prayerPolicyOf(ctx, rc.CustomerID)
	fixedMinutes := getRemoteHandlingFixed(ctx, rc.CustomerID)
	return SettingsSnapshot{
		ClockStart: getClockStart(ctx, rc.CustomerID), PlanningLevel: getPlanningLevel(ctx, rc), LiveAssignmentStages: stages,
		FallbackTimeoutSeconds: getFallbackTimeoutSeconds(ctx, rc.CustomerID), DecisionDeadlineMs: getDecisionDeadlineMs(ctx, rc.CustomerID),
		AutoResume: getAutoResume(ctx, rc.CustomerID), AutoResumeAfterSeconds: getAutoResumeAfterSeconds(ctx, rc.CustomerID),
		FallbackAfterSilenceS: getFallbackAfterSilenceSeconds(ctx, rc.CustomerID),
		Reposition:            getReposition(ctx, rc.CustomerID), RepositionMaxMoveKm: getRepositionMaxMoveKm(ctx, rc.CustomerID),
		PrayerPenalty: getPrayerPenalty(ctx, rc.CustomerID),
		Localization:  getLocalization(ctx, rc.CustomerID), InstallMode: rc.InstallMode, TargetShare: getServiceLevelTargetShare(ctx, rc.CustomerID), UpdatedAt: updated,
		OptimizerModel: getOptimizerModel(ctx, rc.CustomerID), OptimizerModels: append([]string(nil), OptimizerModels...),
		BreakPrayerPolicy: pol.Mode, PrayerWindowMinutes: pol.window(),
		RemoteHandlingSource: getRemoteHandlingSource(ctx, rc.CustomerID), RemoteHandlingFixedMin: &fixedMinutes,
		TenMinuteThresholdS: getTenMinuteThresholdSeconds(ctx, rc.CustomerID),
	}, nil
}

// UpdateClockStart mirrors updateClockStart.
func UpdateClockStart(rc reqctx.RequestContext, body any) (SettingsSnapshot, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, auditlog.WriteMeta{Action: "settings.clock_start_changed", EntityType: "setting", EntityID: strPtr("clock_start")}, func(ctx context.Context) (auditlog.AuditedWrite[SettingsSnapshot], error) {
		input, err := datactx.Object(body, "Clock start", []string{"clock_start"})
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		next, err := datactx.EnumOf(input, "clock_start", modelClockStarts)
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		before := getClockStart(ctx, rc.CustomerID)
		if err := settingsstore.Put(ctx, rc.CustomerID, "clock_start", next); err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		snap, err := settingsSnapshot(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		return auditlog.AuditedWrite[SettingsSnapshot]{
			Result: snap, SummaryEn: fmt.Sprintf("10-minute clock start changed from %s to %s.", before, next),
			Detail: sumDetail(map[string]any{"from": before, "to": next}, map[string]any{"from": fmt.Sprint(before), "to": fmt.Sprint(next)}),
		}, nil
	})
}

// UpdatePlanningLevel mirrors updatePlanningLevel.
func UpdatePlanningLevel(rc reqctx.RequestContext, body any) (SettingsSnapshot, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, auditlog.WriteMeta{Action: "settings.planning_level_changed", EntityType: "setting", EntityID: strPtr("planning_level")}, func(ctx context.Context) (auditlog.AuditedWrite[SettingsSnapshot], error) {
		input, err := datactx.Object(body, "Planning level", []string{"planning_level"})
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		next, err := datactx.EnumOf(input, "planning_level", modelPlanningLevel)
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		before := getPlanningLevel(ctx, rc)
		if err := settingsstore.Put(ctx, rc.CustomerID, "planning_level", next); err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		snap, err := settingsSnapshot(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		return auditlog.AuditedWrite[SettingsSnapshot]{
			Result: snap, SummaryEn: fmt.Sprintf("Planning level changed from %s to %s.", before, next),
			Detail: sumDetail(map[string]any{"from": before, "to": next}, map[string]any{"from": fmt.Sprint(before), "to": fmt.Sprint(next)}),
		}, nil
	})
}

// UpdateLiveAssignmentSettings mirrors updateLiveAssignmentSettings.
func UpdateLiveAssignmentSettings(rc reqctx.RequestContext, body any) (SettingsSnapshot, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminDataSources}, auditlog.WriteMeta{Action: "settings.live_assignment_changed", EntityType: "setting", EntityID: strPtr("live_assignment")}, func(ctx context.Context) (auditlog.AuditedWrite[SettingsSnapshot], error) {
		input, err := datactx.Object(body, "Live assignment settings", []string{"fallback_timeout_seconds", "decision_deadline_ms", "dispatch_auto_resume", "dispatch_auto_resume_after_seconds", "dispatch_fallback_after_silence_seconds",
			"dispatch_reposition", "dispatch_reposition_max_move_km", "dispatch_prayer_penalty", tenMinuteThresholdKey})
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		resume, hasResume, err := datactx.OptBool(input, "dispatch_auto_resume")
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		resumeAfter, hasResumeAfter, err := datactx.OptInt(input, "dispatch_auto_resume_after_seconds", datactx.NumOpts{Min: 30, Max: 3600, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		timeout, hasTimeout, err := datactx.OptInt(input, "fallback_timeout_seconds", datactx.NumOpts{Min: 1, Max: 300, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		deadline, hasDeadline, err := datactx.OptInt(input, "decision_deadline_ms", datactx.NumOpts{Min: 50, Max: 30000, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		silence, hasSilence, err := datactx.OptInt(input, "dispatch_fallback_after_silence_seconds", datactx.NumOpts{Min: 5, Max: 3600, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		threshold, hasThreshold, err := datactx.OptInt(input, tenMinuteThresholdKey, datactx.NumOpts{Min: minTenMinuteThresholdS, Max: maxTenMinuteThresholdS, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		repo, hasRepo, err := datactx.OptBool(input, "dispatch_reposition")
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		maxKm, hasMaxKm, err := datactx.OptNumber(input, "dispatch_reposition_max_move_km", datactx.NumOpts{Min: 0, Max: 50, HasMin: true, HasMax: true})
		if err == nil && hasMaxKm && maxKm <= 0 {
			err = dataerr.Invalid("dispatch_reposition_max_move_km must be above 0.")
		}
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		prayer, hasPrayer, err := datactx.OptBool(input, "dispatch_prayer_penalty")
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		if !hasTimeout && !hasDeadline && !hasResume && !hasResumeAfter && !hasSilence && !hasRepo && !hasMaxKm && !hasPrayer && !hasThreshold {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, dataerr.Invalid("Live assignment settings: nothing to change.")
		}
		detail := map[string]any{}
		var changes []settingsstore.KV
		if hasTimeout {
			detail["fallback_timeout_seconds"] = map[string]any{"from": getFallbackTimeoutSeconds(ctx, rc.CustomerID), "to": timeout}
			changes = append(changes, settingsstore.KV{Key: "fallback_timeout_seconds", Value: timeout})
		}
		if hasDeadline {
			var from any
			if d := getDecisionDeadlineMs(ctx, rc.CustomerID); d != nil {
				from = *d
			}
			detail["decision_deadline_ms"] = map[string]any{"from": from, "to": deadline}
			changes = append(changes, settingsstore.KV{Key: "decision_deadline_ms", Value: deadline})
		}
		if hasResume {
			detail["dispatch_auto_resume"] = map[string]any{"from": getAutoResume(ctx, rc.CustomerID), "to": resume}
			changes = append(changes, settingsstore.KV{Key: autoResumeKey, Value: resume})
		}
		if hasResumeAfter {
			detail["dispatch_auto_resume_after_seconds"] = map[string]any{"from": getAutoResumeAfterSeconds(ctx, rc.CustomerID), "to": resumeAfter}
			changes = append(changes, settingsstore.KV{Key: autoResumeAfterKey, Value: resumeAfter})
		}
		if hasSilence {
			detail["dispatch_fallback_after_silence_seconds"] = map[string]any{"from": getFallbackAfterSilenceSeconds(ctx, rc.CustomerID), "to": silence}
			changes = append(changes, settingsstore.KV{Key: silenceKey, Value: silence})
		}
		if hasThreshold {
			detail[tenMinuteThresholdKey] = map[string]any{"from": getTenMinuteThresholdSeconds(ctx, rc.CustomerID), "to": threshold}
			changes = append(changes, settingsstore.KV{Key: tenMinuteThresholdKey, Value: threshold})
		}
		if hasRepo {
			detail["dispatch_reposition"] = map[string]any{"from": getReposition(ctx, rc.CustomerID), "to": repo}
			changes = append(changes, settingsstore.KV{Key: repositionKey, Value: repo})
		}
		if hasMaxKm {
			detail["dispatch_reposition_max_move_km"] = map[string]any{"from": getRepositionMaxMoveKm(ctx, rc.CustomerID), "to": maxKm}
			changes = append(changes, settingsstore.KV{Key: repositionMaxMoveKey, Value: maxKm})
		}
		if hasPrayer {
			detail["dispatch_prayer_penalty"] = map[string]any{"from": getPrayerPenalty(ctx, rc.CustomerID), "to": prayer}
			changes = append(changes, settingsstore.KV{Key: prayerPenaltyKey, Value: prayer})
		}
		if err := settingsstore.PutMany(ctx, rc.CustomerID, changes...); err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		snap, err := settingsSnapshot(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[SettingsSnapshot]{}, err
		}
		summary := "Live assignment fallback settings changed."
		if !hasTimeout && !hasDeadline && !hasResume && !hasResumeAfter && !hasSilence {
			summary = "Live assignment dispatch settings changed."
		}
		return auditlog.AuditedWrite[SettingsSnapshot]{Result: snap, SummaryEn: summary, Detail: detail}, nil
	})
}

// SetZoneStage mirrors setZoneStage.
func SetZoneStage(rc reqctx.RequestContext, zoneID string, body any) (ZoneStage, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminDataSources}, auditlog.WriteMeta{Action: "settings.zone_stage_changed", EntityType: "zone", EntityID: &zoneID}, func(ctx context.Context) (auditlog.AuditedWrite[ZoneStage], error) {
		fail := func(err error) (auditlog.AuditedWrite[ZoneStage], error) {
			return auditlog.AuditedWrite[ZoneStage]{}, err
		}
		if _, err := importutil.RequireID(zoneID, "Zone"); err != nil {
			return fail(err)
		}
		input, err := datactx.Object(body, "Zone stage", []string{"stage", "reason"})
		if err != nil {
			return fail(err)
		}
		var zone *settingsZoneRow
		for _, z := range allSettingsZoneRows() {
			if z.ID == zoneID {
				row := z
				zone = &row
				break
			}
		}
		zone, err = datactx.RequireFound(zone, "Zone")
		if err != nil {
			return fail(err)
		}
		if err := reqctx.RequireWriteZone(rc, &zone.ID); err != nil {
			return fail(err)
		}
		stage, err := datactx.EnumOf(input, "stage", settingsStages)
		if err != nil {
			return fail(err)
		}
		reason, err := datactx.NullableString(input, "reason", datactx.StrOpts{Max: 300, HasMax: true})
		if err != nil {
			return fail(err)
		}
		before := "shadow"
		stored, key, err := storedStage(ctx, rc.CustomerID, zone.ID)
		if err != nil {
			return fail(err)
		}
		if stored != nil {
			before = stored.Stage
		}
		if key == "" {
			key = stageKeyFor(*zone)
		}
		var by *string
		if rc.UserID != "" {
			u := rc.UserID
			by = &u
		}
		value := ZoneStage{ZoneID: zone.ID, Stage: stage, UpdatedAt: datactx.NowISO(), UpdatedBy: by, DataSource: recordsource.Get()}
		if err := settingsstore.Put(ctx, rc.CustomerID, key, value); err != nil {
			return fail(err)
		}
		var reasonAny any
		if reason != nil {
			reasonAny = *reason
		}
		return auditlog.AuditedWrite[ZoneStage]{
			Result: value, EntityID: &zone.ID,
			SummaryEn: fmt.Sprintf("Live-assignment stage of %s changed from %s to %s.", zone.NameEn, before, stage),
			Detail:    sumDetail(map[string]any{"zone_id": zone.ID, "from": before, "to": stage, "reason": reasonAny}, map[string]any{"zone": zone.NameEn, "from": fmt.Sprint(before), "to": fmt.Sprint(stage)}),
		}, nil
	})
}

var defaultReasonCodes = []ReasonCodeInfo{
	{Code: "agent_unavailable", NameEn: "Agent unavailable"},
	{Code: "vehicle_unavailable", NameEn: "Vehicle unavailable"},
	{Code: "closer_agent_known", NameEn: "Closer agent known"},
	{Code: "skills_needed", NameEn: "Skills needed"},
	{Code: "dispatcher_judgement", NameEn: "Dispatcher judgement"},
	{Code: "other", NameEn: "Other (note required)", RequiresNote: true},
}

// GetOverrideReasonCodes mirrors getOverrideReasonCodes.
func GetOverrideReasonCodes(rc reqctx.RequestContext) ([]ReasonCodeInfo, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformSession); err != nil {
		return nil, err
	}
	return settingsstore.Get(context.Background(), rc.CustomerID, "override.reason_codes", defaultReasonCodes)
}

// GetSkillVocabulary mirrors getSkillVocabulary.
func GetSkillVocabulary(rc reqctx.RequestContext) ([]SkillInfo, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformSession); err != nil {
		return nil, err
	}
	return settingsstore.Get(context.Background(), rc.CustomerID, "skills.vocabulary", []SkillInfo{})
}

// ListSettings mirrors listSettings.
func ListSettings(rc reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[Setting], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminDataSources, access.AccessView); err != nil {
		return datactx.PageResult[Setting]{}, err
	}
	entries, err := settingsstore.Entries(context.Background(), rc.CustomerID)
	if err != nil {
		return datactx.PageResult[Setting]{}, err
	}
	rows := make([]Setting, 0, len(entries))
	for _, e := range entries {
		if strings.HasPrefix(e.Key, "dispatch.") {
			continue
		}
		rows = append(rows, Setting{
			BaseRecord: datactx.BaseRecord{ID: e.ID, TenantID: e.TenantID, CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt, CreatedBy: e.CreatedBy, DataSource: e.DataSource},
			Key:        e.Key, Value: e.Value,
		})
	}
	return datactx.Paginate(rows, query)
}

var demoTodayPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// DemoToday is Today (setting demo.today).
func DemoToday(tenant string) string {
	return Today(tenant)
}

// GetDemoToday mirrors getDemoToday.
func GetDemoToday(rc reqctx.RequestContext) (string, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformSession); err != nil {
		return "", err
	}
	return DemoToday(rc.CustomerID), nil
}

// GetZoneStage: one zone's stage (shadow when none stored).
func GetZoneStage(rc reqctx.RequestContext, zoneID string) (string, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformSession); err != nil {
		return "", err
	}
	s, _, err := storedStage(context.Background(), rc.CustomerID, zoneID)
	if err != nil {
		return "", err
	}
	if s != nil {
		return s.Stage, nil
	}
	return "shadow", nil
}

// GetRawSetting: a stored value for the other TS modules.
func GetRawSetting(rc reqctx.RequestContext, key string) (any, bool, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformSession); err != nil {
		return nil, false, err
	}
	entries, err := settingsstore.Entries(context.Background(), rc.CustomerID)
	if err != nil {
		return nil, false, err
	}
	for _, e := range entries {
		if e.Key == key {
			return e.Value, true, nil
		}
	}
	return nil, false, nil
}

// PutRawSetting: no audit; the calling module audits.
func PutRawSetting(rc reqctx.RequestContext, key string, value any) error {
	if err := datactx.RequirePlatform(rc, datactx.PlatformSession); err != nil {
		return err
	}
	if key == "" {
		return dataerr.Invalid("Setting key is required.")
	}
	if err := forecastcal.ValidateSetting(key, value); err != nil {
		return dataerr.Invalid(err.Error())
	}
	if err := forecasthist.ValidateSetting(key, value); err != nil {
		return dataerr.Invalid(err.Error())
	}
	if err := ValidateOutlookSetting(key, value); err != nil {
		return dataerr.Invalid(err.Error())
	}
	if err := validPlanningSetting(key, value); err != nil {
		return dataerr.Invalid(err.Error())
	}
	if err := validKPISetting(key, value); err != nil {
		return dataerr.Invalid(err.Error())
	}
	if err := validOptimizerSetting(key, value); err != nil {
		return dataerr.Invalid(err.Error())
	}
	if err := validSkillSetting(key, value); err != nil {
		return dataerr.Invalid(err.Error())
	}
	if err := validBreakPrayerSetting(key, value); err != nil {
		return dataerr.Invalid(err.Error())
	}
	if err := validWeeklySetting(key, value); err != nil {
		return dataerr.Invalid(err.Error())
	}
	if err := validRemoteHandlingSetting(key, value); err != nil {
		return dataerr.Invalid(err.Error())
	}
	if err := validThresholdSetting(key, value); err != nil {
		return dataerr.Invalid(err.Error())
	}
	return settingsstore.Put(context.Background(), rc.CustomerID, key, value)
}

// ReadZoneStages: every readable zone's stage, for the api.
func ReadZoneStages(rc reqctx.RequestContext) ([]ZoneStage, error) {
	return readZoneStages(context.Background(), rc)
}
