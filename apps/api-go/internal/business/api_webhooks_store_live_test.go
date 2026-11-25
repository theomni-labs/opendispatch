// SPDX-License-Identifier: AGPL-3.0-only

// Live: clients and webhooks in Postgres.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestPostgresAPIClientsSurviveARestartWithoutTheSecret(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresAPIWebhooks(conn)
	t.Cleanup(UseMemoryAPIWebhooks)
	a, b := freshTenant(), freshTenant()
	rc := adminOf(a)
	created, err := CreateApiClient(rc, map[string]any{"name": "Exporter", "scopes": []any{"read"}})
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := RotateApiClient(rc, created.Client.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := RevokeApiClient(rc, created.Client.ID); err != nil {
		t.Fatal(err)
	}
	UseMemoryAPIWebhooks()
	UsePostgresAPIWebhooks(conn)
	page, err := ListApiClients(rc, ApiClientQuery{})
	if err != nil || len(page.Items) != 1 || !page.Items[0].IsRevoked || page.Items[0].SecretHint != rotated.Secret[len(rotated.Secret)-4:] {
		t.Fatalf("after a restart: %+v %v", page, err)
	}
	for _, secret := range []string{created.Secret, rotated.Secret} {
		var leaked int
		if err := ownerPool(t).QueryRow(context.Background(), `SELECT count(*) FROM api_clients WHERE tenant_id = $1 AND to_jsonb(api_clients)::text LIKE '%'||$2||'%'`, a, secret).Scan(&leaked); err != nil || leaked != 0 {
			t.Fatalf("the secret is stored: %d %v", leaked, err)
		}
	}
	if other, _ := ListApiClients(adminOf(b), ApiClientQuery{}); len(other.Items) != 0 {
		t.Fatalf("another customer sees %d clients", len(other.Items))
	}
}

func TestPostgresWebhooksKeepDeliveriesAndRetries(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresAPIWebhooks(conn)
	t.Cleanup(UseMemoryAPIWebhooks)
	a, b := freshTenant(), freshTenant()
	rc := adminOf(a)
	hook, err := CreateWebhook(rc, map[string]any{"name": "Broken target", "target_url": "https://fail.example.com/x", "event_types": []any{"roster.approved"}})
	if err != nil {
		t.Fatal(err)
	}
	if res, err := TestWebhook(rc, hook.ID); err != nil || res.Delivered {
		t.Fatalf("test: %+v %v", res, err)
	}
	UseMemoryAPIWebhooks()
	UsePostgresAPIWebhooks(conn)
	page, err := ListWebhookDeliveries(rc, hook.ID, WebhookDeliveryQuery{})
	if err != nil || len(page.Items) != 1 || page.Items[0].Status != "failed" {
		t.Fatalf("after a restart: %+v %v", page, err)
	}
	if _, err := RetryWebhookDelivery(rc, page.Items[0].ID); err != nil {
		t.Fatal(err)
	}
	UseMemoryAPIWebhooks()
	UsePostgresAPIWebhooks(conn)
	got, err := GetWebhook(rc, hook.ID)
	if err != nil || got.LastStatus == nil || *got.LastStatus != "failed" || got.LastDeliveryAt == nil {
		t.Fatalf("last delivery: %+v %v", got, err)
	}
	page, _ = ListWebhookDeliveries(rc, hook.ID, WebhookDeliveryQuery{})
	if len(page.Items) != 1 || page.Items[0].AttemptCount != 2 {
		t.Fatalf("retry count: %+v", page.Items)
	}
	if others, _ := ListWebhooks(adminOf(b), WebhookQuery{}); len(others.Items) != 0 {
		t.Fatalf("another customer sees %d webhooks", len(others.Items))
	}
	if err := DeleteWebhook(rc, hook.ID); err != nil {
		t.Fatal(err)
	}
	if rows, _ := allDeliveries(context.Background(), a); len(rows) != 0 {
		t.Fatalf("deleting a webhook left %d deliveries", len(rows))
	}
}

func TestPostgresDeliveryAndWebhookAreAllOrNothing(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresAPIWebhooks(conn)
	t.Cleanup(UseMemoryAPIWebhooks)
	a := freshTenant()
	hook := seedWebhookRows(a)[0]
	if err := saveWebhook(context.Background(), a, hook); err != nil {
		t.Fatal(err)
	}
	changed := hook
	changed.Name = "renamed"
	orphan := seedDeliveryRows(a)[0]
	orphan.WebhookID = datactx.NewID()
	if err := saveDelivery(context.Background(), a, orphan, changed); err == nil {
		t.Fatal("a delivery of an unknown webhook was accepted")
	}
	got, _, err := findWebhook(context.Background(), a, hook.ID)
	if err != nil || got.Name != hook.Name {
		t.Fatalf("a failed write renamed the webhook: %+v %v", got, err)
	}
}

func TestPostgresAPIWebhooksReseedTheDemoRows(t *testing.T) {
	conn := settingsConn(t)
	owner := &tenancy.Connection{Pool: ownerPool(t)}
	UsePostgresAPIWebhooks(conn)
	t.Cleanup(UseMemoryAPIWebhooks)
	if err := ReseedAPIWebhooksForTest(context.Background(), owner); err != nil {
		t.Fatal(err)
	}
	tenant, _ := fixtures.TenantID()
	clients, _ := allAPIClients(context.Background(), tenant)
	hooks, _ := allWebhooks(context.Background(), tenant)
	deliveries, _ := allDeliveries(context.Background(), tenant)
	if len(clients) != 3 || len(hooks) != 1 || len(deliveries) != 3 {
		t.Fatalf("clients %d hooks %d deliveries %d", len(clients), len(hooks), len(deliveries))
	}
}
