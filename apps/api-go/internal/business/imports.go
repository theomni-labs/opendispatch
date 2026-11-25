// SPDX-License-Identifier: AGPL-3.0-only

// Ports imports.ts (admin.data_import_quality, flow
// 5): upload a customer-format file, validate it against
// config/mappings/, compare with cases already held,
// dry-run the cut-over, then cut over.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"

	"github.com/jackc/pgx/v5"
)

const maxImportFileChars = 8_000_000

var importIssueStatuses = []string{"open", "acknowledged", "resolved", "ignored"}

// -------------------------------------------------
// Mappings (config/mappings/*.json)
// -------------------------------------------------

// MappingColumn mirrors MappingColumn.
type MappingColumn struct {
	DefaultColumn string    `json:"default_column"`
	InternalField string    `json:"internal_field"`
	Type          string    `json:"type"`
	Required      bool      `json:"required"`
	References    string    `json:"references"`
	Range         []float64 `json:"range"`
	Minimum       *float64  `json:"minimum"`
	// Extra: kept in the case's extra.
	Extra   bool     `json:"extra"`
	Values  []string `json:"values"`
	Allowed []string `json:"allowed"`
	// Position: 0-based column, headerless files.
	Position *int `json:"position"`
	// Compose, IfEmpty: templates of {field}.
	Compose string `json:"compose"`
	IfEmpty string `json:"if_empty"`
}

// ImportMapping mirrors Mapping.
type ImportMapping struct {
	MappingID string `json:"mapping_id"`
	Source    struct {
		FileType string `json:"file_type"`
		// HeaderRow: nil means true.
		HeaderRow  *bool    `json:"header_row"`
		NullValues []string `json:"null_values"`
	} `json:"source"`
	Columns []MappingColumn `json:"columns"`
	// ServiceArea: where a case may plausibly be.
	ServiceArea *struct {
		Latitude  []float64 `json:"latitude"`
		Longitude []float64 `json:"longitude"`
	} `json:"service_area"`
}

func loadMappings() ([]ImportMapping, error) {
	root, err := fixtures.RepoRoot()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(root, "config", "mappings")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	var out []ImportMapping
	for _, name := range names {
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return nil, err
		}
		var m ImportMapping
		if err := json.Unmarshal(body, &m); err != nil {
			return nil, err
		}
		if err := m.checkShape(); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

// ImportMappingColumnInfo mirrors the contract type.
type ImportMappingColumnInfo struct {
	SourceColumn  string `json:"source_column"`
	InternalField string `json:"internal_field"`
	Required      bool   `json:"required"`
}

// ImportMappingInfo mirrors the contract type.
type ImportMappingInfo struct {
	Version      string                    `json:"version"`
	NameEn       string                    `json:"name_en"`
	SourceFormat string                    `json:"source_format"`
	Columns      []ImportMappingColumnInfo `json:"columns"`
	BaseVersion  *string                   `json:"base_version"`
	Notes        *string                   `json:"notes"`
	CreatedAt    *string                   `json:"created_at"`
}

// ListImportMappings mirrors listImportMappings.
func ListImportMappings(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[ImportMappingInfo], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminDataImportQuality, access.AccessView); err != nil {
		return datactx.PageResult[ImportMappingInfo]{}, err
	}
	mappings, err := tenantMappings(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[ImportMappingInfo]{}, err
	}
	infos := make([]ImportMappingInfo, len(mappings))
	for i, m := range mappings {
		infos[i] = mappingInfoOf(m)
	}
	return datactx.Paginate(infos, query)
}

// -------------------------------------------------
// ImportJob / DataQualityIssue (live Postgres)
// -------------------------------------------------

// ImportJob mirrors the contract type.
type ImportJob struct {
	datactx.BaseRecord
	FileName       string  `json:"file_name"`
	MappingVersion string  `json:"mapping_version"`
	Status         string  `json:"status"`
	RowCount       int     `json:"row_count"`
	IssueCount     int     `json:"issue_count"`
	ErrorCount     int     `json:"error_count"`
	WarningCount   int     `json:"warning_count"`
	StorageRef     *string `json:"storage_ref"`
	ValidatedAt    *string `json:"validated_at"`
	CutOverAt      *string `json:"cut_over_at"`
	ImportStep
}

const importJobColumns = `id, tenant_id, created_at, updated_at, created_by, data_source, file_name, mapping_version, status, row_count, issue_count, error_count, warning_count, storage_ref, validated_at, cut_over_at`

