// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func probe(t *testing.T, mux http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestLivezNeedsNoDependencies(t *testing.T) {
	rec := probe(t, NewProbeMux(func(context.Context) error { return errors.New("down") }), "/livez")
	if rec.Code != http.StatusOK {
		t.Fatalf("livez = %d, want 200", rec.Code)
	}
}

func TestReadyzReady(t *testing.T) {
	rec := probe(t, NewProbeMux(func(context.Context) error { return nil }), "/readyz")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "ready") {
		t.Fatalf("readyz = %d %s", rec.Code, rec.Body)
	}
}

func TestReadyzNotReadyGives503WithReason(t *testing.T) {
	rec := probe(t, NewProbeMux(func(context.Context) error { return errors.New("migrations not applied") }), "/readyz")
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "migrations not applied") {
		t.Fatalf("readyz = %d %s", rec.Code, rec.Body)
	}
}

func TestApiReadinessPathDoesNotClashWithSystemHealth(t *testing.T) {
	mux := http.NewServeMux()
	RegisterProbeRoutes(mux, func(context.Context) error { return nil }, "/ready")
	mux.HandleFunc("GET /readyz", func(http.ResponseWriter, *http.Request) {})
	if rec := probe(t, mux, "/ready"); rec.Code != http.StatusOK {
		t.Fatalf("ready = %d", rec.Code)
	}
}

func TestNewMuxRegistersWithoutRouteClash(t *testing.T) {
	conn, err := tenancy.OpenConnection(context.Background(), "postgres://u:p@127.0.0.1:1/none")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	mux := NewMux(conn)
	if rec := probe(t, mux, "/livez"); rec.Code != http.StatusOK {
		t.Fatalf("livez = %d", rec.Code)
	}
	if rec := probe(t, mux, "/ready"); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("ready with no database = %d, want 503", rec.Code)
	}
}

func TestSetReadinessCheckOverrides(t *testing.T) {
	SetReadinessCheck(func(context.Context) error { return errors.New("custom") })
	defer SetReadinessCheck(nil)
	rec := probe(t, NewProbeMux(func(context.Context) error { return nil }), "/readyz")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz = %d, want 503", rec.Code)
	}
}

func TestTestRoutesExistOnlyWithTheExplicitOptIn(t *testing.T) {
	t.Setenv("OPENDISPATCH_TEST_ROUTES", "")
	off := NewMux(&tenancy.Connection{})
	rec := httptest.NewRecorder()
	off.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/_internal/test/reset", nil))
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("the reset route must not exist without the opt-in, got %d", rec.Code)
	}
	t.Setenv("OPENDISPATCH_TEST_ROUTES", "1")
	on := NewMux(&tenancy.Connection{})
	rec = httptest.NewRecorder()
	on.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/_internal/test/reset", nil))
	if rec.Code == http.StatusNotFound || rec.Code == http.StatusMethodNotAllowed {
		t.Fatalf("the reset route must exist with the opt-in, got %d", rec.Code)
	}
}
