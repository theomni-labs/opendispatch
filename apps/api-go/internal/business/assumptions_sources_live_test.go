// SPDX-License-Identifier: AGPL-3.0-only

// Live: skip scan matches DISTINCT.
package business

import (
	"context"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestCaseDataSources_MatchesDistinctAggregate(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	old := func() []string {
		out, err := tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) ([]string, error) {
			var out []string
			err := tx.QueryRow(ctx, `SELECT coalesce(array_agg(DISTINCT data_source ORDER BY data_source), '{}') FROM cases`).Scan(&out)
			return out, err
		})
		check(t, err)
		return out
	}
	empty, err := caseDataSources(ctx, conn, rc.CustomerID)
	check(t, err)
	if len(empty) != 0 || len(old()) != 0 {
		t.Fatalf("no cases: got %v, old %v", empty, old())
	}
	seedSQLCases(t, ctx, conn, rc)
	got, err := caseDataSources(ctx, conn, rc.CustomerID)
	check(t, err)
	if want := old(); !reflect.DeepEqual(got, want) || len(got) != 2 {
		t.Fatalf("got %v, want %v", got, want)
	}
}
