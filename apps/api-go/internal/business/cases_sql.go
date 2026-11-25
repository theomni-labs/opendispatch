// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// caseQuery: a case filter as SQL.
type caseQuery struct {
	where string
	args  []any
	// none: nothing can match.
	none bool
}

// canonicalUUID: the form Postgres prints.
func canonicalUUID(s string) bool {
	return uuidPattern.MatchString(s) && s == strings.ToLower(s)
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}

// caseSQL: false when only Go matches alike.
func caseSQL(rc reqctx.RequestContext, f CaseFilter) (caseQuery, bool) {
	var q caseQuery
	var conds []string
	add := func(cond string, arg any) {
		q.args = append(q.args, arg)
		conds = append(conds, fmt.Sprintf(cond, len(q.args)))
	}
	for _, d := range []struct {
		val, cond string
		next      int
	}{{f.DateFrom, "registered_at >= $%d", 0}, {f.DateTo, "registered_at < $%d", 1}} {
		if d.val == "" {
			continue
		}
		at, err := time.ParseInLocation("2006-01-02", d.val, riyadhZone)
		if err != nil || at.Format("2006-01-02") != d.val {
			return caseQuery{}, false
		}
		add(d.cond, at.AddDate(0, 0, d.next))
	}
	for _, id := range []struct{ val, col string }{
		{f.ZoneID, "zone_id"}, {f.SubZoneID, "sub_zone_id"}, {f.CityID, "city_id"}, {f.CaseTypeID, "case_type_id"},
	} {
		if id.val == "" {
			continue
		}
		if !canonicalUUID(id.val) {
			q.none = true
			return q, true
		}
		add(id.col+" = $%d::uuid", id.val)
	}
	if f.IDs != nil {
		ids := []string{}
		for _, id := range f.IDs {
			if canonicalUUID(id) {
				ids = append(ids, id)
			}
		}
		if len(ids) == 0 {
			q.none = true
			return q, true
		}
		add("id = ANY($%d::uuid[])", ids)
	}
	if f.DataSource != "" {
		add("data_source = $%d", f.DataSource)
	}
	if f.Handling != "" {
		add("handling = $%d", f.Handling)
	}
	if text := strings.TrimSpace(f.Q); text != "" {
		if !isASCII(text) {
			return caseQuery{}, false
		}
		add("strpos(lower(case_number || ' ' || coalesce(external_id, '')), $%d) > 0", strings.ToLower(text))
	}
	if rc.ZoneScope.Kind == access.ScopeAssignedZones {
		ids := []string{}
		for _, z := range rc.ZoneScope.ZoneIDs {
			if canonicalUUID(z) {
				ids = append(ids, z)
			}
		}
		add("zone_id = ANY($%d::uuid[])", ids)
	}
	if len(conds) > 0 {
		q.where = " WHERE " + strings.Join(conds, " AND ")
	}
	return q, true
}

// and: q's WHERE plus one more condition.
func (q caseQuery) and(cond string) string {
	if q.where == "" {
		return " WHERE " + cond
	}
	return q.where + " AND " + cond
}

// pageCasesSQL: one page; ties by whole second.
func pageCasesSQL(ctx context.Context, conn *tenancy.Connection, tenantID string, q caseQuery, page datactx.PageQuery) (datactx.PageResult[Case], error) {
	offset, limit, err := datactx.PageWindow(page)
	if err != nil {
		return datactx.PageResult[Case]{}, err
	}
	if q.none {
		return datactx.PageOf[Case](nil, offset, limit, 0), nil
	}
	type window struct {
		total int
		rows  []Case
	}
	w, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (window, error) {
		var w window
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM cases`+q.where, q.args...).Scan(&w.total); err != nil {
			return w, err
		}
		if offset >= w.total {
			return w, nil
		}
		args := append(append([]any{}, q.args...), offset+limit-1)
		var at time.Time
		err := tx.QueryRow(ctx, fmt.Sprintf(`SELECT registered_at FROM cases%s ORDER BY registered_at DESC OFFSET $%d LIMIT 1`, q.where, len(args)), args...).Scan(&at)
		where := q.where
		args = q.args
		switch {
		case err == nil:
			args = append(append([]any{}, q.args...), at.Truncate(time.Second))
			where = q.and(fmt.Sprintf("registered_at >= $%d", len(args)))
		case err != pgx.ErrNoRows:
			return w, err
		}
		w.rows, err = scanCases(ctx, tx, where, args...)
		return w, err
	})
	if err != nil {
		return datactx.PageResult[Case]{}, err
	}
	rows := w.rows
	sortCasesNewest(rows)
	end := offset + limit
	if end > len(rows) {
		end = len(rows)
	}
	var items []Case
	if offset < len(rows) {
		items = rows[offset:end]
	}
	return datactx.PageOf(items, offset, limit, w.total), nil
}
