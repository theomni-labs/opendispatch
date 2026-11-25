// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestListMyNotifications_OwnAndRoleAddressedVisibility(t *testing.T) {
	ResetNotificationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	otherAdmin := roleCtx("t1", "u2", access.RoleAdministrator)
	planner := roleCtx("t1", "u3", access.RolePlanner)

	userID := "u1"
	UpsertNotificationForTest(Notification{BaseRecord: nb("00000000-0000-4000-8000-000000000001"), RecipientUserID: &userID, Category: "system", Severity: "info", TitleEn: "For u1"})
	role := "administrator"
	UpsertNotificationForTest(Notification{BaseRecord: nb("00000000-0000-4000-8000-000000000002"), RecipientRole: &role, Category: "system", Severity: "info", TitleEn: "For all admins"})
	plannerID := "u3"
	UpsertNotificationForTest(Notification{BaseRecord: nb("00000000-0000-4000-8000-000000000003"), RecipientUserID: &plannerID, Category: "system", Severity: "info", TitleEn: "For u3", IsRead: true})

	page, err := ListMyNotifications(admin, NotificationQuery{})
	check(t, err)
	if len(page.Items) != 2 {
		t.Fatalf("admin u1: got %d, want 2 (own + role-addressed)", len(page.Items))
	}

	page2, err := ListMyNotifications(otherAdmin, NotificationQuery{})
	check(t, err)
	if len(page2.Items) != 1 || page2.Items[0].ID != "00000000-0000-4000-8000-000000000002" {
		t.Fatalf("other admin: got %+v, want only n2 (role-addressed)", page2.Items)
	}

	unread, err := ListMyNotifications(planner, NotificationQuery{UnreadOnly: true})
	check(t, err)
	if len(unread.Items) != 0 {
		t.Fatalf("planner unread_only: got %+v, want none (n3 is read)", unread.Items)
	}
}

func TestCountUnreadNotifications(t *testing.T) {
	ResetNotificationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	userID := "u1"
	UpsertNotificationForTest(Notification{BaseRecord: nb("00000000-0000-4000-8000-000000000001"), RecipientUserID: &userID, Category: "system", Severity: "info", TitleEn: "A"})
	UpsertNotificationForTest(Notification{BaseRecord: nb("00000000-0000-4000-8000-000000000002"), RecipientUserID: &userID, Category: "system", Severity: "info", TitleEn: "B", IsRead: true})

	count, err := CountUnreadNotifications(admin)
	check(t, err)
	if count != 1 {
		t.Fatalf("got %d, want 1", count)
	}
}

func TestMarkNotificationRead_IdempotentAndNotFoundForOthers(t *testing.T) {
	ResetNotificationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	other := roleCtx("t1", "u2", access.RoleAdministrator)
	userID := "u1"
	UpsertNotificationForTest(Notification{BaseRecord: nb("00000000-0000-4000-8000-000000000001"), RecipientUserID: &userID, Category: "system", Severity: "info", TitleEn: "A"})

	got, err := MarkNotificationRead(admin, "00000000-0000-4000-8000-000000000001")
	check(t, err)
	if !got.IsRead || got.ReadAt == nil {
		t.Fatalf("got %+v, want read", got)
	}

	again, err := MarkNotificationRead(admin, "00000000-0000-4000-8000-000000000001")
	check(t, err)
	if again.ReadAt == nil || *again.ReadAt != *got.ReadAt {
		t.Fatalf("second call changed read_at: got %+v, want unchanged %+v", again, got)
	}

	_, err = MarkNotificationRead(other, "00000000-0000-4000-8000-000000000001")
	if errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("other user: got %v, want NotFound", err)
	}
}

func TestMarkAllNotificationsRead(t *testing.T) {
	ResetNotificationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	userID := "u1"
	UpsertNotificationForTest(Notification{BaseRecord: nb("00000000-0000-4000-8000-000000000001"), RecipientUserID: &userID, Category: "system", Severity: "info", TitleEn: "A"})
	UpsertNotificationForTest(Notification{BaseRecord: nb("00000000-0000-4000-8000-000000000002"), RecipientUserID: &userID, Category: "system", Severity: "info", TitleEn: "B"})

	check(t, MarkAllNotificationsRead(admin))
	page, err := ListMyNotifications(admin, NotificationQuery{UnreadOnly: true})
	check(t, err)
	if len(page.Items) != 0 {
		t.Fatalf("got %+v unread, want none", page.Items)
	}
}

func TestNotificationRules_ValidationAndRoleGating(t *testing.T) {
	ResetNotificationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	planner := roleCtx("t1", "u2", access.RolePlanner)
	UpsertNotificationRuleForTest(NotificationRule{BaseRecord: nb("00000000-0000-4000-8000-0000000000a1"), EventType: "rule_approved", Channels: []string{"in_app"}, Severity: "info", IsEnabled: true})

	_, err := ListNotificationRules(planner, datactx.PageQuery{})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner list: got %v, want Forbidden", err)
	}

	updated, err := UpdateNotificationRule(admin, "00000000-0000-4000-8000-0000000000a1", map[string]any{
		"channels": []any{"in_app", "email"}, "recipient_roles": []any{"administrator"},
		"severity": "critical", "is_enabled": false,
	})
	check(t, err)
	if len(updated.Channels) != 2 || updated.Severity != "critical" || updated.IsEnabled {
		t.Fatalf("got %+v, want updated fields", updated)
	}

	_, err = UpdateNotificationRule(admin, "00000000-0000-4000-8000-0000000000a1", map[string]any{
		"channels": []any{}, "recipient_roles": []any{"administrator"}, "severity": "critical", "is_enabled": false,
	})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("empty channels: got %v, want Invalid", err)
	}
}

