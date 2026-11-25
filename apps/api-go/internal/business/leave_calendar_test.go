// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

// Real values: fixtures/reference/holidays.json.
func TestToHijriDate_MatchesRealFixtures(t *testing.T) {
	cases := []struct {
		date    string
		y, m, d int
	}{
		{"2026-02-18", 1447, 9, 1},
		{"2026-03-20", 1447, 10, 1},
		{"2026-05-27", 1447, 12, 10},
	}
	for _, c := range cases {
		got, err := ToHijriDate(c.date)
		if err != nil {
			t.Fatalf("%s: %v", c.date, err)
		}
		if got.Year != c.y || got.Month != c.m || got.Day != c.d {
			t.Errorf("%s: got %+v, want {%d %d %d}", c.date, got, c.y, c.m, c.d)
		}
	}
}

func TestToHijriDate_RejectsBadInput(t *testing.T) {
	if _, err := ToHijriDate("not-a-date"); err == nil {
		t.Fatal("want error")
	}
}

// Real values: fixtures/reference/prayer_times.json.
func TestComputePrayerTime_MatchesRealFixtures(t *testing.T) {
	riyadh, err := computePrayerTimeFor("riyadh", 24.71, 46.68, "2026-09-06")
	if err != nil {
		t.Fatal(err)
	}
	want := PrayerTime{Fajr: "04:17", Sunrise: "05:36", Dhuhr: "11:52", Asr: "15:20", Maghrib: "18:07", Isha: "19:37"}
	if riyadh.Fajr != want.Fajr || riyadh.Sunrise != want.Sunrise || riyadh.Dhuhr != want.Dhuhr || riyadh.Asr != want.Asr || riyadh.Maghrib != want.Maghrib || riyadh.Isha != want.Isha {
		t.Errorf("Riyadh 2026-09-06: got %+v, want %+v", riyadh, want)
	}

	jeddah, err := computePrayerTimeFor("jeddah", 21.54, 39.17, "2026-09-12")
	if err != nil {
		t.Fatal(err)
	}
	want2 := PrayerTime{Fajr: "04:53", Sunrise: "06:09", Dhuhr: "12:20", Asr: "15:45", Maghrib: "18:29", Isha: "19:59"}
	if jeddah.Fajr != want2.Fajr || jeddah.Sunrise != want2.Sunrise || jeddah.Dhuhr != want2.Dhuhr || jeddah.Asr != want2.Asr || jeddah.Maghrib != want2.Maghrib || jeddah.Isha != want2.Isha {
		t.Errorf("Jeddah 2026-09-12: got %+v, want %+v", jeddah, want2)
	}
}

