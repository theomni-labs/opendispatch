// SPDX-License-Identifier: AGPL-3.0-only

// Live: a write and its audit row share one tx.
package business

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// brokenAudit: an insert Postgres refuses (NUL).
type brokenAudit struct{ auditlog.PgStore }

func (b brokenAudit) Insert(ctx context.Context, e auditlog.AuditEvent) error {
	e.SummaryEn += "\x00"
	return b.PgStore.Insert(ctx, e)
}

func cityCount(t *testing.T, conn *tenancy.Connection, tenant string) int {
	t.Helper()
	n, err := tenancy.WithTenant(context.Background(), conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (int, error) {
		var n int
		err := tx.QueryRow(ctx, `SELECT count(*) FROM cities`).Scan(&n)
		return n, err
	})
	check(t, err)
	return n
}

func TestAWriteIsRolledBackWhenItsAuditRowFails_LivePostgres(t *testing.T) {
	conn := usePgAudit(t)
	rc, tenant := adminCtx(t)
	ctx := context.Background()

	auditlog.UseStore(brokenAudit{auditlog.PgStore{Conn: conn}})
	if _, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RD", "name_en": "Riyadh"}); err == nil {
		t.Fatal("the write must fail when its audit row cannot be written")
	}
	if n := cityCount(t, conn, tenant); n != 0 {
		t.Fatalf("the city was kept without its audit row: %d rows", n)
	}
	events, err := auditlog.EventsOf(ctx, tenant)
	check(t, err)
	if len(events) != 0 {
		t.Fatalf("no audit row expected, got %+v", events)
	}

	auditlog.UseStore(auditlog.PgStore{Conn: conn})
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RD", "name_en": "Riyadh"})
	check(t, err)
	if n := cityCount(t, conn, tenant); n != 1 {
		t.Fatalf("want the city once the audit works, got %d rows", n)
	}
	events, err = auditlog.EventsOf(ctx, tenant)
	check(t, err)
	if len(events) != 1 || events[0].Action != "location.city_created" || events[0].EntityID == nil || *events[0].EntityID != city.ID {
		t.Fatalf("want one city_created audit row, got %+v", events)
	}
}

func TestADeniedWriteIsStillAuditedOnItsOwn_LivePostgres(t *testing.T) {
	conn := usePgAudit(t)
	rc, tenant := adminCtx(t)
	planner := plannerCtx(tenant, rc.UserID, nil)
	if _, err := CreateCity(context.Background(), conn, planner, map[string]any{"case_code": "RD", "name_en": "Riyadh"}); err == nil {
		t.Fatal("a planner may not create a city")
	}
	events, err := auditlog.EventsOf(context.Background(), tenant)
	check(t, err)
	if len(events) != 1 || events[0].Outcome != "denied" {
		t.Fatalf("want one denied audit row, got %+v", events)
	}
	if n := cityCount(t, conn, tenant); n != 0 {
		t.Fatalf("no city expected, got %d", n)
	}
}
