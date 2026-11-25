// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func TestAppNowISO_KeepsTheTimeOnTheAppsDay(t *testing.T) {
	at := time.Date(2026, 10, 2, 11, 30, 5, 0, time.UTC)
	datactx.SetNowForTest(&at)
	t.Cleanup(func() { datactx.SetNowForTest(nil) })
	got := appNowISO(context.Background(), "")
	if got[:10] != "2026-09-13" || got[10:] != datactx.NowISO()[10:] {
		t.Fatalf("got %s, want the demo day 2026-09-13 at the wall-clock time %s", got, datactx.NowISO())
	}
	saved := pinnedToday
	pinnedToday = ""
	settingsstore.ResetForTest()
	t.Cleanup(func() { pinnedToday = saved; settingsstore.ReloadForTest() })
	if got := appNowISO(context.Background(), ""); got != datactx.NowISO() {
		t.Fatalf("got %s, want the wall clock when no demo day is set", got)
	}
}
