// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors people.live.test.ts (live Postgres).
// addSkill/ImportSample: not ported, see people.go.
package business

import (
	"context"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func TestAgentAndVehicle_CreateUpdateSkills(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	city, err0 := CreateCity(ctx, conn, rc, map[string]any{"case_code": "PL", "name_en": "Palm City"})
	check(t, err0)
	zone, err1 := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Palm Zone"})
	check(t, err1)

	vehicle, err := CreateVehicle(ctx, conn, rc, map[string]any{"code": "VEH-001", "plate_number": "SYN 0001", "zone_id": zone.ID})
	if err != nil {
		t.Fatalf("create vehicle: %v", err)
	}
	updatedVehicle, err := UpdateVehicle(ctx, conn, rc, vehicle.ID, map[string]any{"code": "VEH-001", "plate_number": "SYN 0001", "zone_id": zone.ID, "is_active": false})
	if err != nil {
		t.Fatalf("update vehicle: %v", err)
	}
	if updatedVehicle.IsActive {
		t.Fatalf("expected vehicle inactive after update")
	}

	agent, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SVR-001", "name_en": "Field One", "kind": "field", "home_zone_id": zone.ID, "default_vehicle_id": vehicle.ID})
	if err != nil {
		t.Fatalf("create agent: %v", err)
	}
	updatedAgent, err := UpdateAgent(ctx, conn, rc, agent.ID, map[string]any{"code": "SVR-001", "name_en": "Field One B", "kind": "field", "home_zone_id": zone.ID, "is_active": false})
	if err != nil {
		t.Fatalf("update agent: %v", err)
	}
	if updatedAgent.IsActive || updatedAgent.NameEn != "Field One B" {
		t.Fatalf("unexpected update: %+v", updatedAgent)
	}

	skills, err := SetAgentSkills(ctx, conn, rc, agent.ID, map[string]any{"skill_codes": []any{"injury_protocol", "night_operations", "injury_protocol"}})
	if err != nil {
		t.Fatalf("set skills: %v", err)
	}
	if len(skills.Items) != 2 || skills.Items[0].SkillCode != "injury_protocol" || skills.Items[1].SkillCode != "night_operations" {
		t.Fatalf("unexpected skills (dedup/order): %+v", skills.Items)
	}

	replaced, err := SetAgentSkills(ctx, conn, rc, agent.ID, map[string]any{"skill_codes": []any{"heavy_vehicle"}})
	if err != nil {
		t.Fatalf("replace skills: %v", err)
	}
	if len(replaced.Items) != 1 || replaced.Items[0].SkillCode != "heavy_vehicle" {
		t.Fatalf("expected the skill list replaced, got %+v", replaced.Items)
	}
	listed, err := ListAgentSkills(ctx, conn, rc, agent.ID, AgentSkillQuery{})
	if err != nil {
		t.Fatalf("list skills: %v", err)
	}
	if len(listed.Items) != 1 || listed.Items[0].SkillCode != "heavy_vehicle" {
		t.Fatalf("expected only heavy_vehicle after replace, got %+v", listed.Items)
	}
}

func TestRemoveSkill_RefusedWhileAAgentHoldsIt(t *testing.T) {
	conn := openConn(t)
	rc, tenant := adminCtx(t)
	ctx := context.Background()
	t.Cleanup(func() { _ = settingsstore.Put(context.Background(), tenant, "skills.vocabulary", []SkillInfo{}) })
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RS", "name_en": "Skill City"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Skill Zone"})
	check(t, err)
	agent, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SVR-RS1", "name_en": "Holder", "kind": "field", "home_zone_id": zone.ID})
	check(t, err)
	_, err = AddSkill(rc, map[string]any{"code": "rope_access", "name_en": "Rope access", "name_ar": nil})
	check(t, err)
	_, err = SetAgentSkills(ctx, conn, rc, agent.ID, map[string]any{"skill_codes": []any{"rope_access"}})
	check(t, err)
	err = RemoveSkill(ctx, conn, rc, "rope_access")
	if errCode(err) != dataerr.CodeConflict || !strings.Contains(err.Error(), "1 agents") {
		t.Fatalf("held skill: got %v, want Conflict", err)
	}
	_, err = SetAgentSkills(ctx, conn, rc, agent.ID, map[string]any{"skill_codes": []any{}})
	check(t, err)
	check(t, RemoveSkill(ctx, conn, rc, "rope_access"))
	vocabulary, _ := settingsstore.Get(context.Background(), tenant, "skills.vocabulary", []SkillInfo{})
	for _, s := range vocabulary {
		if s.Code == "rope_access" {
			t.Fatalf("still in the vocabulary: %+v", vocabulary)
		}
	}
	if err := RemoveSkill(ctx, conn, rc, "rope_access"); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("second remove: got %v, want NotFound", err)
	}
}

