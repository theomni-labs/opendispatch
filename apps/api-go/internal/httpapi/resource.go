// SPDX-License-Identifier: AGPL-3.0-only

// Generic CRUD, RLS-gated. Mirrors resource.ts.
package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const defaultLimit = 50

// Matches resource.ts (contract itself says 200).
const maxLimit = 500

var uuidRE = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func parseLimit(raw string) int {
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return defaultLimit
	}
	if n > maxLimit {
		return maxLimit
	}
	return n
}

type cursor struct {
	Value string
	ID    string
}

func encodeCursor(value, id string) string {
	b, _ := json.Marshal([2]string{value, id})
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(raw string) (cursor, bool) {
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return cursor{}, false
	}
	var pair [2]string
	if err := json.Unmarshal(b, &pair); err != nil {
		return cursor{}, false
	}
	return cursor{Value: pair[0], ID: pair[1]}, true
}

// Lat/Longitude: optional; omit an explicit null.
var optionalNotNullable = map[string]bool{"latitude": true, "longitude": true}

// columnMeta caches kinds, fixed once migrated.
type columnMeta struct {
	jsonb      map[string]bool
	numeric    map[string]bool
	timestamps map[string]bool
	dates      map[string]bool
}

func loadColumnMeta(ctx context.Context, conn *tenancy.Connection, table string) (columnMeta, error) {
	meta := columnMeta{jsonb: map[string]bool{}, numeric: map[string]bool{}, timestamps: map[string]bool{}, dates: map[string]bool{}}
	rows, err := conn.Pool.Query(ctx, `
		SELECT column_name, data_type FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = $1
	`, table)
	if err != nil {
		return meta, err
	}
	defer rows.Close()
	for rows.Next() {
		var name, dataType string
		if err := rows.Scan(&name, &dataType); err != nil {
			return meta, err
		}
		switch dataType {
		case "jsonb":
			meta.jsonb[name] = true
		case "numeric":
			meta.numeric[name] = true
		case "timestamp with time zone", "timestamp without time zone":
			meta.timestamps[name] = true
		case "date":
			meta.dates[name] = true
		}
	}
	return meta, rows.Err()
}

// ResourceRouteOptions mirrors ResourceRouteOptions.
type ResourceRouteOptions struct {
	OrderBy         string // trusted, hardcoded column name; default created_at
	WritableColumns []string
}

var baseColumns = []string{"id", "created_at", "updated_at", "created_by", "data_source"}

// resourceRoutes: a table's CRUD + cached metadata.
type resourceRoutes struct {
	conn           *tenancy.Connection
	table          string
	orderBy        string
	allowedColumns map[string]bool

	metaOnce sync.Once
	meta     columnMeta
	metaErr  error
}

// RegisterResourceRoutes: see createResourceRoutes.
func RegisterResourceRoutes(mux *http.ServeMux, conn *tenancy.Connection, prefix, table string, opts ResourceRouteOptions) {
	orderBy := opts.OrderBy
	if orderBy == "" {
		orderBy = "created_at"
	}
	allowed := map[string]bool{}
	for _, c := range baseColumns {
		allowed[c] = true
	}
	for _, c := range opts.WritableColumns {
		allowed[c] = true
	}
	rr := &resourceRoutes{conn: conn, table: table, orderBy: orderBy, allowedColumns: allowed}

	mux.Handle("GET "+prefix, TenantContext(http.HandlerFunc(rr.list)))
	mux.Handle("GET "+prefix+"/{id}", TenantContext(http.HandlerFunc(rr.getByID)))
	mux.Handle("POST "+prefix, TenantContext(http.HandlerFunc(rr.upsert)))
	mux.Handle("POST "+prefix+"/batch", TenantContext(http.HandlerFunc(rr.batchUpsert)))
	mux.Handle("DELETE "+prefix+"/{id}", TenantContext(http.HandlerFunc(rr.deleteByID)))
}

