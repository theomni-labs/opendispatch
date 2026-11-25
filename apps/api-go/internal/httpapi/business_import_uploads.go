// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"net/http"
	"strconv"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importstorage"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterImportUploadRoutes: uploads and steps.
func RegisterImportUploadRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("POST /import-uploads", forecastWrite(conn, http.StatusCreated, func(r *http.Request, rc reqctx.RequestContext, body any) (business.ImportUploadSession, error) {
		return business.CreateImportUpload(r.Context(), conn, rc, body)
	}))
	mux.HandleFunc("GET /import-uploads/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetImportUpload(r.Context(), rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("DELETE /import-uploads/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		if err := business.CancelImportUpload(r.Context(), rc, r.PathValue("id")); err != nil {
			writeBusinessError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("PUT /import-uploads/{id}/chunks/{index}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		index, err := strconv.Atoi(r.PathValue("index"))
		if err != nil {
			writeBusinessError(w, dataerr.Invalid("Import upload: the chunk number must be a whole number."))
			return
		}
		// one byte over: refused as too long
		r.Body = http.MaxBytesReader(w, r.Body, importstorage.UploadChunkSize+1)
		result, err := business.PutImportUploadChunk(r.Context(), rc, r.PathValue("id"), index, r.ContentLength, r.Body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /imports/{id}/steps", forecastWrite(conn, http.StatusAccepted, func(r *http.Request, rc reqctx.RequestContext, body any) (business.ImportJob, error) {
		return business.StartImportStep(r.Context(), conn, rc, r.PathValue("id"), body)
	}))
	mux.HandleFunc("POST /import-uploads/{id}/complete", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.CompleteImportUpload(r.Context(), conn, rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
}
