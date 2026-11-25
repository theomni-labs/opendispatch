// SPDX-License-Identifier: AGPL-3.0-only

package engines_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestParseConfig(t *testing.T) {
	all := map[string]string{
		"OPENDISPATCH_ENGINE_MODE":                   "engine",
		"OPENDISPATCH_ENGINE_FORECASTER_URL":         "http://f",
		"OPENDISPATCH_ENGINE_OPTIMIZER_URL":          "http://o",
		"OPENDISPATCH_ENGINE_SIMULATOR_URL":          "http://s",
		"OPENDISPATCH_ENGINE_ASSIGNMENT_URL":         "http://a",
		"OPENDISPATCH_ENGINE_ASSIGNMENT_DEADLINE_MS": "500",
	}
	with := func(k, v string) map[string]string {
		m := map[string]string{}
		for a, b := range all {
			m[a] = b
		}
		m[k] = v
		return m
	}
	cases := []struct {
		name     string
		env      map[string]string
		wantErr  bool
		mode     engines.Mode
		deadline time.Duration
	}{
		{"empty is fixture", nil, false, engines.ModeFixture, 2000 * time.Millisecond},
		{"explicit fixture", map[string]string{"OPENDISPATCH_ENGINE_MODE": "Fixture"}, false, engines.ModeFixture, 2000 * time.Millisecond},
		{"engine with urls", all, false, engines.ModeEngine, 500 * time.Millisecond},
		{"engine missing url", with("OPENDISPATCH_ENGINE_SIMULATOR_URL", ""), true, "", 0},
		{"bad mode", map[string]string{"OPENDISPATCH_ENGINE_MODE": "live"}, true, "", 0},
		{"deadline not a number", map[string]string{"OPENDISPATCH_ENGINE_ASSIGNMENT_DEADLINE_MS": "x"}, true, "", 0},
		{"deadline too small", map[string]string{"OPENDISPATCH_ENGINE_ASSIGNMENT_DEADLINE_MS": "10"}, true, "", 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := engines.ParseConfig(env(c.env))
			if (err != nil) != c.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, c.wantErr)
			}
			if c.wantErr {
				return
			}
			if got.Mode != c.mode || got.AssignmentDeadline != c.deadline {
				t.Fatalf("got %v %v", got.Mode, got.AssignmentDeadline)
			}
		})
	}
}

func TestEngineDeadlines(t *testing.T) {
	cfg, err := engines.ParseConfig(env(map[string]string{"OPENDISPATCH_ENGINE_FORECASTER_DEADLINE_MS": "900000", "OPENDISPATCH_ENGINE_ASSIGNMENT_DEADLINE_MS": "500"}))
	if err != nil {
		t.Fatal(err)
	}
	if got := cfg.Deadline(engines.Forecaster); got != 15*time.Minute {
		t.Fatalf("forecaster %v, want 15m", got)
	}
	if got := cfg.Deadline(engines.Optimizer); got != engines.DefaultDeadline {
		t.Fatalf("optimizer %v, want the default", got)
	}
	if got := cfg.Deadline(engines.Assignment); got != 500*time.Millisecond {
		t.Fatalf("assignment %v, want its own setting", got)
	}
	for _, bad := range []string{"x", "999", "1800001"} {
		if _, err := engines.ParseConfig(env(map[string]string{"OPENDISPATCH_ENGINE_SIMULATOR_DEADLINE_MS": bad})); err == nil {
			t.Fatalf("%q must be refused", bad)
		}
	}
}

func TestBuildFixtureMode(t *testing.T) {
	cfg, _ := engines.ParseConfig(env(nil))
	g, err := cfg.Build(engines.Assignment, []byte(`{"a":1}`))
	if err != nil {
		t.Fatal(err)
	}
	out, err := g.Call(context.Background(), []byte(`{}`))
	if err != nil || string(out) != `{"a":1}` {
		t.Fatalf("out %q err %v", out, err)
	}
	if _, err := cfg.Build("nope", nil); err == nil {
		t.Fatal("unknown engine must fail")
	}
}

