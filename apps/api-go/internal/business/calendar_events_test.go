// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func eventsOf(items []CalendarEvent, kind string) []CalendarEvent {
	var out []CalendarEvent
	for _, e := range items {
		if e.Kind == kind {
			out = append(out, e)
		}
	}
	return out
}

func TestCalendarEvents_Derived(t *testing.T) {
	settingsstore.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	got, err := ListCalendarEvents(admin, "2026-01-01", "2026-12-31")
	check(t, err)
	if got.PaydayDay != forecastcal.DefaultPaydayDay {
		t.Fatalf("got %+v", got)
	}
	derived := eventsOf(got.Items, "derived")
	names := map[string]CalendarEvent{}
	for _, e := range derived {
		names[e.Name] = e
		if e.Editable || len(e.Scope.Cities) != 0 || e.Scope.Region != nil {
			t.Fatalf("derived %+v", e)
		}
	}
	nd, ok := names["National Day"]
	if !ok || nd.StartDate != "2026-09-23" || nd.Source != "fixed" || *nd.EventType != "national_day" {
		t.Fatalf("national day %+v", nd)
	}
	if eid, ok := names["Eid al-Fitr"]; !ok || eid.Source != "hijri" || eid.EndDate <= eid.StartDate {
		t.Fatalf("eid %+v", eid)
	}
	for _, name := range []string{"Arafah Day", "Hajj", "Hajj Pre-Season", "Hajj Post-Season", "Eid al-Adha", "Founding Day"} {
		if e, ok := names[name]; !ok || e.Source == "" {
			t.Fatalf("%s is missing from the derived events", name)
		}
	}
	if len(eventsOf(got.Items, "customer")) != 0 {
		t.Fatal("no customer calendar is loaded, so no customer events")
	}
	for _, bad := range [][2]string{{"2026-13-01", ""}, {"2026-01-01", "2025-01-01"}, {"2026-01-01", "2027-06-01"}} {
		if _, err := ListCalendarEvents(admin, bad[0], bad[1]); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("%v: got %v", bad, err)
		}
	}
}

func TestCalendarEvents_SetHereCrudAudited(t *testing.T) {
	settingsstore.ResetForTest()
	auditlog.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	term, err := CreateCalendarEvent(admin, map[string]any{"kind": "school", "name": "Term 1", "start_date": "2026-08-23", "end_date": "2026-11-26"})
	check(t, err)
	if !term.Editable || term.Source != "setting" || term.Kind != "school" {
		t.Fatalf("created %+v", term)
	}
	if _, err := CreateCalendarEvent(admin, map[string]any{"kind": "school", "name": "Clash", "start_date": "2026-11-01", "end_date": "2026-12-01"}); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("overlap: got %v", err)
	}
	_, err = CreateCalendarEvent(admin, map[string]any{"kind": "season", "name": "Riyadh Season", "start_date": "2026-10-10", "end_date": "2027-03-31"})
	check(t, err)
	stored := readSetting[[]forecastcal.Range](context.Background(), "t1", forecastcal.KeySchoolTerms, nil)
	if len(stored) != 1 || stored[0].Name != "Term 1" {
		t.Fatalf("stored %+v", stored)
	}
	moved, err := UpdateCalendarEvent(admin, term.ID, map[string]any{"kind": "school", "name": "Term 1", "start_date": "2026-08-30", "end_date": "2026-11-26"})
	check(t, err)
	if moved.ID == term.ID || moved.StartDate != "2026-08-30" {
		t.Fatalf("moved %+v", moved)
	}
	if _, err := UpdateCalendarEvent(admin, moved.ID, map[string]any{"kind": "umrah", "name": "x", "start_date": "2026-08-30", "end_date": "2026-11-26"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("kind change: got %v", err)
	}
	if _, err := UpdateCalendarEvent(admin, term.ID, map[string]any{"kind": "school", "name": "x", "start_date": "2026-08-30", "end_date": "2026-11-26"}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("stale id: got %v", err)
	}
	for _, bad := range []map[string]any{
		{"kind": "school", "name": "x", "start_date": "2026-09-01", "end_date": "2026-08-01"},
		{"kind": "school", "name": " ", "start_date": "2026-09-01", "end_date": "2026-09-02"},
		{"kind": "derived", "name": "x", "start_date": "2026-09-01", "end_date": "2026-09-02"},
		{"kind": "school", "name": "x", "start_date": "2026-9-1", "end_date": "2026-09-02"},
		{"kind": "school", "name": "x", "start_date": "2026-09-01", "end_date": "2026-09-02", "cities": []any{}},
	} {
		if _, err := CreateCalendarEvent(admin, bad); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("%v: got %v", bad, err)
		}
	}
	check(t, DeleteCalendarEvent(admin, moved.ID))
	if err := DeleteCalendarEvent(admin, moved.ID); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("second delete: got %v", err)
	}
	got, err := ListCalendarEvents(admin, "", "")
	check(t, err)
	if len(eventsOf(got.Items, "school")) != 0 || len(eventsOf(got.Items, "season")) != 1 {
		t.Fatalf("after delete %+v", got.Items)
	}
	actions := map[string]bool{}
	for _, e := range auditlog.AllEvents() {
		if e.Outcome == "success" {
			actions[e.Action] = true
		}
	}
	for _, a := range []string{"calendar_event.created", "calendar_event.updated", "calendar_event.deleted"} {
		if !actions[a] {
			t.Fatalf("no %s in %v", a, actions)
		}
	}
}

func TestPaydayDay_SetAndOff(t *testing.T) {
	settingsstore.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	got, err := UpdatePaydayDay(admin, map[string]any{"payday_day": float64(25)})
	check(t, err)
	if got.PaydayDay != 25 || readSetting(context.Background(), "t1", forecastcal.KeyPaydayDay, 0) != 25 {
		t.Fatalf("got %+v", got)
	}
	_, err = UpdatePaydayDay(admin, map[string]any{"payday_day": float64(0)})
	check(t, err)
	list, err := ListCalendarEvents(admin, "", "")
	check(t, err)
	if list.PaydayDay != 0 {
		t.Fatalf("off: %d", list.PaydayDay)
	}
	for _, bad := range []any{float64(32), float64(-1), 2.5, "5", nil} {
		if _, err := UpdatePaydayDay(admin, map[string]any{"payday_day": bad}); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("%v: got %v", bad, err)
		}
	}
}

func TestCalendarEvents_RolesDeniedAndAudited(t *testing.T) {
	settingsstore.ResetForTest()
	expectDenied(t, []deniedWrite{
		{"calendar_event.created", "calendar_event", func() error { _, err := CreateCalendarEvent(viewer(), map[string]any{}); return err }},
		{"calendar_event.updated", "calendar_event", func() error { _, err := UpdateCalendarEvent(viewer(), junkID, map[string]any{}); return err }},
		{"calendar_event.deleted", "calendar_event", func() error { return DeleteCalendarEvent(viewer(), junkID) }},
		{"settings.payday_day_changed", "setting", func() error { _, err := UpdatePaydayDay(viewer(), map[string]any{}); return err }},
	})
	for _, role := range []access.Role{access.RoleDispatcher, access.RolePlanner, access.RoleRemoteTeamLead} {
		if _, err := ListCalendarEvents(roleCtx("t1", "u1", role), "", ""); errCode(err) != dataerr.CodeForbidden {
			t.Fatalf("%s: got %v", role, err)
		}
	}
}
