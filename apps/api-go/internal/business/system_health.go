// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors system.ts's admin.system_health part.
package business

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

const appVersion = "0.0.0-a0"

// JobRun mirrors the contract type.
type JobRun struct {
	datactx.BaseRecord
	JobName    string  `json:"job_name"`
	Kind       string  `json:"kind"`
	Status     string  `json:"status"`
	StartedAt  *string `json:"started_at"`
	FinishedAt *string `json:"finished_at"`
	DurationMs *int    `json:"duration_ms"`
	Message    *string `json:"message"`
}

var (
	jobRunsMu  sync.Mutex
	jobRuns    []JobRun
	jobsSeeded bool
)

// ResetSystemHealthForTest clears both stores here.
func ResetSystemHealthForTest() {
	jobRunsMu.Lock()
	jobRuns = nil
	jobsSeeded = false
	jobRunsMu.Unlock()
	diagnosticsMu.Lock()
	diagnostics = nil
	diagnosticsMu.Unlock()
}

// UpsertJobRunForTest: no fixture loader yet.
func UpsertJobRunForTest(j JobRun) {
	jobRunsMu.Lock()
	defer jobRunsMu.Unlock()
	for i, x := range jobRuns {
		if x.ID == j.ID {
			jobRuns[i] = j
			return
		}
	}
	jobRuns = append(jobRuns, j)
}

// finishISO: start + duration + 3h, +03:00.
func finishISO(start string, ms int) string {
	t, err := datactx.EpochOf(start)
	if err != nil {
		return start
	}
	at := t.Add(time.Duration(ms)*time.Millisecond + 3*time.Hour)
	return at.UTC().Format("2006-01-02T15:04:05") + "+03:00"
}

type seedJobRow struct {
	jobName string
	kind    string
	status  string
	start   string
	ms      int
	message *string
}

// seedJobs mirrors the literal seedJobs sample data.
func seedJobs(ctx reqctx.RequestContext) []JobRun {
	rows := []seedJobRow{
		{"nightly-forecast", "forecast", "succeeded", "2026-09-13T02:00:00+03:00", 240_000, nil},
		{"nightly-forecast", "forecast", "succeeded", "2026-09-12T02:00:00+03:00", 236_000, nil},
		{"rollup-refresh", "rollup", "succeeded", "2026-09-13T06:00:00+03:00", 18_000, nil},
		{"rollup-refresh", "rollup", "succeeded", "2026-09-13T05:00:00+03:00", 17_500, nil},
		{"rollup-refresh", "rollup", "succeeded", "2026-09-13T04:00:00+03:00", 17_000, nil},
		{"roster-optimise", "roster", "succeeded", "2026-09-12T20:30:00+03:00", 95_000, nil},
		{"import-validate", "import", "succeeded", "2026-09-12T18:10:00+03:00", 42_000, strPtr("Validated with 3 errors and 1 warning.")},
		{"import-validate", "import", "failed", "2026-09-11T11:00:00+03:00", 900, strPtr("The file header is missing required columns.")},
		{"assignment-shadow", "assignment", "succeeded", "2026-09-12T23:59:00+03:00", 3_000, nil},
		{"data-retention", "retention", "succeeded", "2026-09-13T03:30:00+03:00", 61_000, nil},
		{"position-history-trim", "retention", "succeeded", "2026-09-13T03:40:00+03:00", 8_000, nil},
	}
	out := make([]JobRun, len(rows))
	for i, r := range rows {
		start := r.start
		finished := finishISO(start, r.ms)
		ms := r.ms
		out[i] = JobRun{
			BaseRecord: datactx.SystemRecord(ctx, "job|"+strconv.Itoa(i), start),
			JobName:    r.jobName, Kind: r.kind, Status: r.status,
			StartedAt: &start, FinishedAt: &finished, DurationMs: &ms, Message: r.message,
		}
	}
	return out
}

func seedJobsOnce(ctx reqctx.RequestContext) {
	jobRunsMu.Lock()
	if jobsSeeded {
		jobRunsMu.Unlock()
		return
	}
	jobRunsMu.Unlock()
	for _, j := range seedJobs(ctx) {
		UpsertJobRunForTest(j)
	}
	jobRunsMu.Lock()
	jobsSeeded = true
	jobRunsMu.Unlock()
}

