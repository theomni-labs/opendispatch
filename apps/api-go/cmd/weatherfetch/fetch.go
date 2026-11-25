// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

const dateLayout = "2006-01-02"

// maxBody caps one answer.
const maxBody = 8 << 20

// hostedHosts serve the non-commercial free tier.
var hostedHosts = []string{"open-meteo.com"}

// CheckBaseURL refuses the hosted free tier.
func CheckBaseURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.RawQuery != "" || u.User != nil {
		return fmt.Errorf("weather url %q must be a plain http(s)://host[:port]", raw)
	}
	h := strings.ToLower(u.Hostname())
	for _, d := range hostedHosts {
		if h == d || strings.HasSuffix(h, "."+d) {
			return fmt.Errorf("refusing %s: the hosted Open-Meteo API is for non-commercial use only; run Open-Meteo yourself on its open data", h)
		}
	}
	return nil
}

// Cache keeps answers under a directory.
type Cache struct {
	Dir     string
	Offline bool
	Today   string
	Get     func(ctx context.Context, url string) ([]byte, error)
}

// Stats counts what a run did.
type Stats struct {
	mu                      sync.Mutex
	Network, Cached, Missed int
	Errors                  []string
}

func (s *Stats) add(net, cached, missed int, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Network, s.Cached, s.Missed = s.Network+net, s.Cached+cached, s.Missed+missed
	if err != nil && len(s.Errors) < 10 {
		s.Errors = append(s.Errors, err.Error())
	}
}

func (c Cache) path(f weather.Fetch) string {
	sum := sha256.Sum256([]byte(f.URL))
	return filepath.Join(c.Dir, f.Kind, hex.EncodeToString(sum[:16])+".json")
}

// forecastTTL: models run every 6 hours.
const forecastTTL = 6 * time.Hour

// fresh: archive answers keep; forecasts 6 hours.
func (c Cache) fresh(f weather.Fetch, info os.FileInfo) bool {
	if c.Offline || f.Kind == "archive" {
		return true
	}
	return time.Since(info.ModTime()) < forecastTTL
}

// Body: from the cache, else the network.
func (c Cache) Body(ctx context.Context, f weather.Fetch, st *Stats) ([]byte, bool) {
	p := c.path(f)
	if info, err := os.Stat(p); err == nil && c.fresh(f, info) {
		if b, err := os.ReadFile(p); err == nil {
			st.add(0, 1, 0, nil)
			return b, true
		}
	}
	if c.Offline {
		st.add(0, 0, 1, nil)
		return nil, false
	}
	b, err := c.Get(ctx, f.URL)
	if err != nil {
		st.add(0, 0, 1, fmt.Errorf("%s %s..%s: %w", f.Kind, f.From, f.To, err))
		return nil, false
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err == nil {
		_ = os.WriteFile(p, b, 0o644)
	}
	st.add(1, 0, 0, nil)
	return b, true
}

// HTTPGet is a plain GET with a size cap.
func HTTPGet(client *http.Client) func(ctx context.Context, u string) ([]byte, error) {
	return func(ctx context.Context, u string) ([]byte, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "opendispatch-weatherfetch")
		resp, err := client.Do(req)
		if err != nil {
			var ue *url.Error
			if errors.As(err, &ue) {
				return nil, ue.Err
			}
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			return nil, fmt.Errorf("status %d", resp.StatusCode)
		}
		b, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
		if err != nil {
			return nil, err
		}
		if len(b) > maxBody {
			return nil, errors.New("answer too large")
		}
		return b, nil
	}
}

// Windows splits from..to into calendar months.
func Windows(from, to string) [][2]string {
	f, err1 := time.Parse(dateLayout, from)
	t, err2 := time.Parse(dateLayout, to)
	if err1 != nil || err2 != nil || t.Before(f) {
		return nil
	}
	var out [][2]string
	for a := f; !a.After(t); {
		end := time.Date(a.Year(), a.Month()+1, 0, 0, 0, 0, 0, time.UTC)
		if end.After(t) {
			end = t
		}
		out = append(out, [2]string{a.Format(dateLayout), end.Format(dateLayout)})
		a = end.AddDate(0, 0, 1)
	}
	return out
}

