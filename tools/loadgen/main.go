// SPDX-License-Identifier: AGPL-3.0-only

// Command loadgen puts SYNTHETIC load on the api.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand/v2"
	"net/http"

	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// read is one weighted read endpoint.
type read struct {
	name   string
	path   string
	weight float64
}

// Read mix: the board polls dominate.
var reads = []read{
	{"GET /live/cases", "/live/cases?limit=200", 4},
	{"GET /live/agents", "/live/agents?limit=200", 2},
	{"GET /cases", "/cases?limit=50", 1},
	{"GET /forecasts/values", "/forecasts/values", 1},
	{"GET /forecasts/timeline", "/forecasts/timeline?zone_id={zone}&date={date}", 1},
	{"GET /dashboards/rollups", "/dashboards/rollups?level=zone", 1},
	{"GET /gaps", "/gaps", 0.5},
	{"GET /remote/queue", "/remote/queue", 1},
	{"GET /rosters", "/rosters", 0.5},
}

type config struct {
	api, fixtures, calibration, keyID, secretEnv, role, jsonOut, run, date string
	plan                                                                   Plan
	lifecycle, ping, think, timeout                                        time.Duration
	agents, readers, maxInflight, statusBatch                              int
	fieldShare                                                             float64
}

func parseFlags() config {
	var c config
	flag.StringVar(&c.api, "api", "http://127.0.0.1:8081", "api base address")
	flag.StringVar(&c.fixtures, "fixtures", "fixtures", "SYNTHETIC fixtures folder (zone, case type and agent codes)")
	flag.StringVar(&c.calibration, "calibration", "scripts/synthetic/calibration.json", "the generator's calibration (daily shape)")
	flag.StringVar(&c.keyID, "key-id", "loadgen", "feed key id")
	flag.StringVar(&c.secretEnv, "secret-env", "LOADGEN_FEED_SECRET", "environment variable holding the feed key secret")
	flag.StringVar(&c.role, "role", "dispatch_supervisor", "demo sign-in role for the reads (demo mode only)")
	flag.StringVar(&c.jsonOut, "json", "", "also write the summary as JSON to this file")
	flag.StringVar(&c.run, "run", strconv.FormatInt(time.Now().Unix()%1_000_000, 36), "run id in case numbers")
	flag.StringVar(&c.date, "date", "2026-09-14", "forecast day the timeline reads ask for")
	flag.Float64Var(&c.plan.PerDay, "per-day", 11000, "cases a day at 1x (plan: 7,000 to 11,000)")
	flag.Float64Var(&c.plan.Burst, "burst", 1, "peak burst multiplier on the case arrival rate")
	flag.StringVar(&c.plan.Mode, "mode", "peak", "peak: the busiest slot's rate throughout; day: the daily shape")
	flag.Float64Var(&c.plan.Speed, "speed", 1, "day mode: day time per wall time")
	flag.IntVar(&c.plan.StartSlot, "start-slot", 0, "day mode: first 15-minute slot (0 to 95)")
	flag.DurationVar(&c.plan.Duration, "duration", 5*time.Minute, "length of the run")
	flag.Uint64Var(&c.plan.Seed, "seed", 1, "schedule seed")
	flag.DurationVar(&c.lifecycle, "lifecycle", 90*time.Second, "time from registration to close (assign, arrive, close in between)")
	flag.IntVar(&c.agents, "agents", 600, "field agents sending status pings")
	flag.DurationVar(&c.ping, "ping", 30*time.Second, "status ping interval per agent")
	flag.IntVar(&c.statusBatch, "status-batch", 1, "status events per request")
	flag.IntVar(&c.readers, "readers", 40, "concurrent screen users reading")
	flag.DurationVar(&c.think, "think", 5*time.Second, "mean pause between one user's reads")
	flag.Float64Var(&c.fieldShare, "field-share", 0.7, "share of cases handled in the field")
	flag.IntVar(&c.maxInflight, "max-inflight", 2000, "open requests before new ones count as dropped")
	flag.DurationVar(&c.timeout, "timeout", 30*time.Second, "per-request timeout")
	flag.Parse()
	return c
}