func allJobRuns() []JobRun {
	jobRunsMu.Lock()
	defer jobRunsMu.Unlock()
	out := make([]JobRun, len(jobRuns))
	copy(out, jobRuns)
	return out
}

// adminUserID: real Administrator, not emergency.
func adminUserID(ctx context.Context) *string {
	for _, u := range usersOrLog(ctx, ambientTenant()) {
		if u.AssignedRole == access.RoleAdministrator && !u.IsEmergencyAdmin {
			id := u.ID
			return &id
		}
	}
	return nil
}

// JobRunQuery mirrors listJobRuns' query.
type JobRunQuery struct {
	Limit        int
	Cursor       string
	From, To     string
	Status, Kind string
}

// ListJobRuns mirrors listJobRuns.
func ListJobRuns(ctx reqctx.RequestContext, query JobRunQuery) (datactx.PageResult[JobRun], error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminSystemHealth, access.AccessView); err != nil {
		return datactx.PageResult[JobRun]{}, err
	}
	all, err := loadJobRuns(context.Background(), ctx)
	if err != nil {
		return datactx.PageResult[JobRun]{}, err
	}
	var rows []JobRun
	for _, j := range all {
		if query.Status != "" && j.Status != query.Status {
			continue
		}
		if query.Kind != "" && j.Kind != query.Kind {
			continue
		}
		if j.StartedAt != nil {
			inRange, err := datactx.InTimeRange(*j.StartedAt, query.From, query.To)
			if err != nil {
				return datactx.PageResult[JobRun]{}, err
			}
			if !inRange {
				continue
			}
		}
		rows = append(rows, j)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		ai := rows[i].CreatedAt
		if rows[i].StartedAt != nil {
			ai = *rows[i].StartedAt
		}
		bi := rows[j].CreatedAt
		if rows[j].StartedAt != nil {
			bi = *rows[j].StartedAt
		}
		ta, errA := datactx.EpochOf(ai)
		tb, errB := datactx.EpochOf(bi)
		if errA == nil && errB == nil && !ta.Equal(tb) {
			return ta.After(tb)
		}
		return rows[i].ID < rows[j].ID
	})
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// HealthComponent is one HealthOverview row.
type HealthComponent struct {
	Name   string  `json:"name"`
	Status string  `json:"status"`
	Detail *string `json:"detail"`
}

// HealthFeed is one row of HealthOverview.feeds.
type HealthFeed struct {
	IntegrationID string  `json:"integration_id"`
	NameEn        string  `json:"name_en"`
	Health        string  `json:"health"`
	LastSuccessAt *string `json:"last_success_at"`
}

// HealthOverview mirrors the contract type.
type HealthOverview struct {
	AsOf             string            `json:"as_of"`
	Overall          string            `json:"overall"`
	Components       []HealthComponent `json:"components"`
	Feeds            []HealthFeed      `json:"feeds"`
	LastJobFailureAt *string           `json:"last_job_failure_at"`
	DataSource       string            `json:"data_source"`
}

