// SPDX-License-Identifier: AGPL-3.0-only

package tenancy

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Unit: one tx for WithTenant; one goroutine.
type Unit struct {
	pool     *pgxpool.Pool
	tenantID string
	tx       pgx.Tx
	closed   bool
}

type unitKey struct{}

// BeginUnit: owned is false when ctx has one.
func BeginUnit(ctx context.Context) (context.Context, *Unit, bool) {
	if ctx == nil {
		ctx = context.Background()
	}
	if u := unitOf(ctx); u != nil {
		return ctx, u, false
	}
	u := &Unit{}
	return context.WithValue(ctx, unitKey{}, u), u, true
}

// Detach: ctx whose WithTenant calls stand alone.
func Detach(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	if unitOf(ctx) == nil {
		return ctx
	}
	return context.WithValue(ctx, unitKey{}, (*Unit)(nil))
}

// InUnit: ctx carries an open unit.
func InUnit(ctx context.Context) bool { return unitOf(ctx) != nil }

func unitOf(ctx context.Context) *Unit {
	if ctx == nil {
		return nil
	}
	u, _ := ctx.Value(unitKey{}).(*Unit)
	if u == nil || u.closed {
		return nil
	}
	return u
}

// joins: same pool and customer as the open tx.
func (u *Unit) joins(pool *pgxpool.Pool, tenantID string) bool {
	return u.tx == nil || (u.pool == pool && u.tenantID == tenantID)
}

func (u *Unit) begin(ctx context.Context, pool *pgxpool.Pool, tenantID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('app.tenant_id', $1, true)`, tenantID); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	u.pool, u.tenantID, u.tx = pool, tenantID, tx
	return nil
}

// Commit ends the unit; no-op if it never began.
func (u *Unit) Commit(ctx context.Context) error {
	if u.closed {
		return errors.New("tenancy: unit already closed")
	}
	u.closed = true
	if u.tx == nil {
		return nil
	}
	return u.tx.Commit(ctx)
}

// Rollback ends the unit, dropping its writes.
func (u *Unit) Rollback(ctx context.Context) {
	if u.closed {
		return
	}
	u.closed = true
	if u.tx != nil {
		_ = u.tx.Rollback(ctx)
	}
}

// inUnit runs fn under a savepoint of the unit.
func inUnit[T any](ctx context.Context, u *Unit, pool *pgxpool.Pool, tenantID string, fn func(ctx context.Context, tx pgx.Tx) (T, error)) (T, error) {
	var zero T
	if u.tx == nil {
		if err := u.begin(ctx, pool, tenantID); err != nil {
			return zero, err
		}
	}
	sp, err := u.tx.Begin(ctx)
	if err != nil {
		return zero, err
	}
	result, err := fn(ctx, sp)
	if err != nil {
		_ = sp.Rollback(ctx)
		return zero, err
	}
	if err := sp.Commit(ctx); err != nil {
		return zero, err
	}
	return result, nil
}
