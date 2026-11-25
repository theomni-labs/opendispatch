// SPDX-License-Identifier: AGPL-3.0-only

// Live-Postgres tests for dispatch.go's
// OverrideAssignment (needs a real Agent lookup).
package business

import (
	"context"
	"fmt"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestOverrideAssignment_AssignsAnActiveFieldAgent(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetDispatchDeps()

	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RY", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central"})
	check(t, err)
	agent, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SUR-D1", "name_en": "Dispatch One", "kind": "field", "home_zone_id": zone.ID})
	check(t, err)
	caseID := "00000000-0000-4000-8000-000000000821"
	SeedReplayCasesForTest([]Case{{ID: caseID, CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-13T06:30:00+03:00", DataSource: "SYNTHETIC"}})
	dispatcher := roleCtx(tenantID, "00000000-0000-4000-8000-000000000822", access.RoleDispatchSupervisor)
	_, err = ControlReplay(dispatcher, map[string]any{"action": "seek", "replay_at": "2026-09-13T07:00:00+03:00"})
	check(t, err)
	SeedSettingsZonesForTest([]string{"z1"}, datactx.NowISO())
	PutZoneStageForTest(ZoneStage{ZoneID: "z1", Stage: "recommend", DataSource: "SYNTHETIC"})

	result, err := OverrideAssignment(ctx, conn, dispatcher, caseID, map[string]any{"agent_id": agent.ID, "reason_code": "closer_agent_known"})
	check(t, err)
	if result.State != "assigned" || result.Source != "MANUAL" || result.AgentID != agent.ID {
		t.Fatalf("got %+v, want a MANUAL assignment to the agent", result)
	}
}

func TestOverrideAssignment_RefusesInactiveOrRemoteAgent(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetDispatchDeps()

	remote, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SUR-D2", "name_en": "Remote One", "kind": "remote"})
	check(t, err)
	caseID := "00000000-0000-4000-8000-000000000823"
	SeedReplayCasesForTest([]Case{{ID: caseID, CaseNumber: "RD-2", ZoneID: "z1", RegisteredAt: "2026-09-13T06:30:00+03:00", DataSource: "SYNTHETIC"}})
	dispatcher := roleCtx(tenantID, "00000000-0000-4000-8000-000000000824", access.RoleDispatchSupervisor)
	_, err = ControlReplay(dispatcher, map[string]any{"action": "seek", "replay_at": "2026-09-13T07:00:00+03:00"})
	check(t, err)
	PutZoneStageForTest(ZoneStage{ZoneID: "z1", Stage: "recommend", DataSource: "SYNTHETIC"})

	_, err = OverrideAssignment(ctx, conn, dispatcher, caseID, map[string]any{"agent_id": remote.ID, "reason_code": "closer_agent_known"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid: a remote agent cannot be a field override", err)
	}
}

func TestOverrideAssignment_OtherReasonRequiresANote(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetDispatchDeps()

	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RY", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central"})
	check(t, err)
	agent, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SUR-D3", "name_en": "Dispatch Three", "kind": "field", "home_zone_id": zone.ID})
	check(t, err)
	caseID := "00000000-0000-4000-8000-000000000825"
	SeedReplayCasesForTest([]Case{{ID: caseID, CaseNumber: "RD-3", ZoneID: "z1", RegisteredAt: "2026-09-13T06:30:00+03:00", DataSource: "SYNTHETIC"}})
	dispatcher := roleCtx(tenantID, "00000000-0000-4000-8000-000000000826", access.RoleDispatchSupervisor)
	_, err = ControlReplay(dispatcher, map[string]any{"action": "seek", "replay_at": "2026-09-13T07:00:00+03:00"})
	check(t, err)
	PutZoneStageForTest(ZoneStage{ZoneID: "z1", Stage: "recommend", DataSource: "SYNTHETIC"})

	_, err = OverrideAssignment(ctx, conn, dispatcher, caseID, map[string]any{"agent_id": agent.ID, "reason_code": "other"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid: reason other needs a note", err)
	}
}

func TestOverrideAssignment_ReassignsACustomerAssignedCaseAsManual(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetDispatchDeps()

	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RY", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central"})
	check(t, err)
	agent, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "SUR-D4", "name_en": "Dispatch Four", "kind": "field", "home_zone_id": zone.ID})
	check(t, err)
	caseID := "00000000-0000-4000-8000-000000000827"
	assignedAt, customer := "2026-09-13T06:35:00+03:00", "00000000-0000-4000-8000-000000000829"
	SeedReplayCasesForTest([]Case{{ID: caseID, CaseNumber: "RD-4", ZoneID: "z1", RegisteredAt: "2026-09-13T06:30:00+03:00", AssignedAt: &assignedAt, AgentID: &customer, DataSource: "SYNTHETIC"}})
	dispatcher := roleCtx(tenantID, "00000000-0000-4000-8000-000000000828", access.RoleDispatchSupervisor)
	_, err = ControlReplay(dispatcher, map[string]any{"action": "seek", "replay_at": "2026-09-13T07:00:00+03:00"})
	check(t, err)
	SeedSettingsZonesForTest([]string{"z1"}, datactx.NowISO())
	PutZoneStageForTest(ZoneStage{ZoneID: "z1", Stage: "automatic", DataSource: "SYNTHETIC"})

	result, err := OverrideAssignment(ctx, conn, dispatcher, caseID, map[string]any{"agent_id": agent.ID, "reason_code": "closer_agent_known"})
	check(t, err)
	if result.Source != "MANUAL" || result.ReasonCode == nil || *result.ReasonCode != "closer_agent_known" {
		t.Fatalf("got %+v, want MANUAL with the reason code", result)
	}
	stored, err := loadAssignments(ctx, tenantID)
	check(t, err)
	for _, a := range stored {
		if a.Source == "OPENDISPATCH" {
			t.Fatalf("got %+v, want no OpenDispatch record for a case Customer assigned", stored)
		}
	}
	events, err := loadAssignmentEvents(ctx, tenantID)
	check(t, err)
	from := ""
	for _, e := range events {
		if e.EventType == "overridden" {
			from = fmt.Sprint(strOrSelf(e.Detail["from_agent_id"]))
		}
	}
	if from != customer {
		t.Fatalf("got from %q, want the customer's agent %s", from, customer)
	}
}

func strOrSelf(v any) any {
	if p, ok := v.(*string); ok && p != nil {
		return *p
	}
	return v
}
