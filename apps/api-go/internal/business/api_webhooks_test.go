// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestApiClient_RotateIssuesANewKeyOnce(t *testing.T) {
	ResetAPIWebhooksForTest()
	auditlog.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	created, err := CreateApiClient(admin, map[string]any{"name": "Exporter", "scopes": []any{"read"}})
	check(t, err)
	rotated, err := RotateApiClient(admin, created.Client.ID)
	check(t, err)
	if rotated.Secret == created.Secret || len(rotated.Secret) < 16 {
		t.Fatalf("rotated secret %q", rotated.Secret)
	}
	if rotated.Client.ID != created.Client.ID || rotated.Client.SecretHint != rotated.Secret[len(rotated.Secret)-4:] {
		t.Fatalf("rotated client %+v", rotated.Client)
	}
	page, err := ListApiClients(admin, ApiClientQuery{})
	check(t, err)
	for _, c := range page.Items {
		if c.ID == created.Client.ID && c.SecretHint != rotated.Client.SecretHint {
			t.Fatalf("stored hint %q", c.SecretHint)
		}
	}
	events := auditlog.AllEvents()
	last := events[len(events)-1]
	if last.Action != "api_client.rotated" || last.Outcome != "success" || strings.Contains(last.SummaryEn, rotated.Secret) {
		t.Fatalf("audit %+v", last)
	}
	check(t, RevokeApiClient(admin, created.Client.ID))
	if _, err := RotateApiClient(admin, created.Client.ID); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("rotate revoked: got %v, want Conflict", err)
	}
	if _, err := RotateApiClient(admin, "00000000-0000-4000-8000-000000000000"); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("rotate unknown: got %v, want NotFound", err)
	}
}

func TestApiClient_RotateDeniedAndAudited(t *testing.T) {
	ResetAPIWebhooksForTest()
	expectDenied(t, []deniedWrite{
		{"api_client.rotated", "api_client", func() error { _, err := RotateApiClient(viewer(), junkID); return err }},
	})
}

func TestApiClient_CreateShowsSecretOnceThenRevoke(t *testing.T) {
	ResetAPIWebhooksForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	seeded, err := ListApiClients(admin, ApiClientQuery{})
	check(t, err)
	if len(seeded.Items) != 3 {
		t.Fatalf("got %d seeded clients, want 3", len(seeded.Items))
	}

	created, err := CreateApiClient(admin, map[string]any{"name": "Analytics export", "scopes": []any{"read"}})
	check(t, err)
	if len(created.Secret) < 16 {
		t.Fatalf("secret too short: %q", created.Secret)
	}
	if created.Client.SecretHint != created.Secret[len(created.Secret)-4:] {
		t.Fatalf("hint %q, want last 4 of %q", created.Client.SecretHint, created.Secret)
	}

	after, err := ListApiClients(admin, ApiClientQuery{})
	check(t, err)
	for _, c := range after.Items {
		if strings.Contains(c.SecretHint, created.Secret) {
			t.Fatalf("secret leaked into stored client")
		}
	}

	if err := RevokeApiClient(admin, created.Client.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	after2, err := ListApiClients(admin, ApiClientQuery{})
	check(t, err)
	var found *ApiClient
	for i := range after2.Items {
		if after2.Items[i].ID == created.Client.ID {
			found = &after2.Items[i]
		}
	}
	if found == nil || !found.IsRevoked {
		t.Fatalf("client not revoked: %+v", found)
	}
	if err := RevokeApiClient(admin, created.Client.ID); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("double revoke: got %v, want Conflict", err)
	}
	if _, err := CreateApiClient(admin, map[string]any{"name": "x", "scopes": []any{}}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("empty scopes: got %v, want Invalid", err)
	}
	if _, err := CreateApiClient(admin, map[string]any{"name": "x", "scopes": []any{"admin"}}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad scope: got %v, want Invalid", err)
	}
}

