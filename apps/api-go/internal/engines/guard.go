// SPDX-License-Identifier: AGPL-3.0-only

package engines

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"
)

type BreakerState string

const (
	Closed   BreakerState = "closed"
	Open     BreakerState = "open"
	HalfOpen BreakerState = "half_open"
)

// Stats is a point-in-time copy for a health page.
type Stats struct {
	Name         Name
	State        BreakerState
	Calls        uint64
	Failures     uint64
	Timeouts     uint64
	BreakerOpens uint64
	Rejected     uint64
	LastFailure  time.Time
}

// GuardConfig sets limits; Now is injectable
type GuardConfig struct {
	Name      Name
	Timeout   time.Duration
	Threshold int
	Cooldown  time.Duration
	Now       func() time.Time
}

// Guard adds deadline, breaker and counters
type Guard struct {
	inner Engine
	cfg   GuardConfig

	mu       sync.Mutex
	state    BreakerState
	streak   int
	openedAt time.Time
	probing  bool
	stats    Stats
}

func NewGuard(inner Engine, cfg GuardConfig) *Guard {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Threshold < 1 {
		cfg.Threshold = 3
	}
	if cfg.Cooldown <= 0 {
		cfg.Cooldown = 30 * time.Second
	}
	return &Guard{inner: inner, cfg: cfg, state: Closed, stats: Stats{Name: cfg.Name}}
}

// Stats returns the counters and the breaker state.
func (g *Guard) Stats() Stats {
	g.mu.Lock()
	defer g.mu.Unlock()
	s := g.stats
	s.State = g.state
	return s
}

type result struct {
	body []byte
	err  error
}

// Call gives up at the deadline; late is dropped
func (g *Guard) Call(ctx context.Context, request []byte) ([]byte, error) {
	probe, err := g.admit()
	if err != nil {
		return nil, err
	}
	cctx := ctx
	if g.cfg.Timeout > 0 {
		var cancel context.CancelFunc
		cctx, cancel = context.WithTimeout(ctx, g.cfg.Timeout)
		defer cancel()
	}
	done := make(chan result, 1)
	go func() {
		body, err := g.inner.Call(cctx, request)
		done <- result{body, err}
	}()
	select {
	case r := <-done:
		if r.err == nil && !json.Valid(r.body) {
			r = result{nil, ErrInvalidResponse}
		}
		if r.err != nil && errors.Is(r.err, context.DeadlineExceeded) {
			r.err = ErrTimeout
		}
		g.finish(probe, r.err)
		return r.body, r.err
	case <-cctx.Done():
		err := cctx.Err()
		if errors.Is(err, context.DeadlineExceeded) {
			err = ErrTimeout
		}
		g.finish(probe, err)
		return nil, err
	}
}

func (g *Guard) admit() (probe bool, err error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.stats.Calls++
	switch g.state {
	case Open:
		if g.cfg.Now().Sub(g.openedAt) < g.cfg.Cooldown {
			g.stats.Rejected++
			return false, ErrBreakerOpen
		}
		g.state = HalfOpen
		g.probing = true
		return true, nil
	case HalfOpen:
		if g.probing {
			g.stats.Rejected++
			return false, ErrBreakerOpen
		}
		g.probing = true
		return true, nil
	}
	return false, nil
}

func (g *Guard) finish(probe bool, err error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if probe {
		g.probing = false
	}
	if err == nil {
		g.streak = 0
		g.state = Closed
		return
	}
	if errors.Is(err, context.Canceled) {
		return
	}
	g.stats.Failures++
	if errors.Is(err, ErrTimeout) {
		g.stats.Timeouts++
	}
	g.stats.LastFailure = g.cfg.Now()
	g.streak++
	if g.state == HalfOpen || g.streak >= g.cfg.Threshold {
		if g.state != Open {
			g.stats.BreakerOpens++
		}
		g.state = Open
		g.openedAt = g.cfg.Now()
	}
}
