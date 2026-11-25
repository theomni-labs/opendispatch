// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

// Newest-first order plus the same-second tiebreak.
func TestListWebhookDeliveries_NewestFirstWithSameSecondTiebreak(t *testing.T) {
	ResetAPIWebhooksForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	hook, err := CreateWebhook(admin, map[string]any{
		"name": "Ordering test", "target_url": "https://example.com/hook",
		"event_types": []any{"roster.approved"}, "is_enabled": true,
	})
	check(t, err)

	// A,B,C,D inserted in order; B and C tie on time.
	// Want D, C, B, A: later insert wins B/C's tie.
	insert := func(id, attemptedAt string) {
		upsertDeliveryMemory(WebhookDelivery{
			BaseRecord: datactx.BaseRecord{ID: id, TenantID: hook.TenantID, CreatedAt: attemptedAt, UpdatedAt: attemptedAt, DataSource: "SYNTHETIC"},
			WebhookID:  hook.ID, EventType: "roster.approved", Status: "succeeded", HTTPStatus: 200, AttemptedAt: attemptedAt,
		})
	}
	insert("d-a", "2026-09-14T10:00:00+03:00")
	insert("d-b", "2026-09-14T10:05:00+03:00")
	insert("d-c", "2026-09-14T10:05:00+03:00")
	insert("d-d", "2026-09-14T10:10:00+03:00")

	page, err := ListWebhookDeliveries(admin, hook.ID, WebhookDeliveryQuery{})
	check(t, err)
	var gotIDs []string
	for _, d := range page.Items {
		gotIDs = append(gotIDs, d.ID)
	}
	want := []string{"d-d", "d-c", "d-b", "d-a"}
	if len(gotIDs) != len(want) {
		t.Fatalf("got %v, want %v", gotIDs, want)
	}
	for i := range want {
		if gotIDs[i] != want[i] {
			t.Fatalf("order = %v, want %v", gotIDs, want)
		}
	}
}