func TestApiClient_ForbiddenForOtherRoles(t *testing.T) {
	ResetAPIWebhooksForTest()
	for _, role := range []access.Role{access.RoleDispatchSupervisor, access.RoleDispatcher, access.RolePlanner, access.RoleRemoteTeamLead, access.RoleViewerAuditor, access.RoleChangeApprover} {
		ctx := roleCtx("t1", "u1", role)
		if _, err := ListApiClients(ctx, ApiClientQuery{}); errCode(err) != dataerr.CodeForbidden {
			t.Fatalf("%s: got %v, want Forbidden", role, err)
		}
	}
}

func TestWebhook_CreateUpdateTestDelete(t *testing.T) {
	ResetAPIWebhooksForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	hooks, err := ListWebhooks(admin, WebhookQuery{})
	check(t, err)
	seeded := hooks.Items[0]
	seededDeliveries, err := ListWebhookDeliveries(admin, seeded.ID, WebhookDeliveryQuery{})
	check(t, err)
	if len(seededDeliveries.Items) != 3 {
		t.Fatalf("got %d seeded deliveries, want 3", len(seededDeliveries.Items))
	}

	created, err := CreateWebhook(admin, map[string]any{"name": "Fallback alerts", "target_url": "https://hooks.example.com/opendispatch/fallback", "event_types": []any{"fallback.state_changed"}})
	check(t, err)
	if !created.IsEnabled || created.LastStatus != nil {
		t.Fatalf("got %+v, want enabled with no last_status", created)
	}

	ok, err := TestWebhook(admin, created.ID)
	check(t, err)
	if !ok.Delivered || ok.HTTPStatus != 200 {
		t.Fatalf("got %+v, want delivered 200", ok)
	}
	got, err := GetWebhook(admin, created.ID)
	check(t, err)
	if got.LastStatus == nil || *got.LastStatus != "succeeded" {
		t.Fatalf("got %+v, want last_status succeeded", got)
	}

	broken, err := UpdateWebhook(admin, created.ID, map[string]any{"name": "Fallback alerts", "target_url": "https://fail.example.com/hook", "event_types": []any{"fallback.state_changed"}, "is_enabled": true})
	check(t, err)
	failedResult, err := TestWebhook(admin, broken.ID)
	check(t, err)
	if failedResult.Delivered || failedResult.HTTPStatus != 500 {
		t.Fatalf("got %+v, want failed 500", failedResult)
	}
	deliveries, err := ListWebhookDeliveries(admin, created.ID, WebhookDeliveryQuery{})
	check(t, err)
	if len(deliveries.Items) != 2 || deliveries.Items[0].Status != "failed" || deliveries.Items[1].Status != "succeeded" {
		t.Fatalf("got %+v, want [failed, succeeded]", deliveries.Items)
	}

	if _, err := CreateWebhook(admin, map[string]any{"name": "x", "target_url": "http://insecure.example.com", "event_types": []any{"rule.approved"}}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("insecure url: got %v, want Invalid", err)
	}
	if _, err := CreateWebhook(admin, map[string]any{"name": "x", "target_url": "nonsense", "event_types": []any{"rule.approved"}}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("nonsense url: got %v, want Invalid", err)
	}
	if _, err := CreateWebhook(admin, map[string]any{"name": "x", "target_url": "https://a.example.com", "event_types": []any{"nothing"}}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad event type: got %v, want Invalid", err)
	}
	if _, err := CreateWebhook(admin, map[string]any{"name": "x", "target_url": "http://localhost:3000/hook", "event_types": []any{"rule.approved"}}); err != nil {
		t.Fatalf("localhost http should be allowed: %v", err)
	}

	if err := DeleteWebhook(admin, created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := GetWebhook(admin, created.ID); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("get after delete: got %v, want NotFound", err)
	}
}

func TestApiWebhooks_ForbiddenForNonAdmin(t *testing.T) {
	ResetAPIWebhooksForTest()
	planner := roleCtx("t1", "u1", access.RolePlanner)
	if _, err := CreateWebhook(planner, map[string]any{"name": "x", "target_url": "https://a.example.com", "event_types": []any{"rule.approved"}}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden", err)
	}
}

