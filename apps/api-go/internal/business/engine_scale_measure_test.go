// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"bytes"
	"compress/gzip"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

func scaleUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func scaleList(key, def string) []int {
	v := os.Getenv(key)
	if v == "" {
		v = def
	}
	var out []int
	for _, p := range strings.Split(v, ",") {
		n, _ := strconv.Atoi(strings.TrimSpace(p))
		out = append(out, n)
	}
	return out
}

func scaleLoad(t *testing.T, name string, out any) {
	b, err := os.ReadFile("../../../../fixtures/locations/" + name)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, out); err != nil {
		t.Fatal(err)
	}
}

// scaleZones: the demo's zones replicated to maxZ.
func scaleZones(t *testing.T, maxZ int) ([]Zone, []SubZone, []historyRow) {
	var zs []Zone
	var ss []SubZone
	scaleLoad(t, "zones.json", &zs)
	scaleLoad(t, "sub_zones.json", &ss)
	base, err := backtest.Load(backtest.LoadOptions{Dir: "../../../../fixtures"})
	if err != nil {
		t.Fatal(err)
	}
	var allZ []Zone
	var allS []SubZone
	var hist []historyRow
	for r := 0; len(allZ) < maxZ; r++ {
		res, err := backtest.GenerateLong(base, backtest.LongOptions{Weeks: 52, End: "2026-09-30", Seed: int64(100 + r)})
		if err != nil {
			t.Fatal(err)
		}
		zmap, smap := map[string]string{}, map[string]string{}
		for _, z := range zs {
			if len(allZ) >= maxZ {
				break
			}
			nz := z
			zmap[z.ID] = z.ID
			if r > 0 {
				nz.ID = scaleUUID()
				zmap[z.ID] = nz.ID
			}
			allZ = append(allZ, nz)
		}
		for _, s := range ss {
			zid, ok := zmap[s.ZoneID]
			if !ok {
				continue
			}
			ns := s
			ns.ZoneID = zid
			smap[s.ID] = s.ID
			if r > 0 {
				ns.ID = scaleUUID()
				smap[s.ID] = ns.ID
			}
			allS = append(allS, ns)
		}
		for _, h := range res.Dataset.Intervals {
			if id, ok := smap[h.SubZoneID]; ok {
				hist = append(hist, historyRow{SubZoneID: id, IntervalStart: h.Start, Total: h.Total, Field: h.Field})
			}
		}
	}
	return allZ, allS, hist
}

// Manual: forecast answer size by zones.
func TestMeasureForecastScale(t *testing.T) {
	addr := os.Getenv("OPENDISPATCH_SCALE_ADDR")
	if addr == "" {
		t.Skip("set OPENDISPATCH_SCALE_ADDR to measure")
	}
	const start = "2026-10-01"
	maxZ := 0
	for _, n := range scaleList("OPENDISPATCH_SCALE_ZONES", "8,36") {
		maxZ = max(maxZ, n)
	}
	allZ, allS, hist := scaleZones(t, maxZ)
	cal := forecastcal.Config{PaydayDay: forecastcal.DefaultPaydayDay, SchoolTerms: backtest.SchoolTerms("2025-09-01", "2026-12-31", backtest.DefaultSchoolBreaks())}
	client := &http.Client{Timeout: 20 * time.Minute, Transport: &http.Transport{DisableCompression: true}}
	fmt.Printf("%-5s %-5s %-4s %9s %9s %9s %9s %8s %8s %8s\n", "zones", "hist", "days", "reqRawMB", "reqGzMB", "ansRawMB", "ansGzMB", "engine_s", "parse_s", "sysMB")
	for _, nz := range scaleList("OPENDISPATCH_SCALE_ZONES", "8,36") {
		keep := map[string]bool{}
		for _, z := range allZ[:nz] {
			keep[z.ID] = true
		}
		var sub []SubZone
		subOK := map[string]bool{}
		for _, s := range allS {
			if keep[s.ZoneID] {
				sub = append(sub, s)
				subOK[s.ID] = true
			}
		}
		for _, hd := range scaleList("OPENDISPATCH_SCALE_HIST", "28,357") {
			from := time.Date(2026, 10, 1, 0, 0, 0, 0, time.FixedZone("r", 3*3600)).AddDate(0, 0, -hd)
			var rows []historyRow
			for _, h := range hist {
				if subOK[h.SubZoneID] && !h.IntervalStart.Before(from) {
					rows = append(rows, h)
				}
			}
			sort.SliceStable(rows, func(i, j int) bool { return rows[i].IntervalStart.Before(rows[j].IntervalStart) })
			for _, days := range scaleList("OPENDISPATCH_SCALE_DAYS", "7,10") {
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
					Zones: allZ[:nz], SubZones: sub, Calendar: cd, History: rows, Sources: []string{"SYNTHETIC"}}
				req, err := buildForecasterRequest(src)
				if err != nil {
					t.Fatalf("%d zones %d hist: %v", nz, hd, err)
				}
				if p := os.Getenv("OPENDISPATCH_SCALE_DUMP"); p != "" {
					_ = os.WriteFile(p, req, 0o600)
				}
				gz, _ := engines.Gzip(req)
				r, _ := http.NewRequest(http.MethodPost, "http://"+addr+"/v1/forecaster", bytes.NewReader(gz))
				r.Header.Set("Content-Encoding", "gzip")
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("Accept-Encoding", "gzip")
				t0 := time.Now()
				resp, err := client.Do(r)
				if err != nil {
					t.Fatal(err)
				}
				comp, err := io.ReadAll(resp.Body)
				resp.Body.Close()
				engineS := time.Since(t0).Seconds()
				if err != nil || resp.StatusCode != 200 {
					t.Fatalf("%d zones %d hist %d days: status %d %v", nz, hd, days, resp.StatusCode, err)
				}
				runtime.GC()
				var m0 runtime.MemStats
				runtime.ReadMemStats(&m0)
				zr, err := gzip.NewReader(bytes.NewReader(comp))
				if err != nil {
					t.Fatal(err)
				}
				raw, _ := io.ReadAll(zr)
				t1 := time.Now()
				var doc ForecasterEngineOutput
				if err := json.Unmarshal(raw, &doc); err != nil {
					t.Fatal(err)
				}
				parseS := time.Since(t1).Seconds()
				var m1 runtime.MemStats
				runtime.ReadMemStats(&m1)
				mb := func(n int) float64 { return float64(n) / (1 << 20) }
				fmt.Printf("%-5d %-5d %-4d %9.1f %9.1f %9.1f %9.1f %8.1f %8.2f %8.0f  values=%d records=%d\n", nz, hd, days, mb(len(req)), mb(len(gz)), mb(len(raw)), mb(len(comp)),
					engineS, parseS, mb(int(m1.Sys)), len(doc.Values), len(rows))
				fmt.Printf("      parse alloc %.0f MB, live after %.0f MB\n", mb(int(m1.TotalAlloc-m0.TotalAlloc)), mb(int(m1.HeapAlloc)))
			}
		}
	}
}
