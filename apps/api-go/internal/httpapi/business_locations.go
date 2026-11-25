// SPDX-License-Identifier: AGPL-3.0-only

// admin.locations / platform.records HTTP routes.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// writeBusinessError: dataerr code to HTTP status.
func writeBusinessError(w http.ResponseWriter, err error) {
	de, ok := err.(*dataerr.DataError)
	if !ok {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	status := http.StatusBadRequest
	switch de.Code {
	case dataerr.CodeUnauthenticated:
		status = http.StatusUnauthorized
	case dataerr.CodeForbidden:
		status = http.StatusForbidden
	case dataerr.CodeNotFound:
		status = http.StatusNotFound
	case dataerr.CodeConflict:
		status = http.StatusConflict
	case dataerr.CodeInvalid:
		status = http.StatusBadRequest
	}
	if de.Reason != "" {
		writeJSON(w, status, map[string]string{"error": de.Message, "code": de.Reason})
		return
	}
	writeJSONError(w, status, de.Message)
}

// decodeAnyBody: the write checks the shape.
func decodeAnyBody(w http.ResponseWriter, r *http.Request) (any, bool) {
	var body any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeJSONError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("The request body is larger than %d bytes.", tooBig.Limit))
			return nil, false
		}
		writeJSONError(w, http.StatusBadRequest, "The request body is not valid JSON.")
		return nil, false
	}
	if body == nil {
		return map[string]any(nil), true // as decodeBody does
	}
	return body, true
}

func decodeBody(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "The request body is not valid JSON.")
		return nil, false
	}
	return body, true
}

// RegisterLocationsRoutes: cities, zones and points.
func RegisterLocationsRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /cities", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListCities(r.Context(), conn, rc, business.CityQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), Q: q.Get("q")})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /cities", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.CreateCity(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("GET /cities/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetCity(r.Context(), conn, rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("PUT /cities/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.UpdateCity(r.Context(), conn, rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("GET /zones", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListZones(r.Context(), conn, rc, business.ZoneQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), CityID: q.Get("city_id"), Q: q.Get("q")})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /zones", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.CreateZone(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("GET /zones/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetZone(r.Context(), conn, rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("PUT /zones/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.UpdateZone(r.Context(), conn, rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("GET /sub-zones", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListSubZones(r.Context(), conn, rc, business.SubZoneQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), ZoneID: q.Get("zone_id"), Q: q.Get("q")})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /sub-zones", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.CreateSubZone(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("GET /sub-zones/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetSubZone(r.Context(), conn, rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("PUT /sub-zones/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.UpdateSubZone(r.Context(), conn, rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("GET /standby-points", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListStandbyPoints(r.Context(), conn, rc, business.StandbyPointQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), ZoneID: q.Get("zone_id")})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /locations/import", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.ImportLocations(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("POST /standby-points", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.CreateStandbyPoint(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("PUT /standby-points/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.UpdateStandbyPoint(r.Context(), conn, rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("DELETE /standby-points/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		if err := business.DeleteStandbyPoint(r.Context(), conn, rc, r.PathValue("id")); err != nil {
			writeBusinessError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
