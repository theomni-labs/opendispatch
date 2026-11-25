// SPDX-License-Identifier: AGPL-3.0-only

// Chunked import upload: chunks go to storage.
package business

import (
	"context"
	"fmt"
	"io"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importstorage"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// ImportUploadSession mirrors the contract type.
type ImportUploadSession struct {
	ID             string `json:"id"`
	FileName       string `json:"file_name"`
	Size           int64  `json:"size"`
	ChunkSize      int64  `json:"chunk_size"`
	ChunkCount     int    `json:"chunk_count"`
	ReceivedChunks []int  `json:"received_chunks"`
	ReceivedBytes  int64  `json:"received_bytes"`
	MappingVersion string `json:"mapping_version"`
	DataSource     string `json:"data_source"`
	CreatedAt      string `json:"created_at"`
}

// storedUpload: the session as kept in storage.
type storedUpload struct {
	ImportUploadSession
	CreatedBy string `json:"created_by"`
}

var importGuard = auditlog.Guard{ModuleID: access.ModuleAdminDataImportQuality}

// expectedChunk: the byte length of chunk i.
func (s ImportUploadSession) expectedChunk(i int) int64 {
	if i < s.ChunkCount-1 {
		return s.ChunkSize
	}
	return s.Size - int64(s.ChunkCount-1)*s.ChunkSize
}

func chunkCountOf(size, chunk int64) int {
	return int((size + chunk - 1) / chunk)
}

// CreateImportUpload starts a chunked upload.
func CreateImportUpload(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (ImportUploadSession, error) {
	return auditlog.WriteWithAudit(ctx, rc, importGuard, auditlog.WriteMeta{Action: "import.upload_started", EntityType: "import_upload"}, func(ctx context.Context) (auditlog.AuditedWrite[ImportUploadSession], error) {
		o, err := datactx.Object(body, "Import upload", []string{"file_name", "size", "mapping_version", "data_source"})
		if err != nil {
			return auditlog.AuditedWrite[ImportUploadSession]{}, err
		}
		fileName, err := datactx.String(o, "file_name", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 255})
		if err != nil {
			return auditlog.AuditedWrite[ImportUploadSession]{}, err
		}
		size, err := datactx.Int(o, "size", datactx.NumOpts{HasMin: true, Min: 1})
		if err != nil {
			return auditlog.AuditedWrite[ImportUploadSession]{}, err
		}
		if size > importstorage.MaxUploadBytes {
			return auditlog.AuditedWrite[ImportUploadSession]{}, dataerr.Invalid(fmt.Sprintf("Import: the file is larger than 1 GB (%d bytes at most).", importstorage.MaxUploadBytes))
		}
		version, err := datactx.String(o, "mapping_version", datactx.StrOpts{HasMax: true, Max: 64})
		if err != nil {
			return auditlog.AuditedWrite[ImportUploadSession]{}, err
		}
		source, _, err := datactx.OptString(o, "data_source", datactx.StrOpts{HasMax: true, Max: 32})
		if err != nil {
			return auditlog.AuditedWrite[ImportUploadSession]{}, err
		}
		meta, _, err := checkUploadMeta(ctx, conn, rc.CustomerID, ImportUploadMeta{FileName: fileName, MappingVersion: version, DataSource: source})
		if err != nil {
			return auditlog.AuditedWrite[ImportUploadSession]{}, err
		}
		chunk := int64(importstorage.UploadChunkSize)
		s := ImportUploadSession{
			ID: datactx.NewID(), FileName: meta.FileName, Size: int64(size), ChunkSize: chunk, ChunkCount: chunkCountOf(int64(size), chunk),
			ReceivedChunks: []int{}, MappingVersion: meta.MappingVersion, DataSource: meta.DataSource, CreatedAt: datactx.NowISO(),
		}
		if err := importstorage.PutUploadSession(ctx, rc.CustomerID, s.ID, storedUpload{ImportUploadSession: s, CreatedBy: rc.UserID}); err != nil {
			return auditlog.AuditedWrite[ImportUploadSession]{}, storageUnavailable("upload start", err)
		}
		id := s.ID
		return auditlog.AuditedWrite[ImportUploadSession]{
			Result: s, EntityID: &id, SummaryEn: fmt.Sprintf("Upload of %s started (%d bytes in %d chunks, %s).", s.FileName, s.Size, s.ChunkCount, s.DataSource),
			Detail: map[string]any{"bytes": s.Size, "chunk_count": s.ChunkCount, "mapping_version": s.MappingVersion, "data_source": s.DataSource},
		}, nil
	})
}

// uploadSession: stored session and chunks.
func uploadSession(ctx context.Context, rc reqctx.RequestContext, id string) (ImportUploadSession, error) {
	if _, err := importutil.RequireID(id, "Import upload"); err != nil {
		return ImportUploadSession{}, err
	}
	var stored storedUpload
	found, err := importstorage.GetUploadSession(ctx, rc.CustomerID, id, &stored)
	if err != nil {
		return ImportUploadSession{}, storageUnavailable("upload "+id, err)
	}
	if !found {
		return ImportUploadSession{}, dataerr.NotFound("Import upload not found: start the upload again.")
	}
	s := stored.ImportUploadSession
	chunks, err := importstorage.UploadChunks(ctx, rc.CustomerID, id)
	if err != nil {
		return ImportUploadSession{}, storageUnavailable("upload "+id, err)
	}
	s.ReceivedChunks, s.ReceivedBytes = []int{}, 0
	for i, n := range chunks {
		if i < s.ChunkCount && n == s.expectedChunk(i) {
			s.ReceivedChunks = append(s.ReceivedChunks, i)
			s.ReceivedBytes += n
		}
	}
	sort.Ints(s.ReceivedChunks)
	return s, nil
}

// GetImportUpload: the chunks received so far.
func GetImportUpload(ctx context.Context, rc reqctx.RequestContext, id string) (ImportUploadSession, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminDataImportQuality, access.AccessView); err != nil {
		return ImportUploadSession{}, err
	}
	return uploadSession(ctx, rc, id)
}

