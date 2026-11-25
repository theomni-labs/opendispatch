// SPDX-License-Identifier: AGPL-3.0-only

package forecastcal

import "fmt"

// Rolling accuracy settings.
const (
	KeyAccuracyWindowDays = "forecast.accuracy_window_days"
	KeyMAPETarget         = "forecast.mape_target"

	DefaultAccuracyWindowDays = 28
	MinAccuracyWindowDays     = 7
	MaxAccuracyWindowDays     = 90
	DefaultMAPETarget         = 0.15
)

func init() {
	Descriptions[KeyAccuracyWindowDays] = "Rolling forecast accuracy: the past days measured, each against the forecast made for it. Whole number from 7 to 90 (default 28)."
	Descriptions[KeyMAPETarget] = "Rolling forecast accuracy: the MAPE target, as a share. Number above 0, at most 1 (default 0.15)."
}

// ok false: not an accuracy key.
func validAccuracySetting(key string, value any) (bool, error) {
	switch key {
	case KeyAccuracyWindowDays:
		return true, wholeIn(key, value, MinAccuracyWindowDays, MaxAccuracyWindowDays)
	case KeyMAPETarget:
		n, ok := value.(float64)
		if !ok || n <= 0 || n > 1 {
			return true, fmt.Errorf("%s must be a number above 0, at most 1", key)
		}
		return true, nil
	}
	return false, nil
}

// AccuracyWindowDays: valid or default.
func AccuracyWindowDays(v int) int {
	if v < MinAccuracyWindowDays || v > MaxAccuracyWindowDays {
		return DefaultAccuracyWindowDays
	}
	return v
}

// MAPETarget: valid or default.
func MAPETarget(v float64) float64 {
	if v <= 0 || v > 1 {
		return DefaultMAPETarget
	}
	return v
}
