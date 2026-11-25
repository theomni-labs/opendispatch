// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"log"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

// clock is the wall clock; tests replace it.
var clock = time.Now

// pinnedToday: a demo day for tests; "" in builds.
var pinnedToday string

// Today: the business date in Asia/Riyadh.
func Today(tenant string) string { return todayIn(context.Background(), tenant) }

// todayIn: Today inside ctx's unit.
func todayIn(ctx context.Context, tenant string) string {
	d, _ := today(ctx, tenant)
	return d
}

// today: demo.today when set, else the clock.
func today(ctx context.Context, tenant string) (string, bool) {
	v := readSetting(ctx, tenant, "demo.today", "")
	if demoTodayPattern.MatchString(v) {
		return v, true
	}
	if v != "" {
		log.Printf("settings: demo.today %q is not a date; using the clock", v)
	}
	if pinnedToday != "" {
		return pinnedToday, true
	}
	return clock().In(riyadhZone).Format("2006-01-02"), false
}

// scoredEnd: exclusive end of days with all cases.
func scoredEnd(ctx context.Context, tenant string) string {
	d, demo := today(ctx, tenant)
	if demo {
		return shiftDateBy(d, 1) // the demo day is whole
	}
	return d
}

// appNowISO: now, on the app's own day.
func appNowISO(ctx context.Context, tenant string) string {
	now := datactx.NowISO()
	d, demo := today(ctx, tenant)
	if !demo || len(now) < 10 {
		return now
	}
	return d + now[10:]
}
