// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"
)

const tenMinutes = 600.0

type AssignCandidate struct {
	AgentID    string
	Pos        Point
	PositionAt time.Time
}

type AssignRequest struct {
	CaseID       string
	ZoneID       string
	Pos          Point
	RegisteredAt time.Time
	Now          time.Time
	Candidates   []AssignCandidate
	SpeedKmh     float64
}

type AssignDecision struct {
	AgentID      string
	DecisionTime time.Duration
}

// Assigner picks one agent for a case.
type Assigner func(context.Context, AssignRequest) (AssignDecision, error)

// Nearest is the least-travel baseline.
func Nearest(_ context.Context, r AssignRequest) (AssignDecision, error) {
	best, bestD := "", math.Inf(1)
	for _, c := range r.Candidates {
		d := haversineKm(c.Pos, r.Pos)
		if d < bestD || (d == bestD && c.AgentID < best) {
			best, bestD = c.AgentID, d
		}
	}
	if best == "" {
		return AssignDecision{}, errors.New("no candidates")
	}
	return AssignDecision{AgentID: best}, nil
}

type ReplayConfig struct {
	SpeedKmh      float64
	DutyWindow    time.Duration
	DeadlineMs    int
	FallbackMs    int
	PrimaryClock  string
	Candidate     Assigner
	CandidateName string
}

type TimeStats struct {
	MeanSec      float64 `json:"mean_seconds"`
	MedianSec    float64 `json:"median_seconds"`
	P90Sec       float64 `json:"p90_seconds"`
	WithinTenMin float64 `json:"share_within_10_min"`
}

type ArmStats struct {
	Name             string    `json:"name"`
	Kind             string    `json:"kind"`
	Cases            int       `json:"cases"`
	FromAssignment   TimeStats `json:"from_assignment"`
	FromRegistration TimeStats `json:"from_registration"`
}

type Agreement struct {
	Name                string  `json:"name"`
	SameAsCustomer      float64 `json:"share_same_agent_as_customer"`
	ShorterThanCustomer float64 `json:"share_shorter_travel_than_customer"`
	MeanDeltaSec        float64 `json:"mean_travel_delta_seconds_vs_customer"`
}

type DecisionStats struct {
	Name           string  `json:"name"`
	P50Ms          float64 `json:"p50_ms"`
	P95Ms          float64 `json:"p95_ms"`
	MaxMs          float64 `json:"max_ms"`
	DeadlineMs     int     `json:"deadline_ms"`
	WithinDeadline float64 `json:"share_within_deadline"`
	FallbackMs     int     `json:"fallback_ms"`
	WithinFallback float64 `json:"share_within_customer_fallback"`
}

type ReplayReport struct {
	Days            int             `json:"days"`
	FirstDay        string          `json:"first_day"`
	LastDay         string          `json:"last_day"`
	CasesReplayed   int             `json:"cases_replayed"`
	CasesSkipped    int             `json:"cases_skipped"`
	SpeedKmh        float64         `json:"speed_kmh"`
	DutyWindowHours float64         `json:"duty_window_hours"`
	PrimaryClock    string          `json:"primary_clock"`
	ClockNote       string          `json:"clock_note"`
	Arms            []ArmStats      `json:"arms"`
	Agreement       []Agreement     `json:"agreement"`
	Decision        []DecisionStats `json:"decision_time"`
}

type entry struct {
	caseID   string
	assigned time.Time
	end      time.Time
	pos      Point
}

type timelines map[string][]entry

func buildTimelines(ds *Dataset) timelines {
	tl := timelines{}
	for _, c := range ds.Cases {
		if c.Handling != "field" || c.AgentID == "" || c.AssignedAt == nil || !hasPos(c) {
			continue
		}
		end := *c.AssignedAt
		if c.ArrivedAt != nil {
			end = *c.ArrivedAt
		}
		if c.ClosedAt != nil {
			end = *c.ClosedAt
		}
		tl[c.AgentID] = append(tl[c.AgentID], entry{c.ID, *c.AssignedAt, end, Point{c.Latitude, c.Longitude}})
	}
	for _, l := range tl {
		sort.Slice(l, func(i, j int) bool {
			if !l[i].assigned.Equal(l[j].assigned) {
				return l[i].assigned.Before(l[j].assigned)
			}
			return l[i].caseID < l[j].caseID
		})
	}
	return tl
}

