// SPDX-License-Identifier: AGPL-3.0-only

// Verifies buildLocations against real
// gen/locations.ts output (tsx), for the real seed
// (calibration.structure.seed.value).
package synthetic

import (
	"math"
	"testing"
)

const realSeed = "opendispatch-synthetic-2026-09-v1"

func approxEq(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
}

func TestBuildLocations_MatchesTS(t *testing.T) {
	loc, err := buildLocations(realSeed)
	if err != nil {
		t.Fatalf("buildLocations: %v", err)
	}
	if len(loc.Cities) != 3 {
		t.Fatalf("cityCount: got %d, want 3", len(loc.Cities))
	}
	if len(loc.Zones) != 8 {
		t.Fatalf("zoneCount: got %d, want 8", len(loc.Zones))
	}
	if len(loc.SubZones) != 111 {
		t.Fatalf("subZoneCount: got %d, want 111", len(loc.SubZones))
	}
	if len(loc.StandbyPoints) != 34 {
		t.Fatalf("standbyCount: got %d, want 34", len(loc.StandbyPoints))
	}

	c0 := loc.Cities[0]
	if c0.ID != "c602613f-ca37-49ae-b617-7e2c29fc2a84" || c0.Code != "RD" || c0.Share != 0.62 {
		t.Fatalf("city0: got %+v", c0)
	}

	z0 := loc.Zones[0]
	if z0.ID != "091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a" || z0.Code != "RD-C" || z0.DemandWeight != 0.26 || z0.SortOrder != 1 {
		t.Fatalf("zone0: got %+v", z0)
	}
	z1 := loc.Zones[1]
	if z1.ID != "eecf5c7f-237c-443c-b331-b75ba3fb26fc" || !approxEq(z1.Center.Lat, 24.808814229249013) || !approxEq(z1.Center.Lng, 46.68) {
		t.Fatalf("zone1: got %+v", z1)
	}

	sz0 := loc.SubZones[0]
	if sz0.ID != "1c3884cd-b920-4cdc-8f46-d3fa53127ce3" || sz0.Code != "RD-C-01" || sz0.NameEn != "Amber Terrace" {
		t.Fatalf("subZone0: got %+v", sz0)
	}
	if !approxEq(sz0.Center.Lat, 24.711238066388788) || !approxEq(sz0.Center.Lng, 46.62914534442711) || !approxEq(sz0.DemandWeight, 0.05418149012355263) {
		t.Fatalf("subZone0 values: got %+v", sz0)
	}
	sz1 := loc.SubZones[1]
	if sz1.ID != "54293f6f-617f-4055-b9af-35236212daae" || sz1.NameEn != "Zephyr Quarter" {
		t.Fatalf("subZone1: got %+v", sz1)
	}

	sp0 := loc.StandbyPoints[0]
	if sp0.ID != "92b7ff9b-6358-4eb7-9690-8b004d8f600c" || sp0.Code != "RD-C-SP1" || sp0.NameEn != "Fjord Fields standby" || sp0.CoverageRadiusM != 4500 {
		t.Fatalf("standby0: got %+v", sp0)
	}
	if !approxEq(sp0.Position.Lat, 24.681782180916983) || !approxEq(sp0.Position.Lng, 46.66373494792716) {
		t.Fatalf("standby0 position: got %+v", sp0.Position)
	}

	lastZone := loc.Zones[len(loc.Zones)-1]
	if lastZone.ID != "9eb021e8-b6a5-4fc0-add9-db600d697b78" || lastZone.Code != "DM-C" || lastZone.SortOrder != 8 {
		t.Fatalf("lastZone: got %+v", lastZone)
	}
	lastSubZone := loc.SubZones[len(loc.SubZones)-1]
	if lastSubZone.ID != "7c390bc2-9f30-40c8-9d9e-4d254b3b9781" || lastSubZone.Code != "DM-C-14" || lastSubZone.NameEn != "Nova Fields" {
		t.Fatalf("lastSubZone: got %+v", lastSubZone)
	}

	perZone := map[string]int{"RD-C": 12, "RD-N": 16, "RD-E": 16, "RD-S": 11, "RD-W": 11, "JD-N": 17, "JD-S": 14, "DM-C": 14}
	counts := map[string]int{}
	byID := map[string]string{}
	for _, z := range loc.Zones {
		byID[z.ID] = z.Code
	}
	for _, s := range loc.SubZones {
		counts[byID[s.ZoneID]]++
	}
	for code, want := range perZone {
		if counts[code] != want {
			t.Fatalf("perZone[%s]: got %d, want %d", code, counts[code], want)
		}
	}
}
