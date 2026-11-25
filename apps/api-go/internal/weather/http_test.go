// SPDX-License-Identifier: AGPL-3.0-only

package weather

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
)

const testKey = "test-key-not-a-secret"

// omServer answers in Open-Meteo's documented shape.
func omServer(t *testing.T, calls *atomic.Int64, fail *atomic.Bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if fail != nil && fail.Load() {
			http.Error(w, `{"error":true,"reason":"down"}`, http.StatusBadGateway)
			return
		}
		q := r.URL.Query()
		if q.Get("apikey") != testKey || q.Get("timezone") != "Asia/Riyadh" {
			http.Error(w, `{"error":true,"reason":"bad"}`, http.StatusBadRequest)
			return
		}
		from, _ := time.Parse(dateLayout, q.Get("start_date"))
		to, _ := time.Parse(dateLayout, q.Get("end_date"))
		var days, rain, tmax, hours, vis []string
		for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
			ds := d.Format(dateLayout)
			days = append(days, `"`+ds+`"`)
			rain = append(rain, fmt.Sprintf("%.1f", float64(d.Day()%3)))
			if d.Day() == 2 {
				tmax = append(tmax, "null")
			} else {
				tmax = append(tmax, "22.5")
			}
			for h := 0; h < 24; h++ {
				hours = append(hours, fmt.Sprintf(`"%sT%02d:00"`, ds, h))
				vis = append(vis, fmt.Sprintf("%d", 20000-h*500))
			}
		}
		body := `{"latitude":24.7,"longitude":46.7,"timezone":"Asia/Riyadh","daily_units":{"precipitation_sum":"mm"},` +
			`"daily":{"time":[` + strings.Join(days, ",") + `],"precipitation_sum":[` + strings.Join(rain, ",") +
			`],"temperature_2m_max":[` + strings.Join(tmax, ",") + `]}`
		if r.URL.Path == "/v1/forecast" {
			if q.Get("hourly") != "visibility" {
				http.Error(w, `{"error":true}`, http.StatusBadRequest)
				return
			}
			body += `,"hourly":{"time":[` + strings.Join(hours, ",") + `],"visibility":[` + strings.Join(vis, ",") + `]}`
		}
		_, _ = w.Write([]byte(body + "}"))
	}))
}

func newOM(srv *httptest.Server, now func() time.Time) *HTTPSource {
	return NewHTTPSource(HTTPConfig{Adapter: OpenMeteo{ForecastURL: srv.URL, ArchiveURL: srv.URL}, APIKey: testKey, KeyParam: "apikey",
		Timeout: time.Second, Now: now, Client: srv.Client(), Cooldown: time.Minute})
}

func riyadhNoon(date string) time.Time {
	t, _ := time.ParseInLocation(dateLayout, date, Riyadh)
	return t.Add(12 * time.Hour)
}

func TestPlanSplitsArchiveAndForecast(t *testing.T) {
	o := OpenMeteo{ForecastURL: "https://f.example", ArchiveURL: "https://a.example/"}
	p := o.Plan(testCities[0], "2026-01-01", "2026-03-31", "2026-03-20")
	if len(p) != 2 || p[0].Kind != "archive" || p[0].To != "2026-03-14" || p[1].From != "2026-03-15" || p[1].To != "2026-03-31" {
		t.Fatalf("%+v", p)
	}
	if !strings.HasPrefix(p[0].URL, "https://a.example/v1/archive?") || strings.Contains(p[0].URL, "apikey") {
		t.Fatalf("url %s", p[0].URL)
	}
	if p := o.Plan(testCities[0], "2026-03-20", "2026-05-01", "2026-03-20"); len(p) != 1 || p[0].To != "2026-04-04" {
		t.Fatalf("forecast reach %+v", p)
	}
}

func TestPlanAndParseNameTheModels(t *testing.T) {
	o := OpenMeteo{ForecastURL: "http://om.local", ArchiveURL: "http://om.local", ArchiveModel: ModelERA5, ForecastModel: ModelGFSSeamless}
	p := o.Plan(testCities[0], "2026-01-01", "2026-03-31", "2026-03-20")
	if len(p) != 2 || !strings.Contains(p[0].URL, "models=era5") || !strings.Contains(p[1].URL, "models=gfs_seamless") {
		t.Fatalf("%+v", p)
	}
	d, err := o.Parse([]byte(`{"daily":{"time":["2026-01-01"],"precipitation_sum":[2],"temperature_2m_max":[20]}}`), p[0])
	if err != nil || len(d) != 1 || d[0].Source != "open-meteo:archive:era5" {
		t.Fatalf("%+v %v", d, err)
	}
	if p := (OpenMeteo{ForecastURL: "https://f", ArchiveURL: "https://a"}).Plan(testCities[0], "2026-01-01", "2026-01-02", "2026-03-20"); strings.Contains(p[0].URL, "models=") {
		t.Fatalf("no model asked: %s", p[0].URL)
	}
}

