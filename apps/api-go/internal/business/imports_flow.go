// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"io"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importstorage"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// importSources: labels an upload may carry.
var importSources = []string{"IMPORTED", "SYNTHETIC"}

// ImportUploadMeta: an upload's name and labels.
type ImportUploadMeta struct {
	FileName       string
	MappingVersion string
	// DataSource: "" means IMPORTED.
	DataSource string
}

var spreadsheetName = regexp.MustCompile(`(?i)\.xlsx?$`)

// checkUploadMeta validates and fills defaults.
func checkUploadMeta(ctx context.Context, conn *tenancy.Connection, tenantID string, m ImportUploadMeta) (ImportUploadMeta, *ImportMapping, error) {
	if m.FileName == "" {
		m.FileName = "upload.csv"
	}
	if len(m.FileName) > 255 {
		return m, nil, dataerr.Invalid("Import: file_name must have at most 255 characters.")
	}
	if m.DataSource == "" {
		m.DataSource = "IMPORTED"
	}
	known := false
	for _, s := range importSources {
		known = known || s == m.DataSource
	}
	if !known {
		return m, nil, dataerr.Invalid(fmt.Sprintf("Import: data_source must be one of %s.", strings.Join(importSources, ", ")))
	}
	if m.MappingVersion == "" || len(m.MappingVersion) > 64 {
		return m, nil, dataerr.Invalid("Import: mapping_version is required (at most 64 characters).")
	}
	mapping, err := mappingFor(ctx, conn, tenantID, m.MappingVersion)
	if err != nil {
		return m, nil, err
	}
	if mapping == nil {
		return m, nil, dataerr.Invalid(fmt.Sprintf("Import: there is no mapping version %s.", m.MappingVersion))
	}
	if spreadsheetName.MatchString(m.FileName) || mapping.Source.FileType != "csv" {
		return m, nil, dataerr.Invalid("Import: only CSV files are read. Export the sheet as CSV and upload that.")
	}
	return m, mapping, nil
}

// lineCounter counts non-empty lines it passes.
type lineCounter struct {
	r        io.Reader
	lines    int
	inLine   bool
	byteSeen int64
	readErr  error
}

func (c *lineCounter) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	for _, b := range p[:n] {
		switch b {
		case '\n':
			if c.inLine {
				c.lines++
			}
			c.inLine = false
		case '\r', ' ', '\t':
		default:
			c.inLine = true
		}
	}
	c.byteSeen += int64(n)
	if err != nil && err != io.EOF {
		c.readErr = err
	}
	if err == io.EOF && c.inLine {
		c.lines++
		c.inLine = false
	}
	return n, err
}

var uploadAudit = auditlog.WriteMeta{Action: "import.uploaded", EntityType: "import_job"}

// UploadImport: a small file sent as JSON text.
func UploadImport(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (ImportJob, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminDataImportQuality}, uploadAudit, func(ctx context.Context) (auditlog.AuditedWrite[ImportJob], error) {
		o, err := datactx.Object(body, "Import upload", []string{"file_name", "file", "mapping_version", "data_source"})
		if err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		fileName, _, err := datactx.OptString(o, "file_name", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 255})
		if err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		text, err := datactx.String(o, "file", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: maxImportFileChars})
		if err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		version, err := datactx.String(o, "mapping_version", datactx.StrOpts{HasMax: true, Max: 64})
		if err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		source, _, err := datactx.OptString(o, "data_source", datactx.StrOpts{HasMax: true, Max: 32})
		if err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		return uploadImport(ctx, conn, rc, ImportUploadMeta{FileName: fileName, MappingVersion: version, DataSource: source}, strings.NewReader(text))
	})
}

// UploadImportFile streams a file to storage.
func UploadImportFile(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, meta ImportUploadMeta, file io.Reader) (ImportJob, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminDataImportQuality}, uploadAudit, func(ctx context.Context) (auditlog.AuditedWrite[ImportJob], error) {
		return uploadImport(ctx, conn, rc, meta, file)
	})
}

