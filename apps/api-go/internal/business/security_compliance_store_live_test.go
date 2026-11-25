// SPDX-License-Identifier: AGPL-3.0-only

// Live: control evidence and support grants kept in Postgres.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestPostgresSecurityComplianceSurvivesARestartAndStaysPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresSecurityCompliance(conn)
	t.Cleanup(UseMemorySecurityCompliance)
	a, b := adminOf(freshTenant()), adminOf(freshTenant())
	controls, err := ListControlEvidence(a, ControlEvidenceQuery{})
	if err != nil || len(controls.Items) != len(controlSeeds) {
		t.Fatalf("seeded controls: %d %v", len(controls.Items), err)
	}
	target := controls.Items[0]
	note := "reviewed by the test"
	if _, err := UpdateControlEvidence(a, target.ID, map[string]any{"status": "in_progress", "evidence_note": note}); err != nil {
		t.Fatal(err)
	}
	if err := settingsstore.Put(context.Background(), a.CustomerID, "support_access.enabled", true); err != nil {
		t.Fatal(err)
	}
	grant, err := GrantSupportAccess(a, map[string]any{"hours": 2.0, "reason": "live test"})
	if err != nil {
		t.Fatal(err)
	}
	UseMemorySecurityCompliance()
	UsePostgresSecurityCompliance(conn)
	after, err := ListControlEvidence(a, ControlEvidenceQuery{})
	if err != nil || len(after.Items) != len(controlSeeds) {
		t.Fatalf("controls after a restart: %d %v", len(after.Items), err)
	}
	found := false
	for _, c := range after.Items {
		if c.ID == target.ID {
			found = c.Status == "in_progress" && c.EvidenceNote != nil && *c.EvidenceNote == note && c.ReviewedAt != nil
		}
	}
	if !found {
		t.Fatal("the control update was lost")
	}
	events, err := ListSupportAccessEvents(a, datactx.PageQuery{})
	if err != nil || len(events.Items) != 2 {
		t.Fatalf("events after a restart: %d %v", len(events.Items), err)
	}
	if _, err := EndSupportAccess(a, grant.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := EndSupportAccess(b, grant.ID); err == nil {
		t.Fatal("another customer ended the grant")
	}
	other, err := ListSupportAccessEvents(b, datactx.PageQuery{})
	if err != nil || len(other.Items) != 1 {
		t.Fatalf("another customer sees %d events", len(other.Items))
	}
	if err := ReseedSecurityComplianceForTest(context.Background(), &tenancy.Connection{Pool: ownerPool(t)}); err != nil {
		t.Fatal(err)
	}
}
