// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// modelVersionBackend keeps model versions.
type modelVersionBackend interface {
	versions(ctx context.Context, tenant string) ([]ModelVersion, error)
	save(ctx context.Context, tenant string, rows []ModelVersion) error
}

var modelVersionData modelVersionBackend = memoryModelVersions{}

// UsePostgresModelVersions: Postgres store.
func UsePostgresModelVersions(conn *tenancy.Connection) {
	modelVersionData = pgModelVersions{conn: conn}
}

// UseMemoryModelVersions: memory store (tests).
func UseMemoryModelVersions() { modelVersionData = memoryModelVersions{} }

type memoryModelVersions struct{}

func (memoryModelVersions) versions(context.Context, string) ([]ModelVersion, error) {
	return allModelVersionRows(), nil
}

func (memoryModelVersions) save(_ context.Context, _ string, rows []ModelVersion) error {
	for _, v := range rows {
		upsertModelVersionRow(v)
	}
	return nil
}

type pgModelVersions struct{ conn *tenancy.Connection }

func (p pgModelVersions) versions(ctx context.Context, tenant string) ([]ModelVersion, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]ModelVersion, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, version, status, is_placeholder,
			engine_version, trained_at, notes_en FROM model_versions ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []ModelVersion
		for rows.Next() {
			var v ModelVersion
			var created, updated time.Time
			var trained *time.Time
			if err := rows.Scan(&v.ID, &v.TenantID, &v.DataSource, &created, &updated, &v.CreatedBy, &v.Version, &v.Status, &v.IsPlaceholder,
				&v.EngineVersion, &trained, &v.NotesEn); err != nil {
				return nil, err
			}
			v.CreatedAt, v.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			v.TrainedAt = nullableTimeToISO(trained)
			out = append(out, v)
		}
		return out, rows.Err()
	})
}

// save: the rows of one action, one transaction.
func (p pgModelVersions) save(ctx context.Context, tenant string, list []ModelVersion) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, v := range list {
			created, err := parseTime(v.CreatedAt)
			if err != nil {
				return struct{}{}, err
			}
			updated, err := parseTime(v.UpdatedAt)
			if err != nil {
				return struct{}{}, err
			}
			trained, err := optTime(v.TrainedAt)
			if err != nil {
				return struct{}{}, err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO model_versions (tenant_id, id, data_source, created_at, updated_at, created_by, version, status, is_placeholder, engine_version, trained_at, notes_en)
				VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11)
				ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, version = EXCLUDED.version, status = EXCLUDED.status,
					is_placeholder = EXCLUDED.is_placeholder, engine_version = EXCLUDED.engine_version, trained_at = EXCLUDED.trained_at, notes_en = EXCLUDED.notes_en`,
				v.ID, v.DataSource, created, updated, v.CreatedBy, v.Version, v.Status, v.IsPlaceholder, v.EngineVersion, trained, v.NotesEn); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}

// ReseedModelVersionsForTest: fixtures, owner.
func ReseedModelVersionsForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, isPg := modelVersionData.(pgModelVersions); !isPg {
		return nil
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM model_versions`); err != nil {
		return err
	}
	rows, err := fixtures.Records[ModelVersion]("ModelVersion")
	if err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	return pgModelVersions{conn: owner}.save(ctx, tenant, rows)
}
