// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func errorBody(t *testing.T, err error) (int, map[string]string) {
	t.Helper()
	rec := httptest.NewRecorder()
	writeBusinessError(rec, err)
	var body map[string]string
	if e := json.Unmarshal(rec.Body.Bytes(), &body); e != nil {
		t.Fatal(e)
	}
	return rec.Code, body
}

func TestABusinessErrorWithAReasonCarriesItsCode(t *testing.T) {
	status, body := errorBody(t, dataerr.Conflict("File storage is not available.").WithReason(dataerr.ReasonStorageUnavailable))
	if status != http.StatusConflict || body["code"] != "STORAGE_UNAVAILABLE" || body["error"] != "File storage is not available." {
		t.Fatalf("got %d %v", status, body)
	}
}

func TestABusinessErrorWithoutAReasonHasNoCode(t *testing.T) {
	status, body := errorBody(t, dataerr.Invalid("Bad."))
	if _, has := body["code"]; status != http.StatusBadRequest || has {
		t.Fatalf("got %d %v", status, body)
	}
	if status, _ := errorBody(t, errors.New("boom")); status != http.StatusInternalServerError {
		t.Fatalf("plain error: %d", status)
	}
}