func TestRateLimits_DefaultsUpdateAndValidation(t *testing.T) {
	ResetAPIWebhooksForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	limits, err := GetRateLimits(admin)
	check(t, err)
	want := []ApiRateLimit{{"read", 120, 20}, {"write", 30, 5}, {"feeds", 600, 100}}
	if !rateLimitsEqual(limits.Limits, want) {
		t.Fatalf("got %+v, want defaults %+v", limits.Limits, want)
	}

	next := map[string]any{"limits": []any{
		map[string]any{"scope": "feeds", "requests_per_minute": 900.0, "burst": 150.0},
		map[string]any{"scope": "read", "requests_per_minute": 60.0, "burst": 10.0},
		map[string]any{"scope": "write", "requests_per_minute": 15.0, "burst": 3.0},
	}}
	saved, err := UpdateRateLimits(admin, next)
	check(t, err)
	wantOrder := []ApiRateLimit{{"read", 60, 10}, {"write", 15, 3}, {"feeds", 900, 150}}
	if !rateLimitsEqual(saved.Limits, wantOrder) {
		t.Fatalf("saved %+v, want scope order %+v", saved.Limits, wantOrder)
	}

	bad := []map[string]any{
		{"limits": []any{map[string]any{"scope": "read", "requests_per_minute": 1.0, "burst": 1.0}}},
		{"limits": []any{
			map[string]any{"scope": "read", "requests_per_minute": 1.0, "burst": 1.0},
			map[string]any{"scope": "read", "requests_per_minute": 2.0, "burst": 2.0},
			map[string]any{"scope": "feeds", "requests_per_minute": 3.0, "burst": 3.0},
		}},
		{"limits": []any{
			map[string]any{"scope": "admin", "requests_per_minute": 1.0, "burst": 1.0},
			map[string]any{"scope": "write", "requests_per_minute": 1.0, "burst": 1.0},
			map[string]any{"scope": "feeds", "requests_per_minute": 1.0, "burst": 1.0},
		}},
		{"limits": []any{
			map[string]any{"scope": "read", "requests_per_minute": 0.0, "burst": 1.0},
			map[string]any{"scope": "write", "requests_per_minute": 1.0, "burst": 1.0},
			map[string]any{"scope": "feeds", "requests_per_minute": 1.0, "burst": 1.0},
		}},
		{"limits": []any{
			map[string]any{"scope": "read", "requests_per_minute": 1.5, "burst": 1.0},
			map[string]any{"scope": "write", "requests_per_minute": 1.0, "burst": 1.0},
			map[string]any{"scope": "feeds", "requests_per_minute": 1.0, "burst": 1.0},
		}},
		{"limits": []any{
			map[string]any{"scope": "read", "requests_per_minute": 1.0, "burst": 1.0, "extra": 1.0},
			map[string]any{"scope": "write", "requests_per_minute": 1.0, "burst": 1.0},
			map[string]any{"scope": "feeds", "requests_per_minute": 1.0, "burst": 1.0},
		}},
		{"limits": "all"},
		{},
	}
	for i, body := range bad {
		if _, err := UpdateRateLimits(admin, body); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("case %d: got %v, want Invalid", i, err)
		}
	}

	viewer := roleCtx("t1", "u2", access.RoleViewerAuditor)
	if _, err := GetRateLimits(viewer); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("viewer read: got %v, want Forbidden", err)
	}
	if _, err := UpdateRateLimits(viewer, next); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("viewer write: got %v, want Forbidden", err)
	}
	// Role check first: a bad body is still Forbidden.
	if _, err := UpdateRateLimits(roleCtx("t1", "u3", access.RolePlanner), "nonsense"); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner bad body: got %v, want Forbidden", err)
	}
}