// GetSystemHealth mirrors getSystemHealth.
func GetSystemHealth(ctx reqctx.RequestContext) (HealthOverview, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminSystemHealth, access.AccessView); err != nil {
		return HealthOverview{}, err
	}
	seedJobsOnce(ctx)
	integrations, err := allIntegrations(context.Background(), ctx.CustomerID)
	if err != nil {
		return HealthOverview{}, err
	}
	var failures []JobRun
	for _, j := range allJobRuns() {
		if j.Status == "failed" && j.FinishedAt != nil {
			failures = append(failures, j)
		}
	}
	sort.SliceStable(failures, func(i, j int) bool {
		ti, _ := datactx.EpochOf(*failures[i].FinishedAt)
		tj, _ := datactx.EpochOf(*failures[j].FinishedAt)
		return ti.After(tj)
	})
	updateStatus, updateDetail := "unknown", "Updates are operated by the vendor in this install mode"
	if ctx.InstallMode == access.InstallPrivate {
		updateStatus, updateDetail = "ok", "Stub"
	}
	enginesStatus, enginesDetail := enginesComponent(ctx.CustomerID)
	components := []HealthComponent{
		{Name: "web", Status: "ok", Detail: strPtr("Version " + appVersion)},
		{Name: "api", Status: "ok", Detail: strPtr("demo mode: data functions on the demo store")},
		{Name: "worker", Status: "ok"},
		{Name: "engines", Status: enginesStatus, Detail: strPtr(enginesDetail)},
		{Name: "database", Status: "ok", Detail: strPtr(healthStoreBackend.databaseDetail(context.Background(), ctx))},
		{Name: "keycloak", Status: "unknown", Detail: strPtr("Not used in demo mode (demo sign-in)")},
		{Name: "object_storage", Status: "ok"},
		{Name: "update_agent", Status: updateStatus, Detail: strPtr(updateDetail)},
	}
	feeds := make([]HealthFeed, len(integrations))
	var statuses []string
	for _, c := range components {
		statuses = append(statuses, c.Status)
	}
	for i, in := range integrations {
		feeds[i] = HealthFeed{IntegrationID: in.ID, NameEn: in.NameEn, Health: in.Health, LastSuccessAt: in.LastSuccessAt}
		if in.IsEnabled {
			statuses = append(statuses, in.Health)
		}
	}
	var lastFailure *string
	if len(failures) > 0 {
		lastFailure = failures[0].FinishedAt
	}
	return HealthOverview{
		AsOf: datactx.NowISO(), Overall: worstHealth(statuses), Components: components, Feeds: feeds,
		LastJobFailureAt: lastFailure, DataSource: "SYNTHETIC",
	}, nil
}

// StorageArea is one row of StorageStatus.areas.
type StorageArea struct {
	Area      string `json:"area"`
	UsedBytes int64  `json:"used_bytes"`
}

// StorageStatus mirrors the contract type.
type StorageStatus struct {
	CheckedAt  string        `json:"checked_at"`
	UsedBytes  int64         `json:"used_bytes"`
	TotalBytes int64         `json:"total_bytes"`
	Areas      []StorageArea `json:"areas"`
}

// GetStorageStatus mirrors getStorageStatus.
func GetStorageStatus(ctx reqctx.RequestContext) (StorageStatus, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminSystemHealth, access.AccessView); err != nil {
		return StorageStatus{}, err
	}
	const gb int64 = 1024 * 1024 * 1024
	gbf := float64(gb)
	areas := []StorageArea{
		{Area: "import_files", UsedBytes: int64(math.Round(0.6 * gbf))},
		{Area: "exports", UsedBytes: int64(math.Round(0.2 * gbf))},
		{Area: "backups", UsedBytes: int64(math.Round(0.9 * gbf))},
		{Area: "other", UsedBytes: int64(math.Round(1.2 * gbf))},
	}
	var used int64
	for _, a := range areas {
		used += a.UsedBytes
	}
	return StorageStatus{CheckedAt: datactx.NowISO(), UsedBytes: used, TotalBytes: 100 * gb, Areas: areas}, nil
}

// BackupStatus mirrors the contract type.
type BackupStatus struct {
	LastConfirmedAt   string  `json:"last_confirmed_at"`
	ConfirmedByUserID *string `json:"confirmed_by_user_id"`
	Source            string  `json:"source"`
	Note              *string `json:"note"`
	RestoreDrillDueAt string  `json:"restore_drill_due_at"`
}

func defaultBackup(ctx context.Context) BackupStatus {
	return BackupStatus{
		LastConfirmedAt: "2026-08-30T02:00:00+03:00", ConfirmedByUserID: adminUserID(ctx),
		Source: "customer_reported", RestoreDrillDueAt: "2026-09-30",
	}
}

const backupStatusKey = "backup.status"

// GetBackupStatus mirrors getBackupStatus.
func GetBackupStatus(ctx reqctx.RequestContext) (BackupStatus, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminSystemHealth, access.AccessView); err != nil {
		return BackupStatus{}, err
	}
	return backupStatusStore(context.Background(), ctx.CustomerID)
}

func backupStatusStore(ctx context.Context, tenant string) (BackupStatus, error) {
	return settingsstore.Get(ctx, tenant, backupStatusKey, defaultBackup(ctx))
}

