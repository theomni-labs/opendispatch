// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRemoteChangesAddUpToOnePoolChange(t *testing.T) {
	perZone := Scenario{Adjustments: ScenarioAdjustments{HeadcountDelta: []HeadcountDelta{
		{ZoneID: "z1", RemoteAgents: 2, FieldAgents: 1}, {ZoneID: "z2", RemoteAgents: 3}}}}
	companyWide := Scenario{Adjustments: ScenarioAdjustments{HeadcountDelta: []HeadcountDelta{{ZoneID: "z1", RemoteAgents: 5}}}}
	if remotePoolDelta(perZone) != 5 || remotePoolDelta(companyWide) != 5 {
		t.Fatalf("got %d and %d, want both readings to give +5", remotePoolDelta(perZone), remotePoolDelta(companyWide))
	}
	part := scenarioRequestPart(perZone, "z2", nil)
	if len(part.HeadcountDelta) != 1 || part.HeadcountDelta[0] != (optHeadcount{ZoneID: "z2", RemoteAgents: 5}) {
		t.Fatalf("got %+v, want the zone's own field change and the whole pool change", part.HeadcountDelta)
	}
	if got := remoteNotSimulated(perZone); len(got) != 1 || got[0].ZoneID != nil || !strings.Contains(got[0].Message, "+5") {
		t.Fatalf("got %+v, want one pool-wide note", got)
	}
	if !hasHeadcount(perZone) || hasHeadcount(Scenario{}) {
		t.Fatal("a headcount scenario is one with a non-zero change")
	}
}

func TestScenarioRequestKeepsRemotePatternsWhenShiftsAreChosen(t *testing.T) {
	share := 0.4
	s := Scenario{Adjustments: ScenarioAdjustments{ShiftPatternIDs: []string{"f2"}, RemoteShare: &share,
		HeadcountDelta: []HeadcountDelta{{ZoneID: "z1", FieldAgents: 2, Vehicles: -1}}}}
	patterns := []ShiftPattern{{Kind: ShiftKindField, Status: ShiftStatusActive}, {Kind: "remote", Status: ShiftStatusActive}}
	patterns[0].ID, patterns[1].ID = "f1", "r1"
	part := scenarioRequestPart(s, "z1", patterns)
	b, _ := json.Marshal(part)
	want := `{"headcount_delta":[{"zone_id":"z1","field_agents":2,"vehicles":-1}],"shift_pattern_ids":["f2","r1"],"remote_share":0.4}`
	if string(b) != want {
		t.Fatalf("got %s, want %s", b, want)
	}
	other := scenarioRequestPart(Scenario{Adjustments: ScenarioAdjustments{HeadcountDelta: []HeadcountDelta{{ZoneID: "z1", FieldAgents: 2}}}}, "z9", nil)
	if b, _ := json.Marshal(other); string(b) != `{}` {
		t.Fatalf("got %s, want nothing for a zone without a change", b)
	}
}

func TestAddedPeopleAreUUID5Only(t *testing.T) {
	if !isAddedID("6f1d2c3e-5b7a-5e0f-9a1c-0d2e5f3a4b6c") || isAddedID("6f1d2c3e-5b7a-4e0f-9a1c-0d2e5f3a4b6c") || isAddedID("x") {
		t.Fatal("only uuid version 5 ids are engine-added people")
	}
}

func TestSameInstantIgnoresTheTextForm(t *testing.T) {
	if !sameInstant("2026-10-03T09:00:00.123456+03:00", "2026-10-03T06:00:00.123456Z") || sameInstant("2026-10-03T09:00:00+03:00", "2026-10-03T09:00:01+03:00") || sameInstant("", "") {
		t.Fatal("the stamp compares instants")
	}
}