func TestHTTPEngine(t *testing.T) {
	cases := []struct {
		name string
		b    enginetest.Behavior
		want error
	}{
		{"answer", enginetest.Behavior{Kind: enginetest.Answer}, nil},
		{"500", enginetest.Behavior{Kind: enginetest.Status500}, engines.ErrStatus},
		{"oversized", enginetest.Behavior{Kind: enginetest.Oversized, Size: 2048}, engines.ErrTooLarge},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := enginetest.New()
			defer srv.Close()
			srv.Script(c.b)
			h := engines.NewHTTP(engines.Optimizer, srv.URL+"/")
			h.MaxResponse = 1024
			out, err := h.Call(context.Background(), []byte(`{"x":1}`))
			if !errors.Is(err, c.want) {
				t.Fatalf("err = %v, want %v", err, c.want)
			}
			if c.want == nil && string(out) != enginetest.DefaultBody {
				t.Fatalf("out %q", out)
			}
			r := srv.Requests()
			if len(r) != 1 || r[0].Path != "/v1/optimizer" || r[0].ContentType != "application/json" || r[0].Body != `{"x":1}` {
				t.Fatalf("request %+v", r)
			}
		})
	}
}

func TestHTTPDeadlineFromContext(t *testing.T) {
	srv := enginetest.New()
	defer srv.Close()
	srv.Script(enginetest.Behavior{Kind: enginetest.Hang})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := engines.NewHTTP(engines.Forecaster, srv.URL).Call(ctx, []byte(`{}`)); !errors.Is(err, engines.ErrTimeout) {
		t.Fatalf("err = %v", err)
	}
}

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func newGuard(srv *enginetest.Server, timeout time.Duration) (*engines.Guard, *clock) {
	clk := &clock{t: time.Unix(1_800_000_000, 0)}
	g := engines.NewGuard(engines.NewHTTP(engines.Assignment, srv.URL), engines.GuardConfig{
		Name: engines.Assignment, Timeout: timeout, Threshold: 3, Cooldown: time.Minute, Now: clk.Now,
	})
	return g, clk
}

func TestGuardGivesUpAtDeadline(t *testing.T) {
	cfg, _ := engines.ParseConfig(env(map[string]string{"OPENDISPATCH_ENGINE_ASSIGNMENT_DEADLINE_MS": "2000"}))
	if cfg.Deadline(engines.Assignment) != 2*time.Second {
		t.Fatalf("default deadline %v", cfg.Deadline(engines.Assignment))
	}
	for _, kind := range []enginetest.Kind{enginetest.Hang, enginetest.Slow} {
		srv := enginetest.New()
		srv.Script(enginetest.Behavior{Kind: kind, Delay: 5 * time.Second})
		g, _ := newGuard(srv, 80*time.Millisecond)
		start := time.Now()
		_, err := g.Call(context.Background(), []byte(`{}`))
		if !errors.Is(err, engines.ErrTimeout) {
			t.Fatalf("kind %d err = %v", kind, err)
		}
		if el := time.Since(start); el > time.Second {
			t.Fatalf("took %v", el)
		}
		if s := g.Stats(); s.Timeouts != 1 || s.Failures != 1 {
			t.Fatalf("stats %+v", s)
		}
		srv.Close()
	}
}

func TestGuardDiscardsLateAnswer(t *testing.T) {
	srv := enginetest.New()
	defer srv.Close()
	srv.Script(enginetest.Behavior{Kind: enginetest.Slow, Delay: 300 * time.Millisecond})
	g, _ := newGuard(srv, 50*time.Millisecond)
	out, err := g.Call(context.Background(), []byte(`{}`))
	if out != nil || !errors.Is(err, engines.ErrTimeout) {
		t.Fatalf("out %q err %v", out, err)
	}
	time.Sleep(400 * time.Millisecond)
	if s := g.Stats(); s.Failures != 1 || s.Calls != 1 {
		t.Fatalf("late answer changed stats %+v", s)
	}
}

func TestGuardInvalidAnswersAreFailures(t *testing.T) {
	cases := []struct {
		name string
		b    enginetest.Behavior
		want error
	}{
		{"invalid json", enginetest.Behavior{Kind: enginetest.InvalidJSON}, engines.ErrInvalidResponse},
		{"500", enginetest.Behavior{Kind: enginetest.Status500}, engines.ErrStatus},
		{"oversized", enginetest.Behavior{Kind: enginetest.Oversized, Size: 64}, engines.ErrTooLarge},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := enginetest.New()
			defer srv.Close()
			srv.Script(c.b)
			h := engines.NewHTTP(engines.Assignment, srv.URL)
			h.MaxResponse = 32
			g := engines.NewGuard(h, engines.GuardConfig{Name: engines.Assignment, Timeout: time.Second})
			if _, err := g.Call(context.Background(), []byte(`{}`)); !errors.Is(err, c.want) {
				t.Fatalf("err = %v, want %v", err, c.want)
			}
			if s := g.Stats(); s.Failures != 1 || s.Timeouts != 0 {
				t.Fatalf("stats %+v", s)
			}
		})
	}
}

