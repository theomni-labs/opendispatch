// SPDX-License-Identifier: AGPL-3.0-only

// admin.data_import_quality HTTP routes.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"strconv"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func pageQueryOf(r *http.Request) datactx.PageQuery {
	q := r.URL.Query()
	return datactx.PageQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")}
}

// RegisterImportsRoutes: mappings, jobs, issues and the upload-to-cut-over flow.
func RegisterImportsRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /imports/mappings", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.ListImportMappings(r.Context(), conn, rc, pageQueryOf(r))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /imports/mappings", forecastWrite(conn, http.StatusCreated, func(r *http.Request, rc reqctx.RequestContext, body any) (business.ImportMappingInfo, error) {
		return business.CreateImportMapping(r.Context(), conn, rc, body)
	}))
	mux.HandleFunc("GET /imports", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.ListImportJobs(r.Context(), conn, rc, pageQueryOf(r))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /imports", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		var result business.ImportJob
		var err error
		if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt == "multipart/form-data" {
			r.Body = http.MaxBytesReader(w, r.Body, importMaxBytes())
			result, err = uploadMultipart(r, conn, rc)
		} else {
			r.Body = http.MaxBytesReader(w, r.Body, maxImportJSONBytes)
			body, ok := decodeAnyBody(w, r)
			if !ok {
				return
			}
			result, err = business.UploadImport(r.Context(), conn, rc, body)
		}
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				writeJSONError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("The file is larger than %d bytes (OPENDISPATCH_IMPORT_MAX_BYTES).", tooBig.Limit))
				return
			}
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /imports/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetImportJob(r.Context(), conn, rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /imports/{id}/issues", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.ListImportIssues(r.Context(), conn, rc, r.PathValue("id"), pageQueryOf(r))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	post := func(path string, run func(r *http.Request, rc reqctx.RequestContext, id string) (any, error)) {
		mux.HandleFunc("POST "+path, func(w http.ResponseWriter, r *http.Request) {
			rc, ok := requireContext(w, r, conn)
			if !ok {
				return
			}
			if err := business.RefuseWhileStepRunning(r.Context(), conn, rc, r.PathValue("id")); err != nil {
				writeBusinessError(w, err)
				return
			}
			result, err := run(r, rc, r.PathValue("id"))
			if err != nil {
				writeBusinessError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, result)
		})
	}
	post("/imports/{id}/validate", func(r *http.Request, rc reqctx.RequestContext, id string) (any, error) {
		return business.ValidateImport(r.Context(), conn, rc, id)
	})
	post("/imports/{id}/compare", func(r *http.Request, rc reqctx.RequestContext, id string) (any, error) {
		return business.CompareImport(r.Context(), conn, rc, id)
	})
	post("/imports/{id}/cutover/dry-run", func(r *http.Request, rc reqctx.RequestContext, id string) (any, error) {
		return business.DryRunCutover(r.Context(), conn, rc, id)
	})
	post("/imports/{id}/cutover", func(r *http.Request, rc reqctx.RequestContext, id string) (any, error) {
		return business.ExecuteCutover(r.Context(), conn, rc, id)
	})
	post("/imports/{id}/rollback", func(r *http.Request, rc reqctx.RequestContext, id string) (any, error) {
		return business.RollbackImport(r.Context(), conn, rc, id)
	})

	mux.HandleFunc("GET /data-quality/issues", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListDataQualityIssues(r.Context(), conn, rc, business.DataQualityIssueQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), Status: q.Get("status"), Severity: q.Get("severity"), ImportJobID: q.Get("import_job_id"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("PUT /data-quality/issues/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.UpdateDataQualityIssue(r.Context(), conn, rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}

// maxImportJSONBytes: the JSON upload's body cap.
const maxImportJSONBytes = 40 << 20

// importMaxBytes: the multipart upload's body cap.
func importMaxBytes() int64 {
	if n, err := strconv.ParseInt(os.Getenv("OPENDISPATCH_IMPORT_MAX_BYTES"), 10, 64); err == nil && n > 0 {
		return n
	}
	return 2 << 30
}

// uploadMultipart streams the file part.
func uploadMultipart(r *http.Request, conn *tenancy.Connection, rc reqctx.RequestContext) (business.ImportJob, error) {
	mr, err := r.MultipartReader()
	if err != nil {
		return business.ImportJob{}, dataerr.Invalid("Import: the upload is not a valid multipart form.")
	}
	meta := business.ImportUploadMeta{}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			return business.ImportJob{}, dataerr.Invalid("Import: the form has no file part (send mapping_version and data_source before file).")
		}
		if err != nil {
			return business.ImportJob{}, err
		}
		switch part.FormName() {
		case "file":
			if meta.FileName == "" {
				meta.FileName = part.FileName()
			}
			defer part.Close()
			return business.UploadImportFile(r.Context(), conn, rc, meta, part)
		case "mapping_version", "data_source", "file_name":
			b, err := io.ReadAll(io.LimitReader(part, 256))
			if err != nil {
				return business.ImportJob{}, err
			}
			v := string(b)
			switch part.FormName() {
			case "mapping_version":
				meta.MappingVersion = v
			case "data_source":
				meta.DataSource = v
			default:
				meta.FileName = v
			}
		default:
			return business.ImportJob{}, dataerr.Invalid(fmt.Sprintf("Import: unknown form field %q.", part.FormName()))
		}
	}
}
