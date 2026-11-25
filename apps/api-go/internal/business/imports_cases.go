// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// caseCountLive: every stored case, counted.
func caseCountLive(ctx context.Context, conn *tenancy.Connection, tenantID string) (int, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (int, error) {
		var n int
		err := tx.QueryRow(ctx, `SELECT count(*) FROM cases`).Scan(&n)
		return n, err
	})
}
