// SPDX-License-Identifier: AGPL-3.0-only

package engines

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

type Mode string

const (
	ModeFixture Mode = "fixture"
	ModeEngine  Mode = "engine"
)

const (
	DefaultAssignmentDeadline = 2000 * time.Millisecond
	DefaultDeadline           = 60 * time.Second
	minDeadlineMS             = 1000
	maxDeadlineMS             = 30 * 60 * 1000
)

// Config is read from the environment.
type Config struct {
	Mode               Mode
	URLs               map[Name]string
	AssignmentDeadline time.Duration
	// Deadlines: set per-call limits, not assignment
	Deadlines map[Name]time.Duration
}

// ParseConfig reads OPENDISPATCH_ENGINE_* through getenv.
func ParseConfig(getenv func(string) string) (Config, error) {
	c := Config{Mode: ModeFixture, URLs: map[Name]string{}, AssignmentDeadline: DefaultAssignmentDeadline, Deadlines: map[Name]time.Duration{}}
	switch m := strings.ToLower(strings.TrimSpace(getenv("OPENDISPATCH_ENGINE_MODE"))); m {
	case "", string(ModeFixture):
	case string(ModeEngine):
		c.Mode = ModeEngine
	default:
		return Config{}, fmt.Errorf("OPENDISPATCH_ENGINE_MODE must be fixture or engine, got %q", m)
	}
	for _, n := range All {
		if u := strings.TrimSpace(getenv("OPENDISPATCH_ENGINE_" + strings.ToUpper(string(n)) + "_URL")); u != "" {
			c.URLs[n] = u
		}
	}
	if s := strings.TrimSpace(getenv("OPENDISPATCH_ENGINE_ASSIGNMENT_DEADLINE_MS")); s != "" {
		ms, err := strconv.Atoi(s)
		if err != nil || ms < 50 || ms > 30000 {
			return Config{}, fmt.Errorf("OPENDISPATCH_ENGINE_ASSIGNMENT_DEADLINE_MS must be 50 to 30000, got %q", s)
		}
		c.AssignmentDeadline = time.Duration(ms) * time.Millisecond
	}
	for _, n := range All {
		key := "OPENDISPATCH_ENGINE_" + strings.ToUpper(string(n)) + "_DEADLINE_MS"
		s := strings.TrimSpace(getenv(key))
		if n == Assignment || s == "" {
			continue
		}
		ms, err := strconv.Atoi(s)
		if err != nil || ms < minDeadlineMS || ms > maxDeadlineMS {
			return Config{}, fmt.Errorf("%s must be %d to %d, got %q", key, minDeadlineMS, maxDeadlineMS, s)
		}
		c.Deadlines[n] = time.Duration(ms) * time.Millisecond
	}
	if c.Mode == ModeEngine {
		for _, n := range All {
			if c.URLs[n] == "" {
				return Config{}, fmt.Errorf("engine mode needs OPENDISPATCH_ENGINE_%s_URL", strings.ToUpper(string(n)))
			}
		}
	}
	return c, nil
}

// Deadline is the per-call limit for one engine.
func (c Config) Deadline(n Name) time.Duration {
	if n == Assignment {
		return c.AssignmentDeadline
	}
	if d, ok := c.Deadlines[n]; ok {
		return d
	}
	return DefaultDeadline
}

// BuildRoute: an engine's extra route, own guard.
func (c Config) BuildRoute(n Name, route string, timeout time.Duration, fixture []byte) (*Guard, error) {
	if !Valid(n) || route == "" || strings.ContainsAny(route, "/?#") {
		return nil, fmt.Errorf("unknown engine route %q/%q", n, route)
	}
	var inner Engine = Fixture{Response: fixture}
	if c.Mode == ModeEngine {
		h := NewHTTP(n, c.URLs[n])
		h.Route = route
		inner = h
	}
	return NewGuard(inner, GuardConfig{Name: n, Timeout: timeout}), nil
}

// Build returns a guarded fixture or HTTP engine
func (c Config) Build(n Name, fixture []byte) (*Guard, error) {
	if !Valid(n) {
		return nil, fmt.Errorf("unknown engine %q", n)
	}
	var inner Engine = Fixture{Response: fixture}
	if c.Mode == ModeEngine {
		inner = NewHTTP(n, c.URLs[n])
	}
	return NewGuard(inner, GuardConfig{Name: n, Timeout: c.Deadline(n)}), nil
}
