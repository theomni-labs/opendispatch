// SPDX-License-Identifier: AGPL-3.0-only

package synthetic

// WorkforceCal: calibration.json "workforce".
type WorkforceCal struct {
	SickDaysPerYear  float64
	WorkingDays      float64
	SickMonthFactor  []float64
	SickZoneMin      float64
	SickZoneMax      float64
	AttendanceDays   int
	LateShare        float64
	LateMin, LateMax float64
	EarlyShare       float64
	EarlyMin         float64
	EarlyMax         float64
	TimedWeeks       int
	OnSceneFracMin   float64
	OnSceneFracMax   float64
}

// Workforce reads the workforce block.
func Workforce() (WorkforceCal, error) {
	var w WorkforceCal
	var err error
	get := func(dst *float64, path ...string) {
		if err == nil {
			*dst, err = calFloat(path...)
		}
	}
	geti := func(dst *int, path ...string) {
		if err == nil {
			*dst, err = calInt(path...)
		}
	}
	get(&w.SickDaysPerYear, "workforce", "sick_days_per_fte_year", "value")
	get(&w.WorkingDays, "workforce", "working_days_per_fte_year", "value")
	if err == nil {
		w.SickMonthFactor, err = calFloatArray("workforce", "sick_month_factor", "value")
	}
	get(&w.SickZoneMin, "workforce", "sick_zone_factor", "min")
	get(&w.SickZoneMax, "workforce", "sick_zone_factor", "max")
	geti(&w.AttendanceDays, "workforce", "attendance_days", "value")
	get(&w.LateShare, "workforce", "late_start_share", "value")
	get(&w.LateMin, "workforce", "late_start_minutes", "min")
	get(&w.LateMax, "workforce", "late_start_minutes", "max")
	get(&w.EarlyShare, "workforce", "early_finish_share", "value")
	get(&w.EarlyMin, "workforce", "early_finish_minutes", "min")
	get(&w.EarlyMax, "workforce", "early_finish_minutes", "max")
	geti(&w.TimedWeeks, "workforce", "timed_history_weeks", "value")
	get(&w.OnSceneFracMin, "timing_model", "on_scene_completed_fraction_of_closing", "min")
	get(&w.OnSceneFracMax, "timing_model", "on_scene_completed_fraction_of_closing", "max")
	if err == nil && len(w.SickMonthFactor) != 12 {
		return w, errMonthFactor
	}
	return w, err
}

type calError string

func (e calError) Error() string { return string(e) }

const errMonthFactor = calError("calibration.workforce.sick_month_factor: want 12 values")
