// SPDX-License-Identifier: AGPL-3.0-only

package forecastcal

import "testing"

func TestLocationCellPrecisionSetting(t *testing.T) {
	for _, ok := range []any{5, 6.0, 8} {
		if err := ValidateSetting(KeyLocationCellPrecision, ok); err != nil {
			t.Fatalf("%v: %v", ok, err)
		}
	}
	for _, bad := range []any{4, 9.0, 6.5, "6", nil} {
		if ValidateSetting(KeyLocationCellPrecision, bad) == nil {
			t.Fatalf("%v must be refused", bad)
		}
	}
	if Descriptions[KeyLocationCellPrecision] == "" {
		t.Fatal("the setting needs a description")
	}
	if LocationCellPrecision(0) != 6 || LocationCellPrecision(7) != 7 || LocationCellPrecision(12) != 6 {
		t.Fatal("out-of-range values fall back to 6")
	}
}
