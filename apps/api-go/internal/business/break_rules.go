// SPDX-License-Identifier: AGPL-3.0-only

// Ports break-rules.ts and calendar.ts's isRamadan:
// zone-day prayers, a pattern's break rule. Used by
// breaks.go and roster_plan.go.
package business

import (
	"context"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// IsRamadan mirrors isRamadan.
func IsRamadan(rc reqctx.RequestContext, date string) (bool, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return false, err
	}
	months := allHijriMonths()
	for _, m := range months {
		if m.IsRamadan && datactx.InDateRange(date, m.GregorianStart, m.GregorianEnd) {
			return true, nil
		}
	}
	return false, nil
}

// prayerTimeForOne mirrors prayerTimesFor: stored,
// else computed; nil if the city has no point.
func prayerTimeForOne(ctx context.Context, conn *tenancy.Connection, tenantID, cityID, date string) (*PrayerTime, error) {
	if row := storedPrayerTime(cityID, date); row != nil {
		return row, nil
	}
	zones, err := allZones(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	return prayerTimeIn(zones, cityID, date)
}

// storedPrayerTime: the stored row, nil if none.
func storedPrayerTime(cityID, date string) *PrayerTime {
	calendarMu.Lock()
	seedCalendarLocked()
	for _, p := range prayerTimeRows {
		if p.CityID == cityID && p.PrayerDate == date {
			row := p
			calendarMu.Unlock()
			return &row
		}
	}
	calendarMu.Unlock()
	return nil
}

// prayerTimeIn: prayerTimeForOne on loaded zones.
func prayerTimeIn(zones []Zone, cityID, date string) (*PrayerTime, error) {
	if row := storedPrayerTime(cityID, date); row != nil {
		return row, nil
	}
	lat, lng := cityPointIn(zones, cityID)
	if lat == nil {
		return nil, nil
	}
	pt, err := computePrayerTimeFor(cityID, *lat, *lng, date)
	if err != nil {
		return nil, err
	}
	return &pt, nil
}

func clockMinutes(clock string, plusDay int) int {
	h := int(clock[0]-'0')*10 + int(clock[1]-'0')
	m := int(clock[3]-'0')*10 + int(clock[4]-'0')
	return h*60 + m + plusDay*1440
}

// PrayerMinutesFor mirrors prayerMinutesFor: today's
// five prayers plus tomorrow's Fajr.
func PrayerMinutesFor(ctx context.Context, conn *tenancy.Connection, tenantID, zoneID, date string) ([]PrayerMinute, error) {
	zones, err := allZones(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	return prayerMinutesIn(zones, zoneID, date)
}

// prayerMinutesIn: PrayerMinutesFor on loaded zones.
func prayerMinutesIn(zones []Zone, zoneID, date string) ([]PrayerMinute, error) {
	var cityID string
	found := false
	for _, z := range zones {
		if z.ID == zoneID {
			cityID, found = z.CityID, true
			break
		}
	}
	if !found {
		return []PrayerMinute{}, nil
	}
	tomorrowDate, err := IsoAtMinute(date, 1440)
	if err != nil {
		return nil, err
	}
	tomorrowDate = tomorrowDate[:10]
	today, err := prayerTimeIn(zones, cityID, date)
	if err != nil {
		return nil, err
	}
	tomorrow, err := prayerTimeIn(zones, cityID, tomorrowDate)
	if err != nil {
		return nil, err
	}
	out := []PrayerMinute{}
	if today != nil {
		out = append(out,
			PrayerMinute{Name: PrayerFajr, Minute: clockMinutes(today.Fajr, 0)},
			PrayerMinute{Name: PrayerDhuhr, Minute: clockMinutes(today.Dhuhr, 0)},
			PrayerMinute{Name: PrayerAsr, Minute: clockMinutes(today.Asr, 0)},
			PrayerMinute{Name: PrayerMaghrib, Minute: clockMinutes(today.Maghrib, 0)},
			PrayerMinute{Name: PrayerIsha, Minute: clockMinutes(today.Isha, 0)},
		)
	}
	if tomorrow != nil {
		out = append(out, PrayerMinute{Name: PrayerFajr, Minute: clockMinutes(tomorrow.Fajr, 1)})
	}
	return out, nil
}

// BreakRuleOf mirrors breakRuleOf (the role matrix
// assumption: 30 min after 5h with no rule set).
func BreakRuleOf(ctx context.Context, conn *tenancy.Connection, tenantID, shiftPatternID string) (breakMinutes int, afterHours float64, err error) {
	pattern, err := oneShiftPattern(ctx, conn, tenantID, shiftPatternID)
	if err != nil {
		return 0, 0, err
	}
	if pattern == nil || pattern.BreakRuleID == nil {
		return 30, 5, nil
	}
	rule, err := oneBreakRule(ctx, conn, tenantID, *pattern.BreakRuleID)
	if err != nil {
		return 0, 0, err
	}
	if rule == nil {
		return 30, 5, nil
	}
	return rule.BreakMinutes, rule.AfterConsecutiveHours, nil
}
