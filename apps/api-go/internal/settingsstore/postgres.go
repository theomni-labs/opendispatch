// SPDX-License-Identifier: AGPL-3.0-only

package settingsstore

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

type pgBackend struct{ conn *tenancy.Connection }

// UsePostgres keeps settings in the settings table, one set per customer.
func UsePostgres(conn *tenancy.Connection) { backend = pgBackend{conn: conn} }

const selectColumns = `id::text, tenant_id::text, created_at, updated_at, created_by::text, data_source, key, value`

func scanEntry(row pgx.Row) (Entry, error) {
	var e Entry
	var created, updated time.Time
	var raw string
	if err := row.Scan(&e.ID, &e.TenantID, &created, &updated, &e.CreatedBy, &e.DataSource, &e.Key, &raw); err != nil {
		return Entry{}, err
	}
	e.CreatedAt, e.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
	if err := json.Unmarshal([]byte(raw), &e.Value); err != nil {
		return Entry{}, err
	}
	return e, nil
}

func (b pgBackend) get(ctx context.Context, tenant, key string) (Entry, bool, error) {
	var found bool
	e, err := tenancy.WithTenant(ctx, b.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (Entry, error) {
		e, err := scanEntry(tx.QueryRow(ctx, `SELECT `+selectColumns+` FROM settings WHERE key = $1`, key))
		if err == pgx.ErrNoRows {
			return Entry{}, nil
		}
		found = err == nil
		return e, err
	})
	return e, found, err
}

func (b pgBackend) put(ctx context.Context, tenant, key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, b.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO settings (tenant_id, data_source, key, value) VALUES (current_setting('app.tenant_id')::uuid, $3, $1, $2)
			ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, string(raw), recordsource.Get())
		return struct{}{}, err
	})
	return err
}

func (b pgBackend) getRaw(ctx context.Context, tenant, key string) (string, bool, error) {
	var found bool
	raw, err := tenancy.WithTenant(ctx, b.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (string, error) {
		var raw string
		err := tx.QueryRow(ctx, `SELECT value FROM settings WHERE key = $1`, key).Scan(&raw)
		if err == pgx.ErrNoRows {
			return "", nil
		}
		found = err == nil
		return raw, err
	})
	return raw, found, err
}

func (b pgBackend) swap(ctx context.Context, tenant, key, stamp string, value any) (bool, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return false, err
	}
	return tenancy.WithTenant(ctx, b.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (bool, error) {
		if stamp == "" {
			tag, err := tx.Exec(ctx, `INSERT INTO settings (tenant_id, data_source, key, value) VALUES (current_setting('app.tenant_id')::uuid, $3, $1, $2)
				ON CONFLICT (tenant_id, key) DO NOTHING`, key, string(raw), recordsource.Get())
			return err == nil && tag.RowsAffected() == 1, err
		}
		tag, err := tx.Exec(ctx, `UPDATE settings SET value = $2, updated_at = now() WHERE key = $1 AND value = $3`, key, string(raw), stamp)
		return err == nil && tag.RowsAffected() == 1, err
	})
}

func (b pgBackend) incr(ctx context.Context, tenant, key string, delta int) (int, error) {
	return tenancy.WithTenant(ctx, b.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (int, error) {
		var raw string
		err := tx.QueryRow(ctx, `INSERT INTO settings (tenant_id, data_source, key, value) VALUES (current_setting('app.tenant_id')::uuid, $3, $1, GREATEST(0, $2::int)::text)
			ON CONFLICT (tenant_id, key) DO UPDATE SET value = GREATEST(0, (CASE WHEN settings.value ~ '^[0-9]+$' THEN settings.value::int ELSE 0 END) + $2::int)::text, updated_at = now()
			RETURNING value`, key, delta, recordsource.Get()).Scan(&raw)
		if err != nil {
			return 0, err
		}
		var n int
		return n, json.Unmarshal([]byte(raw), &n)
	})
}

func (b pgBackend) putMany(ctx context.Context, tenant string, kvs []KV) error {
	_, err := tenancy.WithTenant(ctx, b.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, kv := range kvs {
			raw, err := json.Marshal(kv.Value)
			if err != nil {
				return struct{}{}, err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO settings (tenant_id, data_source, key, value) VALUES (current_setting('app.tenant_id')::uuid, $3, $1, $2)
				ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, kv.Key, string(raw), recordsource.Get()); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}

func (b pgBackend) list(ctx context.Context, tenant string) ([]Entry, error) {
	return tenancy.WithTenant(ctx, b.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]Entry, error) {
		rows, err := tx.Query(ctx, `SELECT `+selectColumns+` FROM settings ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Entry
		for rows.Next() {
			e, err := scanEntry(rows)
			if err != nil {
				return nil, err
			}
			out = append(out, e)
		}
		return out, rows.Err()
	})
}

func (b pgBackend) deletePrefix(ctx context.Context, tenant, prefix string) error {
	_, err := tenancy.WithTenant(ctx, b.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `DELETE FROM settings WHERE starts_with(key, $1)`, prefix)
		return struct{}{}, err
	})
	return err
}

// ReseedForTest puts the settings table back to the fixtures (owner connection: it bypasses row-level security).
func ReseedForTest(ctx context.Context, owner *tenancy.Connection) error {
	recs, err := fixtures.Records[fixtureSetting]("Setting")
	if err != nil {
		return err
	}
	tx, err := owner.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed
	if _, err := tx.Exec(ctx, `DELETE FROM settings`); err != nil {
		return err
	}
	for i, r := range recs {
		created, err := time.Parse(time.RFC3339, r.CreatedAt)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO settings (tenant_id, id, data_source, created_at, updated_at, created_by, key, value) VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
			r.TenantID, r.ID, r.DataSource, created.Add(time.Duration(i)*time.Millisecond), r.CreatedBy, r.Key, string(r.Value)); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
