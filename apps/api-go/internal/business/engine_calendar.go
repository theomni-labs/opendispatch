// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

const (
	defaultGateMinImprovement = 0.10
	defaultGateWorseZones     = 0.25
)

// forecastCalendarConfig reads the calendar settings.
func forecastCalendarConfig(ctx context.Context, tenant string) forecastcal.Config {
	return forecastcal.Config{
		PaydayDay:         readSetting(ctx, tenant, forecastcal.KeyPaydayDay, forecastcal.DefaultPaydayDay),
		SalaryWindowStart: forecastcal.DefaultSalaryWindowStart,
		SchoolTerms:       readSetting[[]forecastcal.Range](ctx, tenant, forecastcal.KeySchoolTerms, nil),
		SeasonEvents:      readSetting[[]forecastcal.Range](ctx, tenant, forecastcal.KeySeasonEvents, nil),
		UmrahWindows:      readSetting[[]forecastcal.Range](ctx, tenant, forecastcal.KeyUmrahWindows, nil),
		NoticeEvents:      readSetting[[]forecastcal.NoticeRange](ctx, tenant, forecastcal.KeyNoticeEvents, nil),
	}
}

// applyCalendar puts the derived features on a day.
func applyCalendar(d *forecastDay, c forecastcal.Config) {
	f := c.For(d.Date)
	d.Payday, d.School, d.Events, d.Hijri, d.Extras = f.IsPayday, f.SchoolInSession, f.Events, f.Hijri, f.Extras
}

// planningQuantile: the forecast value staffing covers.
func planningQuantile(ctx context.Context, tenant string) string {
	if readSetting(ctx, tenant, forecastcal.KeyPlanningMode, "central") == "high" {
		return "high"
	}
	return "expected"
}
