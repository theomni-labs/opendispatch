// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"math"
	"testing"
	"time"
)

func blendDay(t *testing.T) (ForecastRequest, []ForecastValue, []ForecastValue) {
	t.Helper()
	origin := time.Date(2026, 9, 10, 0, 0, 0, 0, loc)
	req := ForecastRequest{Origin: origin, Days: 1, Zones: []ZoneSpec{{ZoneID: "z1", SubZones: []string{"a", "b"}}}}
	// 84 days at 100 cases a day, oldest first: not small
	for d := SmallZoneDays; d >= 1; d-- {
		req.History = append(req.History, HistoryRecord{SubZoneID: "a", Start: addDays(origin, -d).Add(9 * time.Hour), Total: 100})
	}
	var eng, seg []ForecastValue
	for i := 0; i < intervalsPerDay; i++ {
		ts := origin.Add(time.Duration(i) * 15 * time.Minute)
		// engine: flat, a three times b; segment: all at 09:00
		eng = append(eng, ForecastValue{ZoneID: "z1", SubZoneID: "a", Start: ts, Low: 0.5, Expected: 0.75, High: 1.5, Field: 0.3, HasField: true},
			ForecastValue{ZoneID: "z1", SubZoneID: "b", Start: ts, Expected: 0.25, High: 1, Field: 0.1, HasField: true})
		var s float64
		if i == 36 {
			s = 50
		}
		seg = append(seg, ForecastValue{ZoneID: "z1", SubZoneID: "a", Start: ts, Expected: s}, ForecastValue{ZoneID: "z1", SubZoneID: "b", Start: ts, Expected: s / 4})
	}
	return req, eng, seg
}

func sumOf(vs []ForecastValue, keep func(ForecastValue) bool) float64 {
	var s float64
	for _, v := range vs {
		if keep(v) {
			s += v.Expected
		}
	}
	return s
}

func blendOf(req ForecastRequest, eng, seg []ForecastValue) []ForecastValue {
	return BlendWithSegment(eng, SegmentDaysOf(seg), SmallZones(req, DefaultSmallZone), DefaultShapeShare)
}

func TestBlendKeepsTheDayTotalAndMeetsTheSegmentShapeHalfway(t *testing.T) {
	req, eng, seg := blendDay(t)
	out := blendOf(req, eng, seg)
	all := func(ForecastValue) bool { return true }
	near(t, "day total", sumOf(out, all), 96)
	// half the day flat, half at 09:00
	at9 := func(v ForecastValue) bool { return v.Start.In(loc).Hour() == 9 && v.Start.In(loc).Minute() == 0 }
	near(t, "09:00", sumOf(out, at9), 0.5*1+0.5*96)
	at3 := func(v ForecastValue) bool { return v.Start.In(loc).Hour() == 3 && v.Start.In(loc).Minute() == 0 }
	near(t, "03:00", sumOf(out, at3), 0.5)
	for _, v := range out {
		if v.Low > v.Expected+1e-12 || v.Expected > v.High+1e-12 {
			t.Fatalf("range out of order %+v", v)
		}
	}
	// the engine's sub-zone split stays: a is three times b
	a := sumOf(out, func(v ForecastValue) bool { return v.SubZoneID == "a" })
	b := sumOf(out, func(v ForecastValue) bool { return v.SubZoneID == "b" })
	near(t, "split", a/b, 3)
}

func TestBlendAveragesTheDayTotalInASmallZone(t *testing.T) {
	req, eng, seg := blendDay(t)
	req.History = req.History[:1]
	if !SmallZones(req, DefaultSmallZone)["z1"] {
		t.Fatal("one case in 84 days is a small zone")
	}
	out := blendOf(req, eng, seg)
	near(t, "day total", sumOf(out, func(ForecastValue) bool { return true }), 0.5*96+0.5*62.5)
}

