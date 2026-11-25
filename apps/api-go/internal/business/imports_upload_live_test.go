// SPDX-License-Identifier: AGPL-3.0-only

// Live: Postgres and an S3-compatible store (OPENDISPATCH_S3_*).
package business

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importstorage"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func startUpload(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, name string, size int64) ImportUploadSession {
	t.Helper()
	s, err := CreateImportUpload(ctx, conn, rc, map[string]any{"file_name": name, "size": float64(size), "mapping_version": "generic_csv_v1", "data_source": "SYNTHETIC"})
	check(t, err)
	return s
}

// sendChunks sends the listed chunks of src.
func sendChunks(t *testing.T, ctx context.Context, rc reqctx.RequestContext, s ImportUploadSession, src io.ReaderAt, order []int) {
	t.Helper()
	for _, i := range order {
		n := s.expectedChunk(i)
		_, err := PutImportUploadChunk(ctx, rc, s.ID, i, n, io.NewSectionReader(src, int64(i)*s.ChunkSize, n))
		check(t, err)
	}
}

// syntheticCsvFile: n SYNTHETIC rows, on disk.
func syntheticCsvFile(t *testing.T, n int) (string, int64) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "synthetic.csv")
	f, err := os.Create(path)
	check(t, err)
	w := bufio.NewWriterSize(f, 1<<20)
	_, _ = w.WriteString(strings.Join(validImportHeader(), ",") + "\r\n")
	for i := 0; i < n; i++ {
		row := validImportRow()
		day := time.Date(2026, 1, 1, 8, 0, 0, 0, riyadhZone).Add(time.Duration(i%(180*24)) * time.Hour)
		row[0], row[1] = fmt.Sprintf("SYN-%07d", i), fmt.Sprintf("RD-%s-%07d", day.Format("060102"), i)
		row[2] = day.Format("2006-01-02 15:04:05")
		row[14] = day.Add(5 * time.Minute).Format("2006-01-02 15:04:05")
		row[15] = day.Add(20 * time.Minute).Format("2006-01-02 15:04:05")
		row[16] = day.Add(40 * time.Minute).Format("2006-01-02 15:04:05")
		_, _ = w.WriteString(strings.Join(row, ",") + "\r\n")
	}
	check(t, w.Flush())
	info, err := f.Stat()
	check(t, err)
	check(t, f.Close())
	return path, info.Size()
}

func TestImportUpload_ChunksInAnyOrderJoinToTheFile(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)
	csv := rowsCsv(90000, nil)
	s := startUpload(t, ctx, conn, rc, "ordered.csv", int64(len(csv)))
	if s.ChunkCount < 2 || s.ChunkSize != importstorage.UploadChunkSize {
		t.Fatalf("session %+v, want 8 MiB chunks and at least 2", s)
	}
	order := make([]int, 0, s.ChunkCount)
	for i := s.ChunkCount - 1; i >= 0; i-- {
		order = append(order, i)
	}
	src := strings.NewReader(csv)
	sendChunks(t, ctx, rc, s, src, order)
	sendChunks(t, ctx, rc, s, src, []int{0})
	got, err := GetImportUpload(ctx, rc, s.ID)
	check(t, err)
	if len(got.ReceivedChunks) != s.ChunkCount || got.ReceivedBytes != s.Size {
		t.Fatalf("session %+v, want every chunk", got)
	}
	job, err := CompleteImportUpload(ctx, conn, rc, s.ID)
	check(t, err)
	if job.Status != "uploaded" || job.RowCount != 90000 || job.DataSource != "SYNTHETIC" {
		t.Fatalf("job %+v, want uploaded, 90000 rows, SYNTHETIC", job)
	}
	stored, err := importstorage.OpenSource(ctx, rc.CustomerID, job.ID)
	check(t, err)
	defer stored.Close()
	body, err := io.ReadAll(stored)
	check(t, err)
	if !bytes.Equal(body, []byte(csv)) {
		t.Fatalf("stored file differs: %d bytes, want %d", len(body), len(csv))
	}
	if _, err := GetImportUpload(ctx, rc, s.ID); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("the chunks outlived the join: %v", err)
	}
	if n := auditCount(rc.CustomerID, "import.uploaded", job.ID, "success"); n != 1 {
		t.Fatalf("%d import.uploaded audit rows, want 1", n)
	}
	if n := auditCount(rc.CustomerID, "import.upload_started", s.ID, "success"); n != 1 {
		t.Fatalf("%d import.upload_started audit rows, want 1", n)
	}
}

