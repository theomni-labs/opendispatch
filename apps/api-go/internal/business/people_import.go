// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors people.ts's CSV import (DG12).
package business

import (
	"context"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// agentCol: the import's CSV column names.
type agentCol string

const (
	scCode              agentCol = "code"
	scNameEn            agentCol = "name_en"
	scNameAr            agentCol = "name_ar"
	scKind              agentCol = "kind"
	scHomeZoneCode      agentCol = "home_zone_code"
	scDefaultVehicleCod agentCol = "default_vehicle_code"
	scIsActive          agentCol = "is_active"
	scSkillCodes        agentCol = "skill_codes"
	scShiftCodes        agentCol = "shift_pattern_codes"
	scAnnualLeaveDays   agentCol = "annual_leave_days"
)

const maxAgentFileChars = 2_000_000
const maxAgentRows = 5000
const maxSkillsPerAgent = 20

type agentImportPlan struct {
	agents  []Agent
	skills  []AgentSkill
	zoneIDs []string
}

func hasSpace(s string) bool {
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			return true
		}
	}
	return false
}

// planAgentImport mirrors planAgentImport.
func planAgentImport(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, text string) (agentImportPlan, error) {
	var zero agentImportPlan
	columns := importutil.Columns[agentCol]{
		Required: []agentCol{scCode, scNameEn, scKind},
		Optional: []agentCol{scNameAr, scHomeZoneCode, scDefaultVehicleCod, scIsActive, scSkillCodes, scShiftCodes, scAnnualLeaveDays},
	}
	rows, err := importutil.ReadCsvTable(text, columns, "Agent import", importutil.ReadCsvTableOptions{MaxRows: maxAgentRows})
	if err != nil {
		return zero, err
	}
	var problems importutil.RowProblems
	at := datactx.NowISO()

	allAgentsRows, err := allAgents(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	allZonesRows, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	allVehiclesRows, err := allVehicles(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}

	existingCodes := map[string]bool{}
	for _, s := range allAgentsRows {
		existingCodes[s.Code] = true
	}
	zoneByCode := map[string]string{}
	for _, z := range allZonesRows {
		if code, ok := codeOfExtra(z.Extra); ok {
			zoneByCode[code] = z.ID
		}
	}
	vehicleByCode := map[string]string{}
	for _, v := range allVehiclesRows {
		vehicleByCode[v.Code] = v.ID
	}
	patterns, err := allShiftPatterns(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	patternByCode := map[string]ShiftPattern{}
	for _, p := range patterns {
		patternByCode[p.Code] = p
	}
	seenInFile := map[string]int{}
	zoneIDSet := map[string]bool{}
	var plan agentImportPlan

	for _, r := range rows {
		before := problems.Count()
		code := strings.TrimSpace(r.Cells[scCode])
		name := strings.TrimSpace(r.Cells[scNameEn])
		nameAr := strings.TrimSpace(r.Cells[scNameAr])
		kind := strings.TrimSpace(r.Cells[scKind])
		zoneCode := strings.TrimSpace(r.Cells[scHomeZoneCode])
		vehicleCode := strings.TrimSpace(r.Cells[scDefaultVehicleCod])
		active := strings.ToLower(strings.TrimSpace(r.Cells[scIsActive]))

		if len(code) < 1 || len(code) > 32 {
			problems.Add(r.Row, ptr("code"), "code is 1 to 32 characters.")
		} else if existingCodes[code] {
			problems.Add(r.Row, ptr("code"), "staff code "+code+" already exists.")
		} else if seenRow, ok := seenInFile[code]; ok {
			problems.Add(r.Row, ptr("code"), "staff code "+code+" already used in row "+strconv.Itoa(seenRow)+".")
		} else {
			seenInFile[code] = r.Row
		}
		if len(name) < 1 || len(name) > 120 {
			problems.Add(r.Row, ptr("name_en"), "name_en is 1 to 120 characters.")
		}
		if len(nameAr) > 120 {
			problems.Add(r.Row, ptr("name_ar"), "name_ar is at most 120 characters.")
		}
		if kind != "field" && kind != "remote" {
			problems.Add(r.Row, ptr("kind"), "kind is field or remote.")
		}
		var homeZone *string
		if zoneCode == "" {
			if kind == "field" {
				problems.Add(r.Row, ptr("home_zone_code"), "a field agent needs a home_zone_code.")
			}
		} else if id, ok := zoneByCode[zoneCode]; ok {
			homeZone = &id
			zoneIDSet[id] = true
		} else {
			problems.Add(r.Row, ptr("home_zone_code"), "zone "+zoneCode+" does not exist.")
		}
		var vehicle *string
		if vehicleCode != "" {
			if id, ok := vehicleByCode[vehicleCode]; ok {
				vehicle = &id
			} else {
				problems.Add(r.Row, ptr("default_vehicle_code"), "vehicle "+vehicleCode+" does not exist.")
			}
		}
		if active != "" && active != "true" && active != "false" {
			problems.Add(r.Row, ptr("is_active"), "is_active is true or false (empty means true).")
		}
		var skillCodes []string
		for _, part := range strings.Split(r.Cells[scSkillCodes], ";") {
			c := strings.TrimSpace(part)
			if c != "" {
				skillCodes = append(skillCodes, c)
			}
		}
		skillCodes = dedupeStrings(skillCodes)
		if len(skillCodes) > maxSkillsPerAgent {
			problems.Add(r.Row, ptr("skill_codes"), "at most "+strconv.Itoa(maxSkillsPerAgent)+" skills.")
		} else {
			for _, c := range skillCodes {
				if len(c) > 64 || hasSpace(c) {
					problems.Add(r.Row, ptr("skill_codes"), "a skill code is up to 64 characters with no spaces; separate skills with semicolons.")
					break
				}
			}
		}

		elig := importEligibility(r.Row, r.Cells[scShiftCodes], kind, patternByCode, &problems)
		annual := importAnnualDays(r.Row, r.Cells[scAnnualLeaveDays], &problems)

		if problems.Count() == before && (kind == "field" || kind == "remote") {
			var nameArPtr *string
			if nameAr != "" {
				nameArPtr = &nameAr
			}
			agent := Agent{BaseRecord: datactx.NewRecord(rc, "", at), Code: code, NameEn: name, NameAr: nameArPtr, Kind: kind, HomeZoneID: homeZone, DefaultVehicleID: vehicle, IsActive: active != "false", Extra: map[string]any{},
				EligibleShiftPatternIDs: elig, AnnualLeaveDays: annual}
			plan.agents = append(plan.agents, agent)
			for _, skillCode := range skillCodes {
				plan.skills = append(plan.skills, AgentSkill{BaseRecord: datactx.NewRecord(rc, datactx.NewID(), at), AgentID: agent.ID, SkillCode: skillCode})
			}
		}
	}
	if err := problems.Refuse("Agent import"); err != nil {
		return zero, err
	}
	for id := range zoneIDSet {
		plan.zoneIDs = append(plan.zoneIDs, id)
	}
	return plan, nil
}

// importEligibility: shift_pattern_codes; nil is any.
func importEligibility(row int, cell, kind string, byCode map[string]ShiftPattern, problems *importutil.RowProblems) []string {
	var ids []string
	seen := map[string]bool{}
	for _, part := range strings.Split(cell, ";") {
		c := strings.TrimSpace(part)
		if c == "" {
			continue
		}
		p, ok := byCode[c]
		if !ok {
			problems.Add(row, ptr("shift_pattern_codes"), "shift pattern "+c+" does not exist.")
			return nil
		}
		if string(p.Kind) != kind {
			problems.Add(row, ptr("shift_pattern_codes"), "shift pattern "+c+" is for "+string(p.Kind)+" agents.")
			return nil
		}
		if !seen[p.ID] {
			seen[p.ID] = true
			ids = append(ids, p.ID)
		}
	}
	if len(ids) > maxEligiblePatterns {
		problems.Add(row, ptr("shift_pattern_codes"), "at most "+strconv.Itoa(maxEligiblePatterns)+" shift patterns.")
		return nil
	}
	sort.Strings(ids)
	return ids
}

// importAnnualDays: annual_leave_days; empty is nil.
func importAnnualDays(row int, cell string, problems *importutil.RowProblems) *int {
	c := strings.TrimSpace(cell)
	if c == "" {
		return nil
	}
	n, err := strconv.Atoi(c)
	if err != nil || n < 0 || n > 365 {
		problems.Add(row, ptr("annual_leave_days"), "annual_leave_days is a whole number from 0 to 365, or empty.")
		return nil
	}
	return &n
}

// ImportAgents mirrors importAgents.
func ImportAgents(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (AgentImportResult, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminAgentsVehicles}, auditlog.WriteMeta{Action: "agent.imported", EntityType: "agent_import"}, func(ctx context.Context) (auditlog.AuditedWrite[AgentImportResult], error) {
		var zero auditlog.AuditedWrite[AgentImportResult]
		input, err := datactx.Object(body, "Agent import", []string{"file"})
		if err != nil {
			return zero, err
		}
		file, err := datactx.String(input, "file", datactx.StrOpts{Min: 1, Max: maxAgentFileChars, HasMin: true, HasMax: true})
		if err != nil {
			return zero, err
		}
		plan, err := planAgentImport(ctx, conn, rc, file)
		if err != nil {
			return zero, err
		}
		for _, id := range plan.zoneIDs {
			zid := id
			if err := reqctx.RequireWriteZone(rc, &zid); err != nil {
				return zero, err
			}
		}
		if err := writeAgentImportBatch(ctx, conn, rc.CustomerID, plan); err != nil {
			return zero, err
		}
		result := AgentImportResult{Agents: len(plan.agents), Skills: len(plan.skills)}
		summary := "Agents imported: " + strconv.Itoa(result.Agents) + " agents, " + strconv.Itoa(result.Skills) + " skills."
		return auditlog.AuditedWrite[AgentImportResult]{Result: result, SummaryEn: summary, Detail: map[string]any{"agents": result.Agents, "skills": result.Skills}}, nil
	})
}

// writeAgentImportBatch: one transaction.
func writeAgentImportBatch(ctx context.Context, conn *tenancy.Connection, tenantID string, plan agentImportPlan) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, s := range plan.agents {
			if err := upsertAgentTx(ctx, tx, s); err != nil {
				return struct{}{}, err
			}
		}
		for _, k := range plan.skills {
			if err := insertAgentSkillTx(ctx, tx, k); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}
