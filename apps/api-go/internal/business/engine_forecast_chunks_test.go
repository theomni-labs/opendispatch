// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func TestForecastChunksSplitTheHorizon(t *testing.T) {
	cases := []struct {
		days, size int
		want       []int
	}{
		{7, 10, []int{7}}, {10, 10, []int{10}}, {14, 10, []int{10, 4}}, {30, 10, []int{10, 10, 10}},
		{30, 14, []int{14, 14, 2}}, {30, 7, []int{7, 7, 7, 7, 2}}, {7, 0, []int{7}},
	}
	for _, c := range cases {
		if got := forecastChunks(c.days, c.size); !reflect.DeepEqual(got, c.want) {
			t.Fatalf("%d days by %d: got %v, want %v", c.days, c.size, got, c.want)
		}
	}
}

func TestHorizonSettingsDefaultToTenDays(t *testing.T) {
	resetSettings(t)
	if forecastHorizonDays(context.Background(), "") != 10 || forecastChunkDays(context.Background(), "") != 10 {
		t.Fatal("want 10 days in one call by default")
	}
	putSetting(t, forecastcal.KeyHorizonDays, 30.0)
	putSetting(t, forecastcal.KeyHorizonChunkDays, 7.0)
	if forecastHorizonDays(context.Background(), "") != 30 || forecastChunkDays(context.Background(), "") != 7 {
		t.Fatal("want the stored settings")
	}
	putSetting(t, forecastcal.KeyHorizonDays, 31.0)
	putSetting(t, forecastcal.KeyHorizonChunkDays, 31.0)
	if forecastHorizonDays(context.Background(), "") != 10 || forecastChunkDays(context.Background(), "") != 10 {
		t.Fatal("want the defaults for out-of-range stored values")
	}
}

func TestChunkSourceKeepsHistoryAndCutsTheCalendar(t *testing.T) {
	src := testForecasterSource()
	src.Days, src.Calendar = 30, nil
	for i := -3; i < 30; i++ {
		src.Calendar = append(src.Calendar, forecastDay{Date: shiftDateBy(src.StartDate, i)})
	}
	c := chunkSource(src, 10, 10)
	last := c.Calendar[len(c.Calendar)-1].Date
	if c.StartDate != "2026-09-24" || c.Days != 10 || len(c.Calendar) != 23 || last != "2026-10-03" || !reflect.DeepEqual(c.History, src.History) {
		t.Fatalf("got start %s, %d days, %d calendar days to %s", c.StartDate, c.Days, len(c.Calendar), last)
	}
	if len(src.Calendar) != 33 {
		t.Fatal("the source's calendar must not change")
	}
}

func TestMergeForecastChunkKeepsTheFirstModelInfoAndDedupesWarnings(t *testing.T) {
	part := func(start string, info string, w ...EngineWarning) ForecasterEngineOutput {
		var d ForecasterEngineOutput
		d.ModelVersion, d.Engine.Version, d.Horizon.StartDate, d.Horizon.Days = "m", "1", start, 10
		d.Values, d.Warnings, d.ModelInfo = []EngineValue{{ZoneID: "z", IntervalStart: start}}, w, json.RawMessage(info)
		return d
	}
	a, b := EngineWarning{"A", "a"}, EngineWarning{"B", "b"}
	var doc ForecasterEngineOutput
	steps := []ForecasterEngineOutput{part("2026-09-14", `{"history_days":1}`, a, a), part("2026-09-24", `{"history_days":2}`, a, b), part("2026-10-04", `{}`, b)}
	for i, p := range steps {
		if err := mergeForecastChunk(&doc, p, i == 0); err != nil {
			t.Fatal(err)
		}
	}
	if len(doc.Values) != 3 || !reflect.DeepEqual(doc.Warnings, []EngineWarning{a, b}) || string(doc.ModelInfo) != `{"history_days":1}` {
		t.Fatalf("got %d values, warnings %v, info %s", len(doc.Values), doc.Warnings, doc.ModelInfo)
	}
	other := part("2026-10-14", `{}`)
	other.ModelVersion = "m2"
	if err := mergeForecastChunk(&doc, other, false); !errors.Is(err, ErrEngineAnswer) {
		t.Fatalf("got %v, want chunks from another model refused", err)
	}
}