func TestImportUpload_MissingChunkBlocksTheJoin(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	seedImportRefFixture(t, ctx, conn, rc)
	data := bytes.Repeat([]byte("x"), 2*importstorage.UploadChunkSize+10)
	s := startUpload(t, ctx, conn, rc, "gap.csv", int64(len(data)))
	sendChunks(t, ctx, rc, s, bytes.NewReader(data), []int{0, 2})
	_, err := CompleteImportUpload(ctx, conn, rc, s.ID)
	if errCode(err) != dataerr.CodeConflict || !strings.Contains(err.Error(), "(1)") {
		t.Fatalf("got %v, want a conflict naming chunk 1", err)
	}
	if n := countIn(t, conn, rc.CustomerID, `SELECT count(*)::int FROM import_jobs`); n != 0 {
		t.Fatalf("%d jobs after a refused join, want 0", n)
	}
	check(t, CancelImportUpload(ctx, rc, s.ID))
	if _, err := GetImportUpload(ctx, rc, s.ID); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("cancelled upload still there: %v", err)
	}
}

func TestImportUpload_RefusesWrongLengthsAndIndexes(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	seedImportRefFixture(t, ctx, conn, rc)
	data := bytes.Repeat([]byte("y"), importstorage.UploadChunkSize+100)
	s := startUpload(t, ctx, conn, rc, "len.csv", int64(len(data)))
	if _, err := PutImportUploadChunk(ctx, rc, s.ID, 2, 1, bytes.NewReader([]byte("z"))); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("chunk past the end: got %v, want invalid", err)
	}
	if _, err := PutImportUploadChunk(ctx, rc, s.ID, 1, 99, bytes.NewReader(data[:99])); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("declared short: got %v, want invalid", err)
	}
	if _, err := PutImportUploadChunk(ctx, rc, s.ID, 1, -1, bytes.NewReader(data[:99])); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("short body: got %v, want invalid", err)
	}
	if _, err := PutImportUploadChunk(ctx, rc, s.ID, 1, -1, bytes.NewReader(data[:101])); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("long body: got %v, want invalid", err)
	}
	got, err := GetImportUpload(ctx, rc, s.ID)
	check(t, err)
	if len(got.ReceivedChunks) != 0 {
		t.Fatalf("refused chunks counted as received: %v", got.ReceivedChunks)
	}
	check(t, CancelImportUpload(ctx, rc, s.ID))
}

func TestImportUpload_RefusesOverOneGigabyte(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	_, err := CreateImportUpload(ctx, conn, rc, map[string]any{"file_name": "huge.csv", "size": float64(importstorage.MaxUploadBytes + 1), "mapping_version": "generic_csv_v1"})
	if errCode(err) != dataerr.CodeInvalid || !strings.Contains(err.Error(), "1 GB") {
		t.Fatalf("got %v, want invalid over 1 GB", err)
	}
	if _, err := CreateImportUpload(ctx, conn, rc, map[string]any{"file_name": "cases.xlsx", "size": float64(10), "mapping_version": "generic_csv_v1"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("a spreadsheet: got %v, want invalid", err)
	}
}

func TestImportUpload_OnlyAnEditorMayUpload(t *testing.T) {
	conn := openConn(t)
	rc, tenant := adminCtx(t)
	ctx := context.Background()
	seedImportRefFixture(t, ctx, conn, rc)
	planner := plannerCtx(tenant, rc.UserID, nil)
	if _, err := CreateImportUpload(ctx, conn, planner, map[string]any{"file_name": "p.csv", "size": float64(10), "mapping_version": "generic_csv_v1"}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner start: got %v, want forbidden", err)
	}
	s := startUpload(t, ctx, conn, rc, "own.csv", 10)
	if _, err := PutImportUploadChunk(ctx, planner, s.ID, 0, 10, strings.NewReader("0123456789")); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner chunk: got %v, want forbidden", err)
	}
	if _, err := CompleteImportUpload(ctx, conn, planner, s.ID); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner join: got %v, want forbidden", err)
	}
	if n := auditCount(tenant, "import.upload_chunk", s.ID, "denied") + auditCount(tenant, "import.upload_started", "", "denied"); n != 2 {
		t.Fatalf("%d denied upload attempts audited, want 2", n)
	}
	other, _ := adminCtx(t)
	if _, err := GetImportUpload(ctx, other, s.ID); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("another customer's admin: got %v, want not found", err)
	}
	check(t, CancelImportUpload(ctx, rc, s.ID))
}

