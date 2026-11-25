// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors connection.ts; caller sets the URL.
package tenancy

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connection mirrors TenancyConnection.
type Connection struct {
	Pool *pgxpool.Pool
}

// OpenConnection: pool against url, lazy.
func OpenConnection(ctx context.Context, url string) (*Connection, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 5
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return &Connection{Pool: pool}, nil
}

// Close closes the pool; call once, at shutdown.
func (c *Connection) Close() {
	c.Pool.Close()
}
