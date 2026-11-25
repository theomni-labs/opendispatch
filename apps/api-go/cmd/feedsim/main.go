// SPDX-License-Identifier: AGPL-3.0-only

// Command feedsim replays the synthetic day into a running api's feeds.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds/sim"
)

func main() {
	url := flag.String("url", "http://127.0.0.1:8090", "api base address")
	keyID := flag.String("key-id", "sim", "key id")
	secretEnv := flag.String("secret-env", "FEED_SIM_SECRET", "environment variable holding the key secret")
	fixtures := flag.String("fixtures", "fixtures", "fixtures folder")
	dup := flag.Float64("duplicates", 0.1, "share of events sent twice")
	window := flag.Int("reorder", 20, "events may arrive up to this many places late")
	batch := flag.Int("batch", 100, "events per request")
	outageFrom := flag.Int("outage-from", -1, "first batch to lose (simulated network outage)")
	outageTo := flag.Int("outage-to", -1, "last batch to lose")
	toNow := flag.Bool("to-now", false, "shift the day so it ends now (for a board that reads the live feeds)")
	follow := flag.Bool("follow", false, "after the replay, keep sending new SYNTHETIC cases at the day's pace until stopped")
	speed := flag.Float64("speed", 1, "follow: how many times faster than real time the day runs")
	outage := flag.String("outage", "", "follow: planned silence as after:length, e.g. 10m:3m")
	control := flag.String("control", "", "follow: a file holding minutes of silence to start now (read, then removed)")
	readBoard := flag.Bool("board", false, "follow: read the board (demo sign-in) so the operator takes an accepted OpenDispatch assignment")
	rules := flag.Bool("rules", false, "leave handling out so the api's classification rules decide it")
	flag.Parse()
	sim.LeaveHandlingOut = *rules

	keys, err := feeds.NewKeys([]feeds.Key{{ID: *keyID, TenantID: "sim", SecretEnv: *secretEnv, Status: "active", DataSource: "SYNTHETIC"}})
	if err != nil {
		log.Fatal(err)
	}
	key, _ := keys.Lookup(*keyID, time.Now())
	day, err := sim.LoadDay(*fixtures)
	if err != nil {
		log.Fatal(err)
	}
	if *toNow {
		day.ShiftToEnd(time.Now())
	}
	s := &sim.Sender{URL: *url, Key: key, Sleep: time.Sleep}
	opt := sim.Options{Seed: 1, DuplicateRate: *dup, ReorderWindow: *window, BatchSize: *batch,
		Down: func(b int) bool { return b >= *outageFrom && b <= *outageTo }}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	c, err := s.Replay(ctx, "/feeds/v1/cases", sim.Raw(day.Cases), opt, nil)
	if err != nil {
		log.Fatal(err)
	}
	st, err := s.Replay(ctx, "/feeds/v1/agent-status", sim.Raw(day.Statuses), opt, nil)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("cases: %+v\nstatus: %+v\n", c, st)
	if !*follow {
		return
	}
	if err := runFollow(ctx, s, day, *fixtures, *url, *speed, *outage, *control, *readBoard); err != nil {
		log.Fatal(err)
	}
}

func runFollow(ctx context.Context, s *sim.Sender, day *sim.Stream, fixtures, api string, speed float64, outage, control string, readBoard bool) error {
	if speed <= 0 || speed > 1000 {
		return fmt.Errorf("feedsim: speed %v: want above 0, at most 1000", speed)
	}
	templates, agents, err := sim.LoadTemplates(fixtures)
	if err != nil {
		return err
	}
	start := time.Now()
	logf := log.New(os.Stdout, "feedsim: ", log.LstdFlags).Printf
	live := &sim.Live{Templates: templates, Pace: sim.Pace{Start: start, Speed: speed},
		RunID: strconv.FormatInt(start.Unix()%1_000_000, 36), Positions: sim.LastPositions(day), Idle: sim.IdleAgents(day), Logf: logf}
	r := &sim.Runner{Live: live, Post: s.Send, Control: control, Logf: logf, BoardEvery: 10 * time.Second}
	w, err := sim.ParseOutage(outage, start)
	if err != nil {
		return err
	}
	if w != nil {
		r.Outages = append(r.Outages, *w)
		logf("planned outage from %s to %s", w.From.Format(time.TimeOnly), w.To.Format(time.TimeOnly))
	}
	if readBoard {
		b, err := newBoard(api, fixtures, agents)
		if err != nil {
			return err
		}
		r.Board = b.Read
	}
	logf("following: SYNTHETIC cases at %gx the day's pace, run %s", speed, live.RunID)
	r.Run(ctx, time.Second)
	logf("stopped")
	return nil
}