// auditCount: memory-store events ("" any entity).
func auditCount(tenant, action, entity, outcome string) int {
	n := 0
	for _, e := range auditlog.AllEvents() {
		if e.TenantID == tenant && e.Action == action && e.Outcome == outcome && (entity == "" || (e.EntityID != nil && *e.EntityID == entity)) {
			n++
		}
	}
	return n
}

// peakHeap samples HeapAlloc until stop.
func peakHeap(stop <-chan struct{}) *atomic.Uint64 {
	var peak atomic.Uint64
	go func() {
		var m runtime.MemStats
		for {
			runtime.ReadMemStats(&m)
			if m.HeapAlloc > peak.Load() {
				peak.Store(m.HeapAlloc)
			}
			select {
			case <-stop:
				return
			case <-time.After(20 * time.Millisecond):
			}
		}
	}()
	return &peak
}

func TestImportUpload_200kRowsEndToEndInBoundedMemory(t *testing.T) {
	if testing.Short() {
		t.Skip("long")
	}
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)
	n := 200000
	if s := os.Getenv("OPENDISPATCH_IMPORT_TEST_ROWS"); s != "" {
		n, _ = strconv.Atoi(s)
	}
	path, size := syntheticCsvFile(t, n)
	f, err := os.Open(path)
	check(t, err)
	defer f.Close()
	runtime.GC()
	var base runtime.MemStats
	runtime.ReadMemStats(&base)
	stop := make(chan struct{})
	peak := peakHeap(stop)
	step := func(name string, t0 time.Time) { t.Logf("%s: %.1fs", name, time.Since(t0).Seconds()) }

	t0 := time.Now()
	s := startUpload(t, ctx, conn, rc, "synthetic_200k.csv", size)
	all := make([]int, s.ChunkCount)
	for i := range all {
		all[i] = i
	}
	sendChunks(t, ctx, rc, s, f, all)
	job, err := CompleteImportUpload(ctx, conn, rc, s.ID)
	check(t, err)
	step(fmt.Sprintf("upload %d bytes in %d chunks", size, s.ChunkCount), t0)
	if job.RowCount != n {
		t.Fatalf("job %+v, want %d rows", job, n)
	}
	// every step through the background path, polled
	t0 = time.Now()
	validated := runStepPolled(t, conn, rc, job.ID, StepValidate, 2*time.Second)
	step("validate (background, polled)", t0)
	if validated.RowCount != n || validated.ErrorCount != 0 {
		t.Fatalf("validated %+v, want %d rows and no errors", validated, n)
	}
	t0 = time.Now()
	var cmp ImportComparison
	stepResult(t, runStepPolled(t, conn, rc, job.ID, StepCompare, 2*time.Second), &cmp)
	step("compare (background, polled)", t0)
	if cmp.NewCount != n {
		t.Fatalf("comparison %+v, want %d new", cmp, n)
	}
	t0 = time.Now()
	var dry CutoverResult
	stepResult(t, runStepPolled(t, conn, rc, job.ID, StepDryRun, 2*time.Second), &dry)
	step("dry run (background, polled)", t0)
	if dry.WouldInsert != n || dry.BlockingIssueCount != 0 {
		t.Fatalf("dry run %+v", dry)
	}
	t0 = time.Now()
	var res CutoverResult
	cut := runStepPolled(t, conn, rc, job.ID, StepCutOver, 2*time.Second)
	stepResult(t, cut, &res)
	step("cut-over (background, polled)", t0)
	close(stop)
	if res.WouldInsert != n || cut.StepRowsDone == nil || *cut.StepRowsDone != int64(n) {
		t.Fatalf("cut-over %+v (rows done %v), want %d inserted", res, cut.StepRowsDone, n)
	}
	if count, err := caseCountLive(ctx, conn, rc.CustomerID); err != nil || count != n {
		t.Fatalf("cases held %d (%v), want %d", count, err, n)
	}
	grew := int64(peak.Load()) - int64(base.HeapAlloc)
	t.Logf("peak heap %.1f MB over the %.1f MB before (file %.1f MB)", float64(grew)/(1<<20), float64(base.HeapAlloc)/(1<<20), float64(size)/(1<<20))
	if grew > 256<<20 {
		t.Fatalf("peak heap grew %d MB, want under 256 MB", grew>>20)
	}
	var rb ImportRollbackResult
	stepResult(t, runStepPolled(t, conn, rc, job.ID, StepRollback, 2*time.Second), &rb)
	if rb.DeletedCount != n {
		t.Fatalf("rollback %+v, want %d deleted", rb, n)
	}
}
