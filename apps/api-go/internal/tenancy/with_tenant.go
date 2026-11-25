// SPDX-License-Identifier: AGPL-3.0-only

// set_config helper; mirrors with-tenant.ts.
package tenancy

import (
	"context"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Matches platform.tenants' uuid shape.
var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// MissingTenantError mirrors with-tenant.ts.
type MissingTenantError struct {
	Msg string
}

func (e *MissingTenantError) Error() string { return e.Msg }

// WithTenant mirrors withTenant.
func WithTenant[T any](ctx context.Context, pool *pgxpool.Pool, tenantID string, fn func(ctx context.Context, tx pgx.Tx) (T, error)) (T, error) {
	var zero T
	if !uuidPattern.MatchString(tenantID) {
		return zero, &MissingTenantError{fmt.Sprintf("withTenant needs a uuid tenant id, got %q.", tenantID)}
	}
	if u := unitOf(ctx); u != nil {
		if u.joins(pool, tenantID) {
			return inUnit(ctx, u, pool, tenantID, fn)
		}
		ctx = Detach(ctx)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	if _, err := tx.Exec(ctx, `SELECT set_config('app.tenant_id', $1, true)`, tenantID); err != nil {
		return zero, err
	}
	result, err := fn(ctx, tx)
	if err != nil {
		return zero, err
	}
	if err := tx.Commit(ctx); err != nil {
		return zero, err
	}
	return result, nil
}