func TestAgent_ValidationFailures(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	city, err0 := CreateCity(ctx, conn, rc, map[string]any{"case_code": "VF", "name_en": "Valid City"})
	check(t, err0)
	zone, err1 := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Valid Zone"})
	check(t, err1)

	existing, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SVR-DUP", "name_en": "Existing", "kind": "remote"})
	if err != nil {
		t.Fatalf("seed agent: %v", err)
	}

	if _, err := CreateAgent(ctx, conn, rc, map[string]any{"code": existing.Code, "name_en": "Dup", "kind": "field", "home_zone_id": zone.ID}); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("expected conflict for a duplicate code, got %v", err)
	}
	if _, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SVR-NOZONE", "name_en": "No zone", "kind": "field"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("expected invalid: a field agent needs a home_zone_id, got %v", err)
	}
	if _, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SVR-NOVEH", "name_en": "Bad vehicle", "kind": "remote", "default_vehicle_id": "00000000-0000-4000-8000-000000000000"}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("expected not-found for an unknown vehicle, got %v", err)
	}
	remote, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SVR-REMOTE", "name_en": "Remote", "kind": "remote"})
	if err != nil {
		t.Fatalf("create remote agent: %v", err)
	}
	if remote.HomeZoneID != nil {
		t.Fatalf("expected a remote agent to have no home zone")
	}
	if _, err := CreateVehicle(ctx, conn, rc, map[string]any{"code": "VEH-BAD", "zone_id": zone.ID, "colour": "red"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("expected invalid: unknown field, got %v", err)
	}
	if _, err := SetAgentSkills(ctx, conn, rc, "00000000-0000-4000-8000-000000000000", map[string]any{"skill_codes": []any{}}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("expected not-found for an unknown agent, got %v", err)
	}
}

func TestListAgentsAndVehicles_ZoneScopedReads(t *testing.T) {
	conn := openConn(t)
	admin, tenantID := adminCtx(t)
	ctx := context.Background()

	city, err0 := CreateCity(ctx, conn, admin, map[string]any{"case_code": "ZS", "name_en": "Zone Scope City"})
	check(t, err0)
	zoneA, err1 := CreateZone(ctx, conn, admin, map[string]any{"city_id": city.ID, "name_en": "Zone A"})
	check(t, err1)
	zoneB, err2 := CreateZone(ctx, conn, admin, map[string]any{"city_id": city.ID, "name_en": "Zone B"})
	check(t, err2)

	vehicleA, err3 := CreateVehicle(ctx, conn, admin, map[string]any{"code": "VEH-A", "plate_number": "A 1", "zone_id": zoneA.ID})
	check(t, err3)
	_, err4 := CreateVehicle(ctx, conn, admin, map[string]any{"code": "VEH-B", "plate_number": "B 1", "zone_id": zoneB.ID})
	check(t, err4)
	agentA, err5 := CreateAgent(ctx, conn, admin, map[string]any{"code": "SVR-A", "name_en": "In A", "kind": "field", "home_zone_id": zoneA.ID, "default_vehicle_id": vehicleA.ID})
	check(t, err5)
	agentB, err6 := CreateAgent(ctx, conn, admin, map[string]any{"code": "SVR-B", "name_en": "In B", "kind": "field", "home_zone_id": zoneB.ID})
	check(t, err6)

	dispatcher := plannerCtx(tenantID, "u1", []string{zoneA.ID})
	agents, err := ListAgents(ctx, conn, dispatcher, AgentQuery{})
	if err != nil {
		t.Fatalf("list agents: %v", err)
	}
	if len(agents.Items) != 1 || agents.Items[0].ID != agentA.ID {
		t.Fatalf("expected only agent A, got %+v", agents.Items)
	}
	vehicles, err := ListVehicles(ctx, conn, dispatcher, VehicleQuery{})
	if err != nil {
		t.Fatalf("list vehicles: %v", err)
	}
	if len(vehicles.Items) != 1 || vehicles.Items[0].ID != vehicleA.ID {
		t.Fatalf("expected only vehicle A, got %+v", vehicles.Items)
	}
	if _, err := GetAgent(ctx, conn, dispatcher, agentB.ID); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("expected not-found for an out-of-scope agent, got %v", err)
	}
	if _, err := ListAgentSkills(ctx, conn, dispatcher, agentB.ID, AgentSkillQuery{}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("expected not-found for an out-of-scope agent's skills, got %v", err)
	}
}

