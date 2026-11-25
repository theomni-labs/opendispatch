// SPDX-License-Identifier: AGPL-3.0-only

// Live: notifications in Postgres.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func liveRule(tenant, event string) NotificationRule {
	at := datactx.NowISO()
	return NotificationRule{
		BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenant, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
		EventType:  event, Channels: []string{"in_app"}, RecipientRoles: []access.Role{access.RoleAdministrator, access.RolePlanner}, Severity: "warning", IsEnabled: true,
	}
}

func TestPostgresNotificationsSurviveARestartAndStayPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresNotifications(conn)
	t.Cleanup(UseMemoryNotifications)
	a, b := freshTenant(), freshTenant()
	rule := liveRule(a, "model_paused")
	if err := saveNotificationRule(context.Background(), a, rule); err != nil {
		t.Fatal(err)
	}
	rc := adminOf(a)
	made, err := RaiseExternal(rc, false, "model_paused", RaisedNotification{TitleEn: "Forecast paused"})
	if err != nil || len(made) != 2 {
		t.Fatalf("raised %d: %v", len(made), err)
	}
	if _, err := UpdateNotificationRule(rc, rule.ID, map[string]any{"channels": []any{"in_app", "email"}, "recipient_roles": []any{"administrator"}, "severity": "critical", "is_enabled": true}); err != nil {
		t.Fatal(err)
	}
	UseMemoryNotifications()
	UsePostgresNotifications(conn)
	page, err := ListMyNotifications(rc, NotificationQuery{})
	if err != nil || len(page.Items) != 1 || page.Items[0].TitleEn != "Forecast paused" || page.Items[0].IsRead {
		t.Fatalf("after a restart: %+v %v", page, err)
	}
	if _, err := MarkNotificationRead(rc, page.Items[0].ID); err != nil {
		t.Fatal(err)
	}
	UseMemoryNotifications()
	UsePostgresNotifications(conn)
	if n, err := CountUnreadNotifications(rc); err != nil || n != 0 {
		t.Fatalf("unread after a read mark: %d %v", n, err)
	}
	rules, err := allNotificationRules(context.Background(), a)
	if err != nil || len(rules) != 1 || rules[0].Severity != "critical" || len(rules[0].Channels) != 2 || len(rules[0].RecipientRoles) != 1 {
		t.Fatalf("rule after a restart: %+v %v", rules, err)
	}
	if other, _ := ListMyNotifications(adminOf(b), NotificationQuery{}); len(other.Items) != 0 {
		t.Fatalf("another customer sees %d notifications", len(other.Items))
	}
	if rs, _ := allNotificationRules(context.Background(), b); len(rs) != 0 {
		t.Fatalf("another customer sees %d rules", len(rs))
	}
}

func TestPostgresNotificationsAreAllOrNothing(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresNotifications(conn)
	t.Cleanup(UseMemoryNotifications)
	a := freshTenant()
	at := datactx.NowISO()
	role := string(access.RoleAdministrator)
	good := Notification{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: a, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"}, RecipientRole: &role, Category: "system", Severity: "info", TitleEn: "ok"}
	bad := good
	bad.ID, bad.CreatedAt = datactx.NewID(), "not a time"
	if err := saveNotifications(context.Background(), a, good, bad); err == nil {
		t.Fatal("a bad row was accepted")
	}
	if rows, err := allNotifications(context.Background(), a); err != nil || len(rows) != 0 {
		t.Fatalf("a failed write left %d rows (%v)", len(rows), err)
	}
}

func TestPostgresNotificationsReseedFromTheFixtures(t *testing.T) {
	conn := settingsConn(t)
	owner := &tenancy.Connection{Pool: ownerPool(t)}
	ctx := context.Background()
	UsePostgresNotifications(conn)
	t.Cleanup(UseMemoryNotifications)
	if err := ReseedUsersForTest(ctx, owner); err != nil {
		t.Fatal(err)
	}
	if err := ReseedNotificationsForTest(ctx, owner); err != nil {
		t.Fatal(err)
	}
	tenant, _ := fixtures.TenantID()
	wantRules, _ := fixtures.Records[NotificationRule]("NotificationRule")
	wantRows, _ := fixtures.Records[Notification]("Notification")
	rules, err := allNotificationRules(context.Background(), tenant)
	rows, err2 := allNotifications(context.Background(), tenant)
	if err != nil || err2 != nil || len(rules) != len(wantRules) || len(rows) != len(wantRows) {
		t.Fatalf("rules %d/%d notifications %d/%d (%v %v)", len(rules), len(wantRules), len(rows), len(wantRows), err, err2)
	}
}