func scanImportJob(row pgx.Row) (ImportJob, error) {
	var j ImportJob
	var createdAt, updatedAt time.Time
	var validatedAt, cutOverAt *time.Time
	var rowCount, issueCount, errorCount, warningCount *int
	var st stepScan
	err := row.Scan(append([]any{&j.ID, &j.TenantID, &createdAt, &updatedAt, &j.CreatedBy, &j.DataSource, &j.FileName, &j.MappingVersion, &j.Status,
		&rowCount, &issueCount, &errorCount, &warningCount, &j.StorageRef, &validatedAt, &cutOverAt}, st.targets()...)...)
	if err != nil {
		return ImportJob{}, err
	}
	j.ImportStep = st.value()
	j.CreatedAt, j.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
	j.ValidatedAt, j.CutOverAt = nullableTimeToISO(validatedAt), nullableTimeToISO(cutOverAt)
	if rowCount != nil {
		j.RowCount = *rowCount
	}
	if issueCount != nil {
		j.IssueCount = *issueCount
	}
	if errorCount != nil {
		j.ErrorCount = *errorCount
	}
	if warningCount != nil {
		j.WarningCount = *warningCount
	}
	return j, nil
}

func allImportJobs(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]ImportJob, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]ImportJob, error) {
		rows, err := tx.Query(ctx, `SELECT `+importJobColumns+`, `+importStepColumns+` FROM import_jobs`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []ImportJob
		for rows.Next() {
			j, err := scanImportJob(rows)
			if err != nil {
				return nil, err
			}
			out = append(out, j)
		}
		return out, rows.Err()
	})
}

func oneImportJob(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*ImportJob, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (*ImportJob, error) {
		row := tx.QueryRow(ctx, `SELECT `+importJobColumns+`, `+importStepColumns+` FROM import_jobs WHERE id=$1`, id)
		j, err := scanImportJob(row)
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil, nil
			}
			return nil, err
		}
		return &j, nil
	})
}

func upsertImportJob(ctx context.Context, conn *tenancy.Connection, tenantID string, j ImportJob) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO import_jobs (`+importJobColumns+`)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
			ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$4, status=$9, row_count=$10, issue_count=$11,
				error_count=$12, warning_count=$13, storage_ref=$14, validated_at=$15, cut_over_at=$16`,
			j.ID, j.TenantID, j.CreatedAt, j.UpdatedAt, j.CreatedBy, j.DataSource, j.FileName, j.MappingVersion, j.Status,
			j.RowCount, j.IssueCount, j.ErrorCount, j.WarningCount, j.StorageRef, j.ValidatedAt, j.CutOverAt)
		return struct{}{}, err
	})
	return err
}

// DataQualityIssue mirrors the contract type.
type DataQualityIssue struct {
	datactx.BaseRecord
	ImportJobID *string `json:"import_job_id"`
	CaseID      *string `json:"case_id"`
	RowNumber   *int    `json:"row_number"`
	Field       *string `json:"field"`
	IssueType   string  `json:"issue_type"`
	Severity    string  `json:"severity"`
	Status      string  `json:"status"`
	Message     string  `json:"message"`
}

const dqiColumns = `id, tenant_id, created_at, updated_at, created_by, data_source, import_job_id, case_id, row_number, field, issue_type, severity, status, message`

func scanDataQualityIssue(row pgx.Row) (DataQualityIssue, error) {
	var i DataQualityIssue
	var createdAt, updatedAt time.Time
	err := row.Scan(&i.ID, &i.TenantID, &createdAt, &updatedAt, &i.CreatedBy, &i.DataSource, &i.ImportJobID, &i.CaseID,
		&i.RowNumber, &i.Field, &i.IssueType, &i.Severity, &i.Status, &i.Message)
	if err != nil {
		return DataQualityIssue{}, err
	}
	i.CreatedAt, i.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
	return i, nil
}

func dataQualityIssuesWhere(ctx context.Context, conn *tenancy.Connection, tenantID, where string, args ...any) ([]DataQualityIssue, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]DataQualityIssue, error) {
		rows, err := tx.Query(ctx, `SELECT `+dqiColumns+` FROM data_quality_issues`+where, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []DataQualityIssue
		for rows.Next() {
			i, err := scanDataQualityIssue(rows)
			if err != nil {
				return nil, err
			}
			out = append(out, i)
		}
		return out, rows.Err()
	})
}

func oneDataQualityIssue(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*DataQualityIssue, error) {
	rows, err := dataQualityIssuesWhere(ctx, conn, tenantID, ` WHERE id = $1`, id)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}

func upsertDataQualityIssueTx(ctx context.Context, tx pgx.Tx, i DataQualityIssue) error {
	_, err := tx.Exec(ctx, `INSERT INTO data_quality_issues (`+dqiColumns+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$4, status=$13, message=$14`,
		i.ID, i.TenantID, i.CreatedAt, i.UpdatedAt, i.CreatedBy, i.DataSource, i.ImportJobID, i.CaseID,
		i.RowNumber, i.Field, i.IssueType, i.Severity, i.Status, i.Message)
	return err
}

