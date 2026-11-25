// SPDX-License-Identifier: AGPL-3.0-only

// Saved mapping versions (import help).
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

var mappingVersionPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{2,63}$`)

const (
	maxMappingNotes   = 4000
	maxMappingColumns = 100
	maxSourceColumn   = 80
)

// renamedColumn: one field's new source column.
type renamedColumn struct {
	SourceColumn  string `json:"source_column"`
	InternalField string `json:"internal_field"`
}

// savedMapping: one row of import_mappings.
type savedMapping struct {
	Version     string
	BaseVersion string
	Notes       *string
	Columns     []renamedColumn
	CreatedAt   string
}

func savedMappingsOf(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]savedMapping, error) {
	if conn == nil {
		return nil, nil
	}
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]savedMapping, error) {
		rows, err := tx.Query(ctx, `SELECT version, base_version, notes, columns, created_at FROM import_mappings ORDER BY created_at, version`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []savedMapping
		for rows.Next() {
			var s savedMapping
			var cols []byte
			var at time.Time
			if err := rows.Scan(&s.Version, &s.BaseVersion, &s.Notes, &cols, &at); err != nil {
				return nil, err
			}
			if err := json.Unmarshal(cols, &s.Columns); err != nil {
				return nil, err
			}
			s.CreatedAt = datactx.ToRiyadhISO(at)
			out = append(out, s)
		}
		return out, rows.Err()
	})
}

// deriveMapping: base with source columns renamed.
func deriveMapping(base ImportMapping, version string, renames []renamedColumn) ImportMapping {
	out := base
	out.MappingID = version
	out.Columns = append([]MappingColumn(nil), base.Columns...)
	for _, r := range renames {
		for i := range out.Columns {
			if out.Columns[i].InternalField == r.InternalField {
				out.Columns[i].DefaultColumn = r.SourceColumn
			}
		}
	}
	return out
}

// tenantMapping: a mapping and, if saved, its row.
type tenantMapping struct {
	Mapping ImportMapping
	Saved   *savedMapping
}

// tenantMappings: files first, then saved versions.
func tenantMappings(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]tenantMapping, error) {
	files, err := loadMappings()
	if err != nil {
		return nil, err
	}
	out := make([]tenantMapping, 0, len(files))
	byID := map[string]ImportMapping{}
	for _, m := range files {
		out = append(out, tenantMapping{Mapping: m})
		byID[m.MappingID] = m
	}
	saved, err := savedMappingsOf(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range saved {
		s := saved[i]
		base, ok := byID[s.BaseVersion]
		if !ok {
			continue
		}
		if _, clash := byID[s.Version]; clash {
			continue
		}
		m := deriveMapping(base, s.Version, s.Columns)
		byID[s.Version] = m
		out = append(out, tenantMapping{Mapping: m, Saved: &s})
	}
	return out, nil
}

// mappingFor: a file or saved mapping, or nil.
func mappingFor(ctx context.Context, conn *tenancy.Connection, tenantID, version string) (*ImportMapping, error) {
	all, err := tenantMappings(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].Mapping.MappingID == version {
			return &all[i].Mapping, nil
		}
	}
	return nil, nil
}

func mappingInfoOf(t tenantMapping) ImportMappingInfo {
	m := t.Mapping
	cols := make([]ImportMappingColumnInfo, len(m.Columns))
	for j, c := range m.Columns {
		cols[j] = ImportMappingColumnInfo{SourceColumn: c.DefaultColumn, InternalField: c.InternalField, Required: c.Required}
	}
	info := ImportMappingInfo{Version: m.MappingID, NameEn: mappingName(m.MappingID), SourceFormat: m.Source.FileType, Columns: cols}
	if t.Saved != nil {
		base, at := t.Saved.BaseVersion, t.Saved.CreatedAt
		info.BaseVersion, info.Notes, info.CreatedAt = &base, t.Saved.Notes, &at
	}
	return info
}

// mappingCreate: a checked createImportMapping body.
type mappingCreate struct {
	Version, BaseVersion string
	Notes                *string
	Columns              []renamedColumn
	ApplyTo              string
	Assisted             bool
}

func invalidMapping(format string, args ...any) error {
	return dataerr.Invalid("Mapping: " + fmt.Sprintf(format, args...))
}

// parseMappingCreate: shape checks only.
func parseMappingCreate(body any) (mappingCreate, error) {
	o, err := datactx.Object(body, "Mapping", []string{"version", "base_version", "notes", "columns", "apply_to_import_id", "assisted"})
	if err != nil {
		return mappingCreate{}, err
	}
	var c mappingCreate
	if c.Version, err = datactx.String(o, "version", datactx.StrOpts{HasMax: true, Max: 64}); err != nil {
		return c, err
	}
	if !mappingVersionPattern.MatchString(c.Version) {
		return c, invalidMapping("version must be lower-case letters, digits and _ (3 to 64, starting with a letter).")
	}
	if c.BaseVersion, err = datactx.String(o, "base_version", datactx.StrOpts{HasMax: true, Max: 64}); err != nil {
		return c, err
	}
	if c.Notes, err = datactx.NullableString(o, "notes", datactx.StrOpts{HasMax: true, Max: maxMappingNotes}); err != nil {
		return c, err
	}
	if datactx.Has(o, "apply_to_import_id") {
		if c.ApplyTo, err = datactx.UUID(o, "apply_to_import_id"); err != nil {
			return c, err
		}
	}
	if c.Assisted, _, err = datactx.OptBool(o, "assisted"); err != nil {
		return c, err
	}
	list, ok := o["columns"].([]any)
	if !ok || len(list) == 0 || len(list) > maxMappingColumns {
		return c, invalidMapping("columns must be a list of 1 to %d columns.", maxMappingColumns)
	}
	for _, item := range list {
		col, err := datactx.Object(item, "Mapping column", []string{"source_column", "internal_field"})
		if err != nil {
			return c, err
		}
		src, err := datactx.String(col, "source_column", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: maxSourceColumn})
		if err != nil {
			return c, err
		}
		field, err := datactx.String(col, "internal_field", datactx.StrOpts{HasMax: true, Max: 64})
		if err != nil {
			return c, err
		}
		src = strings.TrimSpace(src)
		if src == "" || !utf8.ValidString(src) {
			return c, invalidMapping("a source column is empty.")
		}
		c.Columns = append(c.Columns, renamedColumn{SourceColumn: src, InternalField: field})
	}
	return c, nil
}

// checkRenames: fields of base, each once, no clash.
func checkRenames(base ImportMapping, renames []renamedColumn) error {
	fields := map[string]bool{}
	for _, col := range base.Columns {
		fields[col.InternalField] = true
	}
	seenField := map[string]bool{}
	for _, r := range renames {
		if !fields[r.InternalField] {
			return invalidMapping("%q is not a field of %s.", r.InternalField, base.MappingID)
		}
		if seenField[r.InternalField] {
			return invalidMapping("%s has more than one column.", r.InternalField)
		}
		seenField[r.InternalField] = true
	}
	derived := deriveMapping(base, "check", renames)
	seenCol := map[string]string{}
	for _, col := range derived.Columns {
		if col.Required && strings.TrimSpace(col.DefaultColumn) == "" {
			return invalidMapping("required field %s has no column.", col.InternalField)
		}
		if other, dup := seenCol[col.DefaultColumn]; dup {
			return invalidMapping("column %q is used for both %s and %s.", col.DefaultColumn, other, col.InternalField)
		}
		seenCol[col.DefaultColumn] = col.InternalField
	}
	return nil
}

// CreateImportMapping mirrors createImportMapping.
func CreateImportMapping(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (ImportMappingInfo, error) {
	meta := auditlog.WriteMeta{Action: "import.mapping_created", EntityType: "import_mapping"}
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminDataImportQuality}, meta, func(ctx context.Context) (auditlog.AuditedWrite[ImportMappingInfo], error) {
		c, err := parseMappingCreate(body)
		if err != nil {
			return auditlog.AuditedWrite[ImportMappingInfo]{}, err
		}
		all, err := tenantMappings(ctx, conn, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[ImportMappingInfo]{}, err
		}
		var base *ImportMapping
		for i := range all {
			if all[i].Mapping.MappingID == c.Version {
				return auditlog.AuditedWrite[ImportMappingInfo]{}, dataerr.Conflict(fmt.Sprintf("Mapping version %s already exists.", c.Version))
			}
			if all[i].Mapping.MappingID == c.BaseVersion {
				base = &all[i].Mapping
			}
		}
		if base == nil {
			return auditlog.AuditedWrite[ImportMappingInfo]{}, invalidMapping("there is no mapping version %s.", c.BaseVersion)
		}
		if err := checkRenames(*base, c.Columns); err != nil {
			return auditlog.AuditedWrite[ImportMappingInfo]{}, err
		}
		var job *ImportJob
		if c.ApplyTo != "" {
			if _, err := importutil.RequireID(c.ApplyTo, "Import job"); err != nil {
				return auditlog.AuditedWrite[ImportMappingInfo]{}, err
			}
			j, err := importJobFor(ctx, conn, rc, c.ApplyTo)
			if err != nil {
				return auditlog.AuditedWrite[ImportMappingInfo]{}, err
			}
			if j.Status == "cut_over" {
				return auditlog.AuditedWrite[ImportMappingInfo]{}, dataerr.Conflict("The import has already been cut over.")
			}
			job = &j
		}
		cols, _ := json.Marshal(c.Columns)
		id, at := datactx.NewID(), datactx.NowISO()
		rec := datactx.NewRecord(rc, id, at)
		_, err = tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			if _, err := tx.Exec(ctx, `INSERT INTO import_mappings (tenant_id, id, data_source, created_at, updated_at, created_by, version, base_version, notes, columns)
				VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9)`, rc.CustomerID, id, rec.DataSource, at, rec.CreatedBy, c.Version, c.BaseVersion, c.Notes, cols); err != nil {
				return struct{}{}, err
			}
			if job == nil {
				return struct{}{}, nil
			}
			if _, err := tx.Exec(ctx, `DELETE FROM data_quality_issues WHERE import_job_id = $1`, job.ID); err != nil {
				return struct{}{}, err
			}
			_, err := tx.Exec(ctx, `UPDATE import_jobs SET mapping_version=$2, status='uploaded', issue_count=0, error_count=0, warning_count=0,
				validated_at=NULL, updated_at=$3 WHERE id=$1`, job.ID, c.Version, at)
			return struct{}{}, err
		})
		if err != nil {
			return auditlog.AuditedWrite[ImportMappingInfo]{}, err
		}
		saved := savedMapping{Version: c.Version, BaseVersion: c.BaseVersion, Notes: c.Notes, Columns: c.Columns, CreatedAt: at}
		info := mappingInfoOf(tenantMapping{Mapping: deriveMapping(*base, c.Version, c.Columns), Saved: &saved})
		renamed := make([]string, 0, len(c.Columns))
		for _, r := range c.Columns {
			renamed = append(renamed, r.InternalField)
		}
		sort.Strings(renamed)
		detail := map[string]any{"version": c.Version, "base_version": c.BaseVersion, "fields": renamed, "assisted": c.Assisted, "notes_chars": 0}
		if c.Notes != nil {
			detail["notes_chars"] = utf8.RuneCountInString(*c.Notes)
		}
		summary := fmt.Sprintf("Mapping %s saved from %s (%d columns).", c.Version, c.BaseVersion, len(c.Columns))
		if job != nil {
			detail["import_job_id"] = job.ID
			summary += fmt.Sprintf(" Import %s now uses it.", job.FileName)
		}
		return auditlog.AuditedWrite[ImportMappingInfo]{Result: info, EntityID: &id, SummaryEn: summary, Detail: detail}, nil
	})
}
