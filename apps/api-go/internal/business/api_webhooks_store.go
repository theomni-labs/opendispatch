// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// apiWebhookBackend keeps clients and webhooks.
type apiWebhookBackend interface {
	clients(ctx context.Context, tenant string) ([]ApiClient, error)
	saveClient(ctx context.Context, tenant string, c ApiClient) error
	hooks(ctx context.Context, tenant string) ([]Webhook, error)
	saveHook(ctx context.Context, tenant string, h Webhook) error
	removeHook(ctx context.Context, tenant, id string) error
	deliveries(ctx context.Context, tenant string) ([]WebhookDelivery, error)
	saveDelivery(ctx context.Context, tenant string, d WebhookDelivery, h Webhook) error
}

var apiWebhookData apiWebhookBackend = memoryAPIWebhooks{}

// UsePostgresAPIWebhooks: Postgres store.
func UsePostgresAPIWebhooks(conn *tenancy.Connection) { apiWebhookData = pgAPIWebhooks{conn: conn} }

// UseMemoryAPIWebhooks: memory store (tests).
func UseMemoryAPIWebhooks() { apiWebhookData = memoryAPIWebhooks{} }

func allAPIClients(ctx context.Context, tenant string) ([]ApiClient, error) {
	return apiWebhookData.clients(ctx, tenant)
}

func findAPIClient(ctx context.Context, tenant, id string) (ApiClient, bool, error) {
	rows, err := apiWebhookData.clients(ctx, tenant)
	if err != nil {
		return ApiClient{}, false, err
	}
	for _, c := range rows {
		if c.ID == id {
			return c, true, nil
		}
	}
	return ApiClient{}, false, nil
}

func saveAPIClient(ctx context.Context, tenant string, c ApiClient) error {
	return apiWebhookData.saveClient(ctx, tenant, c)
}

func allWebhooks(ctx context.Context, tenant string) ([]Webhook, error) {
	return apiWebhookData.hooks(ctx, tenant)
}

func findWebhook(ctx context.Context, tenant, id string) (Webhook, bool, error) {
	rows, err := apiWebhookData.hooks(ctx, tenant)
	if err != nil {
		return Webhook{}, false, err
	}
	for _, h := range rows {
		if h.ID == id {
			return h, true, nil
		}
	}
	return Webhook{}, false, nil
}

func saveWebhook(ctx context.Context, tenant string, h Webhook) error {
	return apiWebhookData.saveHook(ctx, tenant, h)
}

func removeWebhook(ctx context.Context, tenant, id string) error {
	return apiWebhookData.removeHook(ctx, tenant, id)
}

func allDeliveries(ctx context.Context, tenant string) ([]WebhookDelivery, error) {
	return apiWebhookData.deliveries(ctx, tenant)
}

func findDelivery(ctx context.Context, tenant, id string) (WebhookDelivery, bool, error) {
	rows, err := apiWebhookData.deliveries(ctx, tenant)
	if err != nil {
		return WebhookDelivery{}, false, err
	}
	for _, d := range rows {
		if d.ID == id {
			return d, true, nil
		}
	}
	return WebhookDelivery{}, false, nil
}

// saveDelivery: delivery and webhook, one tx.
func saveDelivery(ctx context.Context, tenant string, d WebhookDelivery, h Webhook) error {
	return apiWebhookData.saveDelivery(ctx, tenant, d, h)
}

type memoryAPIWebhooks struct{}

func (memoryAPIWebhooks) clients(context.Context, string) ([]ApiClient, error) {
	return allAPIClientsMemory(), nil
}

func (memoryAPIWebhooks) saveClient(_ context.Context, _ string, c ApiClient) error {
	upsertAPIClientMemory(c)
	return nil
}

func (memoryAPIWebhooks) hooks(context.Context, string) ([]Webhook, error) {
	return allWebhooksMemory(), nil
}

func (memoryAPIWebhooks) saveHook(_ context.Context, _ string, h Webhook) error {
	upsertWebhookMemory(h)
	return nil
}

func (memoryAPIWebhooks) removeHook(_ context.Context, _, id string) error {
	removeWebhookMemory(id)
	return nil
}

