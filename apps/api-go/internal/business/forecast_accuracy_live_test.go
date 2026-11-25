// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"errors"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// storedRun keeps a run with 1.5 cases at 09:00.
func storedRun(t *testing.T, w engineWorld, rc reqctx.RequestContext, model, createdAt, start string, days int) ForecastRun {
	t.Helper()
	run := ForecastRun{BaseRecord: datactx.NewRecord(rc, "", createdAt), ModelVersion: model, Status: "succeeded", HorizonStartDate: start, HorizonDays: days, RangeCoverage: 0.8, Illustrative: true, InputDataSources: []string{"SYNTHETIC"}}
	check(t, forecastRunBackendInUse.save(context.Background(), w.tenantID, run))
	doc := ForecasterEngineOutput{ModelVersion: model, DataSource: "SYNTHETIC", Illustrative: true}
	for d := 0; d < days; d++ {
		day := shiftDateBy(start, d)
		doc.Values = append(doc.Values, EngineValue{ZoneID: w.zoneID, SubZoneID: w.subID, IntervalStart: intervalStartOf(day, 36), IntervalIndex: 36, Low: 0, Expected: 1.5, High: 3})
	}
	check(t, storeEngineForecastValues(context.Background(), w.conn, rc, run, doc, createdAt))
	return run
}

func TestForecastAgainstActualUsesTheRunMadeBeforeTheDay(t *testing.T) {
	w := newEngineWorld(t)
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	yesterday, before := shiftDateBy(w.today, -1), shiftDateBy(w.today, -2)
	early := storedRun(t, w, rc, "m-early", shiftDateBy(w.today, -3)+"T02:00:00+03:00", before, 2)
	storedRun(t, w, rc, "m-late", w.today+"T02:00:00+03:00", yesterday, 1)

	got, err := GetForecastAccuracy(context.Background(), w.conn, rc, ForecastAccuracyQuery{})
	check(t, err)
	if len(got.Dates) != 2 || got.Dates[0] != yesterday || got.Dates[1] != before || got.Date == nil || *got.Date != yesterday {
		t.Fatalf("dates %v date %v", got.Dates, got.Date)
	}
	if got.Run == nil || got.Run.ID != early.ID || got.Run.ModelVersion != "m-early" {
		t.Fatalf("run %+v, want the one made before the day", got.Run)
	}
	if !got.Illustrative || got.DataSource != "SYNTHETIC" || got.MixedSources {
		t.Fatalf("source %q illustrative %v", got.DataSource, got.Illustrative)
	}
	f := got.Overall
	if f == nil || f.Forecast != 1.5 || f.Actual != 1 || f.Difference == nil || *f.Difference != 0.5 || f.WAPE == nil || *f.WAPE != 0.5 || f.WithinRange != 1 {
		t.Fatalf("figures %+v", f)
	}
	if len(got.Zones) != 1 || got.Zones[0].ZoneID != w.zoneID || got.ZoneID == nil || *got.ZoneID != w.zoneID {
		t.Fatalf("zones %+v", got.Zones)
	}
	if len(got.Intervals) != Intervals || got.Intervals[36].Actual != 1 || got.Intervals[36].Expected != 1.5 || got.Intervals[35].Actual != 0 {
		t.Fatalf("intervals %+v", got.Intervals[35:37])
	}

	older, err := GetForecastAccuracy(context.Background(), w.conn, rc, ForecastAccuracyQuery{Date: before, ZoneID: w.zoneID})
	check(t, err)
	if *older.Date != before || older.Run.ID != early.ID {
		t.Fatalf("the older day %v run %+v", older.Date, older.Run)
	}
}

func TestForecastAgainstActualSourceIsTheRunsWithoutCases(t *testing.T) {
	w := newEngineWorld(t)
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	empty := shiftDateBy(w.today, -5)
	run := storedRun(t, w, rc, "m-customer", shiftDateBy(empty, -1)+"T02:00:00+03:00", empty, 1)
	run.DataSource, run.InputDataSources = "IMPORTED", []string{"IMPORTED"}
	check(t, forecastRunBackendInUse.save(context.Background(), w.tenantID, run))
	got, err := GetForecastAccuracy(context.Background(), w.conn, rc, ForecastAccuracyQuery{Date: empty})
	check(t, err)
	if got.Date == nil || *got.Date != empty || got.DataSource != "IMPORTED" || got.MixedSources || !got.Illustrative {
		t.Fatalf("a day with no cases: date %v source %q mixed %v illustrative %v", got.Date, got.DataSource, got.MixedSources, got.Illustrative)
	}
}

func TestForecastAgainstActualIsEmptyWithoutAPastRunAndKeepsTheZoneScope(t *testing.T) {
	w := newEngineWorld(t)
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	storedRun(t, w, rc, "m-next", w.today+"T02:00:00+03:00", w.tomorrow, 1)
	got, err := GetForecastAccuracy(context.Background(), w.conn, rc, ForecastAccuracyQuery{})
	check(t, err)
	if len(got.Dates) != 0 || got.Date != nil || got.Run != nil || got.Overall != nil || len(got.Intervals) != 0 {
		t.Fatalf("a future run only: %+v", got)
	}

	storedRun(t, w, rc, "m-past", shiftDateBy(w.today, -2)+"T02:00:00+03:00", shiftDateBy(w.today, -1), 1)
	other := plannerCtx(w.tenantID, datactx.NewID(), []string{datactx.NewID()})
	scoped, err := GetForecastAccuracy(context.Background(), w.conn, other, ForecastAccuracyQuery{})
	check(t, err)
	if len(scoped.Dates) != 1 || len(scoped.Zones) != 0 || scoped.Overall != nil {
		t.Fatalf("a planner of another zone: %+v", scoped)
	}

	approver := roleCtx(w.tenantID, datactx.NewID(), access.RoleChangeApprover)
	var de *dataerr.DataError
	if _, err := GetForecastAccuracy(context.Background(), w.conn, approver, ForecastAccuracyQuery{}); !errors.As(err, &de) || de.Code != dataerr.CodeForbidden {
		t.Fatalf("the change approver got %v", err)
	}
	if _, err := GetForecastAccuracy(context.Background(), w.conn, rc, ForecastAccuracyQuery{Date: "13-09-2026"}); !errors.As(err, &de) || de.Code != dataerr.CodeInvalid {
		t.Fatalf("a bad date got %v", err)
	}
}
