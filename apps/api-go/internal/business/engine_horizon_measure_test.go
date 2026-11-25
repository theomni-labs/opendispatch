// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"sort"
	"sync/atomic"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// Manual: a chunked 30-day run on the real engine.
func TestMeasureChunkedHorizon(t *testing.T) {
	addr := os.Getenv("OPENDISPATCH_SCALE_ADDR")
	if addr == "" {
		t.Skip("set OPENDISPATCH_SCALE_ADDR to measure")
	}
	const start = "2026-10-01"
	nz := scaleList("OPENDISPATCH_SCALE_ZONES", "8")[0]
	hd := scaleList("OPENDISPATCH_SCALE_HIST", "28")[0]
	days := scaleList("OPENDISPATCH_SCALE_DAYS", "30")[0]
	chunk := scaleList("OPENDISPATCH_SCALE_CHUNK", "10")[0]
	allZ, allS, hist := scaleZones(t, nz)
	from := time.Date(2026, 10, 1, 0, 0, 0, 0, time.FixedZone("r", 3*3600)).AddDate(0, 0, -hd)
	var rows []historyRow
	for _, h := range hist {
		if !h.IntervalStart.Before(from) {
			rows = append(rows, h)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].IntervalStart.Before(rows[j].IntervalStart) })
	hist = nil
	cal := forecastcal.Config{PaydayDay: forecastcal.DefaultPaydayDay, SchoolTerms: backtest.SchoolTerms("2025-09-01", "2026-12-31", backtest.DefaultSchoolBreaks())}
	var cd []forecastDay
	for i := -hd; i < days; i++ {
		d := forecastDay{Date: shiftDateBy(start, i)}
		applyCalendar(&d, cal)
		if i >= 0 {
			d.Prayer = &PrayerTime{Fajr: "04:30", Dhuhr: "11:45", Asr: "15:10", Maghrib: "17:55", Isha: "19:25"}
		}
		cd = append(cd, d)
	}
	src := forecasterSource{Now: time.Now(), StartDate: start, Days: days, ModelVersion: "v2", RangeCoverage: 0.8,
		Zones: allZ, SubZones: allS, Calendar: cd, History: rows, Sources: []string{"SYNTHETIC"}}
	UseEngines(engines.Config{Mode: engines.ModeEngine, URLs: map[engines.Name]string{engines.Forecaster: "http://" + addr}})
	t.Cleanup(UseFixtureEngines)
	rc := reqctx.RequestContext{CustomerID: scaleUUID()}

	runtime.GC()
	var base runtime.MemStats
	runtime.ReadMemStats(&base)
	fmt.Printf("heap before the run %.0f MiB\n", float64(base.HeapAlloc)/(1<<20))
	var peak atomic.Uint64
	stop := make(chan struct{})
	go func() {
		var m runtime.MemStats
		for {
			runtime.ReadMemStats(&m)
			if m.HeapAlloc > peak.Load() {
				peak.Store(m.HeapAlloc)
			}
			select {
			case <-stop:
				return
			case <-time.After(20 * time.Millisecond):
			}
		}
	}()
	t0 := time.Now()
	doc, err := askForecasterChunks(context.Background(), rc, src, chunk)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("warnings %v\n", doc.Warnings)
	asked := time.Since(t0).Seconds()
	kept, err := keptForecast(doc)
	if err != nil {
		t.Fatal(err)
	}
	total := time.Since(t0).Seconds()
	close(stop)
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	mb := func(n uint64) float64 { return float64(n) / (1 << 20) }
	fmt.Printf("zones %d (%d sub-zones), history %d days, %d days by %d: asked %.1f s, with kept marshal %.1f s; values %d; kept %.0f MiB; peak heap %.0f MiB; sys %.0f MiB\n",
		len(allZ), len(allS), hd, days, chunk, asked, total, len(doc.Values), mb(uint64(len(kept))), mb(peak.Load()), mb(m.Sys))
	perDay := map[string]float64{}
	for _, v := range doc.Values {
		perDay[v.IntervalStart[:10]] += v.Expected
	}
	for i := 0; i < days; i++ {
		d := shiftDateBy(start, i)
		fmt.Printf("%s %s %8.1f\n", d, time.Date(2026, 10, 1+i, 0, 0, 0, 0, time.UTC).Weekday().String()[:3], perDay[d])
	}
}
