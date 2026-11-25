// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

func TestCheckBaseURLRefusesTheHostedFreeTier(t *testing.T) {
	for _, u := range []string{"https://api.open-meteo.com", "https://archive-api.open-meteo.com", "ftp://x", "http://x?y=1", ""} {
		if CheckBaseURL(u) == nil {
			t.Errorf("accepted %q", u)
		}
	}
	for _, u := range []string{"http://127.0.0.1:8080", "https://weather.internal"} {
		if err := CheckBaseURL(u); err != nil {
			t.Errorf("%s: %v", u, err)
		}
	}
}

func TestWindowsAreCalendarMonths(t *testing.T) {
	w := Windows("2026-01-15", "2026-03-02")
	if len(w) != 3 || w[0] != [2]string{"2026-01-15", "2026-01-31"} || w[1] != [2]string{"2026-02-01", "2026-02-28"} || w[2] != [2]string{"2026-03-01", "2026-03-02"} {
		t.Fatalf("%v", w)
	}
	if Windows("2026-03-02", "2026-01-01") != nil {
		t.Fatal("reversed range")
	}
}

// fakeOM answers daily values for the asked dates.
func fakeOM(t *testing.T, calls *atomic.Int64) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		a, _ := time.Parse(dateLayout, r.URL.Query().Get("start_date"))
		b, _ := time.Parse(dateLayout, r.URL.Query().Get("end_date"))
		var ts, ps, xs []string
		for d := a; !d.After(b); d = d.AddDate(0, 0, 1) {
			ts, ps, xs = append(ts, `"`+d.Format(dateLayout)+`"`), append(ps, "0.5"), append(xs, "30")
		}
		fmt.Fprintf(w, `{"daily":{"time":[%s],"precipitation_sum":[%s],"temperature_2m_max":[%s]},"hourly":{"time":[],"visibility":[]}}`,
			strings.Join(ts, ","), strings.Join(ps, ","), strings.Join(xs, ","))
	}))
}

func TestFetchUsesTheCacheAndWorksOffline(t *testing.T) {
	var calls atomic.Int64
	srv := fakeOM(t, &calls)
	defer srv.Close()
	dir := t.TempDir()
	ad := weather.OpenMeteo{ForecastURL: srv.URL, ArchiveURL: srv.URL, ArchiveModel: weather.ModelERA5, ForecastModel: weather.ModelGFSSeamless}
	cities := []weather.City{{ID: "c1", NameEn: "Riyadh", Lat: 24.7, Lon: 46.7, HasPoint: true}, {ID: "c2", NameEn: "Nowhere"}}
	c := Cache{Dir: dir, Today: "2026-03-20", Get: HTTPGet(srv.Client())}
	days, st := Fetch(context.Background(), ad, cities, "2026-02-01", "2026-04-04", c, 2)
	if len(days) != 63 || st.Network != 4 || st.Missed != 0 {
		t.Fatalf("days %d stats %+v", len(days), st)
	}
	if days[0].CityID != "c1" || days[0].Source != "open-meteo:archive:era5" || days[len(days)-1].Source != "open-meteo:forecast:gfs_seamless" {
		t.Fatalf("%+v %+v", days[0], days[len(days)-1])
	}
	before := calls.Load()
	_, st = Fetch(context.Background(), ad, cities, "2026-02-01", "2026-04-04", c, 2)
	if calls.Load() != before || st.Cached != 4 {
		t.Fatalf("same day: want all from cache, calls %d stats %+v", calls.Load()-before, st)
	}
	c.Today = "2026-03-21"
	old := time.Now().Add(-48 * time.Hour)
	filepath.Walk(filepath.Join(dir, "forecast"), func(p string, _ os.FileInfo, _ error) error { return os.Chtimes(p, old, old) }) //nolint:errcheck
	_, st = Fetch(context.Background(), ad, cities, "2026-02-01", "2026-02-28", c, 1)
	if st.Cached != 1 || st.Network != 0 {
		t.Fatalf("a closed archive month stays cached: %+v", st)
	}
	srv.Close()
	off := Cache{Dir: dir, Offline: true, Today: "2026-04-30"}
	days, st = Fetch(context.Background(), ad, cities, "2026-02-01", "2026-04-04", off, 2)
	if st.Network != 0 || st.Cached != 1 || st.Missed != 2 || len(days) != 28 {
		t.Fatalf("offline, later day: only February's plan is unchanged: days %d %+v", len(days), st)
	}
	off.Today = "2026-03-20"
	days, st = Fetch(context.Background(), ad, cities, "2026-02-01", "2026-04-04", off, 2)
	if len(days) != 63 || st.Missed != 0 {
		t.Fatalf("offline replay: days %d %+v", len(days), st)
	}
	merged, err := MergeSnapshot(dir, days)
	if err != nil || len(merged) != 63 {
		t.Fatalf("snapshot %d %v", len(merged), err)
	}
	later, err := MergeSnapshot(dir, []weather.Day{{CityID: "c1", Date: "2026-02-01", RainMM: ptr(9.0), Source: "x"}})
	if err != nil || len(later) != 63 || *later[0].RainMM != 9 {
		t.Fatalf("an offline run keeps the last days, the new one wins: %d %v", len(later), err)
	}
	r := Report(cities, days, "2026-02-01", "2026-04-04")
	if len(r) != 2 || r[1].City != "Riyadh" || r[1].Days != 63 || r[1].Missing != 0 || r[1].Vis != 0 || r[0].Missing != 63 {
		t.Fatalf("%+v", r)
	}
}

func ptr[T any](v T) *T { return &v }