var bySeverityOrder = map[string]int{"error": 0, "warning": 1, "info": 2}

func issuesOf(ctx context.Context, conn *tenancy.Connection, tenantID string, jobID *string) ([]DataQualityIssue, error) {
	where, args := "", []any{}
	if jobID != nil {
		where, args = ` WHERE import_job_id = $1`, []any{*jobID}
	}
	out, err := dataQualityIssuesWhere(ctx, conn, tenantID, where, args...)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(a, b int) bool {
		if bySeverityOrder[out[a].Severity] != bySeverityOrder[out[b].Severity] {
			return bySeverityOrder[out[a].Severity] < bySeverityOrder[out[b].Severity]
		}
		ra, rb := 0, 0
		if out[a].RowNumber != nil {
			ra = *out[a].RowNumber
		}
		if out[b].RowNumber != nil {
			rb = *out[b].RowNumber
		}
		if ra != rb {
			return ra < rb
		}
		return out[a].ID < out[b].ID
	})
	return out, nil
}

// DataQualityIssueQuery: the list-issues query.
type DataQualityIssueQuery struct {
	Limit       int
	Cursor      string
	Status      string
	Severity    string
	ImportJobID string
}

// ListDataQualityIssues mirrors the TS function.
func ListDataQualityIssues(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query DataQualityIssueQuery) (datactx.PageResult[DataQualityIssue], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminDataImportQuality, access.AccessView); err != nil {
		return datactx.PageResult[DataQualityIssue]{}, err
	}
	var jobFilter *string
	if query.ImportJobID != "" {
		jobFilter = &query.ImportJobID
	}
	rows, err := issuesOf(ctx, conn, rc.CustomerID, jobFilter)
	if err != nil {
		return datactx.PageResult[DataQualityIssue]{}, err
	}
	var out []DataQualityIssue
	for _, i := range rows {
		if (query.Status == "" || i.Status == query.Status) && (query.Severity == "" || i.Severity == query.Severity) {
			out = append(out, i)
		}
	}
	return datactx.Paginate(out, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// ListImportIssues mirrors listImportIssues.
func ListImportIssues(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, query datactx.PageQuery) (datactx.PageResult[DataQualityIssue], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminDataImportQuality, access.AccessView); err != nil {
		return datactx.PageResult[DataQualityIssue]{}, err
	}
	if _, err := importutil.RequireID(id, "Import job"); err != nil {
		return datactx.PageResult[DataQualityIssue]{}, err
	}
	job, err := oneImportJob(ctx, conn, rc.CustomerID, id)
	if err != nil {
		return datactx.PageResult[DataQualityIssue]{}, err
	}
	if _, err := datactx.RequireFound(job, "Import job"); err != nil {
		return datactx.PageResult[DataQualityIssue]{}, err
	}
	rows, err := issuesOf(ctx, conn, rc.CustomerID, &id)
	if err != nil {
		return datactx.PageResult[DataQualityIssue]{}, err
	}
	return datactx.Paginate(rows, query)
}