// PutImportUploadChunk: length -1 when unknown.
func PutImportUploadChunk(ctx context.Context, rc reqctx.RequestContext, id string, index int, length int64, body io.Reader) (ImportUploadSession, error) {
	if err := auditlog.GuardWithAudit(rc, importGuard, auditlog.WriteMeta{Action: "import.upload_chunk", EntityType: "import_upload", EntityID: &id}); err != nil {
		return ImportUploadSession{}, err
	}
	s, err := uploadSession(ctx, rc, id)
	if err != nil {
		return ImportUploadSession{}, err
	}
	if index < 0 || index >= s.ChunkCount {
		return ImportUploadSession{}, dataerr.Invalid(fmt.Sprintf("Import upload: chunk %d is outside the file (chunks 0 to %d).", index, s.ChunkCount-1))
	}
	want := s.expectedChunk(index)
	if length >= 0 && length != want {
		return ImportUploadSession{}, dataerr.Invalid(fmt.Sprintf("Import upload: chunk %d must be %d bytes, not %d.", index, want, length))
	}
	extra := &overflowReader{r: body, left: want}
	if err := importstorage.PutUploadChunk(ctx, rc.CustomerID, id, index, extra, want); err != nil {
		if extra.readErr != nil {
			return ImportUploadSession{}, fmt.Errorf("import upload: reading chunk %d: %w", index, extra.readErr)
		}
		if extra.short {
			return ImportUploadSession{}, dataerr.Invalid(fmt.Sprintf("Import upload: chunk %d is shorter than %d bytes.", index, want))
		}
		return ImportUploadSession{}, storageUnavailable("upload chunk "+id, err)
	}
	if n, _ := io.ReadFull(body, make([]byte, 1)); n > 0 {
		if err := importstorage.RemoveUploadChunk(context.WithoutCancel(ctx), rc.CustomerID, id, index); err != nil {
			return ImportUploadSession{}, storageUnavailable("upload chunk "+id, err)
		}
		return ImportUploadSession{}, dataerr.Invalid(fmt.Sprintf("Import upload: chunk %d is longer than %d bytes.", index, want))
	}
	return uploadSession(ctx, rc, id)
}

// overflowReader notes a short body or read error.
type overflowReader struct {
	r       io.Reader
	left    int64
	short   bool
	readErr error
}

func (o *overflowReader) Read(p []byte) (int, error) {
	if o.left <= 0 {
		return 0, io.EOF
	}
	if int64(len(p)) > o.left {
		p = p[:o.left]
	}
	n, err := o.r.Read(p)
	o.left -= int64(n)
	if err == io.EOF && o.left > 0 {
		o.short = true
		return n, io.ErrUnexpectedEOF
	}
	if err != nil && err != io.EOF {
		o.readErr = err
	}
	return n, err
}