func TestOpenMeteoAgainstFakeServer(t *testing.T) {
	var calls atomic.Int64
	srv := omServer(t, &calls, nil)
	defer srv.Close()
	s := newOM(srv, func() time.Time { return riyadhNoon("2026-01-20") })
	days, err := s.Days(context.Background(), testCities, "2026-01-01", "2026-01-22")
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 4 {
		t.Fatalf("calls %d: two cities with a point, two endpoints each", calls.Load())
	}
	if len(days) != 44 {
		t.Fatalf("days %d", len(days))
	}
	byDate := map[string]Day{}
	for _, d := range days {
		if d.CityID == "c1" {
			byDate[d.Date] = d
		}
	}
	a, f := byDate["2026-01-03"], byDate["2026-01-18"]
	if a.Source != "open-meteo:archive" || a.VisibilityKM != nil || *a.RainMM != 0 {
		t.Fatalf("archive day %+v", a)
	}
	if f.Source != "open-meteo:forecast" || f.VisibilityKM == nil || *f.VisibilityKM != 8.5 {
		t.Fatalf("forecast day %+v", f)
	}
	if byDate["2026-01-02"].MaxTempC != nil {
		t.Fatal("null should stay unknown")
	}
	if _, err := s.Days(context.Background(), testCities, "2026-01-01", "2026-01-22"); err != nil || calls.Load() != 4 {
		t.Fatalf("not cached: %d %v", calls.Load(), err)
	}
}

func TestCacheExpiresNextDay(t *testing.T) {
	var calls atomic.Int64
	srv := omServer(t, &calls, nil)
	defer srv.Close()
	now := riyadhNoon("2026-01-20")
	s := newOM(srv, func() time.Time { return now })
	ctx := context.Background()
	_, _ = s.Days(ctx, testCities[:1], "2026-01-19", "2026-01-21")
	now = now.Add(24 * time.Hour)
	_, _ = s.Days(ctx, testCities[:1], "2026-01-19", "2026-01-21")
	if calls.Load() != 2 {
		t.Fatalf("calls %d", calls.Load())
	}
}

func TestFailuresOpenTheBreakerAndHideTheKey(t *testing.T) {
	var calls atomic.Int64
	var fail atomic.Bool
	fail.Store(true)
	srv := omServer(t, &calls, &fail)
	defer srv.Close()
	s := newOM(srv, func() time.Time { return riyadhNoon("2026-01-20") })
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		days, err := s.Days(ctx, testCities[:1], "2026-01-19", "2026-01-21")
		if err == nil || len(days) != 0 {
			t.Fatalf("want an error, got %v", days)
		}
		if strings.Contains(err.Error(), testKey) || strings.Contains(err.Error(), "apikey") {
			t.Fatalf("key leaked: %v", err)
		}
	}
	if st := s.Stats(); st.State != engines.Open || calls.Load() != 3 {
		t.Fatalf("breaker %+v calls %d", st, calls.Load())
	}
}

func TestUnreachableFeedHidesTheKey(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	s := NewHTTPSource(HTTPConfig{Adapter: OpenMeteo{ForecastURL: url, ArchiveURL: url}, APIKey: testKey, KeyParam: "apikey", Timeout: time.Second})
	_, err := s.Days(context.Background(), testCities[:1], "2026-01-01", "2026-01-02")
	if err == nil || strings.Contains(err.Error(), testKey) {
		t.Fatalf("err %v", err)
	}
}

func TestSlowFeedTimesOut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(2 * time.Second):
		case <-r.Context().Done():
		}
	}))
	defer srv.Close()
	s := NewHTTPSource(HTTPConfig{Adapter: OpenMeteo{ForecastURL: srv.URL, ArchiveURL: srv.URL}, Timeout: 100 * time.Millisecond})
	began := time.Now()
	_, err := s.Days(context.Background(), testCities[:1], "2026-01-01", "2026-01-02")
	if err == nil || time.Since(began) > time.Second {
		t.Fatalf("err %v after %s", err, time.Since(began))
	}
}

func TestParseRejectsOtherShapes(t *testing.T) {
	o := OpenMeteo{}
	for _, b := range []string{`[]`, `{"error":true,"reason":"x"}`, `{"daily":{"time":["2026-01-01"],"precipitation_sum":[]}}`,
		`{"daily":{"time":["bad"],"precipitation_sum":[1],"temperature_2m_max":[1]}}`} {
		if _, err := o.Parse([]byte(b), Fetch{Kind: "forecast"}); err == nil {
			t.Errorf("accepted %s", b)
		}
	}
	d, err := o.Parse([]byte(`{"daily":{"time":["2026-01-01"],"precipitation_sum":[-3],"temperature_2m_max":[99]}}`), Fetch{Kind: "archive"})
	if err != nil || len(d) != 0 {
		t.Fatalf("out-of-range values should be dropped: %+v %v", d, err)
	}
}