// chunkAnswer: every interval of the chunk's days.
func (w engineWorld) chunkAnswer(start string, days int) string {
	var values []map[string]any
	for d := 0; d < days; d++ {
		date := shiftDateBy(start, d)
		for i := 0; i < 96; i++ {
			values = append(values, map[string]any{"zone_id": w.zoneID, "sub_zone_id": w.subID, "interval_start": intervalStartOf(date, i), "interval_index": i,
				"low": 0, "expected": 1.5, "high": 3, "field_expected": 1, "remote_inferred_expected": 0.5})
		}
	}
	b, _ := json.Marshal(map[string]any{"schema_version": "1.0", "request_id": datactx.NewID(), "engine": map[string]any{"name": "forecaster", "version": "9.1.0"},
		"model_version": "m-9", "generated_at": "2026-09-13T02:00:00Z", "data_source": "SYNTHETIC", "illustrative": true, "rule_set_version": "rs-1",
		"horizon": map[string]any{"start_date": start, "days": days}, "interval_minutes": 15, "intervals_per_day": 96, "range_coverage": 0.8, "values": values,
		"warnings": []map[string]any{{"code": "W", "message": "same"}}, "model_info": map[string]any{"history_days": 3}})
	return string(b)
}

type sentForecast struct {
	Horizon struct {
		StartDate string `json:"start_date"`
		Days      int    `json:"days"`
	} `json:"horizon"`
	Zones    []json.RawMessage `json:"zones"`
	Calendar []struct {
		Date string `json:"date"`
	} `json:"calendar"`
	History json.RawMessage `json:"history"`
}

// horizonWorld: an engine world with horizon settings.
func horizonWorld(t *testing.T, days, chunk float64) engineWorld {
	t.Helper()
	resetSettings(t)
	w := newEngineWorld(t)
	check(t, settingsstore.Put(context.Background(), w.tenantID, forecastcal.KeyHorizonDays, days))
	check(t, settingsstore.Put(context.Background(), w.tenantID, forecastcal.KeyHorizonChunkDays, chunk))
	return w
}

func (w engineWorld) scriptChunks(sizes []int, broken int) {
	var script []enginetest.Behavior
	offset := 0
	for i, n := range sizes {
		b := enginetest.Behavior{Kind: enginetest.Answer, Body: w.chunkAnswer(shiftDateBy(w.today, offset), n)}
		if i == broken {
			b = enginetest.Behavior{Kind: enginetest.Status500}
		}
		script = append(script, b)
		offset += n
	}
	w.srv.Script(script...)
}

func TestTheForecastIsAskedForInChunksAndStoredAsOneRun(t *testing.T) {
	for _, c := range []struct {
		days, chunk float64
		sizes       []int
	}{{7, 10, []int{7}}, {10, 10, []int{10}}, {14, 10, []int{10, 4}}, {30, 10, []int{10, 10, 10}}} {
		w := horizonWorld(t, c.days, c.chunk)
		w.scriptChunks(c.sizes, -1)
		var report WorkerCycleReport
		check(t, runEngineForecast(context.Background(), w.conn, w.actors.Forecast, w.today, &report))
		reqs := w.srv.Requests()
		if !report.ForecastCreated || len(reqs) != len(c.sizes) {
			t.Fatalf("%v days: got %+v and %d calls, want %d", c.days, report, len(reqs), len(c.sizes))
		}
		offset := 0
		var history json.RawMessage
		for i, r := range reqs {
			checkRequest(t, "forecaster", []byte(r.Body))
			var sent sentForecast
			check(t, json.Unmarshal([]byte(r.Body), &sent))
			start := shiftDateBy(w.today, offset)
			end := shiftDateBy(start, c.sizes[i]-1)
			if sent.Horizon.StartDate != start || sent.Horizon.Days != c.sizes[i] || len(sent.Zones) != 1 || sent.Calendar[len(sent.Calendar)-1].Date != end {
				t.Fatalf("call %d: got %+v, want %s for %d days", i, sent.Horizon, start, c.sizes[i])
			}
			if i > 0 && string(sent.History) != string(history) {
				t.Fatalf("call %d: want the same full history in every chunk", i)
			}
			history, offset = sent.History, offset+c.sizes[i]
		}
		runs, err := loadForecastRuns(context.Background(), w.tenantID, false)
		check(t, err)
		if len(runs) != 1 || runs[0].HorizonStartDate != w.today || runs[0].HorizonDays != int(c.days) || runs[0].Status != "succeeded" {
			t.Fatalf("got %+v, want one run over the whole horizon", runs)
		}
		index, err := indexStored(context.Background(), w.tenantID)
		check(t, err)
		dates, err := index.datesByRun()
		check(t, err)
		if len(dates[runs[0].ID]) != int(c.days) {
			t.Fatalf("got %d stored days, want %v", len(dates[runs[0].ID]), c.days)
		}
		for d := 0; d < int(c.days); d++ {
			rows, err := index.Rows(runs[0].ID, w.zoneID, shiftDateBy(w.today, d))
			check(t, err)
			seen := map[int]bool{}
			for _, r := range rows {
				seen[r.IntervalIndex] = true
			}
			if len(rows) != 96 || len(seen) != 96 {
				t.Fatalf("day %d: got %d values over %d intervals, want 96 once each", d, len(rows), len(seen))
			}
		}
		kept, err := readForecasterOutput(context.Background(), w.tenantID)
		check(t, err)
		want := 96 * int(c.days)
		if c.days > keepValuesMaxDays {
			want = 0
		}
		if kept == nil || kept.Horizon.Days != int(c.days) || len(kept.Values) != want || len(kept.Warnings) != 1 || string(kept.ModelInfo) != `{"history_days":3}` {
			t.Fatalf("got a kept answer that is not the merged run")
		}
		rc, _ := adminCtx(t)
		rc.CustomerID = w.tenantID
		last := shiftDateBy(w.today, int(c.days)-1)
		demand, err := zoneDemand(context.Background(), rc, w.zoneID, last, nil, runs[0].ID)
		check(t, err)
		sum := 0.0
		for _, d := range demand {
			sum += d.Expected
		}
		if sum <= 0 {
			t.Fatalf("%v days: the last day reads %v expected, want the stored values", c.days, sum)
		}
		page, err := ListAuditEvents(rc, AuditFilter{ActionPrefix: "forecast.run_created"})
		check(t, err)
		if len(page.Items) != 1 {
			t.Fatalf("got %d run audit rows, want 1", len(page.Items))
		}
		if s := page.Items[0].SummaryEn; !strings.HasSuffix(s, ", calendar derived from settings).") {
			t.Fatalf("summary %q does not name the calendar", s)
		}
	}
}

