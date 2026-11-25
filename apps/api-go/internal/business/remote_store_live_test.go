// SPDX-License-Identifier: AGPL-3.0-only

// Live: remote reviewer assignments kept in Postgres.
package business

import (
	"context"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestPostgresRemoteReviewsSurviveARestartAndStayPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	owner := ownerPool(t)
	UsePostgresRemoteReviews(conn)
	t.Cleanup(UseMemoryRemoteReviews)
	a, b := freshTenant(), freshTenant()
	caseID := newCase(t, owner, a)
	var agent string
	err := owner.QueryRow(context.Background(), `INSERT INTO agents (tenant_id, data_source, code, name_en, kind) VALUES ($1, 'SYNTHETIC', 'R-'||gen_random_uuid()::text, 'Rev', 'remote') RETURNING id::text`, a).Scan(&agent)
	if err != nil {
		t.Fatal(err)
	}
	at := datactx.NowISO()
	r := remoteReview{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: a, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"}, CaseID: caseID, ReviewerID: agent, ReviewStartedAt: at}
	if err := saveRemoteReview(context.Background(), a, r); err != nil {
		t.Fatal(err)
	}
	UseMemoryRemoteReviews()
	UsePostgresRemoteReviews(conn)
	got, err := loadRemoteReviews(context.Background(), a)
	if err != nil || got[caseID].ReviewerID != agent || got[caseID].ReviewStartedAt == "" {
		t.Fatalf("after a restart: %+v %v", got, err)
	}
	if other, _ := loadRemoteReviews(context.Background(), b); len(other) != 0 {
		t.Fatalf("another customer sees %d reviews", len(other))
	}
	if err := ReseedRemoteReviewsForTest(context.Background(), &tenancy.Connection{Pool: owner}); err != nil {
		t.Fatal(err)
	}
	if again, _ := loadRemoteReviews(context.Background(), a); len(again) != 0 {
		t.Fatalf("reseed left %d reviews", len(again))
	}
}

func TestASecondReviewerCannotTakeAClaimedCase(t *testing.T) {
	conn := settingsConn(t)
	owner := ownerPool(t)
	UsePostgresRemoteReviews(conn)
	t.Cleanup(UseMemoryRemoteReviews)
	tenant := freshTenant()
	caseID := newCase(t, owner, tenant)
	mk := func(reviewer string) remoteReview {
		at := datactx.NowISO()
		return remoteReview{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenant, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"}, CaseID: caseID, ReviewerID: reviewer, ReviewStartedAt: at}
	}
	var first, second string
	if err := owner.QueryRow(context.Background(), `INSERT INTO agents (tenant_id, data_source, code, name_en, kind) VALUES ($1, 'SYNTHETIC', 'R-'||gen_random_uuid()::text, 'r1', 'remote') RETURNING id::text`, tenant).Scan(&first); err != nil {
		t.Fatal(err)
	}
	if err := owner.QueryRow(context.Background(), `INSERT INTO agents (tenant_id, data_source, code, name_en, kind) VALUES ($1, 'SYNTHETIC', 'R-'||gen_random_uuid()::text, 'r2', 'remote') RETURNING id::text`, tenant).Scan(&second); err != nil {
		t.Fatal(err)
	}
	if err := saveRemoteReview(context.Background(), tenant, mk(first)); err != nil {
		t.Fatal(err)
	}
	err := saveRemoteReview(context.Background(), tenant, mk(second))
	if err == nil || !strings.Contains(err.Error(), "ALREADY_ASSIGNED") {
		t.Fatalf("the second claim must be refused: %v", err)
	}
	got, _ := loadRemoteReviews(context.Background(), tenant)
	if got[caseID].ReviewerID != first {
		t.Fatalf("the first reviewer must keep the case: %+v", got[caseID])
	}
}
