// SPDX-License-Identifier: AGPL-3.0-only

package auditlog

import (
	"context"
	"encoding/json"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

var uuidShape = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// PgStore writes audit_events through the tenant transaction.
type PgStore struct {
	Conn *tenancy.Connection
}

// asUUID: the id when it is a uuid, else nil (the original goes to detail).
func asUUID(id *string) *string {
	if id == nil || !uuidShape.MatchString(*id) {
		return nil
	}
	return id
}

func (p PgStore) Insert(ctx context.Context, e AuditEvent) error {
	detail := map[string]any{}
	for k, v := range e.Detail {
		detail[k] = v
	}
	if e.ActorUserID != nil && asUUID(e.ActorUserID) == nil {
		detail["actor_ref"] = *e.ActorUserID
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, p.Conn.Pool, e.TenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO audit_events
			(tenant_id, id, data_source, created_at, updated_at, created_by, occurred_at, actor_type, actor_user_id,
			 action, entity_type, entity_id, outcome, summary_en, correlation_id, detail)
			VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7::timestamptz, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)`,
			e.TenantID, e.ID, e.DataSource, e.CreatedAt, e.UpdatedAt, asUUID(e.CreatedBy), e.OccurredAt, e.ActorType, asUUID(e.ActorUserID),
			e.Action, e.EntityType, e.EntityID, e.Outcome, e.SummaryEn, e.CorrelationID, string(raw))
		return struct{}{}, err
	})
	return err
}

func (p PgStore) List(ctx context.Context, tenantID string) ([]AuditEvent, error) {
	return tenancy.WithTenant(ctx, p.Conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]AuditEvent, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, created_at, created_by::text, data_source, updated_at, occurred_at,
			actor_type, actor_user_id::text, action, entity_type, entity_id, outcome, summary_en, correlation_id, detail
			FROM audit_events ORDER BY seq`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []AuditEvent
		for rows.Next() {
			var e AuditEvent
			var created, updated, occurred time.Time
			var raw []byte
			if err := rows.Scan(&e.ID, &e.TenantID, &created, &e.CreatedBy, &e.DataSource, &updated, &occurred,
				&e.ActorType, &e.ActorUserID, &e.Action, &e.EntityType, &e.EntityID, &e.Outcome, &e.SummaryEn, &e.CorrelationID, &raw); err != nil {
				return nil, err
			}
			e.CreatedAt = created.UTC().Format(time.RFC3339Nano)
			e.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
			e.OccurredAt = occurred.UTC().Format(time.RFC3339Nano)
			e.Detail = map[string]any{}
			if err := json.Unmarshal(raw, &e.Detail); err != nil {
				return nil, err
			}
			out = append(out, e)
		}
		return out, rows.Err()
	})
}
