// SPDX-License-Identifier: AGPL-3.0-only

// Maps tenancy errors to HTTP; see app.ts onError.
package httpapi

import (
	"errors"
	"log"
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// writeTenancyError: bad tenant id is 400, not 500.
func writeTenancyError(w http.ResponseWriter, err error) {
	var missing *tenancy.MissingTenantError
	if errors.As(err, &missing) {
		writeJSONError(w, http.StatusBadRequest, TenantHeader+" must be a uuid")
		return
	}
	log.Printf("[opendispatch-api-go] %v", err)
	writeJSONError(w, http.StatusInternalServerError, "internal error")
}
