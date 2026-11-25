// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// ReseedRostersForTest puts rosters and their lines back to the fixtures (owner connection; rows that point at them go first).
func ReseedRostersForTest(ctx context.Context, owner *tenancy.Connection) error {
	rosters, err := fixtures.Records[Roster]("Roster")
	if err != nil {
		return err
	}
	lines, err := fixtures.Records[RosterAssignment]("RosterAssignment")
	if err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, owner.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, table := range []string{"simulation_results", "simulation_runs", "overrides", "roster_assignments", "rosters"} {
			if _, err := tx.Exec(ctx, `DELETE FROM `+table); err != nil {
				return struct{}{}, err
			}
		}
		for i, r := range rosters {
			r.CreatedAt = nudgedCreatedAt(r.CreatedAt, i)
			if err := upsertRosterTx(ctx, tx, r); err != nil {
				return struct{}{}, err
			}
		}
		for i, a := range lines {
			a.CreatedAt = nudgedCreatedAt(a.CreatedAt, i)
			if err := upsertRosterAssignmentTx(ctx, tx, a); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}
