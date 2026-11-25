// SPDX-License-Identifier: AGPL-3.0-only

// Pure part only; PrayerMinutesFor/BreakRuleOf need
// live Postgres, covered by roster_plan's live test.
package business

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
)

func TestIsRamadan_InAndOutOfRange(t *testing.T) {
	ResetLeaveCalendarForTest()
	calendarMu.Lock()
	hijriMonthRows = []HijriMonth{{GregorianStart: "2027-03-11", GregorianEnd: "2027-04-09", IsRamadan: true}}
	calendarMu.Unlock()
	rc := roleCtx("t1", "u1", access.RoleAdministrator)

	inRange, err := IsRamadan(rc, "2027-03-20")
	check(t, err)
	if !inRange {
		t.Fatalf("got false, want true for a date inside the Ramadan month")
	}
	outOfRange, err := IsRamadan(rc, "2027-05-01")
	check(t, err)
	if outOfRange {
		t.Fatalf("got true, want false for a date outside the Ramadan month")
	}
}

func TestClockMinutes_PlusDayRollsForward(t *testing.T) {
	if got := clockMinutes("06:30", 0); got != 390 {
		t.Fatalf("got %d, want 390", got)
	}
	if got := clockMinutes("06:30", 1); got != 1830 {
		t.Fatalf("got %d, want 1830", got)
	}
}