func (memoryAPIWebhooks) deliveries(context.Context, string) ([]WebhookDelivery, error) {
	return allDeliveriesMemory(), nil
}

func (memoryAPIWebhooks) saveDelivery(_ context.Context, _ string, d WebhookDelivery, h Webhook) error {
	upsertDeliveryMemory(d)
	upsertWebhookMemory(h)
	return nil
}

type pgAPIWebhooks struct{ conn *tenancy.Connection }

func nonNil(list []string) []string {
	if list == nil {
		return []string{}
	}
	return list
}

func (p pgAPIWebhooks) clients(ctx context.Context, tenant string) ([]ApiClient, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]ApiClient, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, name, scopes, is_revoked, secret_hint, last_used_at
			FROM api_clients ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []ApiClient
		for rows.Next() {
			var c ApiClient
			var created, updated time.Time
			var used *time.Time
			if err := rows.Scan(&c.ID, &c.TenantID, &c.DataSource, &created, &updated, &c.CreatedBy, &c.Name, &c.Scopes, &c.IsRevoked, &c.SecretHint, &used); err != nil {
				return nil, err
			}
			c.CreatedAt, c.UpdatedAt, c.LastUsedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated), nullableTimeToISO(used)
			out = append(out, c)
		}
		return out, rows.Err()
	})
}

func (p pgAPIWebhooks) saveClient(ctx context.Context, tenant string, c ApiClient) error {
	created, err := parseTime(c.CreatedAt)
	if err != nil {
		return err
	}
	updated, err := parseTime(c.UpdatedAt)
	if err != nil {
		return err
	}
	used, err := optTime(c.LastUsedAt)
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO api_clients (tenant_id, id, data_source, created_at, updated_at, created_by, name, scopes, is_revoked, secret_hint, last_used_at)
			VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10)
			ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, name = EXCLUDED.name, scopes = EXCLUDED.scopes,
				is_revoked = EXCLUDED.is_revoked, secret_hint = EXCLUDED.secret_hint, last_used_at = EXCLUDED.last_used_at`,
			c.ID, c.DataSource, created, updated, c.CreatedBy, c.Name, nonNil(c.Scopes), c.IsRevoked, c.SecretHint, used)
		return struct{}{}, err
	})
	return err
}

func (p pgAPIWebhooks) hooks(ctx context.Context, tenant string) ([]Webhook, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]Webhook, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, name, target_url, event_types, is_enabled,
			signing_secret_hint, last_delivery_at, last_status FROM webhooks ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Webhook
		for rows.Next() {
			var h Webhook
			var created, updated time.Time
			var last *time.Time
			if err := rows.Scan(&h.ID, &h.TenantID, &h.DataSource, &created, &updated, &h.CreatedBy, &h.Name, &h.TargetURL, &h.EventTypes, &h.IsEnabled,
				&h.SigningSecretHint, &last, &h.LastStatus); err != nil {
				return nil, err
			}
			h.CreatedAt, h.UpdatedAt, h.LastDeliveryAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated), nullableTimeToISO(last)
			out = append(out, h)
		}
		return out, rows.Err()
	})
}

const webhookUpsertSQL = `INSERT INTO webhooks (tenant_id, id, data_source, created_at, updated_at, created_by, name, target_url, event_types, is_enabled, signing_secret_hint, last_delivery_at, last_status)
	VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11, $12)
	ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, name = EXCLUDED.name, target_url = EXCLUDED.target_url,
		event_types = EXCLUDED.event_types, is_enabled = EXCLUDED.is_enabled, last_delivery_at = EXCLUDED.last_delivery_at, last_status = EXCLUDED.last_status`

func execWebhook(ctx context.Context, tx pgx.Tx, h Webhook) error {
	created, err := parseTime(h.CreatedAt)
	if err != nil {
		return err
	}
	updated, err := parseTime(h.UpdatedAt)
	if err != nil {
		return err
	}
	last, err := optTime(h.LastDeliveryAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, webhookUpsertSQL, h.ID, h.DataSource, created, updated, h.CreatedBy, h.Name, h.TargetURL, nonNil(h.EventTypes), h.IsEnabled,
		h.SigningSecretHint, last, h.LastStatus)
	return err
}

func (p pgAPIWebhooks) saveHook(ctx context.Context, tenant string, h Webhook) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, execWebhook(ctx, tx, h)
	})
	return err
}

func (p pgAPIWebhooks) removeHook(ctx context.Context, tenant, id string) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `DELETE FROM webhooks WHERE id = $1::uuid`, id)
		return struct{}{}, err
	})
	return err
}

func (p pgAPIWebhooks) deliveries(ctx context.Context, tenant string) ([]WebhookDelivery, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]WebhookDelivery, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, webhook_id::text, event_type, status, http_status,
			attempted_at, attempt_count, error_message FROM webhook_deliveries ORDER BY created_at, seq`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []WebhookDelivery
		for rows.Next() {
			var d WebhookDelivery
			var created, updated, attempted time.Time
			var httpStatus, attempts int32
			if err := rows.Scan(&d.ID, &d.TenantID, &d.DataSource, &created, &updated, &d.CreatedBy, &d.WebhookID, &d.EventType, &d.Status, &httpStatus,
				&attempted, &attempts, &d.ErrorMessage); err != nil {
				return nil, err
			}
			d.CreatedAt, d.UpdatedAt, d.AttemptedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated), datactx.ToRiyadhISO(attempted)
			d.HTTPStatus, d.AttemptCount = int(httpStatus), int(attempts)
			out = append(out, d)
		}
		return out, rows.Err()
	})
}