func uploadImport(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, meta ImportUploadMeta, file io.Reader) (auditlog.AuditedWrite[ImportJob], error) {
	meta, mapping, err := checkUploadMeta(ctx, conn, rc.CustomerID, meta)
	if err != nil {
		return auditlog.AuditedWrite[ImportJob]{}, err
	}
	id := datactx.NewID()
	counter := &lineCounter{r: file}
	t0 := time.Now()
	size, err := importstorage.PutSource(ctx, rc.CustomerID, id, counter)
	if err != nil {
		_ = importstorage.RemoveJob(context.WithoutCancel(ctx), rc.CustomerID, id)
		if counter.readErr != nil {
			return auditlog.AuditedWrite[ImportJob]{}, fmt.Errorf("import upload: reading the file: %w", counter.readErr)
		}
		return auditlog.AuditedWrite[ImportJob]{}, storageUnavailable("upload "+id, err)
	}
	if size == 0 {
		_ = importstorage.RemoveJob(ctx, rc.CustomerID, id)
		return auditlog.AuditedWrite[ImportJob]{}, dataerr.Invalid("Import: the file is empty.")
	}
	at := datactx.NowISO()
	ref := importstorage.SourceRef(rc.CustomerID, id)
	job := ImportJob{
		BaseRecord: datactx.NewRecord(rc, id, at), FileName: meta.FileName, MappingVersion: meta.MappingVersion, Status: "uploaded",
		RowCount: max(counter.lines-1, 0), StorageRef: &ref,
	}
	if mapping.headerless() {
		job.RowCount = counter.lines
	}
	job.DataSource = meta.DataSource
	if err := upsertImportJob(ctx, conn, rc.CustomerID, job); err != nil {
		_ = importstorage.RemoveJob(context.WithoutCancel(ctx), rc.CustomerID, id)
		return auditlog.AuditedWrite[ImportJob]{}, err
	}
	log.Printf("import %s: uploaded %s, %d bytes, about %d rows, %s, in %.1fs", id, meta.FileName, size, job.RowCount, meta.DataSource, time.Since(t0).Seconds())
	jobID := job.ID
	return auditlog.AuditedWrite[ImportJob]{
		Result: job, EntityID: &jobID, SummaryEn: fmt.Sprintf("Import file %s uploaded (about %d rows, %s).", meta.FileName, job.RowCount, meta.DataSource),
		Detail: map[string]any{"mapping_version": meta.MappingVersion, "row_count": job.RowCount, "bytes": size, "data_source": meta.DataSource},
	}, nil
}

