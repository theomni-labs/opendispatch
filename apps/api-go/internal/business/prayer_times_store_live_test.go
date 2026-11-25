// SPDX-License-Identifier: AGPL-3.0-only

// Live: prayer times and the leave policy kept in Postgres.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func prayerRow(tenant, city, date, fajr string) PrayerTime {
	at := datactx.NowISO()
	return PrayerTime{
		BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenant, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
		CityID:     city, PrayerDate: date, Fajr: fajr, Sunrise: "05:30", Dhuhr: "12:00", Asr: "15:30", Maghrib: "18:00", Isha: "19:30", CalculationMethod: "umm_al_qura",
	}
}

func TestPostgresPrayerTimesSurviveARestartAndAreAllOrNothing(t *testing.T) {
	conn := settingsConn(t)
	owner := ownerPool(t)
	UsePostgresPrayerTimes(conn)
	t.Cleanup(UseMemoryPrayerTimes)
	a, b := freshTenant(), freshTenant()
	var city string
	if err := owner.QueryRow(context.Background(), `INSERT INTO cities (tenant_id, data_source, name_en) VALUES ($1, 'SYNTHETIC', 'Testville') RETURNING id::text`, a).Scan(&city); err != nil {
		t.Fatal(err)
	}
	if err := savePrayerTimes(context.Background(), a, []PrayerTime{prayerRow(a, city, "2026-10-01", "04:10"), prayerRow(a, city, "2026-10-02", "04:11")}); err != nil {
		t.Fatal(err)
	}
	if err := savePrayerTimes(context.Background(), a, []PrayerTime{prayerRow(a, city, "2026-10-01", "04:20")}); err != nil {
		t.Fatal(err)
	}
	bad := []PrayerTime{prayerRow(a, city, "2026-10-03", "04:12"), prayerRow(a, datactx.NewID(), "2026-10-04", "04:13")}
	if err := savePrayerTimes(context.Background(), a, bad); err == nil {
		t.Fatal("a batch with an unknown city was accepted")
	}
	UseMemoryPrayerTimes()
	UsePostgresPrayerTimes(conn)
	got, err := loadPrayerTimes(context.Background(), a, city)
	if err != nil || len(got) != 2 || got[0].Fajr != "04:20" || got[0].PrayerDate != "2026-10-01" {
		t.Fatalf("after a restart: %+v %v", got, err)
	}
	if other, _ := loadPrayerTimes(context.Background(), b, ""); len(other) != 0 {
		t.Fatalf("another customer sees %d rows", len(other))
	}
}

func TestPostgresLeavePolicySurvivesARestartAndStaysPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	settingsstore.UsePostgres(conn)
	t.Cleanup(settingsstore.UseMemory)
	a, b := adminOf(freshTenant()), adminOf(freshTenant())
	if _, err := UpdateLeavePolicy(a, map[string]any{"min_notice_days": 21.0, "max_concurrent_leave_share": 0.3,
		"blackout_periods": []any{map[string]any{"start_date": "2026-12-01", "end_date": "2026-12-05", "label_en": "Peak"}}}); err != nil {
		t.Fatal(err)
	}
	settingsstore.UseMemory()
	settingsstore.UsePostgres(conn)
	got, err := GetLeavePolicy(a)
	if err != nil || got.MinNoticeDays != 21 || len(got.BlackoutPeriods) != 1 || got.BlackoutPeriods[0].LabelEn != "Peak" {
		t.Fatalf("after a restart: %+v %v", got, err)
	}
	other, err := GetLeavePolicy(b)
	if err != nil || other.MinNoticeDays != 7 {
		t.Fatalf("another customer sees %+v %v", other, err)
	}
}
