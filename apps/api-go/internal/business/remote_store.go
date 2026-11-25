// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// remoteReviewBackend keeps remote reviewer assignments.
type remoteReviewBackend interface {
	byCase(ctx context.Context, tenant string) (map[string]remoteReview, error)
	save(ctx context.Context, tenant string, r remoteReview) error
}

var remoteReviewStoreBackend remoteReviewBackend = memoryRemoteReviews{}

// UsePostgresRemoteReviews keeps assignments in Postgres.
func UsePostgresRemoteReviews(conn *tenancy.Connection) {
	remoteReviewStoreBackend = pgRemoteReviews{conn: conn}
}

// UseMemoryRemoteReviews puts the memory store back.
func UseMemoryRemoteReviews() { remoteReviewStoreBackend = memoryRemoteReviews{} }

type memoryRemoteReviews struct{}

func (memoryRemoteReviews) byCase(context.Context, string) (map[string]remoteReview, error) {
	return remoteReviewsByCaseMemory(), nil
}

func (memoryRemoteReviews) save(_ context.Context, _ string, r remoteReview) error {
	upsertRemoteReviewMemory(r)
	return nil
}

type pgRemoteReviews struct{ conn *tenancy.Connection }

func (p pgRemoteReviews) byCase(ctx context.Context, tenant string) (map[string]remoteReview, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (map[string]remoteReview, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, case_id::text, reviewer_id::text, review_started_at FROM remote_reviews`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := map[string]remoteReview{}
		for rows.Next() {
			var r remoteReview
			var created, updated, started time.Time
			if err := rows.Scan(&r.ID, &r.TenantID, &r.DataSource, &created, &updated, &r.CreatedBy, &r.CaseID, &r.ReviewerID, &started); err != nil {
				return nil, err
			}
			r.CreatedAt, r.UpdatedAt, r.ReviewStartedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated), datactx.ToRiyadhISO(started)
			out[r.CaseID] = r
		}
		return out, rows.Err()
	})
}

func (p pgRemoteReviews) save(ctx context.Context, tenant string, r remoteReview) error {
	started, err := parseTime(r.ReviewStartedAt)
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		// A claim: the first reviewer keeps the case, a second one is told it is taken.
		tag, err := tx.Exec(ctx, `INSERT INTO remote_reviews (tenant_id, id, data_source, created_by, case_id, reviewer_id, review_started_at)
			VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6)
			ON CONFLICT (tenant_id, case_id) DO NOTHING`,
			r.ID, r.DataSource, r.CreatedBy, r.CaseID, r.ReviewerID, started)
		if err == nil && tag.RowsAffected() == 0 {
			return struct{}{}, dataerr.Conflict("ALREADY_ASSIGNED: another reviewer has taken this case.")
		}
		return struct{}{}, err
	})
	return err
}

func loadRemoteReviews(ctx context.Context, tenant string) (map[string]remoteReview, error) {
	return remoteReviewStoreBackend.byCase(ctx, tenant)
}

func saveRemoteReview(ctx context.Context, tenant string, r remoteReview) error {
	return remoteReviewStoreBackend.save(ctx, tenant, r)
}

// ReseedRemoteReviewsForTest empties the table.
func ReseedRemoteReviewsForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, isPg := remoteReviewStoreBackend.(pgRemoteReviews); !isPg {
		return nil
	}
	_, err := owner.Pool.Exec(ctx, `DELETE FROM remote_reviews`)
	return err
}
