// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"math"
	"testing"
	"time"
)

var (
	ptA = Point{24.70, 46.70}
	ptB = Point{24.70, 46.90}
	ptC = Point{24.701, 46.701}
)

func replayCases() []Case {
	mk := func(id, sv string, p Point, reg, asg, arr, closed string) Case {
		return Case{ID: id, DataSource: SourceSynthetic, ZoneID: "z1", Handling: "field", AgentID: sv,
			Latitude: p.Lat, Longitude: p.Lon, RegisteredAt: ts("2026-09-06", reg),
			AssignedAt: tp(ts("2026-09-06", asg)), ArrivedAt: tp(ts("2026-09-06", arr)), ClosedAt: tp(ts("2026-09-06", closed))}
	}
	return []Case{
		mk("c1", "A", ptA, "07:55", "08:00", "08:05", "08:10"),
		mk("c2", "B", ptB, "07:55", "08:00", "08:05", "08:10"),
		mk("c3", "B", ptC, "08:20", "08:30", "08:50", "09:00"),
	}
}

func TestNearestPicksClosestAndBreaksTies(t *testing.T) {
	r := AssignRequest{Pos: ptC, Candidates: []AssignCandidate{{AgentID: "B", Pos: ptB}, {AgentID: "A", Pos: ptA}}}
	d, err := Nearest(context.Background(), r)
	if err != nil || d.AgentID != "A" {
		t.Fatalf("got %+v %v", d, err)
	}
	r.Candidates = []AssignCandidate{{AgentID: "Z", Pos: ptA}, {AgentID: "Y", Pos: ptA}}
	if d, _ := Nearest(context.Background(), r); d.AgentID != "Y" {
		t.Fatalf("tie went to %s", d.AgentID)
	}
	if _, err := Nearest(context.Background(), AssignRequest{}); err == nil {
		t.Fatal("expected an error without candidates")
	}
}

func TestRunReplayBothClocks(t *testing.T) {
	ds := dsOf(replayCases()...)
	rep, err := RunReplay(context.Background(), ds, ReplayConfig{SpeedKmh: 40})
	if err != nil {
		t.Fatal(err)
	}
	if rep.CasesReplayed != 1 || rep.CasesSkipped != 2 {
		t.Fatalf("replayed %d skipped %d", rep.CasesReplayed, rep.CasesSkipped)
	}
	arm := map[string]ArmStats{}
	for _, a := range rep.Arms {
		arm[a.Name] = a
	}
	rec := arm["customer-recorded"]
	if rec.FromAssignment.MeanSec != 1200 || rec.FromRegistration.MeanSec != 1800 {
		t.Fatalf("recorded %+v", rec)
	}
	if rec.FromAssignment.WithinTenMin != 0 || rec.FromRegistration.WithinTenMin != 0 {
		t.Fatalf("recorded 10 min %+v", rec)
	}
	customerSec := travelSeconds(ptB, ptC, 40)
	nm := arm["customer-choice-straight-line"]
	if math.Abs(nm.FromAssignment.MeanSec-round(customerSec, 1)) > 0.1 {
		t.Fatalf("customer model %v want %v", nm.FromAssignment.MeanSec, customerSec)
	}
	if math.Abs(nm.FromRegistration.MeanSec-nm.FromAssignment.MeanSec-600) > 0.2 {
		t.Fatalf("wait of 600s missing: %+v", nm)
	}
	near := arm["nearest-agent"]
	want := travelSeconds(ptA, ptC, 40)
	if math.Abs(near.FromAssignment.MeanSec-round(want, 1)) > 0.1 || near.FromAssignment.WithinTenMin != 1 {
		t.Fatalf("nearest %+v want %v", near, want)
	}
	if near.FromRegistration.WithinTenMin != 0 {
		t.Fatalf("a 600s wait must push the registration clock past 10 min: %+v", near)
	}
	ag := rep.Agreement[0]
	if ag.SameAsCustomer != 0 || ag.ShorterThanCustomer != 1 || ag.MeanDeltaSec >= 0 {
		t.Fatalf("agreement %+v", ag)
	}
	if rep.PrimaryClock != "assignment" || rep.Days != 1 {
		t.Fatalf("primary %s days %d", rep.PrimaryClock, rep.Days)
	}
}

func TestRunReplayCandidateAndDecisionTime(t *testing.T) {
	slow := func(_ context.Context, r AssignRequest) (AssignDecision, error) {
		return AssignDecision{AgentID: "B", DecisionTime: 6 * time.Second}, nil
	}
	rep, err := RunReplay(context.Background(), dsOf(replayCases()...), ReplayConfig{
		Candidate: slow, CandidateName: "slow", PrimaryClock: "registration"})
	if err != nil {
		t.Fatal(err)
	}
	if rep.PrimaryClock != "registration" || len(rep.Decision) != 2 {
		t.Fatalf("primary %s decisions %d", rep.PrimaryClock, len(rep.Decision))
	}
	d := rep.Decision[1]
	if d.Name != "slow" || d.P50Ms != 6000 || d.WithinDeadline != 0 || d.WithinFallback != 0 {
		t.Fatalf("decision %+v", d)
	}
	if rep.Agreement[1].SameAsCustomer != 1 {
		t.Fatalf("agreement %+v", rep.Agreement[1])
	}
}

func TestRunReplayRejectsBadCandidateAndClock(t *testing.T) {
	bad := func(context.Context, AssignRequest) (AssignDecision, error) {
		return AssignDecision{AgentID: "nobody"}, nil
	}
	ds := dsOf(replayCases()...)
	if _, err := RunReplay(context.Background(), ds, ReplayConfig{Candidate: bad, CandidateName: "bad"}); err == nil {
		t.Fatal("expected an error for an agent outside the candidates")
	}
	if _, err := RunReplay(context.Background(), ds, ReplayConfig{PrimaryClock: "x"}); err == nil {
		t.Fatal("expected an error for an unknown clock")
	}
}

func TestRunReplayBusyAgentIsNotACandidate(t *testing.T) {
	cs := replayCases()
	cs[0].ClosedAt = tp(ts("2026-09-06", "08:40"))
	rep, err := RunReplay(context.Background(), dsOf(cs...), ReplayConfig{SpeedKmh: 40})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Agreement[0].SameAsCustomer != 1 {
		t.Fatalf("A is busy until 08:40, nearest must fall back to B: %+v", rep.Agreement[0])
	}
}

func TestRunReplayStandbyGivesFirstPosition(t *testing.T) {
	ds := dsOf(replayCases()...)
	ds.Standby["sp"] = ptA
	s := Agent{ID: "A", IsActive: true, Kind: "field"}
	s.Extra.StandbyPointID = "sp"
	ds.Agents["A"] = s
	rep, err := RunReplay(context.Background(), ds, ReplayConfig{SpeedKmh: 40})
	if err != nil {
		t.Fatal(err)
	}
	if rep.CasesReplayed != 2 {
		t.Fatalf("replayed %d", rep.CasesReplayed)
	}
}

func TestRunReplayNoCases(t *testing.T) {
	ds := dsOf(Case{ID: "x", DataSource: SourceSynthetic, ZoneID: "z", Handling: "remote_inferred", RegisteredAt: ts("2026-09-06", "08:00")})
	if _, err := RunReplay(context.Background(), ds, ReplayConfig{}); err == nil {
		t.Fatal("expected an error")
	}
}