// CompleteImportUpload joins the chunks into a job.
func CompleteImportUpload(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (ImportJob, error) {
	return auditlog.WriteWithAudit(ctx, rc, importGuard, uploadAudit, func(ctx context.Context) (auditlog.AuditedWrite[ImportJob], error) {
		s, err := uploadSession(ctx, rc, id)
		if err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		if missing := missingChunks(s); len(missing) > 0 {
			return auditlog.AuditedWrite[ImportJob]{}, dataerr.Conflict(fmt.Sprintf("Import upload: %d chunks have not arrived (%s): send them, then finish.", len(missing), listInts(missing, 20)))
		}
		meta, _, err := checkUploadMeta(ctx, conn, rc.CustomerID, ImportUploadMeta{FileName: s.FileName, MappingVersion: s.MappingVersion, DataSource: s.DataSource})
		if err != nil {
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		jobID := datactx.NewID()
		t0 := time.Now()
		size := s.Size
		if _, err := importstorage.ComposeUpload(ctx, rc.CustomerID, id, jobID, s.ChunkCount); err != nil {
			_ = importstorage.RemoveJob(context.WithoutCancel(ctx), rc.CustomerID, jobID)
			return auditlog.AuditedWrite[ImportJob]{}, storageUnavailable("upload join "+id, err)
		}
		lines, err := countStoredLines(ctx, rc.CustomerID, jobID)
		if err != nil {
			_ = importstorage.RemoveJob(context.WithoutCancel(ctx), rc.CustomerID, jobID)
			return auditlog.AuditedWrite[ImportJob]{}, storageUnavailable("upload count "+id, err)
		}
		at := datactx.NowISO()
		ref := importstorage.SourceRef(rc.CustomerID, jobID)
		job := ImportJob{
			BaseRecord: datactx.NewRecord(rc, jobID, at), FileName: meta.FileName, MappingVersion: meta.MappingVersion, Status: "uploaded",
			RowCount: max(lines-1, 0), StorageRef: &ref,
		}
		job.DataSource = meta.DataSource
		if err := upsertImportJob(ctx, conn, rc.CustomerID, job); err != nil {
			_ = importstorage.RemoveJob(context.WithoutCancel(ctx), rc.CustomerID, jobID)
			return auditlog.AuditedWrite[ImportJob]{}, err
		}
		if err := importstorage.RemoveUpload(context.WithoutCancel(ctx), rc.CustomerID, id); err != nil {
			log.Printf("import upload %s: removing the chunks failed: %v", id, err)
		}
		log.Printf("import %s: joined %d chunks of %s, %d bytes, about %d rows, %s, in %.1fs", jobID, s.ChunkCount, meta.FileName, size, job.RowCount, meta.DataSource, time.Since(t0).Seconds())
		return auditlog.AuditedWrite[ImportJob]{
			Result: job, EntityID: &jobID, SummaryEn: fmt.Sprintf("Import file %s uploaded (about %d rows, %s).", meta.FileName, job.RowCount, meta.DataSource),
			Detail: map[string]any{"mapping_version": meta.MappingVersion, "row_count": job.RowCount, "bytes": size, "data_source": meta.DataSource, "upload_id": id, "chunk_count": s.ChunkCount},
		}, nil
	})
}

// CancelImportUpload removes what was received.
func CancelImportUpload(ctx context.Context, rc reqctx.RequestContext, id string) error {
	_, err := auditlog.WriteWithAudit(ctx, rc, importGuard, auditlog.WriteMeta{Action: "import.upload_cancelled", EntityType: "import_upload", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[struct{}], error) {
		s, err := uploadSession(ctx, rc, id)
		if err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		if err := importstorage.RemoveUpload(ctx, rc.CustomerID, id); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, storageUnavailable("upload cancel "+id, err)
		}
		return auditlog.AuditedWrite[struct{}]{
			SummaryEn: fmt.Sprintf("Upload of %s cancelled (%d of %d chunks received).", s.FileName, len(s.ReceivedChunks), s.ChunkCount),
			Detail:    map[string]any{"bytes": s.Size, "received_bytes": s.ReceivedBytes},
		}, nil
	})
	return err
}

func missingChunks(s ImportUploadSession) []int {
	have := make(map[int]bool, len(s.ReceivedChunks))
	for _, i := range s.ReceivedChunks {
		have[i] = true
	}
	var out []int
	for i := 0; i < s.ChunkCount; i++ {
		if !have[i] {
			out = append(out, i)
		}
	}
	return out
}

func listInts(ns []int, most int) string {
	parts := make([]string, 0, min(len(ns), most))
	for _, n := range ns[:min(len(ns), most)] {
		parts = append(parts, fmt.Sprint(n))
	}
	if len(ns) > most {
		parts = append(parts, "...")
	}
	return strings.Join(parts, ", ")
}

// UploadMaxAge: unfinished sessions older go.
const UploadMaxAge = 24 * time.Hour

// SweepImportUploads drops sessions not finished.
func SweepImportUploads(ctx context.Context, now time.Time) (int, error) {
	n, err := importstorage.SweepUploads(ctx, now.Add(-UploadMaxAge))
	if n > 0 {
		log.Printf("import uploads: %d unfinished session(s) older than %s removed", n, UploadMaxAge)
	}
	return n, err
}

// SweepImportUploadsEvery runs the sweep on a timer.
func SweepImportUploadsEvery(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		if _, err := SweepImportUploads(ctx, time.Now()); err != nil && ctx.Err() == nil {
			log.Printf("import uploads: sweep: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// countStoredLines streams the joined file once.
func countStoredLines(ctx context.Context, tenantID, jobID string) (int, error) {
	src, err := importstorage.OpenSource(ctx, tenantID, jobID)
	if err != nil {
		return 0, err
	}
	if src == nil {
		return 0, fmt.Errorf("joined file %s is missing", jobID)
	}
	defer src.Close()
	counter := &lineCounter{r: src}
	if _, err := io.Copy(io.Discard, counter); err != nil {
		return 0, err
	}
	return counter.lines, nil
}