func TestSendTestNotification_ResolvesCategory(t *testing.T) {
	ResetNotificationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	UpsertNotificationRuleForTest(NotificationRule{BaseRecord: nb("00000000-0000-4000-8000-0000000000a1"), EventType: "roster_approved", Channels: []string{"in_app"}, Severity: "warning", IsEnabled: true})

	n, err := SendTestNotification(admin, "00000000-0000-4000-8000-0000000000a1")
	check(t, err)
	if n.Category != "roster" {
		t.Fatalf("got category %q, want roster (from EVENT_CATEGORY)", n.Category)
	}
	if n.RecipientUserID == nil || *n.RecipientUserID != "u1" {
		t.Fatalf("got recipient %v, want the caller", n.RecipientUserID)
	}
}

func TestListNotificationLog_Filters(t *testing.T) {
	ResetNotificationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	UpsertNotificationForTest(Notification{BaseRecord: nb("00000000-0000-4000-8000-000000000001"), Category: "rule", Severity: "info", TitleEn: "A"})
	UpsertNotificationForTest(Notification{BaseRecord: nb("00000000-0000-4000-8000-000000000002"), Category: "roster", Severity: "critical", TitleEn: "B"})

	page, err := ListNotificationLog(admin, NotificationLogFilter{Category: "roster"})
	check(t, err)
	if len(page.Items) != 1 || page.Items[0].ID != "00000000-0000-4000-8000-000000000002" {
		t.Fatalf("got %+v, want only n2", page.Items)
	}
}

func TestQuietHours_DefaultRoundTripAndValidation(t *testing.T) {
	ResetNotificationsForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	def, err := GetQuietHours(admin)
	check(t, err)
	if def.Start != "23:00" || def.End != "05:00" {
		t.Fatalf("got %+v, want the default window", def)
	}

	updated, err := UpdateQuietHours(admin, map[string]any{"enabled": true, "start": "22:00", "end": "06:00", "applies_to": "email_and_in_app"})
	check(t, err)
	if updated.Start != "22:00" || updated.AppliesTo != "email_and_in_app" {
		t.Fatalf("got %+v, want updated window", updated)
	}
	again, err := GetQuietHours(admin)
	check(t, err)
	if again != updated {
		t.Fatalf("get after update = %+v, want %+v", again, updated)
	}

	_, err = UpdateQuietHours(admin, map[string]any{"enabled": true, "start": "08:00", "end": "08:00", "applies_to": "email"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("equal start/end: got %v, want Invalid", err)
	}
}

func TestListApprovals_VisibilityByRole(t *testing.T) {
	// CreateRule needs admin.classification_rules edit
	// (Administrator only), so a real request's creator
	// is always an Administrator -- that would confound
	// "sees own request" with "admin sees everything".
	// Build the Approval directly with a non-admin
	// creator, matching what SubmitRuleVersion stores.
	ResetRulesForTest()
	ResetNotificationsForTest()
	drafterID := "drafter"
	upsertApprovalRow(Approval{
		BaseRecord:  datactx.BaseRecord{ID: "a1", TenantID: "t1", CreatedAt: "2026-09-13T00:00:00+03:00", UpdatedAt: "2026-09-13T00:00:00+03:00", DataSource: "SYNTHETIC", CreatedBy: &drafterID},
		SubjectType: "rule_version", SubjectID: "v1", Status: "pending", SummaryEn: "Test approval.", RequestedAt: "2026-09-13T00:00:00+03:00",
	})

	admin := roleCtx("t1", "u-admin", access.RoleAdministrator)
	drafter := roleCtx("t1", drafterID, access.RolePlanner)
	supervisor := roleCtx("t1", "u-supervisor", access.RoleDispatchSupervisor)
	outsider := roleCtx("t1", "outsider", access.RolePlanner)

	// Approval also carries the committed fixture's 21 rows (reference data,
	// like ClassificationRule/RuleVersion), so these check for a1, not counts.
	adminPage, err := ListApprovals(context.Background(), nil, admin, ApprovalQuery{Limit: 100})
	check(t, err)
	if !hasApproval(adminPage.Items, "a1") {
		t.Fatalf("admin: got %+v, want a1 (sees everything)", adminPage.Items)
	}

	drafterPage, err := ListApprovals(context.Background(), nil, drafter, ApprovalQuery{Limit: 100})
	check(t, err)
	if !hasApproval(drafterPage.Items, "a1") {
		t.Fatalf("drafter (planner, can't approve rules): got %+v, want to see their own request", drafterPage.Items)
	}
	for _, a := range drafterPage.Items {
		if a.CreatedBy == nil || *a.CreatedBy != drafterID {
			t.Fatalf("drafter: saw %+v, not their own request", a)
		}
	}

	supervisorPage, err := ListApprovals(context.Background(), nil, supervisor, ApprovalQuery{Limit: 100})
	check(t, err)
	if !hasApproval(supervisorPage.Items, "a1") {
		t.Fatalf("dispatch_supervisor: got %+v, want to see it (may approve)", supervisorPage.Items)
	}

	outsiderPage, err := ListApprovals(context.Background(), nil, outsider, ApprovalQuery{Limit: 100})
	check(t, err)
	if hasApproval(outsiderPage.Items, "a1") {
		t.Fatalf("unrelated planner: got %+v, want a1 excluded", outsiderPage.Items)
	}
}

func hasApproval(items []Approval, id string) bool {
	for _, a := range items {
		if a.ID == id {
			return true
		}
	}
	return false
}

func nb(id string) datactx.BaseRecord {
	return datactx.BaseRecord{ID: id, TenantID: "t1", CreatedAt: "2026-09-13T00:00:00+03:00", UpdatedAt: "2026-09-13T00:00:00+03:00", DataSource: "SYNTHETIC"}
}
