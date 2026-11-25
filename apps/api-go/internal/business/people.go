// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors apps/web/src/lib/data/people.ts.
// Reads: platform.records (zone scoped).
// Writes: admin.agents_vehicles (Administrator).
// ImportSample: skipped (unported deps).
package business

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// Agent mirrors the contract's Agent.
type Agent struct {
	datactx.BaseRecord
	Code             string  `json:"code"`
	NameEn           string  `json:"name_en"`
	NameAr           *string `json:"name_ar"`
	Kind             string  `json:"kind"` // "field" | "remote"
	HomeZoneID       *string `json:"home_zone_id"`
	DefaultVehicleID *string `json:"default_vehicle_id"`
	IsActive         bool    `json:"is_active"`
	// EligibleShiftPatternIDs: nil is any of the kind
	EligibleShiftPatternIDs []string       `json:"eligible_shift_pattern_ids"`
	AnnualLeaveDays         *int           `json:"annual_leave_days"`
	Extra                   map[string]any `json:"extra"`
}

// Vehicle mirrors the contract's Vehicle.
type Vehicle struct {
	datactx.BaseRecord
	Code        string         `json:"code"`
	PlateNumber string         `json:"plate_number"`
	ZoneID      *string        `json:"zone_id"`
	IsActive    bool           `json:"is_active"`
	Extra       map[string]any `json:"extra"`
}

// AgentSkill mirrors the contract type.
type AgentSkill struct {
	datactx.BaseRecord
	AgentID   string `json:"agent_id"`
	SkillCode string `json:"skill_code"`
}

// AgentImportResult mirrors the contract type.
type AgentImportResult struct {
	Agents int `json:"agents"`
	Skills int `json:"skills"`
}

var agentKinds = []string{"field", "remote"}

// Reads

func allAgents(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]Agent, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]Agent, error) {
		elig, err := eligibilityTx(ctx, tx)
		if err != nil {
			return nil, err
		}
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, code, name_en, name_ar, kind, home_zone_id, default_vehicle_id, is_active, annual_leave_days, extra FROM agents ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Agent
		for rows.Next() {
			var s Agent
			var createdAt, updatedAt time.Time
			var extraRaw []byte
			if err := rows.Scan(&s.ID, &s.TenantID, &createdAt, &updatedAt, &s.CreatedBy, &s.DataSource, &s.Code, &s.NameEn, &s.NameAr, &s.Kind, &s.HomeZoneID, &s.DefaultVehicleID, &s.IsActive, &s.AnnualLeaveDays, &extraRaw); err != nil {
				return nil, err
			}
			s.CreatedAt, s.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			if s.Extra, err = scanExtra(extraRaw); err != nil {
				return nil, err
			}
			s.EligibleShiftPatternIDs = elig[s.ID]
			out = append(out, s)
		}
		return out, rows.Err()
	})
}

