// SPDX-License-Identifier: AGPL-3.0-only

// GET /health, /livez, /readyz. See health.ts.
package httpapi

import (
	"context"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// ReadyFunc returns nil when the process can serve.
type ReadyFunc func(ctx context.Context) error

var (
	readyMu     sync.RWMutex
	readyCustom ReadyFunc
)

// SetReadinessCheck replaces the default /readyz check.
func SetReadinessCheck(f ReadyFunc) {
	readyMu.Lock()
	readyCustom = f
	readyMu.Unlock()
}

func migrationsDirFromEnv() string {
	if d := os.Getenv("OPENDISPATCH_MIGRATIONS_DIR"); d != "" {
		return d
	}
	return "migrations"
}

// DefaultReadiness: database up, migration tables present.
func DefaultReadiness(conn *tenancy.Connection) ReadyFunc {
	return func(ctx context.Context) error {
		return tenancy.CheckReady(ctx, conn, migrationsDirFromEnv())
	}
}

// RegisterProbeRoutes adds /livez and a readiness path.
func RegisterProbeRoutes(mux *http.ServeMux, ready ReadyFunc, readyPaths ...string) {
	mux.HandleFunc("GET /livez", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	readyHandler := func(w http.ResponseWriter, r *http.Request) {
		check := ready
		readyMu.RLock()
		if readyCustom != nil {
			check = readyCustom
		}
		readyMu.RUnlock()
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if err := check(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready", "reason": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}
	for _, p := range readyPaths {
		mux.HandleFunc("GET "+p, readyHandler)
	}
}

// RegisterHealthRoute mirrors createHealthRoute.
func RegisterHealthRoute(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		if _, err := conn.Pool.Exec(r.Context(), `SELECT 1`); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	// /readyz is the signed-in System Health endpoint.
	RegisterProbeRoutes(mux, DefaultReadiness(conn), "/ready")
}

// NewProbeMux serves only the probes (worker).
func NewProbeMux(ready ReadyFunc) *http.ServeMux {
	mux := http.NewServeMux()
	RegisterProbeRoutes(mux, ready, "/readyz", "/ready")
	return mux
}