func TestListHijriMonths_EmptyUntilSeeded(t *testing.T) {
	ResetLeaveCalendarForTest()
	rc := roleCtx("t1", "u1", access.RoleAdministrator)
	got, err := ListHijriMonths(rc, HijriMonthQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 0 {
		t.Fatalf("got %d items, want 0 (nothing seeds HijriMonth in Go yet)", len(got.Items))
	}
}

func TestLeavePolicy_DefaultThenUpdate(t *testing.T) {
	ResetLeaveCalendarForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	got, err := GetLeavePolicy(admin)
	if err != nil {
		t.Fatal(err)
	}
	if got.MinNoticeDays != 7 || got.MaxConcurrentLeaveShare != 0.15 || len(got.BlackoutPeriods) != 0 {
		t.Fatalf("default: got %+v", got)
	}

	updated, err := UpdateLeavePolicy(admin, map[string]any{
		"min_notice_days": 14.0, "max_concurrent_leave_share": 0.2,
		"blackout_periods": []any{
			map[string]any{"start_date": "2026-03-20", "end_date": "2026-03-22", "label_en": "Eid al-Fitr"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.MinNoticeDays != 14 || updated.MaxConcurrentLeaveShare != 0.2 || len(updated.BlackoutPeriods) != 1 {
		t.Fatalf("updated: got %+v", updated)
	}

	again, err := GetLeavePolicy(admin)
	if err != nil {
		t.Fatal(err)
	}
	if again.MinNoticeDays != 14 {
		t.Fatalf("persisted: got %+v", again)
	}
}

func TestLeavePolicy_RefusesBadBlackoutPeriod(t *testing.T) {
	ResetLeaveCalendarForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	_, err := UpdateLeavePolicy(admin, map[string]any{
		"min_notice_days": 7.0, "max_concurrent_leave_share": 0.1,
		"blackout_periods": []any{
			map[string]any{"start_date": "2026-03-22", "end_date": "2026-03-20", "label_en": "Bad"},
		},
	})
	if de, ok := err.(*dataerr.DataError); !ok || de.Code != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid", err)
	}
}

func TestLeavePolicy_RequiresEditAccess(t *testing.T) {
	ResetLeaveCalendarForTest()
	planner := roleCtx("t1", "u1", access.RolePlanner)
	_, err := UpdateLeavePolicy(planner, map[string]any{
		"min_notice_days": 7.0, "max_concurrent_leave_share": 0.1, "blackout_periods": []any{},
	})
	if de, ok := err.(*dataerr.DataError); !ok || de.Code != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden", err)
	}
}

// --- Holiday: live Postgres ---

func TestHoliday_CreateUpdateDelete(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	created, err := CreateHoliday(ctx, conn, rc, map[string]any{
		"name_en": "Founding Day", "name_ar": "يوم التأسيس",
		"start_date": "2026-02-22", "end_date": "2026-02-22", "kind": "public",
	})
	check(t, err)
	if created.HijriStart.Year != 1447 || created.HijriStart.Month != 9 || created.HijriStart.Day != 5 {
		t.Fatalf("hijri_start = %+v, want {1447 9 5}", created.HijriStart)
	}
	if created.HijriStart != created.HijriEnd {
		t.Fatalf("single-day holiday: hijri_start != hijri_end: %+v vs %+v", created.HijriStart, created.HijriEnd)
	}

	updated, err := UpdateHoliday(ctx, conn, rc, created.ID, map[string]any{
		"name_en": "Founding Day (updated)", "name_ar": "يوم التأسيس",
		"start_date": "2026-02-22", "end_date": "2026-02-23", "kind": "public",
	})
	check(t, err)
	if updated.EndDate != "2026-02-23" {
		t.Fatalf("end_date = %s, want 2026-02-23", updated.EndDate)
	}
	if updated.HijriEnd.Day != 6 {
		t.Fatalf("hijri_end.day = %d, want 6", updated.HijriEnd.Day)
	}

	list, err := ListHolidays(ctx, conn, rc, HolidayQuery{})
	check(t, err)
	found := false
	for _, h := range list.Items {
		if h.ID == created.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("created holiday not found in list")
	}

	err = DeleteHoliday(ctx, conn, rc, created.ID)
	check(t, err)
	list2, err := ListHolidays(ctx, conn, rc, HolidayQuery{})
	check(t, err)
	for _, h := range list2.Items {
		if h.ID == created.ID {
			t.Fatal("deleted holiday still listed")
		}
	}
}

func TestHoliday_RefusesEndBeforeStartAndOtherRoles(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	_, err := CreateHoliday(ctx, conn, rc, map[string]any{
		"name_en": "Bad", "name_ar": "سيء", "start_date": "2026-03-22", "end_date": "2026-03-20", "kind": "public",
	})
	if de, ok := err.(*dataerr.DataError); !ok || de.Code != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid", err)
	}

	dispatcher := roleCtx("", "u", access.RoleDispatcher)
	dispatcher.CustomerID = rc.CustomerID
	_, err = CreateHoliday(ctx, conn, dispatcher, map[string]any{
		"name_en": "X", "name_ar": "س", "start_date": "2026-04-01", "end_date": "2026-04-01", "kind": "public",
	})
	if de, ok := err.(*dataerr.DataError); !ok || de.Code != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden", err)
	}
}

func TestHoliday_ListFiltersByDateRange(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	_, err := CreateHoliday(ctx, conn, rc, map[string]any{
		"name_en": "Ramadan Start", "name_ar": "بداية رمضان", "start_date": "2026-02-18", "end_date": "2026-02-18", "kind": "religious",
	})
	check(t, err)
	_, err = CreateHoliday(ctx, conn, rc, map[string]any{
		"name_en": "Far Future", "name_ar": "مستقبل بعيد", "start_date": "2026-12-25", "end_date": "2026-12-25", "kind": "observance",
	})
	check(t, err)

	list, err := ListHolidays(ctx, conn, rc, HolidayQuery{DateFrom: "2026-02-01", DateTo: "2026-02-28"})
	check(t, err)
	for _, h := range list.Items {
		if h.StartDate < "2026-02-01" || h.StartDate > "2026-02-28" {
			if !(h.EndDate >= "2026-02-01" && h.StartDate <= "2026-02-28") {
				t.Errorf("holiday %s (%s) outside requested range", h.NameEn, h.StartDate)
			}
		}
	}
}
