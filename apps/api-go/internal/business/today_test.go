// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

// withToday sets demo.today and a fixed clock.
func withToday(t *testing.T, demo any, now time.Time) {
	t.Helper()
	settingsstore.UseMemory()
	const tenant = "t-today"
	before, err := settingsstore.Get[any](context.Background(), tenant, "demo.today", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := settingsstore.Put(context.Background(), tenant, "demo.today", demo); err != nil {
		t.Fatal(err)
	}
	pinned := pinnedToday
	pinnedToday = ""
	clock = func() time.Time { return now }
	t.Cleanup(func() {
		clock, pinnedToday = time.Now, pinned
		_ = settingsstore.Put(context.Background(), tenant, "demo.today", before)
	})
}

func TestToday_DemoSettingWins(t *testing.T) {
	withToday(t, "2026-09-13", time.Date(2027, 1, 2, 12, 0, 0, 0, time.UTC))
	if got := Today("t-today"); got != "2026-09-13" {
		t.Fatalf("Today = %s, want the demo day", got)
	}
	if got := DemoToday("t-today"); got != "2026-09-13" {
		t.Fatalf("DemoToday = %s, want Today", got)
	}
	if got := scoredEnd(context.Background(), "t-today"); got != "2026-09-14" {
		t.Fatalf("scoredEnd = %s, want the day after the demo day", got)
	}
}

func TestToday_RealInstallUsesRiyadhClock(t *testing.T) {
	// 22:30 UTC is 01:30 the next day in Riyadh
	now := time.Date(2027, 1, 2, 22, 30, 0, 0, time.UTC)
	for _, unset := range []any{"", nil, "not a date"} {
		withToday(t, unset, now)
		if got := Today("t-today"); got != "2027-01-03" {
			t.Fatalf("demo.today=%v: Today = %s, want 2027-01-03", unset, got)
		}
		if got := scoredEnd(context.Background(), "t-today"); got != "2027-01-03" {
			t.Fatalf("demo.today=%v: scoredEnd = %s, want today (partial) left out", unset, got)
		}
	}
}

func TestToday_MovesWithTheClock(t *testing.T) {
	withToday(t, "", time.Date(2027, 3, 1, 9, 0, 0, 0, riyadhZone))
	first := Today("t-today")
	clock = func() time.Time { return time.Date(2027, 3, 2, 9, 0, 0, 0, riyadhZone) }
	if second := Today("t-today"); first != "2027-03-01" || second != "2027-03-02" {
		t.Fatalf("Today = %s then %s, want a new day each day", first, second)
	}
}
