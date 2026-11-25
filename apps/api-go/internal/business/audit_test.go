// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func recordTestEvent(t *testing.T, action, entityType, summary string) auditlog.AuditEvent {
	t.Helper()
	rc := roleCtx("t1", "u1", access.RoleAdministrator)
	e, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: action, EntityType: entityType, SummaryEn: summary}, "", "")
	if err != nil {
		t.Fatalf("RecordAudit: %v", err)
	}
	return e
}

func TestListAuditEvents_FiltersByActionPrefixAndOutcome(t *testing.T) {
	auditlog.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	recordTestEvent(t, "rule.approved", "rule", "Rule approved.")
	recordTestEvent(t, "user.created", "user", "User created.")

	page, err := ListAuditEvents(admin, AuditFilter{ActionPrefix: "rule."})
	check(t, err)
	if len(page.Items) != 1 || page.Items[0].Action != "rule.approved" {
		t.Fatalf("got %+v, want 1 rule.approved event", page.Items)
	}

	all, err := ListAuditEvents(admin, AuditFilter{})
	check(t, err)
	if len(all.Items) != 2 {
		t.Fatalf("got %d events, want 2", len(all.Items))
	}
}

func TestListAuditEvents_NewestFirst(t *testing.T) {
	auditlog.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	first := recordTestEvent(t, "rule.approved", "rule", "First.")
	second := recordTestEvent(t, "rule.retired", "rule", "Second.")

	page, err := ListAuditEvents(admin, AuditFilter{})
	check(t, err)
	if len(page.Items) != 2 || page.Items[0].ID != second.ID || page.Items[1].ID != first.ID {
		t.Fatalf("order wrong: %+v", page.Items)
	}
}

func TestListAuditEvents_QSearchesActorDisplayName(t *testing.T) {
	auditlog.ResetForTest()
	ResetUsersForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	user, err := CreateUser(nil, nil, admin, map[string]any{"email": "reem@example.com", "display_name": "Reem Al-Hinari", "assigned_role": "viewer_auditor", "zone_ids": []any{}})
	check(t, err)

	// Matches "reem" only via the actor's display name.
	actor := roleCtx("t1", user.ID, access.RoleViewerAuditor)
	signIn, err := auditlog.RecordAudit(actor, auditlog.AuditInput{Action: "sign_in.succeeded", EntityType: "user", SummaryEn: "Signed in."}, "", "")
	check(t, err)

	page, err := ListAuditEvents(admin, AuditFilter{Q: "reem"})
	check(t, err)
	found := false
	for _, e := range page.Items {
		if e.ID == signIn.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("sign-in event not found via actor name search: %+v", page.Items)
	}
}

func TestListAuditEvents_RefusesBadFilterAndNonAdmin(t *testing.T) {
	auditlog.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	_, err := ListAuditEvents(admin, AuditFilter{ActionPrefix: "a,b,c,d,e,f,g,h,i"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("too many prefixes: got %v, want Invalid", err)
	}

	planner := roleCtx("t1", "u2", access.RolePlanner)
	_, err = ListAuditEvents(planner, AuditFilter{})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner: got %v, want Forbidden", err)
	}
}

func TestAuditEvents_LiftTheSummaryValuesOutOfDetail(t *testing.T) {
	auditlog.ResetForTest()
	ResetAPIWebhooksForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	created, err := CreateApiClient(admin, map[string]any{"name": "Exporter", "scopes": []any{"read"}})
	check(t, err)
	plain := recordTestEvent(t, "rule.approved", "rule", "Approved.")
	page, err := ListAuditEvents(admin, AuditFilter{ActionPrefix: "api_client."})
	check(t, err)
	if len(page.Items) != 1 {
		t.Fatalf("got %d events", len(page.Items))
	}
	got := page.Items[0]
	if got.SummaryParams["name"] != "Exporter" || got.Detail[summaryKey] != nil || got.Detail["scopes"] == nil {
		t.Fatalf("got params %+v detail %+v", got.SummaryParams, got.Detail)
	}
	one, err := GetAuditEvent(admin, got.ID)
	check(t, err)
	if one.SummaryParams["name"] != "Exporter" || one.Detail[summaryKey] != nil {
		t.Fatalf("get: %+v", one)
	}
	raw, err := json.Marshal(one)
	check(t, err)
	if !strings.Contains(string(raw), `"summary_params":{"name":"Exporter"}`) || strings.Contains(string(raw), created.Secret) {
		t.Fatalf("json %s", raw)
	}
	bare, err := GetAuditEvent(admin, plain.ID)
	check(t, err)
	if raw, _ := json.Marshal(bare); strings.Contains(string(raw), "summary_params") {
		t.Fatalf("an event without values says %s", raw)
	}
}

func TestGetAuditEvent_FoundAndNotFound(t *testing.T) {
	auditlog.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	e := recordTestEvent(t, "rule.approved", "rule", "Approved.")

	got, err := GetAuditEvent(admin, e.ID)
	check(t, err)
	if got.ID != e.ID {
		t.Fatalf("got %+v, want %+v", got, e)
	}

	_, err = GetAuditEvent(admin, "00000000-0000-4000-8000-000000000000")
	if errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("got %v, want NotFound", err)
	}
}