// eligibilityTx: pattern ids by agent, sorted.
func eligibilityTx(ctx context.Context, tx pgx.Tx) (map[string][]string, error) {
	rows, err := tx.Query(ctx, `SELECT agent_id::text, shift_pattern_id::text FROM agent_shift_eligibility ORDER BY agent_id, shift_pattern_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var sid, pid string
		if err := rows.Scan(&sid, &pid); err != nil {
			return nil, err
		}
		out[sid] = append(out[sid], pid)
	}
	return out, rows.Err()
}

func allVehicles(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]Vehicle, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]Vehicle, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, code, plate_number, zone_id, is_active, extra FROM vehicles ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Vehicle
		for rows.Next() {
			var v Vehicle
			var createdAt, updatedAt time.Time
			var extraRaw []byte
			if err := rows.Scan(&v.ID, &v.TenantID, &createdAt, &updatedAt, &v.CreatedBy, &v.DataSource, &v.Code, &v.PlateNumber, &v.ZoneID, &v.IsActive, &extraRaw); err != nil {
				return nil, err
			}
			v.CreatedAt, v.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			if v.Extra, err = scanExtra(extraRaw); err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, rows.Err()
	})
}

func allAgentSkills(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]AgentSkill, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]AgentSkill, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, agent_id, skill_code FROM agent_skills ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []AgentSkill
		for rows.Next() {
			var k AgentSkill
			var createdAt, updatedAt time.Time
			if err := rows.Scan(&k.ID, &k.TenantID, &createdAt, &updatedAt, &k.CreatedBy, &k.DataSource, &k.AgentID, &k.SkillCode); err != nil {
				return nil, err
			}
			k.CreatedAt, k.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			out = append(out, k)
		}
		return out, rows.Err()
	})
}

func oneAgent(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*Agent, error) {
	rows, err := allAgents(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	for _, s := range rows {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, nil
}

func oneVehicle(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*Vehicle, error) {
	rows, err := allVehicles(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	for _, v := range rows {
		if v.ID == id {
			return &v, nil
		}
	}
	return nil, nil
}

// readableAgents mirrors readableAgents.
func readableAgents(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) ([]Agent, error) {
	rows, err := allAgents(ctx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	var out []Agent
	for _, s := range rows {
		if reqctx.CanReadZone(rc, s.HomeZoneID) {
			out = append(out, s)
		}
	}
	return out, nil
}

// AgentQuery mirrors listAgents' query.
type AgentQuery struct {
	Limit    int
	Cursor   string
	ZoneID   string
	Q        string
	Kind     string
	IsActive *bool
}

// ListAgents mirrors listAgents.
func ListAgents(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query AgentQuery) (datactx.PageResult[Agent], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[Agent]{}, err
	}
	rows, err := readableAgents(ctx, conn, rc)
	if err != nil {
		return datactx.PageResult[Agent]{}, err
	}
	var filtered []Agent
	for _, s := range rows {
		if query.ZoneID != "" && (s.HomeZoneID == nil || *s.HomeZoneID != query.ZoneID) {
			continue
		}
		if query.Kind != "" && s.Kind != query.Kind {
			continue
		}
		if query.IsActive != nil && s.IsActive != *query.IsActive {
			continue
		}
		ar := ""
		if s.NameAr != nil {
			ar = *s.NameAr
		}
		if datactx.MatchesText(s.NameEn+" "+ar+" "+s.Code, query.Q) {
			filtered = append(filtered, s)
		}
	}
	return datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// GetAgent mirrors getAgent.
func GetAgent(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (*Agent, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return nil, err
	}
	if _, err := importutil.RequireID(id, "Agent"); err != nil {
		return nil, err
	}
	rows, err := readableAgents(ctx, conn, rc)
	if err != nil {
		return nil, err
	}
	for _, s := range rows {
		if s.ID == id {
			return &s, nil
		}
	}
	return datactx.RequireFound[Agent](nil, "Agent")
}

// AgentSkillQuery: listAgentSkills' query.
type AgentSkillQuery struct {
	Limit  int
	Cursor string
}

// ListAgentSkills mirrors listAgentSkills.
func ListAgentSkills(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, agentID string, query AgentSkillQuery) (datactx.PageResult[AgentSkill], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[AgentSkill]{}, err
	}
	if _, err := importutil.RequireID(agentID, "Agent"); err != nil {
		return datactx.PageResult[AgentSkill]{}, err
	}
	agent, err := GetAgent(ctx, conn, rc, agentID)
	if err != nil {
		return datactx.PageResult[AgentSkill]{}, err
	}
	rows, err := allAgentSkills(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[AgentSkill]{}, err
	}
	var filtered []AgentSkill
	for _, k := range rows {
		if k.AgentID == agent.ID {
			filtered = append(filtered, k)
		}
	}
	return datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// AllAgentSkillQuery: listAllAgentSkills.
type AllAgentSkillQuery struct {
	Limit  int
	Cursor string
	// AgentIDs: nil means every agent.
	AgentIDs []string
}

// MaxAgentSkillIDs: most agent ids asked.
const MaxAgentSkillIDs = 200

// ListAllAgentSkills: skills of many agents.
func ListAllAgentSkills(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query AllAgentSkillQuery) (datactx.PageResult[AgentSkill], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[AgentSkill]{}, err
	}
	var wanted map[string]bool
	if query.AgentIDs != nil {
		if len(query.AgentIDs) < 1 || len(query.AgentIDs) > MaxAgentSkillIDs {
			return datactx.PageResult[AgentSkill]{}, dataerr.Invalid(fmt.Sprintf("Agent ids: ask for 1 to %d ids at a time.", MaxAgentSkillIDs))
		}
		wanted = map[string]bool{}
		for _, id := range query.AgentIDs {
			if _, err := importutil.RequireID(id, "Agent"); err != nil {
				return datactx.PageResult[AgentSkill]{}, err
			}
			wanted[id] = true
		}
	}
	agents, err := readableAgents(ctx, conn, rc)
	if err != nil {
		return datactx.PageResult[AgentSkill]{}, err
	}
	readable := make(map[string]bool, len(agents))
	for _, s := range agents {
		readable[s.ID] = true
	}
	rows, err := allAgentSkills(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[AgentSkill]{}, err
	}
	filtered := []AgentSkill{}
	for _, k := range rows {
		if readable[k.AgentID] && (wanted == nil || wanted[k.AgentID]) {
			filtered = append(filtered, k)
		}
	}
	return datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// VehicleQuery mirrors listVehicles' query.
type VehicleQuery struct {
	Limit    int
	Cursor   string
	ZoneID   string
	IsActive *bool
}

// ListVehicles mirrors listVehicles.
func ListVehicles(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query VehicleQuery) (datactx.PageResult[Vehicle], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[Vehicle]{}, err
	}
	rows, err := allVehicles(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[Vehicle]{}, err
	}
	var filtered []Vehicle
	for _, v := range rows {
		if !reqctx.CanReadZone(rc, v.ZoneID) {
			continue
		}
		if query.ZoneID != "" && (v.ZoneID == nil || *v.ZoneID != query.ZoneID) {
			continue
		}
		if query.IsActive != nil && v.IsActive != *query.IsActive {
			continue
		}
		filtered = append(filtered, v)
	}
	return datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// GetVehicle mirrors getVehicle.
func GetVehicle(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (*Vehicle, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return nil, err
	}
	if _, err := importutil.RequireID(id, "Vehicle"); err != nil {
		return nil, err
	}
	vehicle, err := oneVehicle(ctx, conn, rc.CustomerID, id)
	if err != nil {
		return nil, err
	}
	if _, err := datactx.RequireFound(vehicle, "Vehicle"); err != nil {
		return nil, err
	}
	if !reqctx.CanReadZone(rc, vehicle.ZoneID) {
		return datactx.RequireFound[Vehicle](nil, "Vehicle")
	}
	return vehicle, nil
}

// Writes (admin.agents_vehicles)

var agentKeys = []string{"code", "name_en", "name_ar", "kind", "home_zone_id", "default_vehicle_id", "is_active", "eligible_shift_pattern_ids", "annual_leave_days", "extra"}

func agentFrom(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any, existing *Agent) (Agent, error) {
	var zero Agent
	input, err := datactx.Object(body, "Agent", agentKeys)
	if err != nil {
		return zero, err
	}
	code, err := datactx.String(input, "code", datactx.StrOpts{Min: 1, Max: 32, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	all, err := allAgents(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	for _, s := range all {
		existingID := ""
		if existing != nil {
			existingID = existing.ID
		}
		if s.Code == code && s.ID != existingID {
			return zero, dataerr.Conflict("Agent code " + code + " is already used.")
		}
	}
	kind, err := datactx.EnumOf(input, "kind", agentKinds)
	if err != nil {
		return zero, err
	}
	homeZone, err := datactx.NullableUUID(input, "home_zone_id")
	if err != nil {
		return zero, err
	}
	if homeZone != nil {
		zone, err := oneZone(ctx, conn, rc.CustomerID, *homeZone)
		if err != nil {
			return zero, err
		}
		if _, err := datactx.RequireFound(zone, "Zone"); err != nil {
			return zero, err
		}
		if err := reqctx.RequireWriteZone(rc, homeZone); err != nil {
			return zero, err
		}
	} else if kind == "field" {
		return zero, dataerr.Invalid("Agent: a field agent needs a home_zone_id.")
	}
	vehicleID, err := datactx.NullableUUID(input, "default_vehicle_id")
	if err != nil {
		return zero, err
	}
	if vehicleID != nil {
		vehicle, err := oneVehicle(ctx, conn, rc.CustomerID, *vehicleID)
		if err != nil {
			return zero, err
		}
		if _, err := datactx.RequireFound(vehicle, "Vehicle"); err != nil {
			return zero, err
		}
	}
	at := datactx.NowISO()
	var base datactx.BaseRecord
	if existing == nil {
		base = datactx.NewRecord(rc, "", at)
	} else {
		base = existing.BaseRecord
		base.UpdatedAt = at
	}
	nameEn, err := datactx.String(input, "name_en", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	nameAr, err := datactx.NullableString(input, "name_ar", datactx.StrOpts{Max: 120, HasMax: true})
	if err != nil {
		return zero, err
	}
	isActive, hasActive, err := datactx.OptBool(input, "is_active")
	if err != nil {
		return zero, err
	}
	if !hasActive {
		isActive = true
	}
	extra, err := extraOf(input)
	if err != nil {
		return zero, err
	}
	out := Agent{BaseRecord: base, Code: code, NameEn: nameEn, NameAr: nameAr, Kind: kind, HomeZoneID: homeZone, DefaultVehicleID: vehicleID, IsActive: isActive, Extra: extra}
	if existing != nil {
		out.EligibleShiftPatternIDs, out.AnnualLeaveDays = existing.EligibleShiftPatternIDs, existing.AnnualLeaveDays
	}
	if datactx.Has(input, "annual_leave_days") {
		if out.AnnualLeaveDays, err = nullableDays(input); err != nil {
			return zero, err
		}
	}
	if datactx.Has(input, "eligible_shift_pattern_ids") {
		if out.EligibleShiftPatternIDs, err = eligibleOf(ctx, conn, rc.CustomerID, input, kind); err != nil {
			return zero, err
		}
	} else if existing != nil && existing.Kind != kind {
		out.EligibleShiftPatternIDs = nil
	}
	return out, nil
}

// nullableDays: annual_leave_days, 0 to 365.
func nullableDays(input datactx.Obj) (*int, error) {
	if input["annual_leave_days"] == nil {
		return nil, nil
	}
	n, err := datactx.Int(input, "annual_leave_days", datactx.NumOpts{Min: 0, Max: 365, HasMin: true, HasMax: true})
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// maxEligiblePatterns: contract maxItems.
const maxEligiblePatterns = 50

// eligibleOf: known patterns of the kind, or nil.
func eligibleOf(ctx context.Context, conn *tenancy.Connection, tenant string, input datactx.Obj, kind string) ([]string, error) {
	if input["eligible_shift_pattern_ids"] == nil {
		return nil, nil
	}
	ids, err := datactx.UUIDList(input, "eligible_shift_pattern_ids", false)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 || len(ids) > maxEligiblePatterns {
		return nil, dataerr.Invalid(fmt.Sprintf("Agent: eligible_shift_pattern_ids needs 1 to %d patterns, or null for any.", maxEligiblePatterns))
	}
	patterns, err := allShiftPatterns(ctx, conn, tenant)
	if err != nil {
		return nil, err
	}
	kinds := map[string]string{}
	for _, p := range patterns {
		kinds[p.ID] = string(p.Kind)
	}
	for _, id := range ids {
		k, ok := kinds[id]
		if !ok {
			return nil, dataerr.NotFound("Shift pattern " + id + " not found.")
		}
		if k != kind {
			return nil, dataerr.Invalid("Agent: shift pattern " + id + " is for " + k + " agents.")
		}
	}
	sort.Strings(ids)
	return ids, nil
}

func upsertAgentTx(ctx context.Context, tx pgx.Tx, s Agent) error {
	_, err := tx.Exec(ctx, `INSERT INTO agents (tenant_id, id, data_source, created_at, updated_at, created_by, code, name_en, name_ar, kind, home_zone_id, default_vehicle_id, is_active, extra, annual_leave_days)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, code=$7, name_en=$8, name_ar=$9, kind=$10, home_zone_id=$11, default_vehicle_id=$12, is_active=$13, extra=$14, annual_leave_days=$15`,
		s.TenantID, s.ID, s.DataSource, s.CreatedAt, s.UpdatedAt, s.CreatedBy, s.Code, s.NameEn, s.NameAr, s.Kind, s.HomeZoneID, s.DefaultVehicleID, s.IsActive, s.Extra, s.AnnualLeaveDays)
	if err != nil {
		return err
	}
	return syncEligibilityTx(ctx, tx, s)
}

// syncEligibilityTx: rows equal the agent's list.
func syncEligibilityTx(ctx context.Context, tx pgx.Tx, s Agent) error {
	ids := s.EligibleShiftPatternIDs
	if ids == nil {
		ids = []string{}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM agent_shift_eligibility WHERE agent_id = $1::uuid AND NOT (shift_pattern_id::text = ANY($2::text[]))`, s.ID, ids); err != nil {
		return err
	}
	for _, pid := range ids {
		if _, err := tx.Exec(ctx, `INSERT INTO agent_shift_eligibility (tenant_id, data_source, created_by, agent_id, shift_pattern_id)
			VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3::uuid, $4::uuid) ON CONFLICT (tenant_id, agent_id, shift_pattern_id) DO NOTHING`,
			s.DataSource, s.CreatedBy, s.ID, pid); err != nil {
			return err
		}
	}
	return nil
}

