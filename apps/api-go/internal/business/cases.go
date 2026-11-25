// SPDX-License-Identifier: AGPL-3.0-only

// Ports cases.ts: live Postgres reads of Case and
// CaseType (platform.records, zone scoped). Read
// only here; new cases arrive via the import
// cut-over (imports.go, not yet built).
package business

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"

	"github.com/jackc/pgx/v5"
)

const caseColumns = `id, tenant_id, created_at, updated_at, created_by, data_source, external_id, case_number, registered_at, city_id, zone_id, sub_zone_id, latitude, longitude, case_type_id, parties_involved, assigned_at, arrived_at, closed_at, handling, agent_id, vehicle_id, severity, injury_present, estimated_damage_sar, on_scene_completed_at, remote_review_at, channel, extra`

// scanCaseRow: nullable DB columns (zone/city/sub-
// zone/case-type id, parties, lat/long) default to
// zero on NULL -- a data-quality
// state real registered cases never actually have.
func scanCaseRow(row pgx.Row) (Case, error) {
	var c Case
	var createdAt, updatedAt, registeredAt time.Time
	var assignedAt, arrivedAt, closedAt, onSceneAt, remoteReviewAt *time.Time
	var cityID, zoneID, subZoneID, caseTypeID *string
	var latitude, longitude *float64
	var partiesInvolved *int
	var extraRaw []byte
	err := row.Scan(&c.ID, &c.TenantID, &createdAt, &updatedAt, &c.CreatedBy, &c.DataSource, &c.ExternalID, &c.CaseNumber, &registeredAt,
		&cityID, &zoneID, &subZoneID, &latitude, &longitude, &caseTypeID, &partiesInvolved, &assignedAt, &arrivedAt, &closedAt,
		&c.Handling, &c.AgentID, &c.VehicleID, &c.Severity, &c.InjuryPresent, &c.EstimatedDamageSar, &onSceneAt, &remoteReviewAt, &c.Channel, &extraRaw)
	if err != nil {
		return Case{}, err
	}
	if c.Extra, err = scanExtra(extraRaw); err != nil {
		return Case{}, err
	}
	c.CreatedAt, c.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
	c.RegisteredAt = datactx.ToRiyadhISO(registeredAt)
	c.AssignedAt, c.ArrivedAt, c.ClosedAt = nullableTimeToISO(assignedAt), nullableTimeToISO(arrivedAt), nullableTimeToISO(closedAt)
	c.OnSceneCompletedAt, c.RemoteReviewAt = nullableTimeToISO(onSceneAt), nullableTimeToISO(remoteReviewAt)
	if cityID != nil {
		c.CityID = *cityID
	}
	if zoneID != nil {
		c.ZoneID = *zoneID
	}
	if subZoneID != nil {
		c.SubZoneID = *subZoneID
	}
	if caseTypeID != nil {
		c.CaseTypeID = *caseTypeID
	}
	if latitude != nil {
		c.Latitude = *latitude
	}
	if longitude != nil {
		c.Longitude = *longitude
	}
	if partiesInvolved != nil {
		c.PartiesInvolved = *partiesInvolved
	}
	return c, nil
}

// allCasesLive: every case row, live Postgres.
func allCasesLive(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]Case, error) {
	return casesLive(ctx, conn, tenantID, CaseFilter{})
}

var riyadhZone = time.FixedZone("Asia/Riyadh", 3*3600)

// caseWhere: SQL pre-filter, dates and handling.
func caseWhere(f CaseFilter) (string, []any) {
	var conds []string
	var args []any
	if d, err := time.ParseInLocation("2006-01-02", f.DateFrom, riyadhZone); err == nil {
		args = append(args, d)
		conds = append(conds, fmt.Sprintf("registered_at >= $%d", len(args)))
	}
	if d, err := time.ParseInLocation("2006-01-02", f.DateTo, riyadhZone); err == nil {
		args = append(args, d.AddDate(0, 0, 1))
		conds = append(conds, fmt.Sprintf("registered_at < $%d", len(args)))
	}
	if f.Handling != "" {
		args = append(args, f.Handling)
		conds = append(conds, fmt.Sprintf("handling = $%d", len(args)))
	}
	if len(conds) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

// casesLive: rows the filter may match.
func casesLive(ctx context.Context, conn *tenancy.Connection, tenantID string, f CaseFilter) ([]Case, error) {
	where, args := caseWhere(f)
	return casesWhere(ctx, conn, tenantID, where, args...)
}

// casesWhere: case rows under a WHERE clause.
func casesWhere(ctx context.Context, conn *tenancy.Connection, tenantID, where string, args ...any) ([]Case, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]Case, error) {
		return scanCases(ctx, tx, where, args...)
	})
}

