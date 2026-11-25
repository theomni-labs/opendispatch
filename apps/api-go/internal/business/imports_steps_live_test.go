// SPDX-License-Identifier: AGPL-3.0-only

// Live: background import steps.
package business

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importstorage"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// runStepPolled starts a step, polls as the screen.
func runStepPolled(t *testing.T, conn *tenancy.Connection, rc reqctx.RequestContext, id, step string, every time.Duration) ImportJob {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	started, err := StartImportStep(ctx, conn, rc, id, map[string]any{"step": step})
	cancel()
	check(t, err)
	if started.StepState == nil || *started.StepState != "running" || *started.Step != step {
		t.Fatalf("started %+v, want %s running", started.ImportStep, step)
	}
	deadline := time.Now().Add(20 * time.Minute)
	for time.Now().Before(deadline) {
		time.Sleep(every)
		job, err := GetImportJob(context.Background(), conn, rc, id)
		check(t, err)
		if *job.StepState == "running" {
			continue
		}
		if *job.StepState != "succeeded" {
			t.Fatalf("%s %s: %v", step, *job.StepState, deref(job.StepError))
		}
		return job
	}
	t.Fatalf("%s still running after 20 minutes", step)
	return ImportJob{}
}

func stepResult(t *testing.T, job ImportJob, out any) {
	t.Helper()
	if err := json.Unmarshal(job.StepResult, out); err != nil {
		t.Fatalf("step_result %s: %v", job.StepResult, err)
	}
}

func uploadedJob(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, rows int) ImportJob {
	t.Helper()
	job, err := UploadImportFile(ctx, conn, rc, ImportUploadMeta{FileName: "steps.csv", MappingVersion: "generic_csv_v1", DataSource: "SYNTHETIC"}, strings.NewReader(rowsCsv(rows, nil)))
	check(t, err)
	return job
}

func TestImportSteps_CutOverOutlivesTheCallerAndASecondStartIsRefused(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)
	const n = 60000
	job := uploadedJob(t, ctx, conn, rc, n)
	for _, s := range []string{StepValidate, StepCompare, StepDryRun} {
		runStepPolled(t, conn, rc, job.ID, s, 100*time.Millisecond)
	}
	// the caller goes away as soon as it has the 202
	call, hangUp := context.WithCancel(context.Background())
	started, err := StartImportStep(call, conn, rc, job.ID, map[string]any{"step": StepCutOver})
	hangUp()
	check(t, err)
	if *started.StepState != "running" || started.StepRowsTotal == nil || *started.StepRowsTotal != n {
		t.Fatalf("started %+v", started.ImportStep)
	}
	if _, err := StartImportStep(ctx, conn, rc, job.ID, map[string]any{"step": StepCutOver}); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("second start: got %v, want conflict", err)
	}
	if err := RefuseWhileStepRunning(ctx, conn, rc, job.ID); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("one-request step while running: got %v, want conflict", err)
	}
	WaitImportStepsForTest()
	done, err := GetImportJob(ctx, conn, rc, job.ID)
	check(t, err)
	if *done.StepState != "succeeded" || done.Status != "cut_over" || *done.StepRowsDone != n || done.StepFinishedAt == nil {
		t.Fatalf("after: %+v status %s", done.ImportStep, done.Status)
	}
	var res CutoverResult
	stepResult(t, done, &res)
	if res.WouldInsert != n {
		t.Fatalf("result %+v", res)
	}
	if count, err := caseCountLive(ctx, conn, rc.CustomerID); err != nil || count != n {
		t.Fatalf("cases %d (%v), want %d", count, err, n)
	}
	if auditCount(rc.CustomerID, "import.cut_over", job.ID, "success") != 1 {
		t.Fatal("the background cut-over was not audited")
	}
}

func TestImportSteps_AFailureIsRecordedAndARetryWorks(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)
	job := uploadedJob(t, ctx, conn, rc, 10)
	if _, err := StartImportStep(ctx, conn, rc, job.ID, map[string]any{"step": StepCutOver}); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("cut-over of an uploaded job: got %v, want conflict", err)
	}
	if _, err := StartImportStep(ctx, conn, rc, job.ID, map[string]any{"step": "explode"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("unknown step: got %v, want invalid", err)
	}
	planner := plannerCtx(rc.CustomerID, rc.UserID, nil)
	if _, err := StartImportStep(ctx, conn, planner, job.ID, map[string]any{"step": StepValidate}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner: got %v, want forbidden", err)
	}
	check(t, importstorage.RemoveJob(ctx, rc.CustomerID, job.ID))
	_, err := StartImportStep(ctx, conn, rc, job.ID, map[string]any{"step": StepValidate})
	check(t, err)
	WaitImportStepsForTest()
	failed, err := GetImportJob(ctx, conn, rc, job.ID)
	check(t, err)
	if *failed.StepState != "failed" || !strings.Contains(deref(failed.StepError), "no longer in object storage") {
		t.Fatalf("after a lost file: %+v", failed.ImportStep)
	}
}

func TestImportSteps_AStepWhoseApiStoppedIsFailedAndCanRunAgain(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)
	SetImportStepTimingForTest(5*time.Second, time.Second)
	t.Cleanup(func() { SetImportStepTimingForTest(5*time.Second, 60*time.Second) })
	job := uploadedJob(t, ctx, conn, rc, 10)
	// a claim with no goroutine: the api died
	if at, err := claimStep(ctx, conn, rc.CustomerID, job.ID, StepCutOver, nil); err != nil || at == nil {
		t.Fatalf("claim: %v %v", at, err)
	}
	if _, err := StartImportStep(ctx, conn, rc, job.ID, map[string]any{"step": StepValidate}); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("while the heartbeat is fresh: got %v, want conflict", err)
	}
	time.Sleep(1500 * time.Millisecond)
	stale, err := GetImportJob(ctx, conn, rc, job.ID)
	check(t, err)
	if *stale.StepState != "failed" || deref(stale.StepError) != interruptedStep || stale.Status != "uploaded" {
		t.Fatalf("stale step: %+v status %s", stale.ImportStep, stale.Status)
	}
	if count, err := caseCountLive(ctx, conn, rc.CustomerID); err != nil || count != 0 {
		t.Fatalf("cases %d (%v) after an interrupted step", count, err)
	}
	runStepPolled(t, conn, rc, job.ID, StepValidate, 100*time.Millisecond)
}

func TestImportUploads_SweepRemovesSessionsOlderThanADay(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	seedImportRefFixture(t, ctx, conn, rc)
	s := startUpload(t, ctx, conn, rc, "abandoned.csv", 10)
	sendChunks(t, ctx, rc, s, strings.NewReader("0123456789"), []int{0})
	if _, err := SweepImportUploads(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := GetImportUpload(ctx, rc, s.ID); err != nil {
		t.Fatalf("a fresh session was swept: %v", err)
	}
	n, err := SweepImportUploads(ctx, time.Now().Add(UploadMaxAge+time.Minute))
	check(t, err)
	if n < 1 {
		t.Fatalf("swept %d, want the abandoned session", n)
	}
	if _, err := GetImportUpload(ctx, rc, s.ID); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("after the sweep: %v, want not found", err)
	}
	if chunks, err := importstorage.UploadChunks(ctx, rc.CustomerID, s.ID); err != nil || len(chunks) != 0 {
		t.Fatalf("chunks left: %v %v", chunks, err)
	}
}
