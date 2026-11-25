// SPDX-License-Identifier: AGPL-3.0-only

// Live: audit events in Postgres.
package business

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func usePgAudit(t *testing.T) *tenancy.Connection {
	t.Helper()
	conn := openConn(t)
	auditlog.UseStore(auditlog.PgStore{Conn: conn})
	t.Cleanup(func() { auditlog.UseStore(auditlog.MemoryStore()) })
	return conn
}

func TestAuditPg_TenantIsolationAndOrder(t *testing.T) {
	usePgAudit(t)
	a, tenantA := adminCtx(t)
	b, tenantB := adminCtx(t)
	ent := "RULE-001"
	for _, name := range []string{"one", "two", "three"} {
		_, err := auditlog.RecordAudit(a, auditlog.AuditInput{Action: "test.audit", EntityType: "thing", EntityID: &ent, SummaryEn: name}, "", "")
		check(t, err)
	}
	_, err := auditlog.RecordAudit(b, auditlog.AuditInput{Action: "test.audit", EntityType: "thing", SummaryEn: "other tenant"}, "", "")
	check(t, err)

	got, err := auditlog.EventsOf(context.Background(), tenantA)
	check(t, err)
	if len(got) != 3 || got[0].SummaryEn != "one" || got[2].SummaryEn != "three" {
		t.Fatalf("tenant A events: %+v", got)
	}
	if got[0].EntityID == nil || *got[0].EntityID != "RULE-001" {
		t.Fatalf("a non-uuid entity id must round trip, got %v", got[0].EntityID)
	}
	other, err := auditlog.EventsOf(context.Background(), tenantB)
	check(t, err)
	if len(other) != 1 || other[0].SummaryEn != "other tenant" {
		t.Fatalf("tenant B events: %+v", other)
	}
}

func TestAuditPg_ListThroughTheBusinessLayer(t *testing.T) {
	usePgAudit(t)
	rc, _ := adminCtx(t)
	for _, name := range []string{"first", "second"} {
		_, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: "rule.approved", EntityType: "rule", SummaryEn: name}, "", "")
		check(t, err)
	}
	page, err := ListAuditEvents(rc, AuditFilter{ActionPrefix: "rule."})
	check(t, err)
	if len(page.Items) != 2 || page.Items[0].SummaryEn != "second" {
		t.Fatalf("want newest first, got %+v", page.Items)
	}
	one, err := GetAuditEvent(rc, page.Items[1].ID)
	check(t, err)
	if one.SummaryEn != "first" {
		t.Fatalf("got %q", one.SummaryEn)
	}
}

func TestAuditPg_ActorThatIsNotAUuidIsKeptInDetail(t *testing.T) {
	usePgAudit(t)
	rc, tenant := adminCtx(t)
	rc.UserID = "emergency-admin"
	_, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: "auth.emergency_sign_in", EntityType: "session", SummaryEn: "in"}, "", "")
	check(t, err)
	got, err := auditlog.EventsOf(context.Background(), tenant)
	check(t, err)
	if len(got) != 1 || got[0].ActorUserID != nil || got[0].Detail["actor_ref"] != "emergency-admin" {
		t.Fatalf("got %+v", got)
	}
}

func TestAuditPg_IsAppendOnly(t *testing.T) {
	conn := usePgAudit(t)
	rc, tenant := adminCtx(t)
	_, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: "test.audit", EntityType: "thing", SummaryEn: "keep"}, "", "")
	check(t, err)
	for _, sql := range []string{`UPDATE audit_events SET summary_en = 'changed'`, `DELETE FROM audit_events`} {
		_, err := tenancy.WithTenant(context.Background(), conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			_, err := tx.Exec(ctx, sql)
			return struct{}{}, err
		})
		if err == nil {
			t.Fatalf("%q must be refused", sql)
		}
	}
	got, err := auditlog.EventsOf(context.Background(), tenant)
	check(t, err)
	if len(got) != 1 || got[0].SummaryEn != "keep" {
		t.Fatalf("the event must be untouched, got %+v", got)
	}
}

func TestAuditPg_NoTenantSetFailsOnFreshAndPooledConnections(t *testing.T) {
	conn := usePgAudit(t)
	rc, tenant := adminCtx(t)
	_, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: "test.audit", EntityType: "thing", SummaryEn: "x"}, "", "")
	check(t, err)
	count := func() error {
		var n int
		return conn.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events`).Scan(&n)
	}
	if count() == nil {
		t.Fatal("a fresh connection with no tenant must fail")
	}
	if _, err := auditlog.EventsOf(context.Background(), tenant); err != nil {
		t.Fatal(err)
	}
	if count() == nil {
		t.Fatal("a pooled connection after a tenant transaction must fail too")
	}
}