func TestWithAnswersTakesTheWorstStatusAndTheViolations(t *testing.T) {
	a := &optimizerOutputDoc{Status: "feasible", ModelVersion: "cpsat-1"}
	b := &optimizerOutputDoc{Status: "partial", ModelVersion: "cpsat-1", Violations: []OptimizerViolation{{Code: "SKILL_COVERAGE_GAP"}}}
	a.Engine.Version, b.Engine.Version = "0.7.0", "0.7.0"
	got := withAnswers(OptimizerEngineOutput{Status: "feasible"}, []*optimizerOutputDoc{a, b})
	if got.Status != "partial" || got.ModelVersion != "cpsat-1" || got.EngineVersion != "0.7.0" || len(got.Violations) != 1 {
		t.Fatalf("got %+v", got)
	}
}

func TestSkillSettingIsChecked(t *testing.T) {
	ok := []any{map[string]any{"skill": "heavy_vehicle", "share": 0.3, "case_type_id": "6f1d2c3e-5b7a-4e0f-9a1c-0d2e5f3a4b6c"}, map[string]any{"skill": "arabic", "share": 1.0}}
	if err := validSkillSetting(skillRequirementsKey, ok); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []any{"x", []any{map[string]any{"skill": "a b", "share": 0.3}}, []any{map[string]any{"skill": "a", "share": 0.0}},
		[]any{map[string]any{"skill": "a", "share": 0.2, "zone_id": "nope"}}, []any{map[string]any{"skill": "a", "share": 0.2, "extra": 1}}} {
		if validSkillSetting(skillRequirementsKey, bad) == nil {
			t.Fatalf("%v was accepted", bad)
		}
	}
	if validSkillSetting("planning.other", "x") != nil {
		t.Fatal("other keys are not this check's")
	}
}

func TestOptimizerRequestCarriesSkillsAndScenarioWithinTheContract(t *testing.T) {
	src := testOptimizerSource()
	ct := "6f1d2c3e-5b7a-4e0f-9a1c-0d2e5f3a4b6c"
	src.SkillReqs = []optSkillReq{{Skill: "heavy", Share: 0.25, ZoneID: src.ZoneID, CaseTypeID: ct}}
	src.Scenario = scenarioRequestPart(Scenario{Adjustments: ScenarioAdjustments{HeadcountDelta: []HeadcountDelta{
		{ZoneID: src.ZoneID, FieldAgents: 2, RemoteAgents: -1, Vehicles: 1}}}}, src.ZoneID, src.Patterns)
	raw, err := buildOptimizerRequest(src)
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "optimizer", raw)
	var doc struct {
		Objective struct {
			Skills []optSkillReq `json:"skill_requirements"`
		} `json:"objective"`
		Scenario optScenario `json:"scenario_adjustments"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Objective.Skills) != 1 || doc.Objective.Skills[0].Share != 0.25 || len(doc.Scenario.HeadcountDelta) != 1 || doc.Scenario.HeadcountDelta[0].RemoteAgents != -1 {
		t.Fatalf("got %s", raw)
	}
	plain, _ := buildOptimizerRequest(testOptimizerSource())
	if strings.Contains(string(plain), "skill_requirements") || strings.Contains(string(plain), "scenario_adjustments") {
		t.Fatalf("a plain request carries neither: %s", plain)
	}
}

func TestSkillRequestScalesByTheCaseTypeMix(t *testing.T) {
	ct, other := "6f1d2c3e-5b7a-4e0f-9a1c-0d2e5f3a4b6c", "6f1d2c3e-5b7a-4e0f-9a1c-0d2e5f3a4b6d"
	z2 := "z2"
	reqs := []SkillRequirement{{CaseTypeID: &ct, Skill: "heavy", Share: 0.5}, {Skill: "arabic", Share: 1}, {ZoneID: &z2, Skill: "night", Share: 0.2},
		{CaseTypeID: &other, Skill: "heavy", Share: 1}}
	got := skillRequestFor(reqs, "z1", map[string]float64{ct: 0.4})
	want := []optSkillReq{{Skill: "arabic", Share: 1, ZoneID: "z1"}, {Skill: "heavy", Share: 0.2, ZoneID: "z1", CaseTypeID: ct}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %+v, want %+v (other zone and unseen case type left out)", got, want)
	}
}
