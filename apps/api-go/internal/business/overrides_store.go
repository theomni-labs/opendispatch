// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// overrideBackend keeps planner overrides of a roster.
type overrideBackend interface {
	all(ctx context.Context, tenant string) ([]Override, error)
	save(ctx context.Context, tenant string, o Override) error
}

var overrideStoreBackend overrideBackend = memoryOverrides{}

// UsePostgresOverrides keeps overrides in Postgres.
func UsePostgresOverrides(conn *tenancy.Connection) { overrideStoreBackend = pgOverrides{conn: conn} }

// UseMemoryOverrides puts the in-memory store back (tests).
func UseMemoryOverrides() { overrideStoreBackend = memoryOverrides{} }

type memoryOverrides struct{}

func (memoryOverrides) all(context.Context, string) ([]Override, error) {
	return allOverrideRowsMemory(), nil
}

func (memoryOverrides) save(_ context.Context, _ string, o Override) error {
	upsertOverrideRowMemory(o)
	return nil
}

type pgOverrides struct{ conn *tenancy.Connection }

func (p pgOverrides) all(ctx context.Context, tenant string) ([]Override, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]Override, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, roster_id::text, roster_assignment_id::text, change_type,
			reason_code, note, before, after, status, decided_by_user_id::text, decided_at, decision_note FROM overrides ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Override
		for rows.Next() {
			var o Override
			var created, updated time.Time
			var roster *string
			var decided *time.Time
			var before, after []byte
			if err := rows.Scan(&o.ID, &o.TenantID, &o.DataSource, &created, &updated, &o.CreatedBy, &roster, &o.RosterAssignmentID, &o.ChangeType, &o.ReasonCode, &o.Note,
				&before, &after, &o.Status, &o.DecidedByUserID, &decided, &o.DecisionNote); err != nil {
				return nil, err
			}
			o.CreatedAt, o.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			if roster != nil {
				o.RosterID = *roster
			}
			o.DecidedAt = nullableTimeToISO(decided)
			if o.Before, err = scanExtra(before); err != nil {
				return nil, err
			}
			if o.After, err = scanExtra(after); err != nil {
				return nil, err
			}
			out = append(out, o)
		}
		return out, rows.Err()
	})
}

func jsonOrNull(m map[string]any) ([]byte, error) {
	if m == nil {
		return nil, nil
	}
	return json.Marshal(m)
}

func (p pgOverrides) save(ctx context.Context, tenant string, o Override) error {
	before, err := jsonOrNull(o.Before)
	if err != nil {
		return err
	}
	after, err := jsonOrNull(o.After)
	if err != nil {
		return err
	}
	decided, err := optTime(o.DecidedAt)
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO overrides (tenant_id, id, data_source, created_at, updated_at, created_by, roster_id, roster_assignment_id, change_type, reason_code, note,
				before, after, status, decided_by_user_id, decided_at, decision_note)
			VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, now(), now(), $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12::uuid, $13, $14)
			ON CONFLICT (tenant_id, id) DO UPDATE SET status = EXCLUDED.status, decided_by_user_id = EXCLUDED.decided_by_user_id, decided_at = EXCLUDED.decided_at,
				decision_note = EXCLUDED.decision_note, note = EXCLUDED.note, before = EXCLUDED.before, after = EXCLUDED.after, updated_at = now()`,
			o.ID, o.DataSource, o.CreatedBy, nullableUUID(o.RosterID), o.RosterAssignmentID, o.ChangeType, o.ReasonCode, o.Note, before, after, o.Status, o.DecidedByUserID, decided, o.DecisionNote)
		return struct{}{}, err
	})
	return err
}

func loadOverrides(ctx context.Context, tenant string) ([]Override, error) {
	return overrideStoreBackend.all(ctx, tenant)
}

func loadOverride(ctx context.Context, tenant, id string) (*Override, error) {
	all, err := overrideStoreBackend.all(ctx, tenant)
	if err != nil {
		return nil, err
	}
	for _, o := range all {
		if o.ID == id {
			row := o
			return &row, nil
		}
	}
	return nil, nil
}

func saveOverride(ctx context.Context, tenant string, o Override) error {
	return overrideStoreBackend.save(ctx, tenant, o)
}

// ReseedOverridesForTest puts the overrides table back to the fixtures (owner connection).
func ReseedOverridesForTest(ctx context.Context, owner *tenancy.Connection) error {
	pg, isPg := overrideStoreBackend.(pgOverrides)
	if !isPg {
		return nil
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM overrides`); err != nil {
		return err
	}
	rows, err := fixtures.Records[Override]("Override")
	if err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	_ = pg
	// An earlier test may have rebuilt a roster: a link to a line or roster that is gone is dropped, as the delete action does.
	lines, err := existingIDs(ctx, owner, `SELECT id::text FROM roster_assignments`)
	if err != nil {
		return err
	}
	rosters, err := existingIDs(ctx, owner, `SELECT id::text FROM rosters`)
	if err != nil {
		return err
	}
	seed := pgOverrides{conn: owner}
	for i, o := range rows {
		o.CreatedAt = nudgedCreatedAt(o.CreatedAt, i)
		if o.RosterAssignmentID != nil && !lines[*o.RosterAssignmentID] {
			o.RosterAssignmentID = nil
		}
		if o.RosterID != "" && !rosters[o.RosterID] {
			o.RosterID = ""
		}
		if err := seed.save(ctx, tenant, o); err != nil {
			return err
		}
	}
	return nil
}

func existingIDs(ctx context.Context, owner *tenancy.Connection, query string) (map[string]bool, error) {
	rows, err := owner.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}
