// SPDX-License-Identifier: AGPL-3.0-only

// SQL builders and value coercion for resource.go.
package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func numericToFloat(v any) any {
	if v == nil {
		return nil
	}
	f, err := strconv.ParseFloat(fmt.Sprint(v), 64)
	if err != nil {
		return v
	}
	return f
}

func timestampToISO(v any) any {
	t, ok := v.(time.Time)
	if !ok {
		return v
	}
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

// A DATE column, bare "YYYY-MM-DD", no time or Z.
func dateOnlyToISO(v any) any {
	t, ok := v.(time.Time)
	if !ok {
		return v
	}
	return t.Format("2006-01-02")
}

// formatUUID: pgx decodes uuid as [16]byte.
func formatUUID(b [16]byte) string {
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// cursorValueOf: full precision; batches can tie.
func cursorValueOf(v any) string {
	switch x := v.(type) {
	case [16]byte:
		return formatUUID(x)
	case time.Time:
		return x.UTC().Format(time.RFC3339Nano)
	default:
		return fmt.Sprint(v)
	}
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

// placeholderFor: a ::jsonb cast for jsonb columns.
func placeholderFor(argIndex int, col string, meta columnMeta) string {
	if meta.jsonb[col] {
		return fmt.Sprintf("$%d::jsonb", argIndex)
	}
	return fmt.Sprintf("$%d", argIndex)
}

func valueFor(col string, body map[string]any, meta columnMeta) any {
	v := body[col]
	if meta.jsonb[col] {
		if v == nil {
			v = map[string]any{}
		}
		b, _ := json.Marshal(v)
		return string(b)
	}
	return v
}

// buildUpsertSQL mirrors resource.ts's POST /.
func buildUpsertSQL(table, tenantID string, cols []string, body map[string]any, meta columnMeta) (string, []any) {
	quotedCols := make([]string, 0, len(cols)+1)
	quotedCols = append(quotedCols, `"tenant_id"`)
	placeholders := make([]string, 0, len(cols)+1)
	placeholders = append(placeholders, "$1")
	args := []any{tenantID}

	for _, col := range cols {
		quotedCols = append(quotedCols, fmt.Sprintf("%q", col))
		args = append(args, valueFor(col, body, meta))
		placeholders = append(placeholders, placeholderFor(len(args), col, meta))
	}

	var updateSet []string
	for _, col := range cols {
		if col != "id" {
			updateSet = append(updateSet, fmt.Sprintf("%q = EXCLUDED.%q", col, col))
		}
	}

	sql := fmt.Sprintf(
		`INSERT INTO %q (%s) VALUES (%s) ON CONFLICT (tenant_id, id) DO UPDATE SET %s RETURNING *`,
		table, strings.Join(quotedCols, ", "), strings.Join(placeholders, ", "), strings.Join(updateSet, ", "),
	)
	return sql, args
}

// buildBatchUpsertSQL: mirrors the TS POST /batch.
func buildBatchUpsertSQL(table, tenantID string, cols []string, records []map[string]any, meta columnMeta) (string, []any) {
	quotedCols := make([]string, 0, len(cols)+1)
	quotedCols = append(quotedCols, `"tenant_id"`)
	for _, col := range cols {
		quotedCols = append(quotedCols, fmt.Sprintf("%q", col))
	}

	var args []any
	var rowGroups []string
	for _, rec := range records {
		placeholders := make([]string, 0, len(cols)+1)
		args = append(args, tenantID)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
		for _, col := range cols {
			args = append(args, valueFor(col, rec, meta))
			placeholders = append(placeholders, placeholderFor(len(args), col, meta))
		}
		rowGroups = append(rowGroups, "("+strings.Join(placeholders, ", ")+")")
	}

	var updateSet []string
	for _, col := range cols {
		if col != "id" {
			updateSet = append(updateSet, fmt.Sprintf("%q = EXCLUDED.%q", col, col))
		}
	}

	sql := fmt.Sprintf(
		`INSERT INTO %q (%s) VALUES %s ON CONFLICT (tenant_id, id) DO UPDATE SET %s RETURNING *`,
		table, strings.Join(quotedCols, ", "), strings.Join(rowGroups, ", "), strings.Join(updateSet, ", "),
	)
	return sql, args
}