func main() {
	c := parseFlags()
	if err := c.plan.Validate(); err != nil {
		log.Fatal(err)
	}
	secret := os.Getenv(c.secretEnv)
	if len(secret) < 32 {
		log.Fatalf("%s must hold the feed key secret (at least 32 bytes)", c.secretEnv)
	}
	shape, err := ShapeFromCalibration(c.calibration)
	if err != nil {
		log.Fatal(err)
	}
	refs, err := LoadRefs(c.fixtures)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client := &http.Client{Timeout: c.timeout, Transport: &http.Transport{MaxIdleConns: 512, MaxIdleConnsPerHost: 512, IdleConnTimeout: time.Minute}}
	base := strings.TrimRight(c.api, "/")
	feed := &Feed{Base: base, KeyID: c.keyID, Secret: []byte(secret), Client: client}
	cookie := ""
	if c.readers > 0 {
		if cookie, err = signIn(ctx, client, base, c.role, refs.ZoneIDs); err != nil {
			log.Fatal(err)
		}
	}

	arrivals := Arrivals(shape, c.plan)
	_, share := shape.Peak()
	log.Printf("run %s: %s mode, %.0f cases/day x%.1f, peak slot share %.4f: %.3f cases/s; %d arrivals in %s",
		c.run, c.plan.Mode, c.plan.PerDay, c.plan.Burst, share, c.plan.PeakRate(shape), len(arrivals), c.plan.Duration)
	log.Printf("status: %d agents every %s (%.1f events/s); reads: %d users, mean think %s",
		c.agents, c.ping, float64(c.agents)/c.ping.Seconds(), c.readers, c.think)

	stats := NewStats()
	sem := make(chan struct{}, c.maxInflight)
	var wg sync.WaitGroup
	var errMu sync.Mutex
	firstErrs := map[string]string{}
	fire := func(name string, fn func(context.Context) (int, error)) {
		select {
		case sem <- struct{}{}:
		default:
			stats.Record(name, 0, -1, false)
			return
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			t0 := time.Now()
			code, err := fn(context.Background())
			ok := err == nil && code >= 200 && code < 300
			stats.Record(name, time.Since(t0), code, ok)
			if !ok {
				errMu.Lock()
				if _, seen := firstErrs[name]; !seen {
					firstErrs[name] = fmt.Sprintf("code %d: %v", code, err)
				}
				errMu.Unlock()
			}
		}()
	}

	start := time.Now()
	end := start.Add(c.plan.Duration)
	runCtx, cancel := context.WithDeadline(ctx, end)
	defer cancel()
	var loops sync.WaitGroup

	// cases: one goroutine walks the schedule
	loops.Add(1)
	go func() {
		defer loops.Done()
		rng := rand.New(rand.NewPCG(c.plan.Seed, 2))
		var mu sync.Mutex
		for i, at := range arrivals {
			if !sleepUntil(runCtx, start.Add(at)) {
				return
			}
			mu.Lock()
			cs := NewCase(refs, rng, c.run, i, time.Now(), c.fieldShare)
			mu.Unlock()
			fire("POST /feeds/v1/cases (new)", func(ctx context.Context) (int, error) {
				return feed.Post(ctx, "/feeds/v1/cases", []caseEvent{{Key: cs.ExternalID + "-0", OccurredAt: cs.RegisteredAt, Case: cs}})
			})
			for step := 1; step <= 3; step++ {
				time.AfterFunc(c.lifecycle*time.Duration(step)/3, func() {
					if time.Now().After(end) {
						return
					}
					mu.Lock()
					cs = cs.Advance(step, refs, rng, time.Now())
					next := cs
					mu.Unlock()
					fire("POST /feeds/v1/cases (update)", func(ctx context.Context) (int, error) {
						return feed.Post(ctx, "/feeds/v1/cases", []caseEvent{{Key: fmt.Sprintf("%s-%d", next.ExternalID, step), OccurredAt: next.UpdatedAt, Case: next}})
					})
				})
			}
		}
	}()

	// status pings, evenly spread
	if c.agents > 0 {
		loops.Add(1)
		go func() {
			defer loops.Done()
			statuses := []string{"available", "en_route", "on_scene", "en_route", "available"}
			batch := max(c.statusBatch, 1)
			every := c.ping * time.Duration(batch) / time.Duration(c.agents)
			for n := 0; ; n++ {
				if !sleepUntil(runCtx, start.Add(every*time.Duration(n))) {
					return
				}
				events := make([]statusEvent, batch)
				now := time.Now()
				for j := range events {
					k := n*batch + j
					code := refs.AllCodes[k%len(refs.AllCodes)]
					events[j] = statusEvent{Key: fmt.Sprintf("LG-%s-s%d", c.run, k), OccurredAt: now, Agent: code, Status: statuses[(k/len(refs.AllCodes))%len(statuses)]}
				}
				fire("POST /feeds/v1/agent-status", func(ctx context.Context) (int, error) {
					return feed.Post(ctx, "/feeds/v1/agent-status", events)
				})
			}
		}()
	}

	// readers: closed loop, exponential think time
	total := 0.0
	for _, r := range reads {
		total += r.weight
	}
	for u := range c.readers {
		loops.Add(1)
		go func() {
			defer loops.Done()
			rng := rand.New(rand.NewPCG(c.plan.Seed, uint64(100+u)))
			for {
				if !sleepUntil(runCtx, time.Now().Add(time.Duration(rng.ExpFloat64()*float64(c.think)))) {
					return
				}
				r := pick(rng, total)
				path := strings.NewReplacer("{zone}", refs.ZoneIDs[rng.IntN(len(refs.ZoneIDs))], "{date}", c.date).Replace(r.path)
				fire(r.name, func(ctx context.Context) (int, error) { return get(ctx, client, base+path, cookie) })
			}
		}()
	}

	loops.Wait()
	elapsed := time.Since(start)
	wg.Wait()

	groups := map[string]func(string) bool{
		"ALL writes (feeds)": func(n string) bool { return strings.HasPrefix(n, "POST") },
		"ALL reads":          func(n string) bool { return strings.HasPrefix(n, "GET") },
		"ALL":                func(string) bool { return true },
	}
	rows := stats.Summaries(groups)
	fmt.Printf("\nrun %s, %s, %d case arrivals (x%.1f burst)\n", c.run, elapsed.Round(time.Second), len(arrivals), c.plan.Burst)
	PrintTable(os.Stdout, rows, elapsed)
	for n, e := range firstErrs {
		fmt.Printf("first error, %s: %s\n", n, e)
	}
	if c.jsonOut != "" {
		out, _ := json.MarshalIndent(map[string]any{"run": c.run, "plan": c.plan, "arrivals": len(arrivals),
			"elapsed_s": elapsed.Seconds(), "agents": c.agents, "readers": c.readers, "classes": rows}, "", "  ")
		if err := os.WriteFile(c.jsonOut, out, 0o644); err != nil {
			log.Fatal(err)
		}
	}
}

func pick(rng *rand.Rand, total float64) read {
	x := rng.Float64() * total
	for _, r := range reads {
		if x -= r.weight; x < 0 {
			return r
		}
	}
	return reads[len(reads)-1]
}

func sleepUntil(ctx context.Context, t time.Time) bool {
	d := time.Until(t)
	if d <= 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func get(ctx context.Context, client *http.Client, u, cookie string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Cookie", cookie)
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, err = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, err
}

// signIn uses the demo sign-in (demo mode only).
func signIn(ctx context.Context, client *http.Client, base, role string, zones []string) (string, error) {
	body, _ := json.Marshal(map[string]any{"assigned_role": role, "install_mode": "private", "zone_ids": zones})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/auth/demo/sign-in", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	for _, ck := range resp.Cookies() {
		if ck.Name == "opendispatch_session" {
			return ck.Name + "=" + ck.Value, nil
		}
	}
	return "", errors.New("demo sign-in gave no session: is the api in demo mode with DEMO_SESSION_SECRET set?")
}