// UpdateDataQualityIssue mirrors the TS function.
func UpdateDataQualityIssue(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (DataQualityIssue, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminDataImportQuality}, auditlog.WriteMeta{Action: "data_quality.issue_updated", EntityType: "data_quality_issue", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[DataQualityIssue], error) {
		if _, err := importutil.RequireID(id, "Data quality issue"); err != nil {
			return auditlog.AuditedWrite[DataQualityIssue]{}, err
		}
		existingRow, err := oneDataQualityIssue(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[DataQualityIssue]{}, err
		}
		existing, err := datactx.RequireFound(existingRow, "Issue")
		if err != nil {
			return auditlog.AuditedWrite[DataQualityIssue]{}, err
		}
		input, err := datactx.Object(body, "Issue update", []string{"status", "note"})
		if err != nil {
			return auditlog.AuditedWrite[DataQualityIssue]{}, err
		}
		status, err := datactx.EnumOf(input, "status", importIssueStatuses)
		if err != nil {
			return auditlog.AuditedWrite[DataQualityIssue]{}, err
		}
		note, err := datactx.NullableString(input, "note", datactx.StrOpts{HasMax: true, Max: 500})
		if err != nil {
			return auditlog.AuditedWrite[DataQualityIssue]{}, err
		}
		updated := *existing
		updated.Status, updated.UpdatedAt = status, datactx.NowISO()
		if err := tenancyWriteOneIssue(ctx, conn, rc.CustomerID, updated); err != nil {
			return auditlog.AuditedWrite[DataQualityIssue]{}, err
		}
		var jobID any
		if existing.ImportJobID != nil {
			jobID = *existing.ImportJobID
		}
		return auditlog.AuditedWrite[DataQualityIssue]{
			Result: updated, SummaryEn: fmt.Sprintf("Issue %s set to %s.", existing.IssueType, status),
			Detail: map[string]any{"import_job_id": jobID, "from": existing.Status, "to": status, "note": note},
		}, nil
	})
}

func tenancyWriteOneIssue(ctx context.Context, conn *tenancy.Connection, tenantID string, i DataQualityIssue) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, upsertDataQualityIssueTx(ctx, tx, i)
	})
	return err
}

// blockingIssues: open/acknowledged errors block a
// cut-over; resolved and ignored ones do not.
func blockingIssues(ctx context.Context, conn *tenancy.Connection, tenantID, jobID string) ([]DataQualityIssue, error) {
	rows, err := issuesOf(ctx, conn, tenantID, &jobID)
	if err != nil {
		return nil, err
	}
	var out []DataQualityIssue
	for _, i := range rows {
		if i.Severity == "error" && (i.Status == "open" || i.Status == "acknowledged") {
			out = append(out, i)
		}
	}
	return out, nil
}

// -------------------------------------------------
// Parsing and validating a file
// -------------------------------------------------

type importIssueSpec struct {
	RowNumber *int
	Field     *string
	IssueType string
	Severity  string
	Message   string
}

var importLabels = map[string]string{"registered_at": "Registration time", "external_id": "Case id", "case_number": "Case number"}

var importLocalLayouts = []string{"2006-01-02 15:04:05", "2006-01-02T15:04:05", "2006-01-02 15:04", "2006-01-02T15:04"}

// importToIso: ISO 8601 or Riyadh local; else nil.
func importToIso(value string) *string {
	text := strings.TrimSpace(value)
	if len(text) < 16 {
		return nil
	}
	for _, layout := range importLocalLayouts {
		if t, err := time.ParseInLocation(layout, text, riyadhZone); err == nil {
			iso := t.Format(time.RFC3339Nano)
			return &iso
		}
	}
	if _, err := time.Parse(time.RFC3339Nano, text); err == nil && text[10] == 'T' {
		return &text
	}
	return nil
}

type importReferenceRow struct {
	ID, NameEn string
	Lat, Lon   float64
	HasCentre  bool
}

type importReferences struct {
	Cities    map[string]importReferenceRow
	Zones     map[string]importReferenceRow
	SubZones  map[string]importReferenceRow
	CaseTypes map[string]importReferenceRow
}

func indexByExternalID[T any](rows []T, externalID func(T) *string, id func(T) string, nameEn func(T) string) map[string]importReferenceRow {
	out := map[string]importReferenceRow{}
	for _, r := range rows {
		if ext := externalID(r); ext != nil && *ext != "" {
			out[*ext] = importReferenceRow{ID: id(r), NameEn: nameEn(r)}
		}
	}
	return out
}

func buildImportReferences(ctx context.Context, conn *tenancy.Connection, tenantID string) (importReferences, error) {
	cities, err := allCities(ctx, conn, tenantID)
	if err != nil {
		return importReferences{}, err
	}
	zones, err := allZones(ctx, conn, tenantID)
	if err != nil {
		return importReferences{}, err
	}
	subZones, err := allSubZones(ctx, conn, tenantID)
	if err != nil {
		return importReferences{}, err
	}
	caseTypes, err := allCaseTypesLive(ctx, conn, tenantID)
	if err != nil {
		return importReferences{}, err
	}
	subs := indexByExternalID(subZones, func(s SubZone) *string { return s.ExternalID }, func(s SubZone) string { return s.ID }, func(s SubZone) string { return s.NameEn })
	for _, sz := range subZones {
		if sz.ExternalID != nil && (sz.Latitude != 0 || sz.Longitude != 0) {
			r := subs[*sz.ExternalID]
			r.Lat, r.Lon, r.HasCentre = sz.Latitude, sz.Longitude, true
			subs[*sz.ExternalID] = r
		}
	}
	return importReferences{
		Cities:    indexByExternalID(cities, func(c City) *string { return c.ExternalID }, func(c City) string { return c.ID }, func(c City) string { return c.NameEn }),
		Zones:     indexByExternalID(zones, func(z Zone) *string { return z.ExternalID }, func(z Zone) string { return z.ID }, func(z Zone) string { return z.NameEn }),
		SubZones:  subs,
		CaseTypes: indexByExternalID(caseTypes, func(c CaseType) *string { return c.ExternalID }, func(c CaseType) string { return c.ID }, func(c CaseType) string { return c.NameEn }),
	}, nil
}