func TestAFailingMiddleChunkFailsTheRun(t *testing.T) {
	w := horizonWorld(t, 30, 10)
	w.scriptChunks([]int{10, 10, 10}, 1)
	var report WorkerCycleReport
	check(t, runEngineForecast(context.Background(), w.conn, w.actors.Forecast, w.today, &report))
	if report.ForecastCreated || !report.ForecastStale || len(w.srv.Requests()) != 2 {
		t.Fatalf("got %+v after %d calls, want a stale forecast and no third call", report, len(w.srv.Requests()))
	}
	runs, err := loadForecastRuns(context.Background(), w.tenantID, false)
	check(t, err)
	if len(runs) != 0 {
		t.Fatalf("got %d runs, want none stored", len(runs))
	}
	index, err := indexStored(context.Background(), w.tenantID)
	check(t, err)
	dates, err := index.datesByRun()
	check(t, err)
	if len(dates) != 0 {
		t.Fatalf("got values for %d runs, want none", len(dates))
	}
	fails := engineFailures(t, w)
	if len(fails) != 1 || fails[0]["error_class"] != "status" {
		t.Fatalf("got %v, want one forecaster failure", fails)
	}
}

func TestAThirtyDayRunStoresThirtyDaysInPostgres(t *testing.T) {
	w := horizonWorld(t, 30, 10)
	UsePostgresForecast(w.conn)
	t.Cleanup(UseMemoryForecast)
	w.scriptChunks([]int{10, 10, 10}, -1)
	var report WorkerCycleReport
	check(t, runEngineForecast(context.Background(), w.conn, w.actors.Forecast, w.today, &report))
	run, err := loadLatestForecastRun(context.Background(), w.tenantID, false)
	check(t, err)
	if run == nil || run.HorizonDays != 30 || run.HorizonStartDate != w.today {
		t.Fatalf("got %+v, want a 30-day run from today", run)
	}
	var n, distinct, days int
	var first, last time.Time
	check(t, ownerPool(t).QueryRow(context.Background(), `SELECT count(*), count(DISTINCT interval_start), count(DISTINCT (interval_start AT TIME ZONE 'Asia/Riyadh')::date), min(interval_start), max(interval_start)
		FROM forecast_values WHERE tenant_id = $1::uuid AND forecast_run_id = $2::uuid`, w.tenantID, run.ID).Scan(&n, &distinct, &days, &first, &last))
	from, err := riyadhMidnight(w.today)
	check(t, err)
	if n != 30*96 || distinct != n || days != 30 || !first.Equal(from) || !last.Equal(from.AddDate(0, 0, 30).Add(-15*time.Minute)) {
		t.Fatalf("got %d values, %d distinct, %d days, %s to %s", n, distinct, days, first, last)
	}
}

func TestAPostedRunLongerThanAChunkIsChunked(t *testing.T) {
	w := horizonWorld(t, 10, 10)
	w.scriptChunks([]int{10, 4}, -1)
	run, err := CreateForecastRun(context.Background(), w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": 14.0})
	check(t, err)
	if run.Status != "succeeded" || run.HorizonDays != 14 || len(w.srv.Requests()) != 2 {
		t.Fatalf("got %+v after %d calls, want 14 days from two calls", run, len(w.srv.Requests()))
	}
}