func hasPos(c Case) bool { return c.Latitude != 0 || c.Longitude != 0 }

type state struct {
	pos         Point
	known, busy bool
	onDuty      bool
	at          time.Time
}

func (ds *Dataset) stateAt(l []entry, id, caseID string, t time.Time, w time.Duration) state {
	idx := sort.Search(len(l), func(i int) bool { return l[i].assigned.After(t) })
	var st state
	k := idx - 1
	for k >= 0 && l[k].caseID == caseID {
		k--
	}
	if k >= 0 {
		st.pos, st.known, st.busy, st.at = l[k].pos, true, l[k].end.After(t), l[k].end
		st.onDuty = !l[k].assigned.Before(t.Add(-w))
	} else if p, ok := ds.Standby[ds.Agents[id].Extra.StandbyPointID]; ok {
		st.pos, st.known, st.at = p, true, t
	}
	if idx < len(l) && !l[idx].assigned.After(t.Add(w)) {
		st.onDuty = true
	}
	return st
}

type sample struct{ fromAssign, fromReg float64 }

func stats(name, kind string, s []sample) ArmStats {
	a := ArmStats{Name: name, Kind: kind, Cases: len(s)}
	a.FromAssignment = timeStats(s, func(x sample) float64 { return x.fromAssign })
	a.FromRegistration = timeStats(s, func(x sample) float64 { return x.fromReg })
	return a
}

func timeStats(s []sample, f func(sample) float64) TimeStats {
	if len(s) == 0 {
		return TimeStats{}
	}
	v := make([]float64, len(s))
	var sum float64
	in := 0
	for i, x := range s {
		v[i] = f(x)
		sum += v[i]
		if v[i] <= tenMinutes {
			in++
		}
	}
	sort.Float64s(v)
	return TimeStats{
		MeanSec: round(sum/float64(len(v)), 1), MedianSec: round(quantile(v, 0.5), 1),
		P90Sec: round(quantile(v, 0.9), 1), WithinTenMin: round(float64(in)/float64(len(v)), 4),
	}
}

func quantile(sorted []float64, q float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	i := int(math.Ceil(q*float64(len(sorted)))) - 1
	if i < 0 {
		i = 0
	}
	return sorted[i]
}

type assignArm struct {
	name    string
	fn      Assigner
	samples []sample
	same    int
	shorter int
	delta   float64
	ms      []float64
}