// ConfirmBackup mirrors confirmBackup.
func ConfirmBackup(ctx reqctx.RequestContext, body any) (BackupStatus, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminSystemHealth}, auditlog.WriteMeta{Action: "backup.confirmed", EntityType: "backup"}, func(uctx context.Context) (auditlog.AuditedWrite[BackupStatus], error) {
		input, err := datactx.Object(body, "Backup confirmation", []string{"note"})
		if err != nil {
			return auditlog.AuditedWrite[BackupStatus]{}, err
		}
		note, err := datactx.NullableString(input, "note", datactx.StrOpts{Max: 300, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[BackupStatus]{}, err
		}
		at := datactx.NowISO()
		userID := ctx.UserID
		status, err := backupStatusStore(uctx, ctx.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[BackupStatus]{}, err
		}
		status.LastConfirmedAt = at
		status.ConfirmedByUserID = &userID
		status.Source = "customer_reported"
		status.Note = note
		if err := settingsstore.Put(uctx, ctx.CustomerID, backupStatusKey, status); err != nil {
			return auditlog.AuditedWrite[BackupStatus]{}, err
		}
		return auditlog.AuditedWrite[BackupStatus]{Result: status, SummaryEn: "Backup confirmed by the Administrator.", Detail: map[string]any{"note": note}}, nil
	})
}

// DiagnosticsBundle mirrors the contract type.
type DiagnosticsBundle struct {
	ID                  string   `json:"id"`
	GeneratedAt         string   `json:"generated_at"`
	GeneratedByUserID   string   `json:"generated_by_user_id"`
	SizeBytes           int      `json:"size_bytes"`
	PersonalDataRemoved bool     `json:"personal_data_removed"`
	Includes            []string `json:"includes"`
}

var (
	diagnosticsMu sync.Mutex
	diagnostics   []DiagnosticsBundle
)

func upsertDiagnosticsBundleMemory(b DiagnosticsBundle) {
	diagnosticsMu.Lock()
	defer diagnosticsMu.Unlock()
	for i, x := range diagnostics {
		if x.ID == b.ID {
			diagnostics[i] = b
			return
		}
	}
	diagnostics = append(diagnostics, b)
}

func oneDiagnosticsBundleMemory(id string) *DiagnosticsBundle {
	diagnosticsMu.Lock()
	defer diagnosticsMu.Unlock()
	for _, b := range diagnostics {
		if b.ID == id {
			return &b
		}
	}
	return nil
}

// settingsSnapshotForDiagnostics mirrors the
// getSettingsSnapshot fields diagnosticsFiles
// uses. Most are placeholders
// defaults); localization is the real value.
func settingsSnapshotForDiagnostics(ctx reqctx.RequestContext) map[string]any {
	loc, _ := GetLocalizationSettings(ctx)
	return map[string]any{
		"clock_start":              "assignment",
		"planning_level":           "zone",
		"fallback_timeout_seconds": 5,
		"install_mode":             string(ctx.InstallMode),
		"zones":                    0,
		"localization":             loc,
	}
}

func diagnosticsFiles(ctx reqctx.RequestContext) ([]struct{ Name, Text string }, error) {
	settingsJSON, err := json.MarshalIndent(settingsSnapshotForDiagnostics(ctx), "", "  ")
	if err != nil {
		return nil, err
	}
	health, err := GetSystemHealth(ctx)
	if err != nil {
		return nil, err
	}
	healthJSON, err := json.MarshalIndent(health, "", "  ")
	if err != nil {
		return nil, err
	}
	jobs, err := ListJobRuns(ctx, JobRunQuery{Limit: 50})
	if err != nil {
		return nil, err
	}
	jobsJSON, err := json.MarshalIndent(jobs.Items, "", "  ")
	if err != nil {
		return nil, err
	}
	return []struct{ Name, Text string }{
		{"README.txt", "OpenDispatch diagnostics. Logs and settings only. Case data and personal data are removed. Nothing is sent automatically.\n"},
		{"settings.json", string(settingsJSON)},
		{"health.json", string(healthJSON)},
		{"jobs.json", string(jobsJSON)},
	}, nil
}

