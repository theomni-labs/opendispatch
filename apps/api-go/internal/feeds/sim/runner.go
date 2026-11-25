// SPDX-License-Identifier: AGPL-3.0-only

package sim

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Window is a planned feed outage.
type Window struct{ From, To time.Time }

// DefaultOutage is the control file's default length.
const DefaultOutage = 3 * time.Minute

// ParseOutage reads "after:length", e.g. "10m:3m".
func ParseOutage(spec string, start time.Time) (*Window, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" || spec == "off" || spec == "0" {
		return nil, nil
	}
	after, length, ok := strings.Cut(spec, ":")
	if !ok {
		return nil, fmt.Errorf("outage %q: want after:length, e.g. 10m:3m", spec)
	}
	a, err := time.ParseDuration(after)
	if err != nil || a < 0 {
		return nil, fmt.Errorf("outage %q: bad start %q", spec, after)
	}
	l, err := time.ParseDuration(length)
	if err != nil || l <= 0 {
		return nil, fmt.Errorf("outage %q: bad length %q", spec, length)
	}
	return &Window{From: start.Add(a), To: start.Add(a + l)}, nil
}

// ParseMinutes reads the control file's content.
func ParseMinutes(s string) (time.Duration, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return DefaultOutage, nil
	}
	m, err := strconv.ParseFloat(s, 64)
	if err != nil || m <= 0 || m > 24*60 {
		return 0, fmt.Errorf("outage minutes %q: want a number above 0", s)
	}
	return time.Duration(m * float64(time.Minute)), nil
}

// Runner sends a Live stream until stopped.
type Runner struct {
	Live    *Live
	Post    func(ctx context.Context, path string, events []json.RawMessage) error
	Board   func(ctx context.Context) (map[string]Decision, error)
	Outages []Window
	Control string
	Logf    func(format string, args ...any)
	// BoardEvery: how often the board is read.
	BoardEvery time.Duration

	cases, statuses []json.RawMessage
	board           map[string]Decision
	boardAt         time.Time
	silent, failing bool
	boardFailing    bool
	summaryAt       time.Time
}

func (r *Runner) logf(format string, args ...any) {
	if r.Logf != nil {
		r.Logf(format, args...)
	}
}

// Queued is the number of events not yet sent.
func (r *Runner) Queued() int { return len(r.cases) + len(r.statuses) }

// Silent says whether an outage is on at now.
func (r *Runner) Silent(now time.Time) bool {
	for _, w := range r.Outages {
		if !now.Before(w.From) && now.Before(w.To) {
			return true
		}
	}
	return false
}

func (r *Runner) readControl(now time.Time) {
	if r.Control == "" {
		return
	}
	raw, err := os.ReadFile(r.Control)
	if err != nil {
		return
	}
	_ = os.Remove(r.Control)
	if strings.TrimSpace(string(raw)) == "0" {
		r.endOutages(now)
		return
	}
	d, err := ParseMinutes(string(raw))
	if err != nil {
		r.logf("outage control ignored: %v", err)
		return
	}
	r.Outages = append(r.Outages, Window{From: now, To: now.Add(d)})
	r.logf("outage requested: silent for %s", d)
}

// endOutages: "0" in the control file.
func (r *Runner) endOutages(now time.Time) {
	for i, w := range r.Outages {
		if !now.Before(w.From) && now.Before(w.To) {
			r.Outages[i].To = now
		}
	}
	r.logf("outage ended on request")
}

// Step does one tick at now.
func (r *Runner) Step(ctx context.Context, now time.Time) {
	r.readControl(now)
	silent := r.Silent(now)
	if silent != r.silent {
		if silent {
			r.logf("outage: the feeds go silent (Customer keeps dispatching on its own)")
		} else {
			r.logf("outage over: sending %d queued events", r.Queued())
		}
		r.silent = silent
	}
	every := r.BoardEvery
	if every <= 0 {
		every = 5 * time.Second
	}
	if r.Board != nil && r.Live.Waiting() > 0 && now.Sub(r.boardAt) >= every {
		r.boardAt = now
		b, err := r.Board(ctx)
		switch {
		case err != nil:
			if !r.boardFailing {
				r.logf("board read failed (Customer assigns on its own): %v", err)
			}
			r.boardFailing, r.board = true, nil
		default:
			if r.boardFailing {
				r.logf("board read recovered")
			}
			r.boardFailing, r.board = false, b
		}
	}
	cs, ss := r.Live.Tick(now, r.board, !silent)
	r.cases = append(r.cases, Raw(cs)...)
	r.statuses = append(r.statuses, Raw(ss)...)
	if !silent {
		r.flush(ctx)
	}
	if now.Sub(r.summaryAt) >= time.Minute {
		r.summaryAt = now
		st := r.Live.Stats
		r.logf("summary: arrived=%d customer_assigned=%d opendispatch_taken=%d closed=%d at_customer=%v recommended_at_customer=%d queued=%d silent=%t",
			st.Arrived, st.CustomerAssigned, st.Echoed, st.Closed, st.AtCustomer, st.RecommendedAtCustomer, r.Queued(), silent)
	}
}

func (r *Runner) flush(ctx context.Context) {
	for _, f := range []struct {
		path string
		q    *[]json.RawMessage
	}{{"/feeds/v1/cases", &r.cases}, {"/feeds/v1/agent-status", &r.statuses}} {
		for len(*f.q) > 0 {
			n := min(len(*f.q), 200)
			if err := r.Post(ctx, f.path, (*f.q)[:n]); err != nil {
				if !r.failing && !errors.Is(err, context.Canceled) {
					r.logf("api unreachable, keeping %d events: %v", r.Queued(), err)
				}
				r.failing = true
				return
			}
			*f.q = (*f.q)[n:]
		}
	}
	if r.failing {
		r.logf("api reachable again")
		r.failing = false
	}
}

// Run steps every interval until ctx ends.
func (r *Runner) Run(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		r.Step(ctx, time.Now())
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