// RunReplay replays recorded field cases.
func RunReplay(ctx context.Context, ds *Dataset, cfg ReplayConfig) (*ReplayReport, error) {
	if cfg.SpeedKmh <= 0 {
		cfg.SpeedKmh = 40
	}
	if cfg.DutyWindow <= 0 {
		cfg.DutyWindow = 4 * time.Hour
	}
	if cfg.DeadlineMs <= 0 {
		cfg.DeadlineMs = 2000
	}
	if cfg.FallbackMs <= 0 {
		cfg.FallbackMs = 5000
	}
	if cfg.PrimaryClock == "" {
		cfg.PrimaryClock = "assignment"
	}
	if cfg.PrimaryClock != "assignment" && cfg.PrimaryClock != "registration" {
		return nil, fmt.Errorf("primary clock %q: want assignment or registration", cfg.PrimaryClock)
	}
	tl := buildTimelines(ds)
	var ids []string
	for id := range tl {
		s, known := ds.Agents[id]
		if known && (!s.IsActive || (s.Kind != "" && s.Kind != "field")) {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)

	arms := []*assignArm{{name: "nearest-agent", fn: Nearest}}
	if cfg.Candidate != nil {
		arms = append(arms, &assignArm{name: cfg.CandidateName, fn: cfg.Candidate})
	}
	var recorded, customerModel []sample
	rep := &ReplayReport{SpeedKmh: cfg.SpeedKmh, DutyWindowHours: cfg.DutyWindow.Hours(), PrimaryClock: cfg.PrimaryClock,
		ClockNote: "Customer has not confirmed when the 10-minute clock starts: both readings are shown"}
	days := map[int64]time.Time{}
	for _, c := range ds.Cases {
		if c.Handling != "field" || c.AgentID == "" || c.AssignedAt == nil || c.ArrivedAt == nil ||
			!hasPos(c) || c.ArrivedAt.Before(*c.AssignedAt) || c.AssignedAt.Before(c.RegisteredAt) {
			continue
		}
		t := *c.AssignedAt
		wait := t.Sub(c.RegisteredAt).Seconds()
		here := Point{c.Latitude, c.Longitude}
		var cands []AssignCandidate
		var chosen *state
		for _, id := range ids {
			st := ds.stateAt(tl[id], id, c.ID, t, cfg.DutyWindow)
			if !st.known {
				continue
			}
			if id == c.AgentID {
				s := st
				chosen = &s
				cands = append(cands, AssignCandidate{id, st.pos, st.at})
				continue
			}
			if st.busy || !st.onDuty {
				continue
			}
			cands = append(cands, AssignCandidate{id, st.pos, st.at})
		}
		if chosen == nil {
			rep.CasesSkipped++
			continue
		}
		req := AssignRequest{CaseID: c.ID, ZoneID: c.ZoneID, Pos: here, RegisteredAt: c.RegisteredAt, Now: t, Candidates: cands, SpeedKmh: cfg.SpeedKmh}
		pos := map[string]Point{}
		for _, a := range cands {
			pos[a.AgentID] = a.Pos
		}
		customerT := travelSeconds(chosen.pos, here, cfg.SpeedKmh)
		type pick struct {
			arm *assignArm
			t   float64
			id  string
			ms  float64
		}
		var picks []pick
		for _, arm := range arms {
			t0 := time.Now()
			d, err := arm.fn(ctx, req)
			el := time.Since(t0)
			if err != nil {
				return nil, fmt.Errorf("%s on case %s: %w", arm.name, c.ID, err)
			}
			if d.DecisionTime > 0 {
				el = d.DecisionTime
			}
			p, ok := pos[d.AgentID]
			if !ok {
				return nil, fmt.Errorf("%s returned an agent outside the candidates", arm.name)
			}
			picks = append(picks, pick{arm, travelSeconds(p, here, cfg.SpeedKmh), d.AgentID, float64(el) / float64(time.Millisecond)})
		}
		recorded = append(recorded, sample{c.ArrivedAt.Sub(t).Seconds(), c.ArrivedAt.Sub(c.RegisteredAt).Seconds()})
		customerModel = append(customerModel, sample{customerT, wait + customerT})
		for _, p := range picks {
			p.arm.samples = append(p.arm.samples, sample{p.t, wait + p.t})
			if p.id == c.AgentID {
				p.arm.same++
			}
			if p.t < customerT-1 {
				p.arm.shorter++
			}
			p.arm.delta += p.t - customerT
			p.arm.ms = append(p.arm.ms, p.ms)
		}
		days[localDay(t).Unix()] = localDay(t)
		rep.CasesReplayed++
	}
	if rep.CasesReplayed == 0 {
		return nil, errors.New("no replayable field cases: need assigned_at, arrived_at, coordinates and agent_id")
	}
	rep.Days = len(days)
	var dl []time.Time
	for _, d := range days {
		dl = append(dl, d)
	}
	sort.Slice(dl, func(i, j int) bool { return dl[i].Before(dl[j]) })
	rep.FirstDay, rep.LastDay = dl[0].Format("2006-01-02"), dl[len(dl)-1].Format("2006-01-02")
	rep.Arms = []ArmStats{
		stats("customer-recorded", "recorded", recorded),
		stats("customer-choice-straight-line", "simulated", customerModel),
	}
	n := float64(rep.CasesReplayed)
	for _, a := range arms {
		rep.Arms = append(rep.Arms, stats(a.name, "simulated", a.samples))
		rep.Agreement = append(rep.Agreement, Agreement{a.name, round(float64(a.same)/n, 4), round(float64(a.shorter)/n, 4), round(a.delta/n, 1)})
		sort.Float64s(a.ms)
		within, fb := 0, 0
		for _, m := range a.ms {
			if m <= float64(cfg.DeadlineMs) {
				within++
			}
			if m <= float64(cfg.FallbackMs) {
				fb++
			}
		}
		rep.Decision = append(rep.Decision, DecisionStats{
			Name: a.name, P50Ms: round(quantile(a.ms, 0.5), 3), P95Ms: round(quantile(a.ms, 0.95), 3), MaxMs: round(a.ms[len(a.ms)-1], 3),
			DeadlineMs: cfg.DeadlineMs, WithinDeadline: round(float64(within)/n, 4),
			FallbackMs: cfg.FallbackMs, WithinFallback: round(float64(fb)/n, 4),
		})
	}
	return rep, nil
}