func TestGuardBreakerOpensAndCloses(t *testing.T) {
	srv := enginetest.New()
	defer srv.Close()
	srv.Script(enginetest.Behavior{Kind: enginetest.Status500})
	g, clk := newGuard(srv, time.Second)
	call := func() error { _, err := g.Call(context.Background(), []byte(`{}`)); return err }

	for i := 0; i < 3; i++ {
		if err := call(); !errors.Is(err, engines.ErrStatus) {
			t.Fatalf("call %d err = %v", i, err)
		}
	}
	if s := g.Stats(); s.State != engines.Open || s.BreakerOpens != 1 {
		t.Fatalf("stats %+v", s)
	}
	seen := len(srv.Requests())
	if err := call(); !errors.Is(err, engines.ErrBreakerOpen) {
		t.Fatalf("err = %v", err)
	}
	if len(srv.Requests()) != seen {
		t.Fatal("an open breaker must not reach the engine")
	}

	clk.Advance(30 * time.Second)
	if err := call(); !errors.Is(err, engines.ErrBreakerOpen) {
		t.Fatalf("before cool-down err = %v", err)
	}

	clk.Advance(31 * time.Second)
	if err := call(); !errors.Is(err, engines.ErrStatus) {
		t.Fatalf("failed probe err = %v", err)
	}
	if s := g.Stats(); s.State != engines.Open || s.BreakerOpens != 2 {
		t.Fatalf("failed probe must reopen: %+v", s)
	}

	srv.Script(enginetest.Behavior{Kind: enginetest.Answer})
	clk.Advance(61 * time.Second)
	if err := call(); err != nil {
		t.Fatalf("probe err = %v", err)
	}
	if s := g.Stats(); s.State != engines.Closed {
		t.Fatalf("stats %+v", s)
	}
	if err := call(); err != nil {
		t.Fatalf("closed breaker err = %v", err)
	}
	if s := g.Stats(); s.Rejected != 2 || s.Calls != 8 {
		t.Fatalf("stats %+v", s)
	}
}

func TestGuardSuccessResetsStreak(t *testing.T) {
	srv := enginetest.New()
	defer srv.Close()
	g, _ := newGuard(srv, time.Second)
	bad, good := enginetest.Behavior{Kind: enginetest.Status500}, enginetest.Behavior{Kind: enginetest.Answer}
	srv.Script(bad, bad, good, bad, bad, good)
	for i := 0; i < 6; i++ {
		_, _ = g.Call(context.Background(), []byte(`{}`))
	}
	if s := g.Stats(); s.State != engines.Closed || s.BreakerOpens != 0 || s.Failures != 4 {
		t.Fatalf("stats %+v", s)
	}
}

func TestGuardCallerCancelIsNotAFailure(t *testing.T) {
	srv := enginetest.New()
	defer srv.Close()
	srv.Script(enginetest.Behavior{Kind: enginetest.Hang})
	g, _ := newGuard(srv, time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(30*time.Millisecond, cancel)
	if _, err := g.Call(ctx, []byte(`{}`)); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if s := g.Stats(); s.Failures != 0 {
		t.Fatalf("stats %+v", s)
	}
}

func TestForecasterGetsLargerResponseCap(t *testing.T) {
	if engines.NewHTTP(engines.Forecaster, "http://x").MaxResponse != engines.ForecasterMaxResponse {
		t.Fatal("forecaster cap")
	}
	if engines.NewHTTP(engines.Optimizer, "http://x").MaxResponse != engines.DefaultMaxResponse {
		t.Fatal("default cap")
	}
}

func TestBuildRoutePostsToTheRoute(t *testing.T) {
	srv := enginetest.New()
	defer srv.Close()
	cfg := engines.Config{Mode: engines.ModeEngine, URLs: map[engines.Name]string{engines.Assignment: srv.URL}}
	g, err := cfg.BuildRoute(engines.Assignment, "reposition", time.Second, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := g.Call(context.Background(), []byte(`{"x":1}`)); err != nil {
		t.Fatal(err)
	}
	if r := srv.Requests(); len(r) != 1 || r[0].Path != "/v1/assignment/reposition" {
		t.Fatalf("request %+v", r)
	}
	for _, bad := range []string{"", "a/b", "x?y"} {
		if _, err := cfg.BuildRoute(engines.Assignment, bad, time.Second, nil); err == nil {
			t.Fatalf("route %q accepted", bad)
		}
	}
	if _, err := cfg.BuildRoute("nope", "reposition", time.Second, nil); err == nil {
		t.Fatal("unknown engine accepted")
	}
}