func importJobFor(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (ImportJob, error) {
	row, err := oneImportJob(ctx, conn, rc.CustomerID, id)
	if err != nil {
		return ImportJob{}, err
	}
	found, err := datactx.RequireFound(row, "Import job")
	if err != nil {
		return ImportJob{}, err
	}
	return *found, nil
}

// failMissingFile: the stored file is gone.
func failMissingFile(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, job ImportJob) error {
	next := job
	next.Status, next.UpdatedAt = "failed", datactx.NowISO()
	// kept although the audited write fails
	if err := upsertImportJob(tenancy.Detach(ctx), conn, rc.CustomerID, next); err != nil {
		return err
	}
	return dataerr.Conflict(fmt.Sprintf("The file of import %s is no longer in object storage, so the import has failed. Upload the file again.", job.FileName))
}

// openJobRows: the uploaded rows; nil if missing.
func openJobRows(ctx context.Context, rc reqctx.RequestContext, job ImportJob, mapping ImportMapping) (importRows, func(), error) {
	src, err := importstorage.OpenSource(ctx, rc.CustomerID, job.ID)
	if err != nil {
		return nil, nil, storageUnavailable("read "+job.ID, err)
	}
	if src != nil {
		rows, err := shapeRows(mapping, newCsvRows(src))
		if err != nil {
			src.Close()
			return nil, nil, err
		}
		return withRowCounter(ctx, rows), func() { src.Close() }, nil
	}
	table, found, err := importstorage.ReadLegacyTable(ctx, job.ID)
	if err != nil || !found {
		return nil, nil, err
	}
	return &tableRows{table: table}, func() {}, nil
}

// validationRecord: what the cut-over must skip.
type validationRecord struct {
	DataRows   int   `json:"data_rows"`
	ErrorLines []int `json:"error_lines"`
}

// ValidateImport streams the file's checks.
func ValidateImport(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (ImportJob, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminDataImportQuality}, auditlog.WriteMeta{Action: "import.validated", EntityType: "import_job", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[ImportJob], error) {
		if _, err := importutil.RequireID(id, "Import job"); err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		job, err := importJobFor(ctx, conn, rc, id)
		if err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		if job.Status == "cut_over" {
			return auditlog.AuditedWrite[ImportJob]{}, dataerr.Conflict("The import has already been cut over.")
		}
		if job.StorageRef == nil {
			return auditlog.AuditedWrite[ImportJob]{
				Result: job, SummaryEn: fmt.Sprintf("Import %s checked again: %d issues.", job.FileName, job.IssueCount),
				Detail: map[string]any{"issue_count": job.IssueCount, "scripted": true},
			}, nil
		}
		mapping, err := mappingFor(ctx, conn, rc.CustomerID, job.MappingVersion)
		if err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		if mapping == nil {
			return auditlog.AuditedWrite[ImportJob]{}, dataerr.NotFound("Mapping not found.")
		}
		rows, closeRows, err := openJobRows(ctx, rc, job, *mapping)
		if err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		if rows == nil {
			return auditlog.AuditedWrite[ImportJob]{}, failMissingFile(ctx, conn, rc, job)
		}
		defer closeRows()
		refs, err := buildImportReferences(ctx, conn, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		t0 := time.Now()
		result, err := validateRows(*mapping, rows, refs)
		if err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, fmt.Errorf("import %s: reading the file: %w", job.FileName, err)
		}
		log.Printf("import %s: validated %d rows in %.1fs: %d errors, %d warnings, %d notes", id, result.DataRows, time.Since(t0).Seconds(), result.Errors, result.Warnings, result.Infos)
		if err := importstorage.PutJSON(ctx, rc.CustomerID, id, importstorage.KindErrors, validationRecord{DataRows: result.DataRows, ErrorLines: result.ErrorLines}); err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, storageUnavailable("validate "+id, err)
		}
		at := datactx.NowISO()
		status := "validated"
		if result.HeaderFailed {
			status = "failed"
		}
		next := job
		next.Status, next.ValidatedAt, next.UpdatedAt = status, &at, at
		next.RowCount, next.IssueCount = result.DataRows, result.Errors+result.Warnings+result.Infos
		next.ErrorCount, next.WarningCount = result.Errors, result.Warnings
		_, writeErr := tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			if _, err := tx.Exec(ctx, `DELETE FROM data_quality_issues WHERE import_job_id = $1`, id); err != nil {
				return struct{}{}, err
			}
			if err := insertIssuesTx(ctx, tx, rc, job, at, result.Issues); err != nil {
				return struct{}{}, err
			}
			return struct{}{}, upsertImportJobTx(ctx, tx, next)
		})
		if writeErr != nil {
			return auditlog.AuditedWrite[ImportJob]{}, writeErr
		}
		if result.HeaderFailed {
			raiseNotification(ctx, rc, "import_failed", RaisedNotification{TitleEn: "Import failed", BodyEn: strPtrOrNil(fmt.Sprintf("%s could not be read.", job.FileName)), LinkPath: strPtr("/admin/data-import-quality")})
		}
		detail := map[string]any{"row_count": result.DataRows, "issue_count": next.IssueCount, "error_count": result.Errors, "warning_count": result.Warnings, "listed_issue_count": len(result.Issues)}
		if owner := escalateImportQuality(ctx, rc, next, result); owner != nil {
			detail["escalated_to"] = string(*owner)
		}
		return auditlog.AuditedWrite[ImportJob]{
			Result: next, SummaryEn: fmt.Sprintf("Import %s validated: %d rows, %d errors, %d warnings.", job.FileName, result.DataRows, result.Errors, result.Warnings),
			Detail: detail,
		}, nil
	})
}

// insertIssuesTx writes issues in batches.
func insertIssuesTx(ctx context.Context, tx pgx.Tx, rc reqctx.RequestContext, job ImportJob, at string, issues []importIssueSpec) error {
	const chunk = 5000
	createdBy := rc.UserID
	for start := 0; start < len(issues); start += chunk {
		part := issues[start:min(start+chunk, len(issues))]
		rowNumbers, fields := make([]*int32, len(part)), make([]*string, len(part))
		types, severities, messages := make([]string, len(part)), make([]string, len(part)), make([]string, len(part))
		for i, s := range part {
			if s.RowNumber != nil {
				n := int32(*s.RowNumber)
				rowNumbers[i] = &n
			}
			fields[i], types[i], severities[i], messages[i] = s.Field, s.IssueType, s.Severity, s.Message
		}
		_, err := tx.Exec(ctx, `INSERT INTO data_quality_issues (tenant_id, created_at, updated_at, created_by, data_source, import_job_id,
				row_number, field, issue_type, severity, status, message)
			SELECT $1::uuid, $2::timestamptz, $2::timestamptz, NULLIF($3, '')::uuid, $4, $5::uuid, r, f, t, s, 'open', m
			FROM unnest($6::int[], $7::text[], $8::text[], $9::text[], $10::text[]) AS u(r, f, t, s, m)`,
			rc.CustomerID, at, createdBy, job.DataSource, job.ID, rowNumbers, fields, types, severities, messages)
		if err != nil {
			return err
		}
	}
	return nil
}

