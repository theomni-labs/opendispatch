// SPDX-License-Identifier: AGPL-3.0-only

// Verifies people.go against real gen/people.ts
// output, captured via tsx, for the real seed.
package synthetic

import "testing"

func TestBuildWorld_MatchesTS(t *testing.T) {
	w, err := buildWorld(realSeed)
	if err != nil {
		t.Fatalf("buildWorld: %v", err)
	}
	if len(w.Agents) != 336 {
		t.Fatalf("agentCount: got %d, want 336", len(w.Agents))
	}
	if len(w.Vehicles) != 112 {
		t.Fatalf("vehicleCount: got %d, want 112", len(w.Vehicles))
	}

	s0 := w.Agents[0]
	if s0.ID != "8aec9202-669d-4b1d-8e97-27d132e909ed" || s0.EmployeeCode != "SVR-RD-C-001" || s0.NameEn != "Tariq Al-Zahani" {
		t.Fatalf("s0: got %+v", s0)
	}
	if s0.WorkMode != "field" || s0.ShiftKey != "day_a" || len(s0.DaysOff) != 2 || s0.DaysOff[0] != 0 || s0.DaysOff[1] != 1 {
		t.Fatalf("s0 duty fields: got %+v", s0)
	}
	if s0.StandbyPointID == nil || *s0.StandbyPointID != "92b7ff9b-6358-4eb7-9690-8b004d8f600c" {
		t.Fatalf("s0 standby: got %+v", s0.StandbyPointID)
	}
	if s0.HomeSpot == nil || !approxEq(s0.HomeSpot.Lat, 24.674917750503802) || !approxEq(s0.HomeSpot.Lng, 46.66954165726248) {
		t.Fatalf("s0 home spot: got %+v", s0.HomeSpot)
	}
	wantSkills := []string{"pedestrian_incident", "multi_vehicle", "photo_documentation"}
	if len(s0.Skills) != len(wantSkills) {
		t.Fatalf("s0 skills: got %v, want %v", s0.Skills, wantSkills)
	}
	for i, want := range wantSkills {
		if s0.Skills[i] != want {
			t.Fatalf("s0 skills[%d]: got %s, want %s", i, s0.Skills[i], want)
		}
	}

	sLast := w.Agents[len(w.Agents)-1]
	if sLast.ID != "e4781dad-40e9-4a77-b82a-03b10126a5fb" || sLast.EmployeeCode != "SVR-DM-C-042" || sLast.WorkMode != "remote" {
		t.Fatalf("sLast: got %+v", sLast)
	}
	if sLast.StandbyPointID != nil || sLast.HomeSpot != nil {
		t.Fatalf("sLast: want nil standby/home for remote, got %+v %+v", sLast.StandbyPointID, sLast.HomeSpot)
	}

	// s0 is off 09-06/07 (days_off 0,1); on 09-08.
	duty, err := dutyOn(s0, "2026-09-08")
	if err != nil || duty == nil {
		t.Fatalf("dutyOn 2026-09-08: got %v, %v", duty, err)
	}
	if duty.Start != 1788836400 || duty.End != 1788865200 || duty.BreakStart != 1788854400 || duty.BreakEnd != 1788856200 {
		t.Fatalf("duty: got %+v", duty)
	}
	at, err := dutyAt(s0, duty.Start+3600, "2026-09-08")
	if err != nil || at == nil || at.Start != duty.Start {
		t.Fatalf("dutyAt: got %+v, %v", at, err)
	}

	vmap, err := vehiclesForZoneDate(w, s0.ZoneID, "2026-09-08")
	if err != nil {
		t.Fatalf("vehiclesForZoneDate: %v", err)
	}
	if vmap[s0.ID] != "960da2cd-1c46-4e73-9938-99d4a9535cf4" {
		t.Fatalf("vmap[s0]: got %s, want 960da2cd-1c46-4e73-9938-99d4a9535cf4", vmap[s0.ID])
	}
	if vmap["083bc287-51e3-441a-91bf-9ee8e5df2bd4"] != "b6d9960e-f11c-4de3-aef1-ab7638939a4d" {
		t.Fatalf("vmap[1]: got %s", vmap["083bc287-51e3-441a-91bf-9ee8e5df2bd4"])
	}
}
