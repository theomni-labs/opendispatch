// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestOptimizerRequestSendsTheReachObjective(t *testing.T) {
	s := testOptimizerSource()
	s.ServiceLevel = &optServiceLevel{ThresholdSeconds: 600, TargetShare: 0.95}
	s.Travel = &travelModel{AverageSpeedKmh: 40, DetourFactor: 1.3}
	s.SubZones = []SubZone{
		{BaseRecord: trec(tSub1, "SYNTHETIC"), ZoneID: tZone, Latitude: 24.71, Longitude: 46.68, IsActive: true},
		{BaseRecord: trec(tSub2, "SYNTHETIC"), ZoneID: tZone, Latitude: 24.6, Longitude: 46.6},
		{BaseRecord: trec(tCase, "SYNTHETIC"), ZoneID: tCity, Latitude: 1, Longitude: 1, IsActive: true},
	}
	raw, err := buildOptimizerRequest(s)
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "optimizer", raw)
	var doc struct {
		Objective struct {
			ServiceLevel optServiceLevel `json:"service_level"`
		} `json:"objective"`
		Travel travelModel `json:"travel_model"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	sl := doc.Objective.ServiceLevel
	if sl.ThresholdSeconds != 600 || sl.TargetShare != 0.95 || len(sl.Centres) != 1 || sl.Centres[0].SubZoneID != tSub1 {
		t.Fatalf("service level: %+v", sl)
	}
	if doc.Travel != (travelModel{40, 1.3}) {
		t.Fatalf("travel model: %+v", doc.Travel)
	}
	s.ServiceLevel.TargetShare = 1.5
	if _, err := buildOptimizerRequest(s); !errors.Is(err, ErrEngineInput) {
		t.Fatalf("a bad target: got %v", err)
	}
}

func TestOptimizerRequestWithoutReachIsUnchanged(t *testing.T) {
	raw, err := buildOptimizerRequest(testOptimizerSource())
	if err != nil {
		t.Fatal(err)
	}
	for _, no := range []string{"service_level", "travel_model"} {
		if strings.Contains(string(raw), no) {
			t.Fatalf("%s sent without being asked: %s", no, raw)
		}
	}
}

func TestSimulatorRequestSendsTheTravelModel(t *testing.T) {
	s := testSimulatorSource()
	s.Travel = &travelModel{AverageSpeedKmh: 35, DetourFactor: 1.2}
	raw, err := buildSimulatorRequest(s)
	if err != nil {
		t.Fatal(err)
	}
	checkRequest(t, "simulator", raw)
	if !strings.Contains(string(raw), `"travel_model":{"average_speed_kmh":35,"detour_factor":1.2}`) {
		t.Fatalf("no travel model: %s", raw)
	}
}