func TestImportAgents_HappyPath(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	city, err0 := CreateCity(ctx, conn, rc, map[string]any{"case_code": "IM", "name_en": "Import City"})
	check(t, err0)
	// extra.code: set explicitly, CreateZone won't.
	zone, err1 := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Import Zone", "extra": map[string]any{"code": "IMP-ZN"}})
	check(t, err1)
	zoneCode := "IMP-ZN"
	vehicle, err2 := CreateVehicle(ctx, conn, rc, map[string]any{"code": "VEH-IMP", "plate_number": "I 1", "zone_id": zone.ID})
	check(t, err2)

	header := "code,name_en,name_ar,kind,home_zone_code,default_vehicle_code,is_active,skill_codes"
	csv := strings.Join([]string{
		header,
		"SVR-SMP-001,Field Person,,field," + zoneCode + "," + vehicle.Code + ",true,pedestrian_incident;night_operations",
		"SVR-SMP-002,Remote Person,,remote,,,false,",
	}, "\n")

	result, err := ImportAgents(ctx, conn, rc, map[string]any{"file": csv})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.Agents != 2 || result.Skills != 2 {
		t.Fatalf("unexpected result: %+v", result)
	}

	imported, err := ListAgents(ctx, conn, rc, AgentQuery{Q: "SVR-SMP-"})
	if err != nil {
		t.Fatalf("list imported: %v", err)
	}
	if len(imported.Items) != 2 {
		t.Fatalf("expected 2 imported agents, got %d", len(imported.Items))
	}
	var field *Agent
	for i := range imported.Items {
		if imported.Items[i].Code == "SVR-SMP-001" {
			field = &imported.Items[i]
		}
	}
	if field == nil || field.HomeZoneID == nil || *field.HomeZoneID != zone.ID || field.DefaultVehicleID == nil || *field.DefaultVehicleID != vehicle.ID {
		t.Fatalf("unexpected field agent: %+v", field)
	}
	skills, err := ListAgentSkills(ctx, conn, rc, field.ID, AgentSkillQuery{})
	if err != nil {
		t.Fatalf("list skills: %v", err)
	}
	if len(skills.Items) != 2 {
		t.Fatalf("expected 2 skills, got %+v", skills.Items)
	}
}

func TestImportAgents_ValidationFailures(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	header := "code,name_en,name_ar,kind,home_zone_code,default_vehicle_code,is_active,skill_codes"

	cases := []struct {
		name string
		row  string
	}{
		{"duplicate code in file", "DUP,A,,remote,,,true,\nDUP,B,,remote,,,true,"},
		{"unknown home_zone_code", "IMP-1,Ok,,field,ZZ-ZZ,,true,"},
		{"unknown default_vehicle_code", "IMP-1,Ok,,remote,,NO-VEHICLE,true,"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			csv := header + "\n" + tc.row
			if _, err := ImportAgents(ctx, conn, rc, map[string]any{"file": csv}); errCode(err) != dataerr.CodeInvalid {
				t.Fatalf("expected invalid, got %v", err)
			}
		})
	}

	// Nothing written: one bad row voids the batch.
	good := "IMP-GOOD"
	mixed := strings.Join([]string{header, good + ",Good,,remote,,,true,", ",Bad,,field,,,true,"}, "\n")
	if _, err := ImportAgents(ctx, conn, rc, map[string]any{"file": mixed}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("expected invalid for a mixed file, got %v", err)
	}
	after, err := ListAgents(ctx, conn, rc, AgentQuery{Q: good})
	if err != nil {
		t.Fatalf("list after failed import: %v", err)
	}
	if len(after.Items) != 0 {
		t.Fatalf("expected nothing imported from a failed batch, got %+v", after.Items)
	}
}

func TestImportAgents_ChecksWriteScopeOfZones(t *testing.T) {
	conn := openConn(t)
	admin, _ := adminCtx(t)
	ctx := context.Background()

	city, err0 := CreateCity(ctx, conn, admin, map[string]any{"case_code": "WS", "name_en": "Write Scope City"})
	check(t, err0)
	zoneIn, err1 := CreateZone(ctx, conn, admin, map[string]any{"city_id": city.ID, "name_en": "Inside", "extra": map[string]any{"code": "WS-IN"}})
	check(t, err1)
	zoneOut, err2 := CreateZone(ctx, conn, admin, map[string]any{"city_id": city.ID, "name_en": "Outside", "extra": map[string]any{"code": "WS-OUT"}})
	check(t, err2)
	_ = zoneOut
	inCode, outCode := "WS-IN", "WS-OUT"

	// Admin role, zone scope narrowed (mirrors TS test).
	limited := admin
	limited.ZoneScope = access.ZoneScope{Kind: access.ScopeAssignedZones, ZoneIDs: []string{zoneIn.ID}}
	header := "code,name_en,name_ar,kind,home_zone_code,default_vehicle_code,is_active,skill_codes"

	if _, err := ImportAgents(ctx, conn, limited, map[string]any{"file": header + "\nWS-OUT,Person,,field," + outCode + ",,true,"}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("expected forbidden for a zone outside scope, got %v", err)
	}
	result, err := ImportAgents(ctx, conn, limited, map[string]any{"file": header + "\nWS-IN,Person,,field," + inCode + ",,true,"})
	if err != nil {
		t.Fatalf("expected the in-scope import to succeed: %v", err)
	}
	if result.Agents != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
}