func scanCases(ctx context.Context, tx pgx.Tx, where string, args ...any) ([]Case, error) {
	rows, err := tx.Query(ctx, `SELECT `+caseColumns+` FROM cases`+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Case
	for rows.Next() {
		c, err := scanCaseRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func oneCaseLive(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*Case, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (*Case, error) {
		row := tx.QueryRow(ctx, `SELECT `+caseColumns+` FROM cases WHERE id=$1`, id)
		c, err := scanCaseRow(row)
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil, nil
			}
			return nil, err
		}
		return &c, nil
	})
}

func allCaseTypesLive(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]CaseType, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]CaseType, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, external_id, name_en, name_ar, is_active, extra FROM case_types ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []CaseType
		for rows.Next() {
			var ct CaseType
			var createdAt, updatedAt time.Time
			var extraRaw []byte
			if err := rows.Scan(&ct.ID, &ct.TenantID, &createdAt, &updatedAt, &ct.CreatedBy, &ct.DataSource, &ct.ExternalID, &ct.NameEn, &ct.NameAr, &ct.IsActive, &extraRaw); err != nil {
				return nil, err
			}
			ct.CreatedAt, ct.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			if ct.Extra, err = scanExtra(extraRaw); err != nil {
				return nil, err
			}
			out = append(out, ct)
		}
		return out, rows.Err()
	})
}

// readableCases: every case the caller may read,
// newest registered first.
func readableCases(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, f CaseFilter) ([]Case, error) {
	rows, err := casesLive(ctx, conn, rc.CustomerID, f)
	if err != nil {
		return nil, err
	}
	var out []Case
	for _, c := range rows {
		zid := c.ZoneID
		if reqctx.CanReadZone(rc, &zid) {
			out = append(out, c)
		}
	}
	sortCasesNewest(out)
	return out, nil
}

// sortCasesNewest: newest second first, by id.
func sortCasesNewest(out []Case) {
	// Parse each time once, sort indexes, permute.
	keys := make([]time.Time, len(out))
	idx := make([]int, len(out))
	for i := range out {
		keys[i], _ = datactx.EpochOf(out[i].RegisteredAt)
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool {
		i, j := idx[a], idx[b]
		if !keys[i].Equal(keys[j]) {
			return keys[i].After(keys[j])
		}
		return out[i].ID < out[j].ID
	})
	sorted := make([]Case, len(out))
	for k, i := range idx {
		sorted[k] = out[i]
	}
	copy(out, sorted)
}

// CaseFilter mirrors listCases's query.
type CaseFilter struct {
	Limit      int
	Cursor     string
	ZoneID     string
	SubZoneID  string
	CityID     string
	DateFrom   string
	DateTo     string
	DataSource string
	Q          string
	Handling   string
	CaseTypeID string
	// IDs: nil means no ids filter.
	IDs []string
}

// MaxCaseIDs: most ids one list asks for.
const MaxCaseIDs = 200

// checkCaseIDs: 1 to 200 UUIDs when given.
func checkCaseIDs(ids []string) error {
	if ids == nil {
		return nil
	}
	if len(ids) < 1 || len(ids) > MaxCaseIDs {
		return dataerr.Invalid(fmt.Sprintf("Case ids: ask for 1 to %d ids at a time.", MaxCaseIDs))
	}
	for _, id := range ids {
		if _, err := importutil.RequireID(id, "Case"); err != nil {
			return err
		}
	}
	return nil
}

func matchesCaseFilter(c Case, filter CaseFilter) bool {
	if filter.IDs != nil && !slices.Contains(filter.IDs, c.ID) {
		return false
	}
	if filter.ZoneID != "" && c.ZoneID != filter.ZoneID {
		return false
	}
	if filter.SubZoneID != "" && c.SubZoneID != filter.SubZoneID {
		return false
	}
	if filter.CityID != "" && c.CityID != filter.CityID {
		return false
	}
	if filter.DataSource != "" && c.DataSource != filter.DataSource {
		return false
	}
	if filter.Handling != "" && c.Handling != filter.Handling {
		return false
	}
	if filter.CaseTypeID != "" && c.CaseTypeID != filter.CaseTypeID {
		return false
	}
	if filter.DateFrom != "" || filter.DateTo != "" {
		date, err := datactx.DateOf(c.RegisteredAt)
		if err != nil || !datactx.InDateRange(date, filter.DateFrom, filter.DateTo) {
			return false
		}
	}
	return datactx.MatchesText(c.CaseNumber+" "+c.ExternalID, filter.Q)
}