// buildDiagnosticsZip: a real ZIP via stdlib
// (uncompressed), unlike TS's hand-rolled
// binary writer -- only contents matter here.
func buildDiagnosticsZip(ctx reqctx.RequestContext) ([]byte, error) {
	files, err := diagnosticsFiles(ctx)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, f := range files {
		hdr := &zip.FileHeader{Name: f.Name, Method: zip.Store}
		fw, err := w.CreateHeader(hdr)
		if err != nil {
			return nil, err
		}
		if _, err := fw.Write([]byte(f.Text)); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// CreateDiagnosticsBundle mirrors the TS fn.
func CreateDiagnosticsBundle(ctx reqctx.RequestContext) (DiagnosticsBundle, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminSystemHealth}, auditlog.WriteMeta{Action: "diagnostics.created", EntityType: "diagnostics_bundle"}, func(uctx context.Context) (auditlog.AuditedWrite[DiagnosticsBundle], error) {
		zipBytes, err := buildDiagnosticsZip(ctx)
		if err != nil {
			return auditlog.AuditedWrite[DiagnosticsBundle]{}, err
		}
		id := datactx.NewID()
		bundle := DiagnosticsBundle{
			ID: id, GeneratedAt: datactx.NowISO(), GeneratedByUserID: ctx.UserID,
			SizeBytes: len(zipBytes), PersonalDataRemoved: true,
			Includes: []string{"Settings", "Health overview", "Job runs"},
		}
		if err := saveDiagnosticsBundle(uctx, ctx.CustomerID, bundle); err != nil {
			return auditlog.AuditedWrite[DiagnosticsBundle]{}, err
		}
		return auditlog.AuditedWrite[DiagnosticsBundle]{Result: bundle, EntityID: &id, SummaryEn: "Diagnostics file created. It stays in the install until the Administrator sends it."}, nil
	})
}

// DiagnosticsDownload mirrors the TS result.
type DiagnosticsDownload struct {
	FileName      string `json:"file_name"`
	ContentType   string `json:"content_type"`
	ContentBase64 string `json:"content_base64"`
}

// DownloadDiagnosticsBundle mirrors the TS fn.
func DownloadDiagnosticsBundle(ctx reqctx.RequestContext, id string) (DiagnosticsDownload, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminSystemHealth, access.AccessView); err != nil {
		return DiagnosticsDownload{}, err
	}
	if _, err := importutil.RequireID(id, "Diagnostics bundle"); err != nil {
		return DiagnosticsDownload{}, err
	}
	bundle, err := loadDiagnosticsBundle(context.Background(), ctx.CustomerID, id)
	if err != nil {
		return DiagnosticsDownload{}, err
	}
	if bundle == nil {
		return DiagnosticsDownload{}, dataerr.NotFound("Diagnostics bundle not found.")
	}
	zipBytes, err := buildDiagnosticsZip(ctx)
	if err != nil {
		return DiagnosticsDownload{}, err
	}
	datePart := bundle.GeneratedAt
	if len(datePart) > 10 {
		datePart = datePart[:10]
	}
	return DiagnosticsDownload{
		FileName: "opendispatch-diagnostics-" + datePart + ".zip", ContentType: "application/zip",
		ContentBase64: base64.StdEncoding.EncodeToString(zipBytes),
	}, nil
}

// HealthStatus mirrors the contract type.
type HealthStatus struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// GetLiveness mirrors getLiveness.
func GetLiveness(ctx reqctx.RequestContext) (HealthStatus, error) {
	if err := datactx.RequirePlatform(ctx, datactx.PlatformSession); err != nil {
		return HealthStatus{}, err
	}
	return HealthStatus{Status: "ok", Version: appVersion}, nil
}

// GetReadiness mirrors getReadiness.
func GetReadiness(ctx reqctx.RequestContext) (HealthStatus, error) {
	if err := datactx.RequirePlatform(ctx, datactx.PlatformSession); err != nil {
		return HealthStatus{}, err
	}
	rows, err := allIntegrations(context.Background(), ctx.CustomerID)
	if err != nil {
		return HealthStatus{}, err
	}
	var healths []string
	for _, in := range rows {
		if in.IsEnabled {
			healths = append(healths, in.Health)
		}
	}
	overall := worstHealth(healths)
	status := "degraded"
	if overall == "healthy" {
		status = "ok"
	} else if overall == "down" {
		status = "down"
	}
	return HealthStatus{Status: status, Version: appVersion}, nil
}
