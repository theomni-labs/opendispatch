// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// securityBackend keeps control evidence and support grants.
type securityBackend interface {
	controls(ctx context.Context, rc reqctx.RequestContext) ([]ControlEvidence, error)
	saveControl(ctx context.Context, tenant string, c ControlEvidence) error
	events(ctx context.Context, rc reqctx.RequestContext) ([]SupportAccessEvent, error)
	saveEvent(ctx context.Context, tenant string, e SupportAccessEvent) error
}

var securityStoreBackend securityBackend = memorySecurity{}

// UsePostgresSecurityCompliance keeps them in Postgres.
func UsePostgresSecurityCompliance(conn *tenancy.Connection) {
	securityStoreBackend = pgSecurity{conn: conn}
}

// UseMemorySecurityCompliance puts the memory store back.
func UseMemorySecurityCompliance() { securityStoreBackend = memorySecurity{} }

type memorySecurity struct{}

func (memorySecurity) controls(_ context.Context, rc reqctx.RequestContext) ([]ControlEvidence, error) {
	return allControlEvidenceMemory(context.Background(), rc), nil
}

func (memorySecurity) saveControl(_ context.Context, _ string, c ControlEvidence) error {
	UpsertControlEvidenceForTest(c)
	return nil
}

func (memorySecurity) events(_ context.Context, rc reqctx.RequestContext) ([]SupportAccessEvent, error) {
	return allSupportAccessEventsMemory(context.Background(), rc), nil
}

func (memorySecurity) saveEvent(_ context.Context, _ string, e SupportAccessEvent) error {
	upsertSupportAccessEventMemory(e)
	return nil
}

type pgSecurity struct{ conn *tenancy.Connection }

func tenantAdminID(ctx context.Context, tenant string) (*string, error) {
	users, err := allUsers(ctx, tenant)
	if err != nil {
		return nil, err
	}
	for _, u := range users {
		if u.AssignedRole == access.RoleAdministrator && !u.IsEmergencyAdmin {
			id := u.ID
			return &id, nil
		}
	}
	return nil, nil
}

func insertControl(ctx context.Context, tx pgx.Tx, c ControlEvidence, upsert bool) error {
	reviewed, err := optTime(c.ReviewedAt)
	if err != nil {
		return err
	}
	created, err := parseTime(c.CreatedAt)
	if err != nil {
		return err
	}
	conflict := `ON CONFLICT (tenant_id, id) DO NOTHING`
	if upsert {
		conflict = `ON CONFLICT (tenant_id, id) DO UPDATE SET status = EXCLUDED.status, evidence_note = EXCLUDED.evidence_note, reviewed_at = EXCLUDED.reviewed_at, updated_at = now()`
	}
	_, err = tx.Exec(ctx, `INSERT INTO control_evidence (tenant_id, id, data_source, created_by, framework, control_ref, title_en, status, evidence_note, reviewed_at, created_at)
		VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10) `+conflict,
		c.ID, c.DataSource, c.CreatedBy, c.Framework, c.ControlRef, c.TitleEn, c.Status, c.EvidenceNote, reviewed, created)
	return err
}

func insertEvent(ctx context.Context, tx pgx.Tx, e SupportAccessEvent, upsert bool) error {
	started, err := parseTime(e.StartedAt)
	if err != nil {
		return err
	}
	ended, err := optTime(e.EndedAt)
	if err != nil {
		return err
	}
	conflict := `ON CONFLICT (tenant_id, id) DO NOTHING`
	if upsert {
		conflict = `ON CONFLICT (tenant_id, id) DO UPDATE SET ended_at = EXCLUDED.ended_at, updated_at = now()`
	}
	_, err = tx.Exec(ctx, `INSERT INTO support_access_events (tenant_id, id, data_source, created_by, started_at, ended_at, granted_by_user_id, reason)
		VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3::uuid, $4, $5, $6::uuid, $7) `+conflict,
		e.ID, e.DataSource, e.CreatedBy, started, ended, e.GrantedByUserID, e.Reason)
	return err
}