// ListCases mirrors listCases.
func ListCases(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, filter CaseFilter) (datactx.PageResult[Case], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[Case]{}, err
	}
	if err := checkCaseIDs(filter.IDs); err != nil {
		return datactx.PageResult[Case]{}, err
	}
	q, ok := caseSQL(rc, filter)
	if !ok {
		return listCasesInGo(ctx, conn, rc, filter)
	}
	return pageCasesSQL(ctx, conn, rc.CustomerID, q, datactx.PageQuery{Limit: filter.Limit, Cursor: filter.Cursor})
}

// listCasesInGo: odd input, filtered in Go.
func listCasesInGo(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, filter CaseFilter) (datactx.PageResult[Case], error) {
	rows, err := readableCases(ctx, conn, rc, filter)
	if err != nil {
		return datactx.PageResult[Case]{}, err
	}
	var out []Case
	for _, c := range rows {
		if matchesCaseFilter(c, filter) {
			out = append(out, c)
		}
	}
	return datactx.Paginate(out, datactx.PageQuery{Limit: filter.Limit, Cursor: filter.Cursor})
}

// ListAllCases mirrors listAllCases: every matching
// case, unpaginated. Paging in a loop would refetch
// the table each time -- call this instead.
func ListAllCases(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, filter CaseFilter) ([]Case, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return nil, err
	}
	if err := checkCaseIDs(filter.IDs); err != nil {
		return nil, err
	}
	q, ok := caseSQL(rc, filter)
	if !ok {
		return listAllCasesInGo(ctx, conn, rc, filter)
	}
	if q.none {
		return nil, nil
	}
	out, err := casesWhere(ctx, conn, rc.CustomerID, q.where, q.args...)
	if err != nil {
		return nil, err
	}
	sortCasesNewest(out)
	return out, nil
}

// listAllCasesInGo: odd input, filtered in Go.
func listAllCasesInGo(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, filter CaseFilter) ([]Case, error) {
	rows, err := readableCases(ctx, conn, rc, filter)
	if err != nil {
		return nil, err
	}
	var out []Case
	for _, c := range rows {
		if matchesCaseFilter(c, filter) {
			out = append(out, c)
		}
	}
	return out, nil
}

// GetCase mirrors getCase.
func GetCase(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (Case, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return Case{}, err
	}
	if _, err := importutil.RequireID(id, "Case"); err != nil {
		return Case{}, err
	}
	found, err := oneCaseLive(ctx, conn, rc.CustomerID, id)
	if err != nil {
		return Case{}, err
	}
	zid := ""
	if found != nil {
		zid = found.ZoneID
	}
	if found == nil || !reqctx.CanReadZone(rc, &zid) {
		found = nil
	}
	row, err := datactx.RequireFound(found, "Case")
	if err != nil {
		return Case{}, err
	}
	return *row, nil
}

// ListCaseTypes mirrors listCaseTypes.
func ListCaseTypes(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[CaseType], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[CaseType]{}, err
	}
	rows, err := allCaseTypesLive(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[CaseType]{}, err
	}
	return datactx.Paginate(rows, query)
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// upsertCasesLive writes cases (test seeding).
func upsertCasesLive(ctx context.Context, conn *tenancy.Connection, tenantID string, rows []Case) error {
	if len(rows) == 0 {
		return nil
	}
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, c := range rows {
			_, err := tx.Exec(ctx, `INSERT INTO cases (`+caseColumns+`)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
				ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$4, data_source=$6, external_id=$7, case_number=$8,
					registered_at=$9, city_id=$10, zone_id=$11, sub_zone_id=$12, latitude=$13, longitude=$14, case_type_id=$15,
					parties_involved=$16, assigned_at=$17, arrived_at=$18, closed_at=$19, handling=$20, agent_id=$21,
					vehicle_id=$22, severity=$23, injury_present=$24, estimated_damage_sar=$25, on_scene_completed_at=$26,
					remote_review_at=$27, channel=$28, extra=$29`,
				c.ID, c.TenantID, c.CreatedAt, c.UpdatedAt, c.CreatedBy, c.DataSource, c.ExternalID, c.CaseNumber, c.RegisteredAt,
				nullIfEmpty(c.CityID), nullIfEmpty(c.ZoneID), nullIfEmpty(c.SubZoneID), c.Latitude, c.Longitude, nullIfEmpty(c.CaseTypeID),
				c.PartiesInvolved, c.AssignedAt, c.ArrivedAt, c.ClosedAt, c.Handling, c.AgentID,
				c.VehicleID, c.Severity, c.InjuryPresent, c.EstimatedDamageSar, c.OnSceneCompletedAt,
				c.RemoteReviewAt, c.Channel, c.Extra)
			if err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}
