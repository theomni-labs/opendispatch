// SPDX-License-Identifier: AGPL-3.0-only

// Live: dispatch decisions kept in Postgres.
package business

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func ownerPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("OPENDISPATCH_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("OPENDISPATCH_TEST_DATABASE_URL is not set: skipped, not faked.")
	}
	p, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	return p
}

func newCase(t *testing.T, owner *pgxpool.Pool, tenant string) string {
	t.Helper()
	var id string
	err := owner.QueryRow(context.Background(), `INSERT INTO cases (tenant_id, data_source, case_number, registered_at, handling) VALUES ($1, 'SYNTHETIC', 'T-'||gen_random_uuid()::text, now(), 'field') RETURNING id::text`, tenant).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func decision(tenant, caseID, state string) (Assignment, []AssignmentEvent) {
	at := datactx.ToRiyadhISO(time.Now())
	a := Assignment{
		BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenant, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
		CaseID:     caseID, DecidedAt: at, Source: "OPENDISPATCH", Stage: "recommend", State: state, Extra: map[string]any{"illustrative": true},
	}
	e := AssignmentEvent{
		BaseRecord:   datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenant, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
		AssignmentID: &a.ID, CaseID: caseID, EventType: "accepted", OccurredAt: at, Source: "OPENDISPATCH", Detail: map[string]any{"rank": float64(1)},
	}
	return a, []AssignmentEvent{e}
}

func TestPostgresAssignmentsKeepDecisionsOnceAndAcrossARestart(t *testing.T) {
	conn := settingsConn(t)
	owner := ownerPool(t)
	UsePostgresAssignments(conn)
	t.Cleanup(UseMemoryAssignments)
	tenant, other := freshTenant(), freshTenant()
	caseID := newCase(t, owner, tenant)

	first, firstEvents := decision(tenant, caseID, "assigned")
	if err := saveDecision(context.Background(), tenant, []Assignment{first}, firstEvents); err != nil {
		t.Fatal(err)
	}
	// Rule 19: a second active assignment for the case is refused, and the refused write leaves nothing behind.
	second, secondEvents := decision(tenant, caseID, "assigned")
	err := saveDecision(context.Background(), tenant, []Assignment{second}, secondEvents)
	var de *dataerr.DataError
	if !errors.As(err, &de) || !strings.Contains(de.Message, "ALREADY_ASSIGNED") {
		t.Fatalf("a second active assignment must be refused as already assigned: %v", err)
	}
	if evs, _ := loadAssignmentEvents(context.Background(), tenant); len(evs) != 1 {
		t.Fatalf("the refused decision left %d events, want the first one only", len(evs))
	}
	// An override: the old decision is superseded and the new one assigned, in one write.
	old := first
	old.State = "superseded"
	next, nextEvents := decision(tenant, caseID, "assigned")
	next.Source = "MANUAL"
	if err := saveDecision(context.Background(), tenant, []Assignment{old, next}, nextEvents); err != nil {
		t.Fatal(err)
	}
	active, err := assignmentStoreBackend.activeFor(context.Background(), tenant, []string{caseID})
	if err != nil || len(active) != 1 || active[caseID].ID != next.ID || active[caseID].Source != "MANUAL" {
		t.Fatalf("the active decision is the override: %+v %v", active, err)
	}
	all, _ := loadAssignments(context.Background(), tenant)
	if len(all) != 2 {
		t.Fatalf("the case keeps its history: %d records, want 2", len(all))
	}

	// A restart, and another customer.
	UseMemoryAssignments()
	UsePostgresAssignments(conn)
	if got, _ := loadAssignment(context.Background(), tenant, next.ID); got == nil || got.Source != "MANUAL" || got.Extra["illustrative"] != true {
		t.Fatalf("after a restart: %+v", got)
	}
	if got, _ := loadAssignments(context.Background(), other); len(got) != 0 {
		t.Fatalf("another customer sees %d assignments", len(got))
	}
}

func TestPostgresAssignmentsAllowOnlyOneOfManyConcurrentAccepts(t *testing.T) {
	conn := settingsConn(t)
	owner := ownerPool(t)
	UsePostgresAssignments(conn)
	t.Cleanup(UseMemoryAssignments)
	tenant := freshTenant()
	caseID := newCase(t, owner, tenant)
	const n = 10
	var wg sync.WaitGroup
	results := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			a, e := decision(tenant, caseID, "assigned")
			results <- saveDecision(context.Background(), tenant, []Assignment{a}, e)
		}()
	}
	wg.Wait()
	close(results)
	ok, refused := 0, 0
	for err := range results {
		var de *dataerr.DataError
		switch {
		case err == nil:
			ok++
		case errors.As(err, &de) && strings.Contains(de.Message, "ALREADY_ASSIGNED"):
			refused++
		default:
			t.Fatal(err)
		}
	}
	if ok != 1 || refused != n-1 {
		t.Fatalf("%d concurrent accepts: %d succeeded, %d refused; want exactly one", n, ok, refused)
	}
}

var _ = tenancy.Connection{}
