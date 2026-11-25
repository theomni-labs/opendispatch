// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// caseFieldColumns: required Case fields.
var caseFieldColumns = []string{"external_id", "case_type_id", "parties_involved"}

// requiredColumns: never NULL in the history.
var requiredColumns = []string{"external_id", "case_number", "registered_at", "city_id", "zone_id", "sub_zone_id", "latitude", "longitude", "case_type_id", "parties_involved", "handling"}

// loadCaseTypes maps type names to ids.
func loadCaseTypes(ctx context.Context, conn *pgx.Conn) (map[string]string, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, name_en FROM case_types WHERE is_active`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		ids[name] = id
	}
	return ids, rows.Err()
}

// checkRequired: no history row misses a field.
func checkRequired(ctx context.Context, conn *pgx.Conn) error {
	var conds []string
	for _, c := range requiredColumns {
		conds = append(conds, c+" IS NULL")
	}
	var n int
	q := `SELECT count(*) FROM cases WHERE extra @> $1::jsonb AND (` + strings.Join(conds, " OR ") + `)`
	if err := conn.QueryRow(ctx, q, marker).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return fmt.Errorf("%d history cases miss a required field (%s)", n, strings.Join(requiredColumns, ", "))
	}
	return nil
}