func rateLimitsEqual(a, b []ApiRateLimit) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestRetryWebhookDelivery_ScriptedByURL(t *testing.T) {
	ResetAPIWebhooksForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	hooks, err := ListWebhooks(admin, WebhookQuery{})
	check(t, err)
	hook := hooks.Items[0]
	deliveries, err := ListWebhookDeliveries(admin, hook.ID, WebhookDeliveryQuery{})
	check(t, err)
	var failed WebhookDelivery
	for _, d := range deliveries.Items {
		if d.Status == "failed" {
			failed = d
		}
	}
	if failed.AttemptCount != 3 {
		t.Fatalf("seeded failed delivery attempt_count = %d, want 3", failed.AttemptCount)
	}

	result, err := RetryWebhookDelivery(admin, failed.ID)
	check(t, err)
	if !result.Delivered || result.Delivery.Status != "succeeded" || result.Delivery.AttemptCount != 4 {
		t.Fatalf("got %+v, want delivered/succeeded/4", result)
	}
	if !strings.Contains(result.Message, StubNothingSent) {
		t.Fatalf("message %q missing stub disclosure", result.Message)
	}
	list2, err := ListWebhookDeliveries(admin, hook.ID, WebhookDeliveryQuery{})
	check(t, err)
	if len(list2.Items) != 3 {
		t.Fatalf("got %d deliveries after retry, want 3 (same one updated)", len(list2.Items))
	}

	// Retrying twice: the second is a Conflict.
	if _, err := RetryWebhookDelivery(admin, failed.ID); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("retry succeeded delivery: got %v, want Conflict", err)
	}
	if _, err := RetryWebhookDelivery(admin, "00000000-0000-4000-8000-000000000000"); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("retry junk id: got %v, want NotFound", err)
	}
}

func TestRetryWebhookDelivery_FailsAgainForBrokenTarget(t *testing.T) {
	ResetAPIWebhooksForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	hooks, err := ListWebhooks(admin, WebhookQuery{})
	check(t, err)
	hook := hooks.Items[0]
	deliveries, err := ListWebhookDeliveries(admin, hook.ID, WebhookDeliveryQuery{})
	check(t, err)
	var failed WebhookDelivery
	for _, d := range deliveries.Items {
		if d.Status == "failed" {
			failed = d
		}
	}

	eventTypes := make([]any, len(hook.EventTypes))
	for i, e := range hook.EventTypes {
		eventTypes[i] = e
	}
	if _, err := UpdateWebhook(admin, hook.ID, map[string]any{"name": hook.Name, "target_url": "https://fail.example.com/hook", "event_types": eventTypes, "is_enabled": true}); err != nil {
		t.Fatalf("update: %v", err)
	}
	first, err := RetryWebhookDelivery(admin, failed.ID)
	check(t, err)
	if first.Delivered || first.Delivery.Status != "failed" || first.Delivery.AttemptCount != 4 {
		t.Fatalf("got %+v, want failed/4", first)
	}
	second, err := RetryWebhookDelivery(admin, failed.ID)
	check(t, err)
	if second.Delivery.AttemptCount != 5 {
		t.Fatalf("attempt_count = %d, want 5", second.Delivery.AttemptCount)
	}
	gotHook, err := GetWebhook(admin, hook.ID)
	check(t, err)
	if gotHook.LastStatus == nil || *gotHook.LastStatus != "failed" {
		t.Fatalf("got %+v, want last_status failed", gotHook)
	}
}

func TestRetryWebhookDelivery_ForbiddenForOtherRoles(t *testing.T) {
	ResetAPIWebhooksForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	hooks, err := ListWebhooks(admin, WebhookQuery{})
	check(t, err)
	deliveries, err := ListWebhookDeliveries(admin, hooks.Items[0].ID, WebhookDeliveryQuery{})
	check(t, err)
	id := deliveries.Items[0].ID
	if _, err := RetryWebhookDelivery(roleCtx("t1", "u2", access.RoleViewerAuditor), id); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden", err)
	}
}
