// SPDX-License-Identifier: AGPL-3.0-only

package business

import "testing"

func TestCasesMoveOntoTheRostersDay(t *testing.T) {
	at := "2026-09-12T08:10:00+03:00"
	cases := []simDayCase{{ID: "a", RegisteredAt: at, ActualAssignedAt: &at}, {ID: "b", RegisteredAt: "2026-09-11T23:50:00+03:00"}}
	got, err := shiftDayCases(cases, "2026-09-12", "2026-09-19")
	if err != nil {
		t.Fatal(err)
	}
	if got[0].RegisteredAt != "2026-09-19T08:10:00+03:00" || *got[0].ActualAssignedAt != "2026-09-19T08:10:00+03:00" || got[1].RegisteredAt != "2026-09-18T23:50:00+03:00" {
		t.Fatalf("got %+v, want the same times a week on", got)
	}
	if cases[0].RegisteredAt != at {
		t.Fatal("the loaded cases were changed")
	}
	same, err := shiftDayCases(cases, "2026-09-12", "2026-09-12")
	if err != nil || same[0].RegisteredAt != at {
		t.Fatalf("got %v %v, want no change for the same day", same, err)
	}
	if _, err := shiftDayCases(cases, "bad", "2026-09-12"); err == nil {
		t.Fatal("want an error for a bad date")
	}
}