func importReferenceFor(refs importReferences, target string) map[string]importReferenceRow {
	switch target {
	case "cities.external_id":
		return refs.Cities
	case "zones.external_id":
		return refs.Zones
	case "sub_zones.external_id":
		return refs.SubZones
	case "case_types.external_id":
		return refs.CaseTypes
	}
	return nil
}

func strPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func upsertImportJobTx(ctx context.Context, tx pgx.Tx, j ImportJob) error {
	_, err := tx.Exec(ctx, `INSERT INTO import_jobs (`+importJobColumns+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$4, status=$9, row_count=$10, issue_count=$11,
			error_count=$12, warning_count=$13, storage_ref=$14, validated_at=$15, cut_over_at=$16`,
		j.ID, j.TenantID, j.CreatedAt, j.UpdatedAt, j.CreatedBy, j.DataSource, j.FileName, j.MappingVersion, j.Status,
		j.RowCount, j.IssueCount, j.ErrorCount, j.WarningCount, j.StorageRef, j.ValidatedAt, j.CutOverAt)
	return err
}

// -------------------------------------------------
// ReplayCase: the Phase-A-only scripted fixture
// jobs' stand-in (no migration; matches TS's own
// sync-store-only ReplayCase entity).
// -------------------------------------------------

var (
	replayCaseMu     sync.Mutex
	replayCaseRows   []Case
	replayCaseSeeded bool
)

// ResetReplayCasesForTest clears the snapshot.
func ResetReplayCasesForTest() {
	replayCaseMu.Lock()
	replayCaseRows, replayCaseSeeded = nil, true
	replayCaseMu.Unlock()
}

// ReloadReplayCasesForTest restores the fixtures.
func ReloadReplayCasesForTest() {
	replayCaseMu.Lock()
	replayCaseRows, replayCaseSeeded = nil, false
	replayCaseMu.Unlock()
}

// SeedReplayCasesForTest sets the snapshot.
func SeedReplayCasesForTest(rows []Case) {
	replayCaseMu.Lock()
	replayCaseRows, replayCaseSeeded = append([]Case(nil), rows...), true
	replayCaseMu.Unlock()
}

func allReplayCases() []Case {
	replayCaseMu.Lock()
	defer replayCaseMu.Unlock()
	if !replayCaseSeeded {
		if rows, err := fixtures.Records[Case]("ReplayCase"); err == nil {
			replayCaseRows = rows
		}
		replayCaseSeeded = true
	}
	return append([]Case(nil), replayCaseRows...)
}

// ListImportJobs mirrors listImportJobs.
func ListImportJobs(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[ImportJob], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminDataImportQuality, access.AccessView); err != nil {
		return datactx.PageResult[ImportJob]{}, err
	}
	if err := settleStaleSteps(ctx, conn, rc.CustomerID); err != nil {
		return datactx.PageResult[ImportJob]{}, err
	}
	rows, err := allImportJobs(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[ImportJob]{}, err
	}
	sort.SliceStable(rows, func(a, b int) bool {
		if rows[a].CreatedAt != rows[b].CreatedAt {
			return rows[a].CreatedAt > rows[b].CreatedAt
		}
		return rows[a].ID > rows[b].ID
	})
	return datactx.Paginate(rows, query)
}

// GetImportJob mirrors getImportJob.
func GetImportJob(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (ImportJob, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminDataImportQuality, access.AccessView); err != nil {
		return ImportJob{}, err
	}
	if _, err := importutil.RequireID(id, "Import job"); err != nil {
		return ImportJob{}, err
	}
	if err := settleStaleSteps(ctx, conn, rc.CustomerID); err != nil {
		return ImportJob{}, err
	}
	return importJobFor(ctx, conn, rc, id)
}
