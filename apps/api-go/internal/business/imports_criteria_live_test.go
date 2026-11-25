// SPDX-License-Identifier: AGPL-3.0-only

// Live: an import keeps rule criteria in extra.
package business

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

var errRollBack = errors.New("roll back")

func TestApplyChunk_NewCaseKeepsCriteriaInExtra(t *testing.T) {
	conn := liveConn(t)
	ctx := context.Background()
	rc := reqctx.RequestContext{CustomerID: "8f3c2a10-5b7e-4d64-9a21-3c6e0d7b1a55"}
	_, err := tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		var c incomingCase
		if err := tx.QueryRow(ctx, `SELECT city_id::text, zone_id::text, sub_zone_id::text, case_type_id::text FROM cases WHERE tenant_id = $1::uuid LIMIT 1`, rc.CustomerID).
			Scan(&c.cityID, &c.zoneID, &c.subZoneID, &c.typeID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				t.Skip("no seeded cases: skipped, not faked.")
			}
			return struct{}{}, err
		}
		c.externalID, c.caseNumber, c.registered, c.parties, c.handling, c.dataSource = "crit-live-1", "RD-CRIT-1", time.Now(), 2, "field", "SYNTHETIC"
		c.extra = `{"location_type":"urban","claim_value_sar":5100}`
		var jobID string
		if err := tx.QueryRow(ctx, `SELECT id::text FROM import_jobs WHERE tenant_id = $1::uuid LIMIT 1`, rc.CustomerID).Scan(&jobID); err != nil {
			t.Skip("no import job to attach the case to: skipped, not faked.")
		}
		var p importPlanCounts
		if err := applyChunk(ctx, tx, rc, ImportJob{ID: jobID, DataSource: "SYNTHETIC"}, []incomingCase{c}, &p); err != nil {
			return struct{}{}, err
		}
		var loc string
		var claim float64
		if err := tx.QueryRow(ctx, `SELECT extra->>'location_type', (extra->>'claim_value_sar')::float8 FROM cases WHERE external_id = 'crit-live-1'`).Scan(&loc, &claim); err != nil {
			return struct{}{}, err
		}
		if p.New != 1 || loc != "urban" || claim != 5100 {
			t.Fatalf("got new=%d %q %v, want the case with its criteria", p.New, loc, claim)
		}
		return struct{}{}, errRollBack
	})
	if !errors.Is(err, errRollBack) {
		t.Fatal(err)
	}
}