func upsertAgent(ctx context.Context, conn *tenancy.Connection, tenantID string, s Agent) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, upsertAgentTx(ctx, tx, s)
	})
	return err
}

// CreateAgent mirrors createAgent.
func CreateAgent(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (Agent, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminAgentsVehicles}, auditlog.WriteMeta{Action: "agent.created", EntityType: "agent"}, func(ctx context.Context) (auditlog.AuditedWrite[Agent], error) {
		agent, err := agentFrom(ctx, conn, rc, body, nil)
		if err != nil {
			return auditlog.AuditedWrite[Agent]{}, err
		}
		if err := upsertAgent(ctx, conn, rc.CustomerID, agent); err != nil {
			return auditlog.AuditedWrite[Agent]{}, err
		}
		id := agent.ID
		return auditlog.AuditedWrite[Agent]{Result: agent, EntityID: &id, SummaryEn: "Agent " + agent.Code + " created.", Detail: sumDetail(nil, map[string]any{"code": agent.Code})}, nil
	})
}

// UpdateAgent mirrors updateAgent.
func UpdateAgent(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (Agent, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminAgentsVehicles}, auditlog.WriteMeta{Action: "agent.updated", EntityType: "agent", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[Agent], error) {
		if _, err := importutil.RequireID(id, "Agent"); err != nil {
			return auditlog.AuditedWrite[Agent]{}, err
		}
		existing, err := oneAgent(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[Agent]{}, err
		}
		if _, err := datactx.RequireFound(existing, "Agent"); err != nil {
			return auditlog.AuditedWrite[Agent]{}, err
		}
		// Only the EXISTING zone is checked (matches TS).
		if existing.HomeZoneID != nil {
			if err := reqctx.RequireWriteZone(rc, existing.HomeZoneID); err != nil {
				return auditlog.AuditedWrite[Agent]{}, err
			}
		}
		agent, err := agentFrom(ctx, conn, rc, body, existing)
		if err != nil {
			return auditlog.AuditedWrite[Agent]{}, err
		}
		if err := upsertAgent(ctx, conn, rc.CustomerID, agent); err != nil {
			return auditlog.AuditedWrite[Agent]{}, err
		}
		return auditlog.AuditedWrite[Agent]{Result: agent, SummaryEn: "Agent " + agent.Code + " updated.", Detail: sumDetail(nil, map[string]any{"code": agent.Code})}, nil
	})
}

