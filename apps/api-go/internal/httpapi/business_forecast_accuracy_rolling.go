// SPDX-License-Identifier: AGPL-3.0-only

// Rolling forecast accuracy route (openapi.yaml).
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterRollingAccuracyRoutes: GET /models/accuracy.
func RegisterRollingAccuracyRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /models/accuracy", forecastGet(conn, func(r *http.Request, rc reqctx.RequestContext) (business.RollingForecastAccuracy, error) {
		return business.GetRollingForecastAccuracy(r.Context(), conn, rc)
	}))
}
