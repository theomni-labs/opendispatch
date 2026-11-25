// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Denied writes reach the guard for any body.
func TestDecodeAnyBodyPassesEveryJSONValue(t *testing.T) {
	for _, raw := range []string{`"not an object"`, `12`, `null`, `[]`, `{"a":1}`} {
		rec := httptest.NewRecorder()
		_, ok := decodeAnyBody(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(raw)))
		if !ok || rec.Code != http.StatusOK {
			t.Fatalf("%s: ok=%v code=%d", raw, ok, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	if _, ok := decodeAnyBody(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader("{"))); ok || rec.Code != http.StatusBadRequest {
		t.Fatalf("broken JSON: ok=%v code=%d", ok, rec.Code)
	}
}
