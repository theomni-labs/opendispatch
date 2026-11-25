// SPDX-License-Identifier: AGPL-3.0-only

// Verifies planChain for the real seed and the
// first case day (2026-09-06). Counts, ids, case
// numbers and registration times match
// gen/dayplan.ts (tsx); agent choice and travel
// times come from the Go port, whose travel-time
// coupling step gen/dayplan.ts does not have.
package synthetic

import "testing"

func int64Ptr(v *int64) int64 {
	if v == nil {
		return -1
	}
	return *v
}

func TestPlanChain_MatchesTS(t *testing.T) {
	w, err := buildWorld(realSeed)
	if err != nil {
		t.Fatalf("buildWorld: %v", err)
	}
	plans, err := planChain(w, realSeed, "2026-09-06")
	if err != nil {
		t.Fatalf("planChain: %v", err)
	}
	if len(plans) == 0 {
		t.Fatal("no plans")
	}
	plan := plans[len(plans)-1]
	if plan.Date != "2026-09-06" {
		t.Fatalf("date: got %s, want 2026-09-06", plan.Date)
	}
	if len(plan.Cases) != 1350 {
		t.Fatalf("caseCount: got %d, want 1350", len(plan.Cases))
	}

	c0 := plan.Cases[0]
	if c0.ID != "c424834d-43dc-4f0b-93d4-cd825b1cd254" || c0.CaseNumber != "JD-260906-00001" || c0.ExternalID != "6010000" {
		t.Fatalf("case0: got %+v", c0)
	}
	if c0.Registered != 1788642314 || c0.CaseType != "Standard case" || c0.Handling != "field" {
		t.Fatalf("case0 fields: got %+v", c0)
	}
	if c0.Zone.Code != "JD-S" || c0.SubZone.Code != "JD-S-14" {
		t.Fatalf("case0 zone/subzone: got %+v %+v", c0.Zone, c0.SubZone)
	}
	if int64Ptr(c0.Assigned) != 1788644105 || int64Ptr(c0.Depart) != 1788644206 || int64Ptr(c0.Arrived) != 1788645567 || int64Ptr(c0.OnSceneCompleted) != 1788645978 {
		t.Fatalf("case0 timing: got assigned=%v depart=%v arrived=%v onScene=%v", c0.Assigned, c0.Depart, c0.Arrived, c0.OnSceneCompleted)
	}
	if c0.Closed != 1788646016 || int64Ptr(c0.ReturningUntil) != 1788647792 {
		t.Fatalf("case0 closed/returning: got closed=%d returning=%v", c0.Closed, c0.ReturningUntil)
	}
	if c0.Agent == nil || c0.Agent.ID != "54807183-3cb7-4d14-bcc9-2d97ced39eeb" || c0.Agent.EmployeeCode != "SVR-JD-S-026" {
		t.Fatalf("case0 agent: got %+v", c0.Agent)
	}
	if c0.VehicleID == nil || *c0.VehicleID != "d7742d95-80db-417f-b314-bc6c7dab063f" {
		t.Fatalf("case0 vehicle: got %v", c0.VehicleID)
	}
	if c0.RoadKm == nil || !approxEq(*c0.RoadKm, 15.56573723166998) {
		t.Fatalf("case0 road_km: got %v", c0.RoadKm)
	}
	if c0.SpeedKmh == nil || !approxEq(*c0.SpeedKmh, 41.17314771051574) {
		t.Fatalf("case0 speed_kmh: got %v", c0.SpeedKmh)
	}

	c1 := plan.Cases[1]
	if c1.ID != "46804372-5666-4f71-b488-8bc2990ca119" || c1.CaseNumber != "JD-260906-00002" {
		t.Fatalf("case1: got %+v", c1)
	}
	if c1.Agent == nil || c1.Agent.ID != "767cbb2f-8068-4cb0-8e2a-5523da21789c" || c1.Agent.EmployeeCode != "SVR-JD-S-029" {
		t.Fatalf("case1 agent: got %+v", c1.Agent)
	}
	if int64Ptr(c1.Assigned) != 1788642484 || c1.Closed != 1788644886 {
		t.Fatalf("case1 timing: got assigned=%v closed=%d", c1.Assigned, c1.Closed)
	}

	// index 2: the first remote case (Jeddah South).
	var remoteCase *PlannedCase
	for i := range plan.Cases {
		if plan.Cases[i].Handling == "remote_inferred" {
			remoteCase = &plan.Cases[i]
			break
		}
	}
	if remoteCase == nil || remoteCase.Index != 2 {
		t.Fatalf("remoteCase: got %+v", remoteCase)
	}
	if remoteCase.ID != "061bddfa-3cd3-4c64-8994-09b10cf1180e" || remoteCase.CaseNumber != "JD-260906-00003" {
		t.Fatalf("remoteCase ids: got %+v", remoteCase)
	}
	if remoteCase.RemoteReviewAt == nil || *remoteCase.RemoteReviewAt != 1788681600 || remoteCase.Closed != 1788683844 {
		t.Fatalf("remoteCase timing: got review=%v closed=%d", remoteCase.RemoteReviewAt, remoteCase.Closed)
	}
	if remoteCase.Agent != nil || remoteCase.Assigned != nil {
		t.Fatalf("remoteCase: want no agent/assigned, got %+v", remoteCase)
	}

	last := plan.Cases[len(plan.Cases)-1]
	if last.Index != 1349 || last.ID != "06ec03ed-fd54-4318-81e0-29eaaffefd91" || last.CaseNumber != "RD-260906-00837" {
		t.Fatalf("lastCase: got %+v", last)
	}
	if last.Zone.Code != "RD-N" || last.SubZone.Code != "RD-N-08" {
		t.Fatalf("lastCase zone/subzone: got %+v %+v", last.Zone, last.SubZone)
	}
	if last.Handling != "field" || int64Ptr(last.Assigned) != 1788728415 || last.Closed != 1788729728 || last.Agent == nil || last.Agent.EmployeeCode != "SVR-RD-N-029" {
		t.Fatalf("lastCase timing: got assigned=%v closed=%d agent=%+v", last.Assigned, last.Closed, last.Agent)
	}
}
