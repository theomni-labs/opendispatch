// SPDX-License-Identifier: AGPL-3.0-only

package forecastcal

import "fmt"

// Geohash length of a micro-cell.
const KeyLocationCellPrecision = "forecast.location_cell_precision"

// About 1.2 km by 0.6 km.
const DefaultLocationCellPrecision = 6

func init() {
	Descriptions[KeyLocationCellPrecision] = "Geohash length of the forecast's location micro-cells, 5 to 8 (default 6, about 1.2 km by 0.6 km; 7 is about 150 m). Counts per cell only, never coordinates, go to the forecaster."
}

// ok false: not the precision key.
func validLocationSetting(key string, value any) (bool, error) {
	if key != KeyLocationCellPrecision {
		return false, nil
	}
	n, isNum := value.(float64)
	if i, isInt := value.(int); isInt {
		n, isNum = float64(i), true
	}
	if !isNum || n != float64(int(n)) || n < 5 || n > 8 {
		return true, fmt.Errorf("%s must be a whole number from 5 to 8", key)
	}
	return true, nil
}

// LocationCellPrecision: valid or default.
func LocationCellPrecision(v int) int {
	if v < 5 || v > 8 {
		return DefaultLocationCellPrecision
	}
	return v
}
