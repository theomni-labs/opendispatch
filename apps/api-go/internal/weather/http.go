// SPDX-License-Identifier: AGPL-3.0-only

package weather

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
)

// Fetch is one feed call; URL holds no key.
type Fetch struct {
	URL      string
	From, To string
	Kind     string
}

// Adapter maps a city and dates to feed calls.
type Adapter interface {
	Name() string
	Plan(c City, from, to, today string) []Fetch
	Parse(body []byte, f Fetch) ([]Day, error)
}

// HTTPConfig sets up a JSON-over-HTTPS feed.
type HTTPConfig struct {
	Adapter Adapter
	// APIKey is sent, never logged or cached.
	APIKey    string
	KeyParam  string
	KeyHeader string
	Timeout   time.Duration
	Client    *http.Client
	Now       func() time.Time
	// MaxResponse caps a body (0: 4 MiB).
	MaxResponse int64
	Threshold   int
	Cooldown    time.Duration
}

// HTTPSource caches answers for the Riyadh day.
type HTTPSource struct {
	cfg   HTTPConfig
	guard *engines.Guard

	mu    sync.Mutex
	cache map[string]cached
}

type cached struct {
	day  string
	days []Day
}

const maxCache = 1024

// NewHTTPSource wraps the feed in a breaker.
func NewHTTPSource(cfg HTTPConfig) *HTTPSource {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Client == nil {
		cfg.Client = &http.Client{}
	}
	if cfg.MaxResponse <= 0 {
		cfg.MaxResponse = 4 << 20
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 5 * time.Second
	}
	if cfg.Cooldown <= 0 {
		cfg.Cooldown = 5 * time.Minute
	}
	s := &HTTPSource{cfg: cfg, cache: map[string]cached{}}
	s.guard = engines.NewGuard(getter{s}, engines.GuardConfig{Name: engines.Name("weather-" + cfg.Adapter.Name()),
		Timeout: cfg.Timeout, Threshold: cfg.Threshold, Cooldown: cfg.Cooldown, Now: cfg.Now})
	return s
}

func (s *HTTPSource) Name() string { return s.cfg.Adapter.Name() }

// Stats is the breaker's state for a health page.
func (s *HTTPSource) Stats() engines.Stats { return s.guard.Stats() }

type getter struct{ s *HTTPSource }

// Call GETs the URL; errors never carry the URL.
func (g getter) Call(ctx context.Context, u []byte) ([]byte, error) {
	s := g.s
	target := string(u)
	if s.cfg.APIKey != "" && s.cfg.KeyParam != "" {
		sep := "?"
		if strings.Contains(target, "?") {
			sep = "&"
		}
		target += sep + url.QueryEscape(s.cfg.KeyParam) + "=" + url.QueryEscape(s.cfg.APIKey)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, errors.New("bad feed URL")
	}
	if s.cfg.APIKey != "" && s.cfg.KeyHeader != "" {
		req.Header.Set(s.cfg.KeyHeader, s.cfg.APIKey)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := s.cfg.Client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return nil, engines.ErrTimeout
			}
			return nil, ctx.Err()
		}
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return nil, fmt.Errorf("send failed: %s", s.scrub(err.Error()))
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("%w: status %d", engines.ErrStatus, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, s.cfg.MaxResponse+1))
	if err != nil {
		return nil, errors.New("read failed")
	}
	if int64(len(body)) > s.cfg.MaxResponse {
		return nil, engines.ErrTooLarge
	}
	return body, nil
}

func (s *HTTPSource) scrub(m string) string {
	if s.cfg.APIKey == "" {
		return m
	}
	m = strings.ReplaceAll(m, s.cfg.APIKey, "REDACTED")
	return strings.ReplaceAll(m, url.QueryEscape(s.cfg.APIKey), "REDACTED")
}

func (s *HTTPSource) fromCache(key, today string) ([]Day, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.cache[key]
	if !ok || c.day != today {
		return nil, false
	}
	return c.days, true
}

func (s *HTTPSource) store(key, today string, days []Day) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, c := range s.cache {
		if c.day != today || len(s.cache) >= maxCache {
			delete(s.cache, k)
		}
	}
	s.cache[key] = cached{day: today, days: days}
}

// Days skips a failed city and says so.
func (s *HTTPSource) Days(ctx context.Context, cities []City, from, to string) ([]Day, error) {
	if _, _, err := checkRange(from, to); err != nil {
		return nil, err
	}
	today := s.cfg.Now().In(Riyadh).Format(dateLayout)
	var out []Day
	var errs []error
	for _, c := range cities {
		if !c.HasPoint {
			continue
		}
		for _, f := range s.cfg.Adapter.Plan(c, from, to, today) {
			days, ok := s.fromCache(f.URL, today)
			if !ok {
				body, err := s.guard.Call(ctx, []byte(f.URL))
				if err != nil {
					errs = append(errs, errf(s.Name(), "city %s %s: %s", c.ID, f.Kind, s.scrub(err.Error())))
					continue
				}
				if days, err = s.cfg.Adapter.Parse(body, f); err != nil {
					errs = append(errs, errf(s.Name(), "city %s %s: %s", c.ID, f.Kind, s.scrub(err.Error())))
					continue
				}
				s.store(f.URL, today, days)
			}
			for _, d := range days {
				if d.Date < from || d.Date > to || !d.Known() {
					continue
				}
				d.CityID = c.ID
				out = append(out, validDay(d))
			}
		}
	}
	return Sorted(out), errors.Join(errs...)
}
