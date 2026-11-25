// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A non-object body reaches the write's guard.
func TestDecodeAnyBodyKeepsEveryJSONValue(t *testing.T) {
	for _, raw := range []string{`{"a":1}`, `"nonsense"`, `[1,2]`, `42`, `null`} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(raw))
		if _, ok := decodeAnyBody(rec, req); !ok {
			t.Fatalf("%s: refused before the guard (%d)", raw, rec.Code)
		}
	}
	got, _ := decodeAnyBody(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/x", strings.NewReader("null")))
	if m, isMap := got.(map[string]any); !isMap || m != nil {
		t.Fatalf("null = %#v, want a nil map as decodeBody gives", got)
	}
	rec := httptest.NewRecorder()
	if _, ok := decodeAnyBody(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader("{oops"))); ok || rec.Code != http.StatusBadRequest {
		t.Fatalf("broken JSON = %v %d, want 400", ok, rec.Code)
	}
}
