// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"encoding/json"
	"testing"
)

type fakeCaller struct {
	got  map[string]any
	resp string
}

func (f *fakeCaller) Call(_ context.Context, req []byte) ([]byte, error) {
	f.got = map[string]any{}
	if err := json.Unmarshal(req, &f.got); err != nil {
		return nil, err
	}
	return []byte(f.resp), nil
}

func TestEngineForecasterAdapter(t *testing.T) {
	fc := &fakeCaller{resp: `{"values":[{"zone_id":"z1","sub_zone_id":"s1","interval_start":"2026-09-14T07:00:00+03:00","low":1,"expected":2,"high":4}]}`}
	f := EngineForecaster(fc, "m1", SourceSynthetic)
	origin := ts("2026-09-14", "00:00")
	vs, err := f(context.Background(), ForecastRequest{
		Origin: origin, Days: 1, Coverage: 0.8,
		Zones:   []ZoneSpec{{ZoneID: "z1", SubZones: []string{"s1"}}},
		History: []HistoryRecord{{SubZoneID: "s1", Start: ts("2026-09-07", "07:00"), Total: 3, Field: 2}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(vs) != 1 || vs[0].Expected != 2 || !vs[0].Start.Equal(ts("2026-09-14", "07:00")) {
		t.Fatalf("values %+v", vs)
	}
	if fc.got["schema_version"] != "1.0" || fc.got["data_source"] != SourceSynthetic {
		t.Fatalf("request %v", fc.got)
	}
	h := fc.got["horizon"].(map[string]any)
	if h["start_date"] != "2026-09-14" || h["days"].(float64) != 1 {
		t.Fatalf("horizon %v", h)
	}
	recs := fc.got["history"].(map[string]any)["records"].([]any)
	if len(recs) != 1 || recs[0].(map[string]any)["interval_start"] != "2026-09-07T07:00:00+03:00" {
		t.Fatalf("history %v", recs)
	}
}

func TestEngineAssignerAdapter(t *testing.T) {
	fc := &fakeCaller{resp: `{"decision_time_ms":42,"ranking":[{"rank":1,"agent_id":"A"}]}`}
	a := EngineAssigner(fc, SourceSynthetic, 2000)
	d, err := a(context.Background(), AssignRequest{
		CaseID: "c1", ZoneID: "z1", Pos: ptC, RegisteredAt: ts("2026-09-06", "08:00"), Now: ts("2026-09-06", "08:01"),
		SpeedKmh: 40, Candidates: []AssignCandidate{{AgentID: "A", Pos: ptA, PositionAt: ts("2026-09-06", "07:50")}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if d.AgentID != "A" || d.DecisionTime.Milliseconds() != 42 {
		t.Fatalf("decision %+v", d)
	}
	cands := fc.got["candidates"].([]any)
	if len(cands) != 1 || cands[0].(map[string]any)["status"] != "available" {
		t.Fatalf("candidates %v", cands)
	}
	empty := &fakeCaller{resp: `{"ranking":[]}`}
	if _, err := EngineAssigner(empty, SourceSynthetic, 2000)(context.Background(), AssignRequest{CaseID: "c1"}); err == nil {
		t.Fatal("expected an error for an empty ranking")
	}
}

func TestEngineSendsActiveSubZonesOnly(t *testing.T) {
	fc := &fakeCaller{resp: `{"values":[]}`}
	c := NewEngineCandidate(fc, EngineOptions{ModelVersion: "m1", Source: SourceSynthetic, ActiveSubZoneDays: 7})
	_, err := c.Forecast(context.Background(), ForecastRequest{
		Origin: ts("2026-09-14", "00:00"), Days: 1, Coverage: 0.8,
		Zones: []ZoneSpec{{ZoneID: "z1", SubZones: []string{"old", "s1"}}, {ZoneID: "z2", SubZones: []string{"gone"}}},
		History: []HistoryRecord{
			{SubZoneID: "old", Start: ts("2026-08-01", "07:00"), Total: 3},
			{SubZoneID: "gone", Start: ts("2026-08-02", "07:00"), Total: 1},
			{SubZoneID: "s1", Start: ts("2026-09-10", "07:00"), Total: 2},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	zs := fc.got["zones"].([]any)
	if len(zs) != 1 {
		t.Fatalf("zones %v", zs)
	}
	subs := zs[0].(map[string]any)["sub_zones"].([]any)
	if len(subs) != 1 || subs[0].(map[string]any)["sub_zone_id"] != "s1" {
		t.Fatalf("sub-zones %v", subs)
	}
}