func requireImportStatus(job ImportJob, allowed []string, action string) error {
	for _, s := range allowed {
		if job.Status == s {
			return nil
		}
	}
	return dataerr.Conflict(fmt.Sprintf("Cannot %s an import that is %s.", action, strings.ReplaceAll(job.Status, "_", " ")))
}

// ImportComparison mirrors the contract type.
type ImportComparison struct {
	ImportJobID            string `json:"import_job_id"`
	GeneratedAt            string `json:"generated_at"`
	ExistingCaseCount      int    `json:"existing_case_count"`
	IncomingCaseCount      int    `json:"incoming_case_count"`
	NewCount               int    `json:"new_count"`
	ChangedCount           int    `json:"changed_count"`
	UnchangedCount         int    `json:"unchanged_count"`
	MissingFromImportCount int    `json:"missing_from_import_count"`
	DataSource             string `json:"data_source"`
}

// CompareImport counts against the cases held.
func CompareImport(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (ImportComparison, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminDataImportQuality}, auditlog.WriteMeta{Action: "import.compared", EntityType: "import_job", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[ImportComparison], error) {
		if _, err := importutil.RequireID(id, "Import job"); err != nil {
			return auditlog.AuditedWrite[ImportComparison]{}, err
		}
		job, err := importJobFor(ctx, conn, rc, id)
		if err != nil {
			return auditlog.AuditedWrite[ImportComparison]{}, err
		}
		if err := requireImportStatus(job, []string{"validated", "compared", "dry_run_done"}, "compare"); err != nil {
			return auditlog.AuditedWrite[ImportComparison]{}, err
		}
		p, err := planImport(ctx, conn, rc, job, false, nil)
		if err != nil {
			return auditlog.AuditedWrite[ImportComparison]{}, err
		}
		existingCount, err := caseCountLive(ctx, conn, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[ImportComparison]{}, err
		}
		at := datactx.NowISO()
		comparison := ImportComparison{
			ImportJobID: id, GeneratedAt: at, ExistingCaseCount: existingCount, IncomingCaseCount: p.Incoming,
			NewCount: p.New, ChangedCount: p.Changed, UnchangedCount: p.Unchanged, MissingFromImportCount: p.Missing, DataSource: job.DataSource,
		}
		if job.Status == "validated" {
			next := job
			next.Status, next.UpdatedAt = "compared", at
			if err := upsertImportJob(ctx, conn, rc.CustomerID, next); err != nil {
				return auditlog.AuditedWrite[ImportComparison]{}, err
			}
		}
		return auditlog.AuditedWrite[ImportComparison]{
			Result: comparison, SummaryEn: fmt.Sprintf("Import %s compared: %d new, %d changed.", job.FileName, comparison.NewCount, comparison.ChangedCount),
			Detail: map[string]any{"new_count": comparison.NewCount, "changed_count": comparison.ChangedCount, "unchanged_count": comparison.UnchangedCount},
		}, nil
	})
}

// CutoverResult mirrors the contract type.
type CutoverResult struct {
	ImportJobID        string `json:"import_job_id"`
	DryRun             bool   `json:"dry_run"`
	Applied            bool   `json:"applied"`
	WouldInsert        int    `json:"would_insert"`
	WouldUpdate        int    `json:"would_update"`
	WouldSkip          int    `json:"would_skip"`
	BlockingIssueCount int    `json:"blocking_issue_count"`
	FinishedAt         string `json:"finished_at"`
	Message            string `json:"message"`
}

func cutoverResultOf(job ImportJob, p importPlanCounts, dryRun, applied bool, blocking int, message string) CutoverResult {
	return CutoverResult{ImportJobID: job.ID, DryRun: dryRun, Applied: applied, WouldInsert: p.New, WouldUpdate: p.Changed, WouldSkip: p.Skipped, BlockingIssueCount: blocking, FinishedAt: datactx.NowISO(), Message: message}
}

