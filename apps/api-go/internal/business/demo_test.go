// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestResetDemoData_OnlyAnAdministratorAndEveryDenialIsAudited(t *testing.T) {
	auditlog.ResetForTest()
	t.Cleanup(auditlog.ResetForTest)
	tenantID := "11111111-1111-4111-8111-111111111111"
	actors := map[string]bool{}
	for i, role := range access.Roles {
		if role == access.RoleAdministrator {
			continue
		}
		userID := "00000000-0000-4000-8000-00000000090" + string(rune('0'+i))
		actors[userID] = true
		_, err := ResetDemoData(roleCtx(tenantID, userID, role))
		if errCode(err) != dataerr.CodeForbidden || !strings.Contains(err.Error(), "only an administrator may") {
			t.Fatalf("%s: got %v, want Forbidden for a non-administrator", role, err)
		}
	}
	events := auditlog.AllEvents()
	if len(events) != len(actors) {
		t.Fatalf("got %d events, want one denied event per role", len(events))
	}
	for _, e := range events {
		if e.Outcome != "denied" || e.Action != "demo.reset" || e.EntityType != "demo" || e.EntityID != nil || e.ActorUserID == nil || !actors[*e.ActorUserID] {
			t.Fatalf("got %+v, want a denied demo.reset event for the caller", e)
		}
	}
}
