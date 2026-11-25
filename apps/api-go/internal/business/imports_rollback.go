// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// ImportRollbackResult mirrors the contract type.
type ImportRollbackResult struct {
	ImportJobID   string `json:"import_job_id"`
	DeletedCount  int    `json:"deleted_count"`
	RestoredCount int    `json:"restored_count"`
	FinishedAt    string `json:"finished_at"`
	Message       string `json:"message"`
	DataSource    string `json:"data_source"`
}

const restoreFromSnapshots = `UPDATE cases c SET
	registered_at = (p->>'registered_at')::timestamptz, city_id = (p->>'city_id')::uuid, zone_id = (p->>'zone_id')::uuid,
	sub_zone_id = (p->>'sub_zone_id')::uuid, latitude = (p->>'latitude')::float8, longitude = (p->>'longitude')::float8,
	case_type_id = (p->>'case_type_id')::uuid, parties_involved = (p->>'parties_involved')::int,
	assigned_at = (p->>'assigned_at')::timestamptz, arrived_at = (p->>'arrived_at')::timestamptz,
	closed_at = (p->>'closed_at')::timestamptz, handling = p->>'handling', data_source = p->>'data_source',
	severity = CASE WHEN p ? 'severity' THEN p->>'severity' ELSE c.severity END,
	extra = CASE WHEN p ? 'extra' THEN p->'extra' ELSE c.extra END,
	import_job_id = (p->>'import_job_id')::uuid, updated_at = now()
	FROM (SELECT case_id, previous AS p FROM import_case_snapshots WHERE import_job_id = $1) s
	WHERE c.id = s.case_id`

func rollbackGuard(rc reqctx.RequestContext) auditlog.Guard {
	return auditlog.Guard{Func: func() error {
		if rc.Role != access.RoleAdministrator {
			return dataerr.Forbidden("Only an administrator can roll back a cut-over.")
		}
		return reqctx.RequireAccess(rc, access.ModuleAdminDataImportQuality, access.AccessEdit)
	}}
}

// RollbackImport undoes one cut-over in one tx.
func RollbackImport(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (ImportRollbackResult, error) {
	return auditlog.WriteWithAudit(ctx, rc, rollbackGuard(rc), auditlog.WriteMeta{Action: "import.rolled_back", EntityType: "import_job", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[ImportRollbackResult], error) {
		if _, err := importutil.RequireID(id, "Import job"); err != nil {
			return auditlog.AuditedWrite[ImportRollbackResult]{}, err
		}
		job, err := importJobFor(ctx, conn, rc, id)
		if err != nil {
			return auditlog.AuditedWrite[ImportRollbackResult]{}, err
		}
		t0 := time.Now()
		res, err := tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (ImportRollbackResult, error) {
			var status string
			if err := tx.QueryRow(ctx, `SELECT status FROM import_jobs WHERE id = $1 FOR UPDATE`, id).Scan(&status); err != nil {
				return ImportRollbackResult{}, err
			}
			if status != "cut_over" {
				return ImportRollbackResult{}, requireImportStatus(ImportJob{Status: status}, []string{"cut_over"}, "roll back")
			}
			var later int
			var laterFile *string
			if err := tx.QueryRow(ctx, `SELECT count(*), min(j.file_name) FROM import_case_snapshots s
				JOIN import_jobs j ON j.tenant_id = s.tenant_id AND j.id = s.import_job_id
				WHERE s.previous->>'import_job_id' = $1::text AND s.import_job_id <> $1::uuid`, id).Scan(&later, &laterFile); err != nil {
				return ImportRollbackResult{}, err
			}
			if later > 0 {
				return ImportRollbackResult{}, dataerr.Conflict(fmt.Sprintf("%d cases from this import were changed again by the later import %s: roll that one back first.", later, deref(laterFile)))
			}
			restored, err := tx.Exec(ctx, restoreFromSnapshots, id)
			if err != nil {
				return ImportRollbackResult{}, err
			}
			deleted, err := tx.Exec(ctx, `DELETE FROM cases WHERE import_job_id = $1`, id)
			if err != nil {
				var pg *pgconn.PgError
				if errors.As(err, &pg) && pg.Code == "23503" {
					return ImportRollbackResult{}, dataerr.Conflict("Some cases this import added are now used by assignments or reviews, so nothing was rolled back.")
				}
				return ImportRollbackResult{}, err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM import_case_snapshots WHERE import_job_id = $1`, id); err != nil {
				return ImportRollbackResult{}, err
			}
			at := datactx.NowISO()
			if _, err := tx.Exec(ctx, `UPDATE import_jobs SET status = 'rolled_back', updated_at = $2 WHERE id = $1`, id, at); err != nil {
				return ImportRollbackResult{}, err
			}
			return ImportRollbackResult{ImportJobID: id, DeletedCount: int(deleted.RowsAffected()), RestoredCount: int(restored.RowsAffected()), FinishedAt: at,
				DataSource: job.DataSource, Message: fmt.Sprintf("Rolled back: %d cases removed, %d restored to their earlier values.", deleted.RowsAffected(), restored.RowsAffected())}, nil
		})
		if err != nil {
			return auditlog.AuditedWrite[ImportRollbackResult]{}, err
		}
		log.Printf("import %s: rolled back, %d cases removed, %d restored, in %.1fs", id, res.DeletedCount, res.RestoredCount, time.Since(t0).Seconds())
		return auditlog.AuditedWrite[ImportRollbackResult]{
			Result: res, SummaryEn: fmt.Sprintf("Import %s rolled back: %d cases removed, %d restored.", job.FileName, res.DeletedCount, res.RestoredCount),
			Detail: map[string]any{"deleted_count": res.DeletedCount, "restored_count": res.RestoredCount, "data_source": job.DataSource},
		}, nil
	})
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
