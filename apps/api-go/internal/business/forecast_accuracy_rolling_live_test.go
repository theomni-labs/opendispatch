// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func TestRollingAccuracyStoresTheWindowAndReadsIt(t *testing.T) {
	w := newEngineWorld(t)
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	ctx := context.Background()

	empty, err := GetRollingForecastAccuracy(ctx, w.conn, rc)
	check(t, err)
	if empty.WindowEnd != nil || empty.Overall != nil || empty.WindowDays != 28 || empty.MAPETarget != 0.15 || len(empty.Zones) != 0 {
		t.Fatalf("before any refresh: %+v", empty)
	}

	// 1.5 forecast at 09:00, 1 case at 09:07, 3 days
	start := shiftDateBy(w.today, -3)
	storedRun(t, w, rc, "m-roll", shiftDateBy(w.today, -4)+"T02:00:00+03:00", start, 3)
	got, err := RefreshRollingAccuracy(ctx, w.conn, rc)
	check(t, err)
	if got.Days != 3 || got.Zones != 1 || got.WindowEnd != shiftDateBy(w.today, -1) || got.WindowStart != shiftDateBy(w.today, -28) {
		t.Fatalf("refresh %+v", got)
	}

	acc, err := GetRollingForecastAccuracy(ctx, w.conn, rc)
	check(t, err)
	if acc.WindowEnd == nil || *acc.WindowEnd != got.WindowEnd || acc.ComputedAt == nil || !acc.Illustrative || acc.DataSource != "SYNTHETIC" || acc.MixedSources || len(acc.DataSources) != 1 {
		t.Fatalf("window %+v", acc)
	}
	o := acc.Overall
	if o == nil || o.Days != 3 || o.Forecast != 4.5 || o.Actual != 3 || o.MAPE == nil || *o.MAPE != 0.5 || o.WAPE == nil || *o.WAPE != 0.5 ||
		o.TargetStatus == nil || *o.TargetStatus != "above" {
		t.Fatalf("overall %+v", o)
	}
	if len(acc.Zones) != 1 || acc.Zones[0].ZoneID != w.zoneID || *acc.Zones[0].Figures.MAPE != 0.5 {
		t.Fatalf("zones %+v", acc.Zones)
	}
	if len(acc.Hours) != 24 || acc.Hours[9].Figures.Actual != 3 || *acc.Hours[9].Figures.MAPE != 0.5 || acc.Hours[8].Figures.MAPE != nil || acc.Hours[8].Figures.WAPE != nil {
		t.Fatalf("hours %+v %+v", acc.Hours[8], acc.Hours[9])
	}
	totals, err := loadHourTotals(ctx, w.conn, w.tenantID, got.WindowEnd)
	check(t, err)
	if len(totals) != 24 || totals[9].Actual != 3 || totals[9].Days != 3 {
		t.Fatalf("company hour totals %+v", totals[9])
	}
	if len(acc.Weekdays) != 3 {
		t.Fatalf("weekdays %+v", acc.Weekdays)
	}
	wd, _ := time.Parse("2006-01-02", start)
	if acc.Weekdays[0].Weekday > acc.Weekdays[1].Weekday || !hasWeekday(acc.Weekdays, int(wd.Weekday())) {
		t.Fatalf("weekdays %+v, want %d among them, in order", acc.Weekdays, wd.Weekday())
	}

	check(t, settingsstore.Put(context.Background(), w.tenantID, forecastcal.KeyMAPETarget, 0.5))
	lenient, err := GetRollingForecastAccuracy(ctx, w.conn, rc)
	check(t, err)
	if lenient.MAPETarget != 0.5 || *lenient.Overall.TargetStatus != "at_or_below" {
		t.Fatalf("target 0.5: %+v", lenient.Overall)
	}

	other := rc
	other.ZoneScope = access.ZoneScope{Kind: access.ScopeAssignedZones, ZoneIDs: []string{datactx.NewID()}}
	scoped, err := GetRollingForecastAccuracy(ctx, w.conn, other)
	check(t, err)
	if scoped.Overall != nil || len(scoped.Zones) != 0 || len(scoped.Hours) != 0 || scoped.WindowEnd != nil {
		t.Fatalf("another zone's scope: %+v", scoped)
	}

	var de *dataerr.DataError
	planner := plannerCtx(w.tenantID, datactx.NewID(), []string{w.zoneID})
	if _, err := GetRollingForecastAccuracy(ctx, w.conn, planner); !errors.As(err, &de) || de.Code != dataerr.CodeForbidden {
		t.Fatalf("a planner got %v", err)
	}
	if _, err := RefreshRollingAccuracy(ctx, w.conn, planner); !errors.As(err, &de) || de.Code != dataerr.CodeForbidden {
		t.Fatalf("a planner's refresh got %v", err)
	}
}

func hasWeekday(ws []RollingAccuracyWeekday, d int) bool {
	for _, w := range ws {
		if w.Weekday == d {
			return true
		}
	}
	return false
}

func TestRollingAccuracyWorkerJobRunsOnceADayAfterYesterdaysCases(t *testing.T) {
	w := newEngineWorld(t)
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	ctx := context.Background()
	storedRun(t, w, rc, "m-roll", shiftDateBy(w.today, -3)+"T02:00:00+03:00", shiftDateBy(w.today, -2), 2)

	var first WorkerCycleReport
	check(t, runRollingAccuracyJob(ctx, w.conn, w.actors.Forecast, &first))
	if !first.AccuracyStored || first.AccuracyDays != 2 {
		t.Fatalf("first cycle %+v", first)
	}
	var again WorkerCycleReport
	check(t, runRollingAccuracyJob(ctx, w.conn, w.actors.Forecast, &again))
	if again.AccuracyStored {
		t.Fatal("the same day's window was stored twice")
	}
	check(t, settingsstore.Put(context.Background(), w.tenantID, forecastcal.KeyAccuracyWindowDays, 7))
	var resized WorkerCycleReport
	check(t, runRollingAccuracyJob(ctx, w.conn, w.actors.Forecast, &resized))
	acc, err := GetRollingForecastAccuracy(ctx, w.conn, rc)
	check(t, err)
	if !resized.AccuracyStored || acc.WindowDays != 7 || *acc.WindowStart != shiftDateBy(w.today, -7) {
		t.Fatalf("a new window length: %+v %+v", resized, acc)
	}

	quiet, _ := adminCtx(t)
	conn := openConn(t)
	var none WorkerCycleReport
	check(t, runRollingAccuracyJob(ctx, conn, NewWorkerActors(quiet.CustomerID).Forecast, &none))
	if none.AccuracyStored {
		t.Fatal("stored without yesterday's cases")
	}
}
