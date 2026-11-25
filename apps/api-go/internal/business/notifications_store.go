// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// notificationBackend keeps notifications.
type notificationBackend interface {
	notifications(ctx context.Context, tenant string) ([]Notification, error)
	saveNotifications(ctx context.Context, tenant string, rows []Notification) error
	rules(ctx context.Context, tenant string) ([]NotificationRule, error)
	saveRule(ctx context.Context, tenant string, r NotificationRule) error
}

var notificationData notificationBackend = memoryNotifications{}

// UsePostgresNotifications: Postgres store.
func UsePostgresNotifications(conn *tenancy.Connection) {
	notificationData = pgNotifications{conn: conn}
}

// UseMemoryNotifications: memory store (tests).
func UseMemoryNotifications() { notificationData = memoryNotifications{} }

func allNotifications(ctx context.Context, tenant string) ([]Notification, error) {
	return notificationData.notifications(ctx, tenant)
}

// saveNotifications: all rows, one transaction.
func saveNotifications(ctx context.Context, tenant string, rows ...Notification) error {
	if len(rows) == 0 {
		return nil
	}
	return notificationData.saveNotifications(ctx, tenant, rows)
}

func allNotificationRules(ctx context.Context, tenant string) ([]NotificationRule, error) {
	return notificationData.rules(ctx, tenant)
}

func oneNotificationRule(ctx context.Context, tenant, id string) (*NotificationRule, error) {
	rows, err := notificationData.rules(ctx, tenant)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.ID == id {
			row := r
			return &row, nil
		}
	}
	return nil, nil
}

func saveNotificationRule(ctx context.Context, tenant string, r NotificationRule) error {
	return notificationData.saveRule(ctx, tenant, r)
}

type memoryNotifications struct{}

func (memoryNotifications) notifications(context.Context, string) ([]Notification, error) {
	return allNotificationsMemory(), nil
}

func (memoryNotifications) saveNotifications(_ context.Context, _ string, rows []Notification) error {
	for _, n := range rows {
		upsertNotificationMemory(n)
	}
	return nil
}

func (memoryNotifications) rules(context.Context, string) ([]NotificationRule, error) {
	return allNotificationRulesMemory(), nil
}

func (memoryNotifications) saveRule(_ context.Context, _ string, r NotificationRule) error {
	upsertNotificationRuleMemory(r)
	return nil
}

type pgNotifications struct{ conn *tenancy.Connection }

func (p pgNotifications) notifications(ctx context.Context, tenant string) ([]Notification, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]Notification, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, recipient_user_id::text, recipient_role,
			category, severity, title_en, title_ar, body_en, link_path, is_read, read_at FROM notifications ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Notification
		for rows.Next() {
			var n Notification
			var created, updated time.Time
			var readAt *time.Time
			var body string
			if err := rows.Scan(&n.ID, &n.TenantID, &n.DataSource, &created, &updated, &n.CreatedBy, &n.RecipientUserID, &n.RecipientRole,
				&n.Category, &n.Severity, &n.TitleEn, &n.TitleAr, &body, &n.LinkPath, &n.IsRead, &readAt); err != nil {
				return nil, err
			}
			n.CreatedAt, n.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			n.BodyEn = &body
			n.ReadAt = nullableTimeToISO(readAt)
			out = append(out, n)
		}
		return out, rows.Err()
	})
}

func (p pgNotifications) saveNotifications(ctx context.Context, tenant string, list []Notification) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, n := range list {
			created, err := parseTime(n.CreatedAt)
			if err != nil {
				return struct{}{}, err
			}
			updated, err := parseTime(n.UpdatedAt)
			if err != nil {
				return struct{}{}, err
			}
			readAt, err := optTime(n.ReadAt)
			if err != nil {
				return struct{}{}, err
			}
			body := ""
			if n.BodyEn != nil {
				body = *n.BodyEn
			}
			if _, err := tx.Exec(ctx, `INSERT INTO notifications (tenant_id, id, data_source, created_at, updated_at, created_by, recipient_user_id, recipient_role, category, severity,
					title_en, title_ar, body_en, link_path, is_read, read_at)
				VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7, $8, $9, $10, $11, $12, $13, $14, $15)
				ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, is_read = EXCLUDED.is_read, read_at = EXCLUDED.read_at,
					category = EXCLUDED.category, severity = EXCLUDED.severity, title_en = EXCLUDED.title_en, title_ar = EXCLUDED.title_ar,
					body_en = EXCLUDED.body_en, link_path = EXCLUDED.link_path`,
				n.ID, n.DataSource, created, updated, n.CreatedBy, n.RecipientUserID, n.RecipientRole, n.Category, n.Severity,
				n.TitleEn, n.TitleAr, body, n.LinkPath, n.IsRead, readAt); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}

func (p pgNotifications) rules(ctx context.Context, tenant string) ([]NotificationRule, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]NotificationRule, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, event_type, channels, recipient_roles,
			severity, is_enabled FROM notification_rules ORDER BY event_type, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []NotificationRule
		for rows.Next() {
			var r NotificationRule
			var created, updated time.Time
			var roles []string
			if err := rows.Scan(&r.ID, &r.TenantID, &r.DataSource, &created, &updated, &r.CreatedBy, &r.EventType, &r.Channels, &roles, &r.Severity, &r.IsEnabled); err != nil {
				return nil, err
			}
			r.CreatedAt, r.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			for _, role := range roles {
				r.RecipientRoles = append(r.RecipientRoles, access.Role(role))
			}
			out = append(out, r)
		}
		return out, rows.Err()
	})
}

func (p pgNotifications) saveRule(ctx context.Context, tenant string, r NotificationRule) error {
	created, err := parseTime(r.CreatedAt)
	if err != nil {
		return err
	}
	updated, err := parseTime(r.UpdatedAt)
	if err != nil {
		return err
	}
	roles := make([]string, len(r.RecipientRoles))
	for i, role := range r.RecipientRoles {
		roles[i] = string(role)
	}
	channels := r.Channels
	if channels == nil {
		channels = []string{}
	}
	_, err = tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO notification_rules (tenant_id, id, data_source, created_at, updated_at, created_by, event_type, channels, recipient_roles, severity, is_enabled)
			VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10)
			ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, channels = EXCLUDED.channels, recipient_roles = EXCLUDED.recipient_roles,
				severity = EXCLUDED.severity, is_enabled = EXCLUDED.is_enabled`,
			r.ID, r.DataSource, created, updated, r.CreatedBy, r.EventType, channels, roles, r.Severity, r.IsEnabled)
		return struct{}{}, err
	})
	return err
}

// ReseedNotificationsForTest: fixtures, owner.
func ReseedNotificationsForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, isPg := notificationData.(pgNotifications); !isPg {
		return nil
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM notifications`); err != nil {
		return err
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM notification_rules`); err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	seed := pgNotifications{conn: owner}
	rules, err := fixtures.Records[NotificationRule]("NotificationRule")
	if err != nil {
		return err
	}
	for _, r := range rules {
		if err := seed.saveRule(ctx, tenant, r); err != nil {
			return err
		}
	}
	rows, err := fixtures.Records[Notification]("Notification")
	if err != nil {
		return err
	}
	return seed.saveNotifications(ctx, tenant, rows)
}
