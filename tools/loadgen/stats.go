// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"fmt"
	"io"
	"math"
	"slices"
	"sort"
	"sync"
	"time"
)

// Stats: latencies and outcomes per class.
type Stats struct {
	mu      sync.Mutex
	classes map[string]*class
}

type class struct {
	lat    []time.Duration
	errors int
	codes  map[int]int
}

// NewStats returns an empty recorder.
func NewStats() *Stats { return &Stats{classes: map[string]*class{}} }

// Record: code 0 transport error, -1 dropped.
func (s *Stats) Record(name string, d time.Duration, code int, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.classes[name]
	if c == nil {
		c = &class{codes: map[int]int{}}
		s.classes[name] = c
	}
	c.lat = append(c.lat, d)
	c.codes[code]++
	if !ok {
		c.errors++
	}
}

// Summary is one class's figures.
type Summary struct {
	Name     string         `json:"name"`
	Requests int            `json:"requests"`
	Errors   int            `json:"errors"`
	ErrRate  float64        `json:"error_rate"`
	P50ms    float64        `json:"p50_ms"`
	P95ms    float64        `json:"p95_ms"`
	P99ms    float64        `json:"p99_ms"`
	MaxMs    float64        `json:"max_ms"`
	Codes    map[string]int `json:"codes"`
}

// Percentile by nearest rank on a sorted slice.
func Percentile(sorted []time.Duration, p float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	i := int(math.Ceil(p/100*float64(len(sorted)))) - 1
	return sorted[min(max(i, 0), len(sorted)-1)]
}

func ms(d time.Duration) float64 { return math.Round(float64(d)/1e4) / 100 }

func summarize(name string, lat []time.Duration, errors int, codes map[int]int) Summary {
	l := slices.Clone(lat)
	slices.Sort(l)
	s := Summary{Name: name, Requests: len(l), Errors: errors, Codes: map[string]int{}}
	if len(l) > 0 {
		s.ErrRate = float64(errors) / float64(len(l))
		s.P50ms, s.P95ms, s.P99ms = ms(Percentile(l, 50)), ms(Percentile(l, 95)), ms(Percentile(l, 99))
		s.MaxMs = ms(l[len(l)-1])
	}
	for code, n := range codes {
		key := fmt.Sprint(code)
		switch code {
		case 0:
			key = "transport"
		case -1:
			key = "dropped"
		}
		s.Codes[key] = n
	}
	return s
}

// Summaries lists each class, then group totals.
func (s *Stats) Summaries(groups map[string]func(string) bool) []Summary {
	s.mu.Lock()
	defer s.mu.Unlock()
	names := make([]string, 0, len(s.classes))
	for n := range s.classes {
		names = append(names, n)
	}
	sort.Strings(names)
	var out []Summary
	for _, n := range names {
		c := s.classes[n]
		out = append(out, summarize(n, c.lat, c.errors, c.codes))
	}
	gnames := make([]string, 0, len(groups))
	for g := range groups {
		gnames = append(gnames, g)
	}
	sort.Strings(gnames)
	for _, g := range gnames {
		var lat []time.Duration
		errs, codes := 0, map[int]int{}
		for _, n := range names {
			if groups[g](n) {
				c := s.classes[n]
				lat = append(lat, c.lat...)
				errs += c.errors
				for k, v := range c.codes {
					codes[k] += v
				}
			}
		}
		out = append(out, summarize(g, lat, errs, codes))
	}
	return out
}

// PrintTable writes the summaries as aligned text.
func PrintTable(w io.Writer, rows []Summary, elapsed time.Duration) {
	fmt.Fprintf(w, "%-34s %8s %7s %8s %8s %8s %8s %8s\n", "class", "requests", "req/s", "errors", "p50 ms", "p95 ms", "p99 ms", "max ms")
	for _, r := range rows {
		fmt.Fprintf(w, "%-34s %8d %7.2f %7.2f%% %8.1f %8.1f %8.1f %8.1f\n", r.Name, r.Requests,
			float64(r.Requests)/elapsed.Seconds(), r.ErrRate*100, r.P50ms, r.P95ms, r.P99ms, r.MaxMs)
	}
}
