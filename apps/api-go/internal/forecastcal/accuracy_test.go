// SPDX-License-Identifier: AGPL-3.0-only

package forecastcal

import "testing"

func TestAccuracySettings(t *testing.T) {
	for _, ok := range []any{7, 28.0, 90} {
		if err := ValidateSetting(KeyAccuracyWindowDays, ok); err != nil {
			t.Fatalf("window %v: %v", ok, err)
		}
	}
	for _, bad := range []any{6, 91.0, 28.5, "28", nil} {
		if ValidateSetting(KeyAccuracyWindowDays, bad) == nil {
			t.Fatalf("window %v must be refused", bad)
		}
	}
	for _, ok := range []any{0.15, 1.0, 0.01} {
		if err := ValidateSetting(KeyMAPETarget, ok); err != nil {
			t.Fatalf("target %v: %v", ok, err)
		}
	}
	for _, bad := range []any{0.0, -0.1, 1.5, "0.15", nil} {
		if ValidateSetting(KeyMAPETarget, bad) == nil {
			t.Fatalf("target %v must be refused", bad)
		}
	}
	if Descriptions[KeyAccuracyWindowDays] == "" || Descriptions[KeyMAPETarget] == "" {
		t.Fatal("both settings need a description")
	}
	if AccuracyWindowDays(0) != 28 || AccuracyWindowDays(14) != 14 || MAPETarget(0) != 0.15 || MAPETarget(0.2) != 0.2 {
		t.Fatal("out-of-range values fall back to the defaults")
	}
}
