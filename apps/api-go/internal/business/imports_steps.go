// SPDX-License-Identifier: AGPL-3.0-only

// Import steps in the background.
package business

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// ImportStep: the job's last background step.
type ImportStep struct {
	Step           *string         `json:"step"`
	StepState      *string         `json:"step_state"`
	StepRowsDone   *int64          `json:"step_rows_done"`
	StepRowsTotal  *int64          `json:"step_rows_total"`
	StepStartedAt  *string         `json:"step_started_at"`
	StepFinishedAt *string         `json:"step_finished_at"`
	StepError      *string         `json:"step_error"`
	StepResult     json.RawMessage `json:"step_result"`
}

const importStepColumns = `step, step_state, step_rows_done, step_rows_total, step_started_at, step_finished_at, step_error, step_result`

type stepScan struct {
	step, state, errText *string
	done, total          *int64
	started, finished    *time.Time
	result               []byte
}

func (s *stepScan) targets() []any {
	return []any{&s.step, &s.state, &s.done, &s.total, &s.started, &s.finished, &s.errText, &s.result}
}

func (s *stepScan) value() ImportStep {
	out := ImportStep{Step: s.step, StepState: s.state, StepRowsDone: s.done, StepRowsTotal: s.total,
		StepStartedAt: nullableTimeToISO(s.started), StepFinishedAt: nullableTimeToISO(s.finished), StepError: s.errText}
	if len(s.result) > 0 {
		out.StepResult = json.RawMessage(s.result)
	}
	return out
}

// Step names, as the contract has them.
const (
	StepValidate = "validate"
	StepCompare  = "compare"
	StepDryRun   = "dry_run"
	StepCutOver  = "cut_over"
	StepRollback = "rollback"
)

var importStepNames = []string{StepValidate, StepCompare, StepDryRun, StepCutOver, StepRollback}

// stepFrom: the job statuses a step may start at.
var stepFrom = map[string][]string{
	StepValidate: {"uploaded", "validating", "validated", "compared", "dry_run_done", "failed", "rolled_back"},
	StepCompare:  {"validated", "compared", "dry_run_done"},
	StepDryRun:   {"compared", "dry_run_done"},
	StepCutOver:  {"dry_run_done"},
	StepRollback: {"cut_over"},
}

var stepAction = map[string]string{
	StepValidate: "import.validated", StepCompare: "import.compared", StepDryRun: "import.dry_run",
	StepCutOver: "import.cut_over", StepRollback: "import.rolled_back",
}

// Heartbeat and staleness; tests shorten them.
var (
	stepHeartbeat  = 5 * time.Second
	stepStaleAfter = 60 * time.Second
	importStepsWG  sync.WaitGroup
)

// WaitImportStepsForTest: background steps done.
func WaitImportStepsForTest() { importStepsWG.Wait() }

// SetImportStepTimingForTest shortens the timers.
func SetImportStepTimingForTest(heartbeat, stale time.Duration) {
	stepHeartbeat, stepStaleAfter = heartbeat, stale
}

const interruptedStep = "The api stopped while this step ran, so nothing from it was kept. Run it again."

// settleStaleSteps: a step whose api died failed.
func settleStaleSteps(ctx context.Context, conn *tenancy.Connection, tenantID string) error {
	_, err := tenancy.WithTenant(tenancy.Detach(ctx), conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `UPDATE import_jobs SET step_state = 'failed', step_finished_at = now(), step_error = $1
			WHERE step_state = 'running' AND step_heartbeat_at < now() - make_interval(secs => $2)`, interruptedStep, stepStaleAfter.Seconds())
		return struct{}{}, err
	})
	return err
}

// stepRunning: a live step holds the job.
func stepRunning(job ImportJob) bool {
	return job.StepState != nil && *job.StepState == "running"
}

// RefuseWhileStepRunning guards the sync steps.
func RefuseWhileStepRunning(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) error {
	if !importutil.IsID(id) {
		return nil
	}
	if err := settleStaleSteps(ctx, conn, rc.CustomerID); err != nil {
		return err
	}
	job, err := oneImportJob(ctx, conn, rc.CustomerID, id)
	if err != nil || job == nil || !stepRunning(*job) {
		return err
	}
	return dataerr.Conflict(fmt.Sprintf("Import %s: a %s is still running.", job.FileName, stepLabel(*job.Step)))
}

func stepLabel(step string) string {
	switch step {
	case StepDryRun:
		return "dry run"
	case StepCutOver:
		return "cut-over"
	}
	return step
}

type progressKey struct{}

// rowsProgress: the counter the file reader bumps.
func rowsProgress(ctx context.Context) *atomic.Int64 {
	c, _ := ctx.Value(progressKey{}).(*atomic.Int64)
	return c
}

// countedRows bumps the step's counter per row.
type countedRows struct {
	importRows
	n *atomic.Int64
}

func (c countedRows) Next() (importRow, error) {
	r, err := c.importRows.Next()
	if err == nil {
		c.n.Add(1)
	}
	return r, err
}

// withRowCounter wraps rows when a step counts.
func withRowCounter(ctx context.Context, rows importRows) importRows {
	if n := rowsProgress(ctx); n != nil && rows != nil {
		return countedRows{importRows: rows, n: n}
	}
	return rows
}