func (rr *resourceRoutes) cachedMeta(ctx context.Context) (columnMeta, error) {
	rr.metaOnce.Do(func() {
		rr.meta, rr.metaErr = loadColumnMeta(ctx, rr.conn, rr.table)
	})
	return rr.meta, rr.metaErr
}

// parsedRow: types up to the contract's JSON shape.
func parsedRow(row map[string]any, meta columnMeta) map[string]any {
	out := make(map[string]any, len(row))
	for k, v := range row {
		out[k] = v
	}
	for key := range meta.jsonb {
		// pgx.RowToMap decodes jsonb as string, not []byte.
		var raw []byte
		switch v := out[key].(type) {
		case []byte:
			raw = v
		case string:
			raw = []byte(v)
		}
		if raw != nil {
			var parsed any
			if json.Unmarshal(raw, &parsed) == nil {
				out[key] = parsed
			}
		}
	}
	for key := range meta.numeric {
		out[key] = numericToFloat(out[key])
	}
	for key := range meta.timestamps {
		out[key] = timestampToISO(out[key])
	}
	for key := range meta.dates {
		out[key] = dateOnlyToISO(out[key])
	}
	for key, v := range out {
		if b, ok := v.([16]byte); ok {
			out[key] = formatUUID(b)
		}
	}
	for key := range optionalNotNullable {
		if v, ok := out[key]; ok && v == nil {
			delete(out, key)
		}
	}
	return out
}

func (rr *resourceRoutes) list(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := getTenantID(ctx)
	limit := parseLimit(r.URL.Query().Get("limit"))
	var cur cursor
	hasCursor := false
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		c, ok := decodeCursor(raw)
		if !ok {
			writeJSONError(w, http.StatusBadRequest, "invalid cursor")
			return
		}
		cur, hasCursor = c, true
	}
	meta, err := rr.cachedMeta(ctx)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	whereClause, whereArgs := "", []any{}
	if hasCursor {
		whereClause = fmt.Sprintf(`WHERE (%q > $1::timestamptz) OR (%q = $1::timestamptz AND id > $2::uuid)`, rr.orderBy, rr.orderBy)
		whereArgs = []any{cur.Value, cur.ID}
	}

	rows, err := tenancy.WithTenant(ctx, rr.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]map[string]any, error) {
		sql := fmt.Sprintf(`SELECT * FROM %q %s ORDER BY %q, id LIMIT %d`, rr.table, whereClause, rr.orderBy, limit+1)
		pgxRows, err := tx.Query(ctx, sql, whereArgs...)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(pgxRows, pgx.RowToMap)
	})
	if err != nil {
		writeTenancyError(w, err)
		return
	}

	hasMore := len(rows) > limit
	page := rows
	if hasMore {
		page = rows[:limit]
	}
	// Raw row: full precision, not the truncated value.
	var nextCursor *string
	if hasMore && len(page) > 0 {
		last := page[len(page)-1]
		nc := encodeCursor(cursorValueOf(last[rr.orderBy]), cursorValueOf(last["id"]))
		nextCursor = &nc
	}
	data := make([]map[string]any, len(page))
	for i, row := range page {
		data[i] = parsedRow(row, meta)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"data":  data,
		"limit": limit,
		"page":  map[string]any{"next_cursor": nextCursor, "has_more": hasMore},
	})
}