func deleteAgentSkillRow(ctx context.Context, tx pgx.Tx, id string) error {
	_, err := tx.Exec(ctx, `DELETE FROM agent_skills WHERE id=$1`, id)
	return err
}

func insertAgentSkillTx(ctx context.Context, tx pgx.Tx, k AgentSkill) error {
	_, err := tx.Exec(ctx, `INSERT INTO agent_skills (tenant_id, id, data_source, created_at, updated_at, created_by, agent_id, skill_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		k.TenantID, k.ID, k.DataSource, k.CreatedAt, k.UpdatedAt, k.CreatedBy, k.AgentID, k.SkillCode)
	return err
}

func dedupeStrings(list []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range list {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func joinOrNone(list []string) string {
	if len(list) == 0 {
		return "none"
	}
	out := list[0]
	for _, s := range list[1:] {
		out += ", " + s
	}
	return out
}

// SetAgentSkills mirrors setAgentSkills.
func SetAgentSkills(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (datactx.PageResult[AgentSkill], error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminAgentsVehicles}, auditlog.WriteMeta{Action: "agent.skills_set", EntityType: "agent", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[datactx.PageResult[AgentSkill]], error) {
		var zero auditlog.AuditedWrite[datactx.PageResult[AgentSkill]]
		if _, err := importutil.RequireID(id, "Agent"); err != nil {
			return zero, err
		}
		agent, err := oneAgent(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return zero, err
		}
		if _, err := datactx.RequireFound(agent, "Agent"); err != nil {
			return zero, err
		}
		if agent.HomeZoneID != nil {
			if err := reqctx.RequireWriteZone(rc, agent.HomeZoneID); err != nil {
				return zero, err
			}
		}
		input, err := datactx.Object(body, "Skills", []string{"skill_codes"})
		if err != nil {
			return zero, err
		}
		rawCodes, err := datactx.StringList(input, "skill_codes", datactx.ListOpts{Max: 64, HasMax: true})
		if err != nil {
			return zero, err
		}
		codes := dedupeStrings(rawCodes)
		for _, c := range codes {
			if len(c) < 1 {
				return zero, dataerr.Invalid("Skills: skill codes may not be empty.")
			}
		}
		existingSkills, err := allAgentSkills(ctx, conn, rc.CustomerID)
		if err != nil {
			return zero, err
		}
		at := datactx.NowISO()
		created := make([]AgentSkill, len(codes))
		for i, code := range codes {
			created[i] = AgentSkill{BaseRecord: datactx.NewRecord(rc, datactx.NewID(), at), AgentID: id, SkillCode: code}
		}
		if _, err := tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			for _, old := range existingSkills {
				if old.AgentID != id {
					continue
				}
				if err := deleteAgentSkillRow(ctx, tx, old.ID); err != nil {
					return struct{}{}, err
				}
			}
			for _, k := range created {
				if err := insertAgentSkillTx(ctx, tx, k); err != nil {
					return struct{}{}, err
				}
			}
			return struct{}{}, nil
		}); err != nil {
			return zero, err
		}
		page, err := datactx.Paginate(created, datactx.PageQuery{Limit: 200})
		if err != nil {
			return zero, err
		}
		return auditlog.AuditedWrite[datactx.PageResult[AgentSkill]]{Result: page, SummaryEn: "Skills of " + agent.Code + " set to " + joinOrNone(codes) + ".", Detail: sumDetail(map[string]any{"skill_codes": codes}, map[string]any{"code": agent.Code, "skills": joinOrNone(codes)})}, nil
	})
}

var skillCodePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

// AddSkill mirrors addSkill: appends to the skills.vocabulary
// setting (DG7), the same store GetSkillVocabulary reads.
func AddSkill(rc reqctx.RequestContext, body any) (SkillInfo, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminAgentsVehicles}, auditlog.WriteMeta{Action: "skill.added", EntityType: "skill"}, func(ctx context.Context) (auditlog.AuditedWrite[SkillInfo], error) {
		var zero auditlog.AuditedWrite[SkillInfo]
		input, err := datactx.Object(body, "Skill", []string{"code", "name_en", "name_ar"})
		if err != nil {
			return zero, err
		}
		code, err := datactx.String(input, "code", datactx.StrOpts{Min: 1, Max: 64, HasMin: true, HasMax: true, Pattern: skillCodePattern})
		if err != nil {
			return zero, err
		}
		nameEn, err := datactx.String(input, "name_en", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
		if err != nil {
			return zero, err
		}
		nameAr, err := datactx.NullableString(input, "name_ar", datactx.StrOpts{Max: 120, HasMax: true})
		if err != nil {
			return zero, err
		}
		skill := SkillInfo{Code: code, NameEn: nameEn, NameAr: nameAr}
		vocabulary, err := settingsstore.Get(ctx, rc.CustomerID, "skills.vocabulary", []SkillInfo{})
		if err != nil {
			return zero, err
		}
		for _, s := range vocabulary {
			if strings.EqualFold(s.Code, skill.Code) {
				return zero, dataerr.Conflict("Skill " + skill.Code + " is already in the vocabulary.")
			}
		}
		if err := settingsstore.Put(ctx, rc.CustomerID, "skills.vocabulary", append(append([]SkillInfo{}, vocabulary...), skill)); err != nil {
			return zero, err
		}
		return auditlog.AuditedWrite[SkillInfo]{Result: skill, EntityID: &skill.Code, SummaryEn: "Skill " + skill.Code + " added to the vocabulary.", Detail: sumDetail(map[string]any{"name_en": skill.NameEn}, map[string]any{"code": skill.Code})}, nil
	})
}

// skillIndex: the vocabulary and code's place in it.
func skillIndex(ctx context.Context, tenant, code string) ([]SkillInfo, int, error) {
	if !skillCodePattern.MatchString(code) {
		return nil, -1, dataerr.Invalid("Skill: code has the wrong format.")
	}
	vocabulary, err := settingsstore.Get(ctx, tenant, "skills.vocabulary", []SkillInfo{})
	if err != nil {
		return nil, -1, err
	}
	for i, s := range vocabulary {
		if strings.EqualFold(s.Code, code) {
			return vocabulary, i, nil
		}
	}
	return nil, -1, dataerr.NotFound("Skill " + code + " is not in the vocabulary.")
}

// UpdateSkill renames a skill; its code stays.
func UpdateSkill(rc reqctx.RequestContext, code string, body any) (SkillInfo, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminAgentsVehicles}, auditlog.WriteMeta{Action: "skill.updated", EntityType: "skill", EntityID: &code}, func(ctx context.Context) (auditlog.AuditedWrite[SkillInfo], error) {
		var zero auditlog.AuditedWrite[SkillInfo]
		input, err := datactx.Object(body, "Skill", []string{"name_en", "name_ar"})
		if err != nil {
			return zero, err
		}
		if len(input) == 0 {
			return zero, dataerr.Invalid("Skill: give name_en or name_ar.")
		}
		vocabulary, i, err := skillIndex(ctx, rc.CustomerID, code)
		if err != nil {
			return zero, err
		}
		skill := vocabulary[i]
		before := skill
		if nameEn, ok, err := datactx.OptString(input, "name_en", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true}); err != nil {
			return zero, err
		} else if ok {
			if strings.TrimSpace(nameEn) == "" {
				return zero, dataerr.Invalid("Input: name_en must have at least 1 characters.")
			}
			skill.NameEn = strings.TrimSpace(nameEn)
		}
		if datactx.Has(input, "name_ar") {
			nameAr, err := datactx.NullableString(input, "name_ar", datactx.StrOpts{Max: 120, HasMax: true})
			if err != nil {
				return zero, err
			}
			if nameAr != nil && strings.TrimSpace(*nameAr) == "" {
				nameAr = nil
			} else if nameAr != nil {
				trimmed := strings.TrimSpace(*nameAr)
				nameAr = &trimmed
			}
			skill.NameAr = nameAr
		}
		next := append([]SkillInfo{}, vocabulary...)
		next[i] = skill
		if err := settingsstore.Put(ctx, rc.CustomerID, "skills.vocabulary", next); err != nil {
			return zero, err
		}
		id := skill.Code
		return auditlog.AuditedWrite[SkillInfo]{Result: skill, EntityID: &id, SummaryEn: "Skill " + skill.Code + " renamed.", Detail: sumDetail(map[string]any{"before": before, "after": skill}, map[string]any{"code": skill.Code})}, nil
	})
}

// RemoveSkill: refused while an agent holds it.
func RemoveSkill(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, code string) error {
	_, err := auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminAgentsVehicles}, auditlog.WriteMeta{Action: "skill.removed", EntityType: "skill", EntityID: &code}, func(ctx context.Context) (auditlog.AuditedWrite[struct{}], error) {
		var zero auditlog.AuditedWrite[struct{}]
		vocabulary, i, err := skillIndex(ctx, rc.CustomerID, code)
		if err != nil {
			return zero, err
		}
		skill := vocabulary[i]
		held, err := allAgentSkills(ctx, conn, rc.CustomerID)
		if err != nil {
			return zero, err
		}
		n := 0
		for _, k := range held {
			if strings.EqualFold(k.SkillCode, skill.Code) {
				n++
			}
		}
		if n > 0 {
			return zero, dataerr.Conflict(fmt.Sprintf("Skill %s is held by %d agents: take it off them first.", skill.Code, n))
		}
		next := append(append([]SkillInfo{}, vocabulary[:i]...), vocabulary[i+1:]...)
		if err := settingsstore.Put(ctx, rc.CustomerID, "skills.vocabulary", next); err != nil {
			return zero, err
		}
		id := skill.Code
		return auditlog.AuditedWrite[struct{}]{EntityID: &id, SummaryEn: "Skill " + skill.Code + " removed from the vocabulary.", Detail: sumDetail(map[string]any{"name_en": skill.NameEn}, map[string]any{"code": skill.Code})}, nil
	})
	return err
}

var vehicleKeys = []string{"code", "plate_number", "zone_id", "is_active", "extra"}

func vehicleFrom(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any, existing *Vehicle) (Vehicle, error) {
	var zero Vehicle
	input, err := datactx.Object(body, "Vehicle", vehicleKeys)
	if err != nil {
		return zero, err
	}
	code, err := datactx.String(input, "code", datactx.StrOpts{Min: 1, Max: 32, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	all, err := allVehicles(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	for _, v := range all {
		existingID := ""
		if existing != nil {
			existingID = existing.ID
		}
		if v.Code == code && v.ID != existingID {
			return zero, dataerr.Conflict("Vehicle code " + code + " is already used.")
		}
	}
	zoneID, err := datactx.UUID(input, "zone_id")
	if err != nil {
		return zero, err
	}
	zone, err := oneZone(ctx, conn, rc.CustomerID, zoneID)
	if err != nil {
		return zero, err
	}
	if _, err := datactx.RequireFound(zone, "Zone"); err != nil {
		return zero, err
	}
	if err := reqctx.RequireWriteZone(rc, &zoneID); err != nil {
		return zero, err
	}
	plate, hasPlate, err := datactx.OptString(input, "plate_number", datactx.StrOpts{Max: 16, HasMax: true})
	if err != nil {
		return zero, err
	}
	at := datactx.NowISO()
	var base datactx.BaseRecord
	plateNumber := plate
	if existing == nil {
		base = datactx.NewRecord(rc, "", at)
		// plate_number is NOT NULL in Postgres; the TS
		// source leaves it unset if omitted on create,
		// which only works against its own demo store.
	} else {
		base = existing.BaseRecord
		base.UpdatedAt = at
		if !hasPlate {
			plateNumber = existing.PlateNumber
		}
	}
	isActive, hasActive, err := datactx.OptBool(input, "is_active")
	if err != nil {
		return zero, err
	}
	if !hasActive {
		isActive = true
	}
	extra, err := extraOf(input)
	if err != nil {
		return zero, err
	}
	zid := zoneID
	return Vehicle{BaseRecord: base, Code: code, PlateNumber: plateNumber, ZoneID: &zid, IsActive: isActive, Extra: extra}, nil
}

func upsertVehicleTx(ctx context.Context, tx pgx.Tx, v Vehicle) error {
	_, err := tx.Exec(ctx, `INSERT INTO vehicles (tenant_id, id, data_source, created_at, updated_at, created_by, code, plate_number, zone_id, is_active, extra)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, code=$7, plate_number=$8, zone_id=$9, is_active=$10, extra=$11`,
		v.TenantID, v.ID, v.DataSource, v.CreatedAt, v.UpdatedAt, v.CreatedBy, v.Code, v.PlateNumber, v.ZoneID, v.IsActive, v.Extra)
	return err
}

func upsertVehicle(ctx context.Context, conn *tenancy.Connection, tenantID string, v Vehicle) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, upsertVehicleTx(ctx, tx, v)
	})
	return err
}

// CreateVehicle mirrors createVehicle.
func CreateVehicle(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (Vehicle, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminAgentsVehicles}, auditlog.WriteMeta{Action: "vehicle.created", EntityType: "vehicle"}, func(ctx context.Context) (auditlog.AuditedWrite[Vehicle], error) {
		vehicle, err := vehicleFrom(ctx, conn, rc, body, nil)
		if err != nil {
			return auditlog.AuditedWrite[Vehicle]{}, err
		}
		if err := upsertVehicle(ctx, conn, rc.CustomerID, vehicle); err != nil {
			return auditlog.AuditedWrite[Vehicle]{}, err
		}
		id := vehicle.ID
		return auditlog.AuditedWrite[Vehicle]{Result: vehicle, EntityID: &id, SummaryEn: "Vehicle " + vehicle.Code + " created.", Detail: sumDetail(nil, map[string]any{"code": vehicle.Code})}, nil
	})
}

// UpdateVehicle mirrors updateVehicle.
func UpdateVehicle(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (Vehicle, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminAgentsVehicles}, auditlog.WriteMeta{Action: "vehicle.updated", EntityType: "vehicle", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[Vehicle], error) {
		if _, err := importutil.RequireID(id, "Vehicle"); err != nil {
			return auditlog.AuditedWrite[Vehicle]{}, err
		}
		existing, err := oneVehicle(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[Vehicle]{}, err
		}
		if _, err := datactx.RequireFound(existing, "Vehicle"); err != nil {
			return auditlog.AuditedWrite[Vehicle]{}, err
		}
		if err := reqctx.RequireWriteZone(rc, existing.ZoneID); err != nil {
			return auditlog.AuditedWrite[Vehicle]{}, err
		}
		vehicle, err := vehicleFrom(ctx, conn, rc, body, existing)
		if err != nil {
			return auditlog.AuditedWrite[Vehicle]{}, err
		}
		if err := upsertVehicle(ctx, conn, rc.CustomerID, vehicle); err != nil {
			return auditlog.AuditedWrite[Vehicle]{}, err
		}
		return auditlog.AuditedWrite[Vehicle]{Result: vehicle, SummaryEn: "Vehicle " + vehicle.Code + " updated.", Detail: sumDetail(nil, map[string]any{"code": vehicle.Code})}, nil
	})
}