// DryRunCutover changes only the job's status.
func DryRunCutover(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (CutoverResult, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminDataImportQuality}, auditlog.WriteMeta{Action: "import.dry_run", EntityType: "import_job", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[CutoverResult], error) {
		if _, err := importutil.RequireID(id, "Import job"); err != nil {
			return auditlog.AuditedWrite[CutoverResult]{}, err
		}
		job, err := importJobFor(ctx, conn, rc, id)
		if err != nil {
			return auditlog.AuditedWrite[CutoverResult]{}, err
		}
		if err := requireImportStatus(job, []string{"compared", "dry_run_done"}, "dry-run"); err != nil {
			return auditlog.AuditedWrite[CutoverResult]{}, err
		}
		p, err := planImport(ctx, conn, rc, job, false, nil)
		if err != nil {
			return auditlog.AuditedWrite[CutoverResult]{}, err
		}
		blocking, err := blockingIssues(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[CutoverResult]{}, err
		}
		message := fmt.Sprintf("Dry run passed: %d to add, %d to update, %d rows skipped (errors or repeated RecordID).", p.New, p.Changed, p.Skipped)
		if len(blocking) > 0 {
			message = fmt.Sprintf("%d errors must be resolved or ignored before the cut-over.", len(blocking))
		}
		result := cutoverResultOf(job, p, true, false, len(blocking), message)
		if len(blocking) == 0 && job.Status == "compared" {
			next := job
			next.Status, next.UpdatedAt = "dry_run_done", datactx.NowISO()
			if err := upsertImportJob(ctx, conn, rc.CustomerID, next); err != nil {
				return auditlog.AuditedWrite[CutoverResult]{}, err
			}
		}
		status := "passed"
		if len(blocking) != 0 {
			status = fmt.Sprintf("%d blocking issues", len(blocking))
		}
		return auditlog.AuditedWrite[CutoverResult]{
			Result: result, SummaryEn: fmt.Sprintf("Cut-over dry run for %s: %s.", job.FileName, status),
			Detail: map[string]any{"would_insert": result.WouldInsert, "would_update": result.WouldUpdate, "would_skip": result.WouldSkip, "blocking_issue_count": len(blocking)},
		}, nil
	})
}

// ExecuteCutover: one transaction, then cleanup.
func ExecuteCutover(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (CutoverResult, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminDataImportQuality}, auditlog.WriteMeta{Action: "import.cut_over", EntityType: "import_job", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[CutoverResult], error) {
		if _, err := importutil.RequireID(id, "Import job"); err != nil {
			return auditlog.AuditedWrite[CutoverResult]{}, err
		}
		job, err := importJobFor(ctx, conn, rc, id)
		if err != nil {
			return auditlog.AuditedWrite[CutoverResult]{}, err
		}
		if err := requireImportStatus(job, []string{"dry_run_done"}, "cut over"); err != nil {
			return auditlog.AuditedWrite[CutoverResult]{}, err
		}
		blocking, err := blockingIssues(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[CutoverResult]{}, err
		}
		if len(blocking) > 0 {
			return auditlog.AuditedWrite[CutoverResult]{}, dataerr.Conflict(fmt.Sprintf("%d errors must be resolved or ignored before the cut-over.", len(blocking)))
		}
		at := datactx.NowISO()
		next := job
		next.Status, next.CutOverAt, next.UpdatedAt = "cut_over", &at, at
		p, err := planImport(ctx, conn, rc, job, true, func(ctx context.Context, tx pgx.Tx) error {
			return upsertImportJobTx(ctx, tx, next)
		})
		if err != nil {
			return auditlog.AuditedWrite[CutoverResult]{}, err
		}
		if job.StorageRef != nil {
			if err := importstorage.RemoveJob(ctx, rc.CustomerID, id); err != nil {
				log.Printf("import %s: removing the stored file failed: %v", id, err)
			}
		}
		result := cutoverResultOf(job, p, false, true, 0, fmt.Sprintf("Cut over: %d cases added, %d updated, %d rows skipped.", p.New, p.Changed, p.Skipped))
		return auditlog.AuditedWrite[CutoverResult]{
			Result: result, SummaryEn: fmt.Sprintf("Import %s cut over: %d added, %d updated, %d skipped (%s).", job.FileName, p.New, p.Changed, p.Skipped, job.DataSource),
			Detail: map[string]any{"would_insert": p.New, "would_update": p.Changed, "would_skip": p.Skipped, "data_source": job.DataSource},
		}, nil
	})
}
