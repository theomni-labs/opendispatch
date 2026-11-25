// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestEngineCandidateDropsOldestDaysToStayUnderTheRequestCap(t *testing.T) {
	fc := &fakeCaller{resp: `{"values":[]}`}
	origin := ts("2026-09-14", "00:00")
	var hist []HistoryRecord
	for d := 10; d >= 1; d-- {
		for i := 0; i < 20; i++ {
			hist = append(hist, HistoryRecord{SubZoneID: "s1", Start: addDays(origin, -d).Add(time.Duration(i) * 15 * time.Minute), Total: 1})
		}
	}
	zones := []ZoneSpec{{ZoneID: "z1", SubZones: []string{"s1"}}}
	all := NewEngineCandidate(fc, EngineOptions{ModelVersion: "m", Source: SourceSynthetic})
	if _, err := all.Forecast(context.Background(), ForecastRequest{Origin: origin, Days: 1, Coverage: 0.8, Zones: zones, History: hist}); err != nil {
		t.Fatal(err)
	}
	full := all.Meta().MaxRequestBytes
	capped := NewEngineCandidate(fc, EngineOptions{ModelVersion: "m", Source: SourceSynthetic, RequestCap: full * 6 / 10})
	if _, err := capped.Forecast(context.Background(), ForecastRequest{Origin: origin, Days: 1, Coverage: 0.8, Zones: zones, History: hist}); err != nil {
		t.Fatal(err)
	}
	if m := capped.Meta().MaxRequestBytes; m > full*6/10 || m == 0 {
		t.Fatalf("request %d over the cap %d", m, full*6/10)
	}
	if m := capped.Meta(); m.TrimmedRequests != 1 || m.MinSpanSent >= m.MaxSpanDays || m.MaxRecords >= len(hist) {
		t.Fatalf("trim facts %+v", m)
	}
	if m := all.Meta(); m.TrimmedRequests != 0 || m.MaxRecords != len(hist) {
		t.Fatalf("untrimmed facts %+v", m)
	}
	body, _ := json.Marshal(fc.got)
	recs := fc.got["history"].(map[string]any)["records"].([]any)
	if len(recs) == 0 || len(recs) >= len(hist) || len(body) == 0 {
		t.Fatalf("%d of %d records kept", len(recs), len(hist))
	}
	first := recs[0].(map[string]any)["interval_start"].(string)[:10]
	if first == "2026-09-04" {
		t.Fatalf("the oldest day was kept: %s", first)
	}
	cal := fc.got["calendar"].([]any)
	if cal[len(cal)-1].(map[string]any)["date"] != "2026-09-14" {
		t.Fatal("the horizon day must stay")
	}
}

func capHistory(origin time.Time, days int) []HistoryRecord {
	var hist []HistoryRecord
	for d := days; d >= 1; d-- {
		for i := 0; i < 96; i++ {
			hist = append(hist, HistoryRecord{SubZoneID: "s1", Start: addDays(origin, -d).Add(time.Duration(i) * 15 * time.Minute), Total: (d*7 + i*3) % 5})
		}
	}
	return hist
}

func keptDays(fc *fakeCaller) int {
	recs := fc.got["history"].(map[string]any)["records"].([]any)
	seen := map[string]bool{}
	for _, r := range recs {
		seen[r.(map[string]any)["interval_start"].(string)[:10]] = true
	}
	return len(seen)
}

func TestTrimMeasuresCompressedSizeAndKeepsAsManyDaysAsFit(t *testing.T) {
	origin := ts("2026-09-14", "00:00")
	hist := capHistory(origin, 60)
	zones := []ZoneSpec{{ZoneID: "z1", SubZones: []string{"s1"}}}
	ask := func(opt EngineOptions) (*fakeCaller, EngineMeta, error) {
		fc := &fakeCaller{resp: `{"values":[]}`}
		opt.ModelVersion, opt.Source = "m", SourceSynthetic
		c := NewEngineCandidate(fc, opt)
		_, err := c.Forecast(context.Background(), ForecastRequest{Origin: origin, Days: 1, Coverage: 0.8, Zones: zones, History: hist})
		return fc, c.Meta(), err
	}
	_, full, err := ask(EngineOptions{})
	if err != nil || full.TrimmedRequests != 0 {
		t.Fatalf("%v %+v", err, full)
	}
	if full.MaxWireBytes*4 > full.MaxRequestBytes {
		t.Fatalf("not compressed: %d raw, %d wire", full.MaxRequestBytes, full.MaxWireBytes)
	}
	// compressed cap at half: the raw size is far over half and must not matter
	wireCap := full.MaxWireBytes / 2
	fc, m, err := ask(EngineOptions{RequestCap: wireCap})
	if err != nil || m.MaxWireBytes > wireCap {
		t.Fatalf("%v wire %d cap %d", err, m.MaxWireBytes, wireCap)
	}
	kept := keptDays(fc)
	if kept < 25 || kept > 35 {
		t.Fatalf("kept %d days of 60 for half the size", kept)
	}
	perDay := m.MaxWireBytes / kept
	if m.MaxWireBytes+2*perDay < wireCap {
		t.Fatalf("over-aggressive: %d of cap %d with %d days", m.MaxWireBytes, wireCap, kept)
	}
	fc, m, err = ask(EngineOptions{RawCap: full.MaxRequestBytes / 2})
	if err != nil || m.MaxRequestBytes > full.MaxRequestBytes/2 {
		t.Fatalf("%v raw %d", err, m.MaxRequestBytes)
	}
	if k := keptDays(fc); k < 28 || k > 32 || m.MaxRequestBytes < full.MaxRequestBytes/2-2*full.MaxRequestBytes/60 {
		t.Fatalf("raw cap kept %d days, %d bytes", k, m.MaxRequestBytes)
	}
}

func TestTrimFailsClearlyWhenOneDayDoesNotFit(t *testing.T) {
	origin := ts("2026-09-14", "00:00")
	fc := &fakeCaller{resp: `{"values":[]}`}
	c := NewEngineCandidate(fc, EngineOptions{ModelVersion: "m", Source: SourceSynthetic, RawCap: 500})
	_, err := c.Forecast(context.Background(), ForecastRequest{Origin: origin, Days: 1, Coverage: 0.8,
		Zones: []ZoneSpec{{ZoneID: "z1", SubZones: []string{"s1"}}}, History: capHistory(origin, 5)})
	if err == nil || !strings.Contains(err.Error(), "over the size limit") {
		t.Fatalf("err = %v", err)
	}
}
