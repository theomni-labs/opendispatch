// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"encoding/json"
	"testing"
)

func TestLocationImportResultJSON(t *testing.T) {
	b, err := json.Marshal(LocationImportResult{Cities: 1, Zones: 2, SubZones: 3, StandbyPoints: 4, Total: 10})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"cities":1,"zones":2,"sub_zones":3,"standby_points":4,"total":10}`
	if string(b) != want {
		t.Fatalf("got %s want %s", b, want)
	}
}
