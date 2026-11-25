// SPDX-License-Identifier: AGPL-3.0-only

// admin.agents_vehicles / platform.records HTTP routes.
// Matches openapi.yaml; calls internal/business.
package httpapi

import (
	"net/http"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RegisterPeopleRoutes: agents, their skills, vehicles.
func RegisterPeopleRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /agents", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		var isActive *bool
		if raw := q.Get("is_active"); raw != "" {
			v := raw == "true"
			isActive = &v
		}
		result, err := business.ListAgents(r.Context(), conn, rc, business.AgentQuery{
			Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), ZoneID: q.Get("zone_id"), Q: q.Get("q"), Kind: q.Get("kind"), IsActive: isActive,
		})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /agents", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.CreateAgent(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("POST /agents/import", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.ImportAgents(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("GET /agents/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetAgent(r.Context(), conn, rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("PUT /agents/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.UpdateAgent(r.Context(), conn, rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /agent-skills", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		var ids []string
		if q.Has("agent_ids") {
			ids = strings.Split(q.Get("agent_ids"), ",")
		}
		result, err := business.ListAllAgentSkills(r.Context(), conn, rc, business.AllAgentSkillQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), AgentIDs: ids})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /agents/{id}/skills", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		result, err := business.ListAgentSkills(r.Context(), conn, rc, r.PathValue("id"), business.AgentSkillQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor")})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("PUT /agents/{id}/skills", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.SetAgentSkills(r.Context(), conn, rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /skills", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.AddSkill(rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("PATCH /skills/{code}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.UpdateSkill(rc, r.PathValue("code"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("DELETE /skills/{code}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		if err := business.RemoveSkill(r.Context(), conn, rc, r.PathValue("code")); err != nil {
			writeBusinessError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("GET /vehicles", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		q := r.URL.Query()
		var isActive *bool
		if raw := q.Get("is_active"); raw != "" {
			v := raw == "true"
			isActive = &v
		}
		result, err := business.ListVehicles(r.Context(), conn, rc, business.VehicleQuery{Limit: parseLimit(q.Get("limit")), Cursor: q.Get("cursor"), ZoneID: q.Get("zone_id"), IsActive: isActive})
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /vehicles", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.CreateVehicle(r.Context(), conn, rc, body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, result)
	})
	mux.HandleFunc("GET /vehicles/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		result, err := business.GetVehicle(r.Context(), conn, rc, r.PathValue("id"))
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("PUT /vehicles/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, ok := requireContext(w, r, conn)
		if !ok {
			return
		}
		body, ok := decodeAnyBody(w, r)
		if !ok {
			return
		}
		result, err := business.UpdateVehicle(r.Context(), conn, rc, r.PathValue("id"), body)
		if err != nil {
			writeBusinessError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