// Fetch gets every city's days, cache first.
func Fetch(ctx context.Context, ad weather.Adapter, cities []weather.City, from, to string, c Cache, workers int) ([]weather.Day, *Stats) {
	type job struct {
		city weather.City
		f    weather.Fetch
	}
	var jobs []job
	for _, city := range cities {
		if !city.HasPoint {
			continue
		}
		for _, w := range Windows(from, to) {
			for _, f := range ad.Plan(city, w[0], w[1], c.Today) {
				jobs = append(jobs, job{city, f})
			}
		}
	}
	st := &Stats{}
	var mu sync.Mutex
	var out []weather.Day
	ch := make(chan job)
	var wg sync.WaitGroup
	for range max(1, workers) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range ch {
				b, ok := c.Body(ctx, j.f, st)
				if !ok {
					continue
				}
				days, err := ad.Parse(b, j.f)
				if err != nil {
					st.add(0, 0, 0, fmt.Errorf("%s %s..%s: %w", j.f.Kind, j.f.From, j.f.To, err))
					continue
				}
				mu.Lock()
				for _, d := range days {
					if d.Date >= j.f.From && d.Date <= j.f.To {
						d.CityID = j.city.ID
						out = append(out, d)
					}
				}
				mu.Unlock()
			}
		}()
	}
	for _, j := range jobs {
		ch <- j
	}
	close(ch)
	wg.Wait()
	return weather.Sorted(out), st
}

const snapshotName = "days.json"

// MergeSnapshot: fetched days over the last ones.
func MergeSnapshot(dir string, fetched []weather.Day) ([]weather.Day, error) {
	p := filepath.Join(dir, snapshotName)
	var prev []weather.Day
	if b, err := os.ReadFile(p); err == nil {
		if err := json.Unmarshal(b, &prev); err != nil {
			return fetched, fmt.Errorf("%s: %w", snapshotName, err)
		}
	}
	have := map[string]bool{}
	for _, d := range fetched {
		have[d.CityID+"|"+d.Date] = true
	}
	out := append([]weather.Day(nil), fetched...)
	for _, d := range prev {
		if !have[d.CityID+"|"+d.Date] {
			out = append(out, d)
		}
	}
	out = weather.Sorted(out)
	b, err := json.Marshal(out)
	if err != nil {
		return out, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return out, err
	}
	return out, os.WriteFile(p, b, 0o644)
}

// CityReport: counts, range and gaps per city.
type CityReport struct {
	City, From, To                 string
	Days, Missing, Rain, Temp, Vis int
}

// Report counts days per city over from..to.
func Report(cities []weather.City, days []weather.Day, from, to string) []CityReport {
	f, _ := time.Parse(dateLayout, from)
	t, _ := time.Parse(dateLayout, to)
	span := int(t.Sub(f).Hours()/24) + 1
	by := map[string]*CityReport{}
	for _, c := range cities {
		by[c.ID] = &CityReport{City: c.NameEn}
	}
	for _, d := range days {
		r := by[d.CityID]
		if r == nil {
			continue
		}
		r.Days++
		if r.From == "" || d.Date < r.From {
			r.From = d.Date
		}
		if d.Date > r.To {
			r.To = d.Date
		}
		if d.RainMM != nil {
			r.Rain++
		}
		if d.MaxTempC != nil {
			r.Temp++
		}
		if d.VisibilityKM != nil {
			r.Vis++
		}
	}
	var out []CityReport
	for _, c := range cities {
		r := by[c.ID]
		r.Missing = span - r.Days
		out = append(out, *r)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].City < out[j].City })
	return out
}