func TestBlendFillsASlotTheEngineLeftEmpty(t *testing.T) {
	req, eng, seg := blendDay(t)
	for i := range eng {
		if eng[i].Start.In(loc).Hour() == 9 {
			eng[i].Expected, eng[i].Low, eng[i].Field = 0, 0, 0
		}
	}
	out := blendOf(req, eng, seg)
	var a, b, fa float64
	for _, v := range out {
		if v.Start.In(loc).Hour() == 9 && v.Start.In(loc).Minute() == 0 {
			if v.SubZoneID == "a" {
				a, fa = v.Expected, v.Field
			} else {
				b = v.Expected
			}
		}
	}
	// the engine's day split, 3 to 1, and a's field share
	if a <= 0 || math.Abs(a/b-3) > 1e-9 || math.Abs(fa/a-0.4) > 1e-9 {
		t.Fatalf("09:00 a %v b %v field %v", a, b, fa)
	}
}

func TestSegmentProfileGivesTheSegmentAverage(t *testing.T) {
	ds := smallDataset()
	hist := buildHistory(ds.Cases)
	origin := time.Date(2026, 9, 3, 0, 0, 0, 0, loc)
	seg := func(d string) string {
		if d == "2026-09-02" {
			return "Weekdays-Event"
		}
		return weekdayGroup(mustDay(t, d)) + "-School"
	}
	var before []HistoryRecord
	for _, h := range hist {
		if h.Start.Before(origin) {
			before = append(before, h)
		}
	}
	zones := zoneSpecs(ds)
	req := ForecastRequest{Origin: origin, Days: 2, Zones: zones, History: before}
	sv, err := SegmentAverage(seg)(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	want := SegmentDaysOf(sv)
	zoneOf := map[string]string{}
	var ids []string
	for _, z := range zones {
		ids = append(ids, z.ZoneID)
		for _, s := range z.SubZones {
			zoneOf[s] = z.ZoneID
		}
	}
	p := SegmentProfile{Sums: map[string]map[string]*[intervalsPerDay]float64{}, First: localDay(before[0].Start)}
	for _, h := range before {
		z, l := zoneOf[h.SubZoneID], seg(localDay(h.Start).Format("2006-01-02"))
		if p.Sums[z] == nil {
			p.Sums[z] = map[string]*[intervalsPerDay]float64{}
		}
		if p.Sums[z][l] == nil {
			p.Sums[z][l] = &[intervalsPerDay]float64{}
		}
		p.Sums[z][l][slotOf(h.Start)] += float64(h.Total)
	}
	got := p.Days(origin, 2, ids, seg)
	for k, w := range want {
		var tw float64
		for _, x := range w {
			tw += x
		}
		g := got[k]
		if tw == 0 && g == nil {
			continue
		}
		if g == nil {
			t.Fatalf("missing %+v", k)
		}
		for i := range w {
			near(t, "slot", g[i], w[i])
		}
	}
}

func mustDay(t *testing.T, d string) time.Time {
	t.Helper()
	x, err := time.ParseInLocation("2006-01-02", d, loc)
	if err != nil {
		t.Fatal(err)
	}
	return x
}

func TestBacktestRecordsTheBlend(t *testing.T) {
	cfg := ForecastConfig{Horizon: 1, MinHistoryDays: 1, HeldOutDays: 2, Candidate: stub, CandidateName: "stub", WeakestN: 2,
		Segmenter: func(string) string { return "Weekdays-School" }}
	plain, err := RunForecast(context.Background(), smallDataset(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	b := DefaultBlend()
	cfg.Blend = &b
	blended, err := RunForecast(context.Background(), smallDataset(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if plain.Blend != nil || blended.Blend == nil || blended.BlendNote == "" {
		t.Fatalf("blend %+v / %+v", plain.Blend, blended.Blend)
	}
	if *plain.Candidate.Overall.WAPE == *blended.Candidate.Overall.WAPE {
		t.Fatal("the blend changed nothing")
	}
}
