// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	// prayerPenaltyKey: default off (3 Oct 2026)
	prayerPenaltyKey = "dispatch.prayer_penalty"
	// busyOverrun: busy_until once the estimate passed
	busyOverrun = 5 * time.Minute
)

// assignmentExtras: request inputs from settings.
type assignmentExtras struct {
	Travel         travelModel
	OnSceneSeconds float64
	Prayer         map[string]string
}

// getPrayerPenalty: send prayer_window or not
func getPrayerPenalty(ctx context.Context, tenant string) bool {
	return readSetting(ctx, tenant, prayerPenaltyKey, false)
}

// assignmentExtrasFor reads the tenant's settings.
func assignmentExtrasFor(ctx context.Context, c Case, atMs int64) assignmentExtras {
	onScene := fallbackOnSceneMin
	if v := minutesSetting(ctx, c.TenantID, demandOnSceneKey); v != nil {
		onScene = *v
	}
	x := assignmentExtras{Travel: getTravelModel(ctx, c.TenantID), OnSceneSeconds: onScene * 60}
	if getPrayerPenalty(ctx, c.TenantID) {
		x.Prayer = assignmentPrayerWindow(ctx, c, timeFromMs(atMs))
	}
	return x
}

// busyUntil: when a busy agent should be free.
func busyUntil(s liveAgent, atMs int64, x assignmentExtras) *time.Time {
	if s.Open == nil || (s.Status != "assigned" && s.Status != "en_route" && s.Status != "on_scene") {
		return nil
	}
	now := timeFromMs(atMs)
	onScene := time.Duration(x.OnSceneSeconds * float64(time.Second))
	var end time.Time
	switch {
	case s.Open.ArrivedAt != nil:
		end = s.Open.ArrivedAt.Add(onScene)
	case s.Lat != nil && s.Lon != nil && s.Open.Lat != nil && s.Open.Lon != nil && x.Travel.AverageSpeedKmh > 0:
		km := haversineKm(*s.Lat, *s.Lon, *s.Open.Lat, *s.Open.Lon)
		travel := time.Duration(x.Travel.minutesFor(km*1000) * float64(time.Minute))
		end = now.Add(travel + onScene)
	default:
		return nil
	}
	if floor := now.Add(busyOverrun); end.Before(floor) {
		end = floor
	}
	return &end
}

// assignmentPrayerWindow: current or next today
func assignmentPrayerWindow(ctx context.Context, c Case, at time.Time) map[string]string {
	if c.CityID == "" {
		return nil
	}
	date := at.In(riyadhZone).Format("2006-01-02")
	var conn *tenancy.Connection
	if feedSource != nil {
		conn = feedSource.conn
	}
	pt := storedPrayerTime(c.CityID, date)
	if pt == nil && conn != nil {
		var err error
		if pt, err = prayerTimeForOne(ctx, conn, c.TenantID, c.CityID, date); err != nil {
			pt = nil
		}
	}
	if pt == nil {
		return nil
	}
	minutes := time.Duration(prayerPolicyOf(ctx, c.TenantID).window()) * time.Minute
	for _, p := range []struct {
		name  PrayerName
		clock string
	}{{PrayerFajr, pt.Fajr}, {PrayerDhuhr, pt.Dhuhr}, {PrayerAsr, pt.Asr}, {PrayerMaghrib, pt.Maghrib}, {PrayerIsha, pt.Isha}} {
		start, err := time.ParseInLocation("2006-01-02 15:04", date+" "+p.clock, riyadhZone)
		if err != nil {
			continue
		}
		if end := start.Add(minutes); end.After(at) {
			return map[string]string{"name": string(p.name), "starts_at": start.Format(time.RFC3339), "ends_at": end.Format(time.RFC3339)}
		}
	}
	return nil
}