func execDelivery(ctx context.Context, tx pgx.Tx, d WebhookDelivery) error {
	created, err := parseTime(d.CreatedAt)
	if err != nil {
		return err
	}
	updated, err := parseTime(d.UpdatedAt)
	if err != nil {
		return err
	}
	attempted, err := parseTime(d.AttemptedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO webhook_deliveries (tenant_id, id, data_source, created_at, updated_at, created_by, webhook_id, event_type, status, http_status, attempted_at, attempt_count, error_message)
		VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, status = EXCLUDED.status, http_status = EXCLUDED.http_status,
			attempted_at = EXCLUDED.attempted_at, attempt_count = EXCLUDED.attempt_count, error_message = EXCLUDED.error_message`,
		d.ID, d.DataSource, created, updated, d.CreatedBy, d.WebhookID, d.EventType, d.Status, d.HTTPStatus, attempted, d.AttemptCount, d.ErrorMessage)
	return err
}

func (p pgAPIWebhooks) saveDelivery(ctx context.Context, tenant string, d WebhookDelivery, h Webhook) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		if err := execWebhook(ctx, tx, h); err != nil {
			return struct{}{}, err
		}
		return struct{}{}, execDelivery(ctx, tx, d)
	})
	return err
}

// ReseedAPIWebhooksForTest: demo rows, owner.
func ReseedAPIWebhooksForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, isPg := apiWebhookData.(pgAPIWebhooks); !isPg {
		return nil
	}
	for _, table := range []string{"webhook_deliveries", "webhooks", "api_clients"} {
		if _, err := owner.Pool.Exec(ctx, `DELETE FROM `+table); err != nil {
			return err
		}
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	seed := pgAPIWebhooks{conn: owner}
	clients := seedClientRows(tenant)
	for idx, c := range clients {
		// Demo rows list in seed order: their stored times rise in that order.
		c.CreatedAt = nudgedCreatedAt(clients[0].CreatedAt, idx)
		if err := seed.saveClient(ctx, tenant, c); err != nil {
			return err
		}
	}
	hooks := seedWebhookRows(tenant)
	for idx := range hooks {
		hooks[idx].CreatedAt = nudgedCreatedAt(hooks[idx].CreatedAt, idx)
		if err := seed.saveHook(ctx, tenant, hooks[idx]); err != nil {
			return err
		}
	}
	for idx, d := range seedDeliveryRows(tenant) {
		d.CreatedAt = nudgedCreatedAt(d.CreatedAt, idx)
		if err := seed.saveDelivery(ctx, tenant, d, hooks[0]); err != nil {
			return err
		}
	}
	return nil
}