// StartImportStep: 202, then the step runs alone.
func StartImportStep(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (ImportJob, error) {
	o, err := datactx.Object(body, "Import step", []string{"step"})
	if err != nil {
		return ImportJob{}, err
	}
	step, err := datactx.EnumOf(o, "step", importStepNames)
	if err != nil {
		return ImportJob{}, err
	}
	guard := auditlog.Guard{ModuleID: access.ModuleAdminDataImportQuality}
	if step == StepRollback {
		guard = rollbackGuard(rc)
	}
	if err := auditlog.GuardWithAudit(rc, guard, auditlog.WriteMeta{Action: stepAction[step], EntityType: "import_job", EntityID: &id}); err != nil {
		return ImportJob{}, err
	}
	if _, err := importutil.RequireID(id, "Import job"); err != nil {
		return ImportJob{}, err
	}
	if err := settleStaleSteps(ctx, conn, rc.CustomerID); err != nil {
		return ImportJob{}, err
	}
	job, err := importJobFor(ctx, conn, rc, id)
	if err != nil {
		return ImportJob{}, err
	}
	if stepRunning(job) {
		return ImportJob{}, dataerr.Conflict(fmt.Sprintf("Import %s: a %s is already running.", job.FileName, stepLabel(*job.Step)))
	}
	if err := requireImportStatus(job, stepFrom[step], stepLabel(step)); err != nil {
		return ImportJob{}, err
	}
	var total *int64
	if step != StepRollback && job.StorageRef != nil {
		t := int64(job.RowCount)
		total = &t
	}
	started, err := claimStep(ctx, conn, rc.CustomerID, id, step, total)
	if err != nil {
		return ImportJob{}, err
	}
	if started == nil {
		return ImportJob{}, dataerr.Conflict(fmt.Sprintf("Import %s: another step has just started.", job.FileName))
	}
	importStepsWG.Add(1)
	go runStep(conn, rc, id, step, *started)
	return importJobFor(ctx, conn, rc, id)
}

// claimStep marks the step running, or nil if taken.
func claimStep(ctx context.Context, conn *tenancy.Connection, tenantID, id, step string, total *int64) (*time.Time, error) {
	return tenancy.WithTenant(tenancy.Detach(ctx), conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (*time.Time, error) {
		var at time.Time
		err := tx.QueryRow(ctx, `UPDATE import_jobs SET step = $2, step_state = 'running', step_started_at = clock_timestamp(),
				step_heartbeat_at = clock_timestamp(), step_finished_at = NULL, step_rows_done = 0, step_rows_total = $3,
				step_error = NULL, step_result = NULL
			WHERE id = $1 AND step_state IS DISTINCT FROM 'running' RETURNING step_started_at`, id, step, total).Scan(&at)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return &at, err
	})
}

// runStep: own context, beats until it ends.
func runStep(conn *tenancy.Connection, rc reqctx.RequestContext, id, step string, started time.Time) {
	defer importStepsWG.Done()
	counter := &atomic.Int64{}
	ctx := context.WithValue(context.Background(), progressKey{}, counter)
	stop := make(chan struct{})
	beat := &sync.WaitGroup{}
	beat.Add(1)
	go func() {
		defer beat.Done()
		t := time.NewTicker(stepHeartbeat)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				if err := touchStep(conn, rc.CustomerID, id, started, counter.Load()); err != nil {
					log.Printf("import %s: step heartbeat: %v", id, err)
				}
			}
		}
	}()
	result, err := doStep(ctx, conn, rc, id, step)
	close(stop)
	beat.Wait()
	if err != nil {
		log.Printf("import %s: %s failed: %v", id, step, err)
	}
	if ferr := finishStep(conn, rc.CustomerID, id, step, started, counter.Load(), result, err); ferr != nil {
		log.Printf("import %s: recording the %s outcome: %v", id, step, ferr)
	}
}

func doStep(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id, step string) (any, error) {
	switch step {
	case StepValidate:
		_, err := ValidateImport(ctx, conn, rc, id)
		return nil, err
	case StepCompare:
		return CompareImport(ctx, conn, rc, id)
	case StepDryRun:
		return DryRunCutover(ctx, conn, rc, id)
	case StepCutOver:
		return ExecuteCutover(ctx, conn, rc, id)
	case StepRollback:
		return RollbackImport(ctx, conn, rc, id)
	}
	return nil, fmt.Errorf("unknown step %q", step)
}

func touchStep(conn *tenancy.Connection, tenantID, id string, started time.Time, done int64) error {
	_, err := tenancy.WithTenant(context.Background(), conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `UPDATE import_jobs SET step_heartbeat_at = clock_timestamp(), step_rows_done = $3
			WHERE id = $1 AND step_state = 'running' AND step_started_at = $2`, id, started, done)
		return struct{}{}, err
	})
	return err
}

// stepFailure: the message a person can act on.
func stepFailure(step string, err error) string {
	var de *dataerr.DataError
	if errors.As(err, &de) {
		return de.Message
	}
	return fmt.Sprintf("The %s stopped on an unexpected error; nothing from it was kept. The api log has the details.", stepLabel(step))
}

func finishStep(conn *tenancy.Connection, tenantID, id, step string, started time.Time, done int64, result any, runErr error) error {
	state, failure := "succeeded", (*string)(nil)
	var body []byte
	if runErr != nil {
		state = "failed"
		msg := stepFailure(step, runErr)
		failure = &msg
	} else if result != nil {
		b, err := json.Marshal(result)
		if err != nil {
			return err
		}
		body = b
	}
	_, err := tenancy.WithTenant(context.Background(), conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `UPDATE import_jobs SET step_state = $3, step_finished_at = clock_timestamp(), step_heartbeat_at = clock_timestamp(),
				step_rows_done = $4, step_error = $5, step_result = $6::jsonb
			WHERE id = $1 AND step_state = 'running' AND step_started_at = $2`, id, started, state, done, failure, body)
		return struct{}{}, err
	})
	return err
}