func (rr *resourceRoutes) getByID(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := getTenantID(ctx)
	id := r.PathValue("id")
	meta, err := rr.cachedMeta(ctx)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	row, err := tenancy.WithTenant(ctx, rr.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (map[string]any, error) {
		if !uuidRE.MatchString(id) {
			return nil, nil
		}
		rows, err := tx.Query(ctx, fmt.Sprintf(`SELECT * FROM %q WHERE id = $1::uuid`, rr.table), id)
		if err != nil {
			return nil, err
		}
		results, err := pgx.CollectRows(rows, pgx.RowToMap)
		if err != nil || len(results) == 0 {
			return nil, err
		}
		return results[0], nil
	})
	if err != nil {
		writeTenancyError(w, err)
		return
	}
	if row == nil {
		writeJSONError(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": parsedRow(row, meta)})
}

// upsertColumns: validates keys, requires id.
func (rr *resourceRoutes) upsertColumns(body map[string]any) ([]string, error) {
	cols := make([]string, 0, len(body))
	for k := range body {
		if k != "tenant_id" {
			cols = append(cols, k)
		}
	}
	var unknown []string
	for _, k := range cols {
		if !rr.allowedColumns[k] {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		return nil, fmt.Errorf("Unknown field(s): %s", strings.Join(unknown, ", "))
	}
	hasID := false
	for _, k := range cols {
		if k == "id" {
			hasID = true
		}
	}
	if !hasID {
		return nil, fmt.Errorf("id is required")
	}
	return cols, nil
}

func (rr *resourceRoutes) upsert(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := getTenantID(ctx)
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	cols, err := rr.upsertColumns(body)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	meta, err := rr.cachedMeta(ctx)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	row, err := tenancy.WithTenant(ctx, rr.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (map[string]any, error) {
		sql, args := buildUpsertSQL(rr.table, tenantID, cols, body, meta)
		rows, err := tx.Query(ctx, sql, args...)
		if err != nil {
			return nil, err
		}
		results, err := pgx.CollectRows(rows, pgx.RowToMap)
		if err != nil || len(results) == 0 {
			return nil, err
		}
		return results[0], nil
	})
	if err != nil {
		writeTenancyError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": parsedRow(row, meta)})
}

func (rr *resourceRoutes) batchUpsert(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := getTenantID(ctx)
	var body struct {
		Records []map[string]any `json:"records"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(body.Records) == 0 {
		writeJSON(w, http.StatusCreated, map[string]any{"data": []any{}})
		return
	}
	colSet := map[string]bool{}
	for _, rec := range body.Records {
		for k := range rec {
			if k != "tenant_id" {
				colSet[k] = true
			}
		}
	}
	cols := make([]string, 0, len(colSet))
	for k := range colSet {
		cols = append(cols, k)
	}
	var unknown []string
	for _, k := range cols {
		if !rr.allowedColumns[k] {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		writeJSONError(w, http.StatusBadRequest, "Unknown field(s): "+strings.Join(unknown, ", "))
		return
	}
	hasID := false
	for _, k := range cols {
		if k == "id" {
			hasID = true
		}
	}
	if !hasID {
		writeJSONError(w, http.StatusBadRequest, "id is required")
		return
	}
	meta, err := rr.cachedMeta(ctx)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	rows, err := tenancy.WithTenant(ctx, rr.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]map[string]any, error) {
		sql, args := buildBatchUpsertSQL(rr.table, tenantID, cols, body.Records, meta)
		pgxRows, err := tx.Query(ctx, sql, args...)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(pgxRows, pgx.RowToMap)
	})
	if err != nil {
		writeTenancyError(w, err)
		return
	}
	data := make([]map[string]any, len(rows))
	for i, row := range rows {
		data[i] = parsedRow(row, meta)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": data})
}

func (rr *resourceRoutes) deleteByID(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := getTenantID(ctx)
	id := r.PathValue("id")
	if !uuidRE.MatchString(id) {
		writeJSONError(w, http.StatusNotFound, "not found")
		return
	}
	_, err := tenancy.WithTenant(ctx, rr.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, fmt.Sprintf(`DELETE FROM %q WHERE id = $1::uuid`, rr.table), id)
		return struct{}{}, err
	})
	if err != nil {
		if isForeignKeyViolation(err) {
			writeJSONError(w, http.StatusConflict, "still referenced by another record")
			return
		}
		writeTenancyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
