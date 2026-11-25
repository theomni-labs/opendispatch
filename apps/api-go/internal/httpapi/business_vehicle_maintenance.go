// SPDX-License-Identifier: AGPL-3.0-only

// Vehicle maintenance windows (admin.agents_vehicles).
package httpapi

import (
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterVehicleMaintenanceRoutes: list, add, remove.
func RegisterVehicleMaintenanceRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /vehicle-maintenance", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListVehicleMaintenance(r.Context(), conn, rc, business.VehicleMaintenanceQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), VehicleID: q.Get("vehicle_id"), ActiveOn: q.Get("active_on"),
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /vehicle-maintenance", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.CreateVehicleMaintenance(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("DELETE /vehicle-maintenance/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		if err := business.DeleteVehicleMaintenance(r.Context(), conn, rc, r.PathValue("id")); err != nil {
			writeBusinessError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