// seed adds the samples once per customer.
func (p pgSecurity) seed(ctx context.Context, rc reqctx.RequestContext) error {
	var empty bool
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		err := tx.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM control_evidence)`).Scan(&empty)
		return struct{}{}, err
	})
	if err != nil || !empty {
		return err
	}
	admin, err := tenantAdminID(ctx, rc.CustomerID)
	if err != nil {
		return err
	}
	controls, events := securitySeedRows(rc, admin)
	_, err = tenancy.WithTenant(ctx, p.conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, c := range controls {
			if err := insertControl(ctx, tx, c, false); err != nil {
				return struct{}{}, err
			}
		}
		for _, e := range events {
			if err := insertEvent(ctx, tx, e, false); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}

func (p pgSecurity) controls(ctx context.Context, rc reqctx.RequestContext) ([]ControlEvidence, error) {
	if err := p.seed(ctx, rc); err != nil {
		return nil, err
	}
	return tenancy.WithTenant(ctx, p.conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) ([]ControlEvidence, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, framework, control_ref, title_en, status, evidence_note, reviewed_at
			FROM control_evidence ORDER BY created_at, control_ref`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []ControlEvidence
		for rows.Next() {
			var c ControlEvidence
			var created, updated time.Time
			var reviewed *time.Time
			if err := rows.Scan(&c.ID, &c.TenantID, &c.DataSource, &created, &updated, &c.CreatedBy, &c.Framework, &c.ControlRef, &c.TitleEn, &c.Status, &c.EvidenceNote, &reviewed); err != nil {
				return nil, err
			}
			c.CreatedAt, c.UpdatedAt, c.ReviewedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated), nullableTimeToISO(reviewed)
			out = append(out, c)
		}
		return out, rows.Err()
	})
}

func (p pgSecurity) saveControl(ctx context.Context, tenant string, c ControlEvidence) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, insertControl(ctx, tx, c, true)
	})
	return err
}

func (p pgSecurity) events(ctx context.Context, rc reqctx.RequestContext) ([]SupportAccessEvent, error) {
	if err := p.seed(ctx, rc); err != nil {
		return nil, err
	}
	return tenancy.WithTenant(ctx, p.conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) ([]SupportAccessEvent, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, started_at, ended_at, granted_by_user_id::text, reason
			FROM support_access_events ORDER BY started_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []SupportAccessEvent
		for rows.Next() {
			var e SupportAccessEvent
			var created, updated, started time.Time
			var ended *time.Time
			if err := rows.Scan(&e.ID, &e.TenantID, &e.DataSource, &created, &updated, &e.CreatedBy, &started, &ended, &e.GrantedByUserID, &e.Reason); err != nil {
				return nil, err
			}
			e.CreatedAt, e.UpdatedAt, e.StartedAt, e.EndedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated), datactx.ToRiyadhISO(started), nullableTimeToISO(ended)
			out = append(out, e)
		}
		return out, rows.Err()
	})
}

func (p pgSecurity) saveEvent(ctx context.Context, tenant string, e SupportAccessEvent) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, insertEvent(ctx, tx, e, true)
	})
	return err
}

func loadControlEvidence(ctx context.Context, rc reqctx.RequestContext) ([]ControlEvidence, error) {
	return securityStoreBackend.controls(ctx, rc)
}

func saveControlEvidence(ctx context.Context, tenant string, c ControlEvidence) error {
	return securityStoreBackend.saveControl(ctx, tenant, c)
}

func loadSupportAccessEvents(ctx context.Context, rc reqctx.RequestContext) ([]SupportAccessEvent, error) {
	return securityStoreBackend.events(ctx, rc)
}

func saveSupportAccessEvent(ctx context.Context, tenant string, e SupportAccessEvent) error {
	return securityStoreBackend.saveEvent(ctx, tenant, e)
}

// ReseedSecurityComplianceForTest puts the samples back.
func ReseedSecurityComplianceForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, isPg := securityStoreBackend.(pgSecurity); !isPg {
		return nil
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM control_evidence`); err != nil {
		return err
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM support_access_events`); err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	admin, err := tenantAdminID(ctx, tenant)
	if err != nil {
		return err
	}
	controls, events := securitySeedRows(reqctx.RequestContext{CustomerID: tenant}, admin)
	_, err = tenancy.WithTenant(ctx, owner.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, c := range controls {
			if err := insertControl(ctx, tx, c, false); err != nil {
				return struct{}{}, err
			}
		}
		for _, e := range events {
			if err := insertEvent(ctx, tx, e, false); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}
