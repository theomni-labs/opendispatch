// SPDX-License-Identifier: AGPL-3.0-only

// Explain: facts equal the screen; numbers checked.
package business

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
)

// explainGolden: shared with the screens' vitest.
type explainGolden struct {
	Zones []Zone `json:"zones"`
	Gap   struct {
		RosterDate string    `json:"roster_date"`
		DataSource string    `json:"data_source"`
		Cells      []GapCell `json:"cells"`
		Screen     struct {
			Gaps       int    `json:"gaps"`
			Surplus    int    `json:"surplus"`
			Met        string `json:"met"`
			OutOfReach string `json:"out_of_reach"`
			Worst      struct {
				Value    int    `json:"value"`
				ZoneCode string `json:"zone_code"`
				Time     string `json:"time"`
			} `json:"worst"`
			MainCause   string         `json:"main_cause"`
			CauseCounts map[string]int `json:"cause_counts"`
		} `json:"screen"`
	} `json:"gap"`
	Forecast struct {
		ZoneID      string                     `json:"zone_id"`
		Date        string                     `json:"date"`
		Intervals   []ForecastTimelineInterval `json:"intervals"`
		FieldShare  float64                    `json:"field_share"`
		Explanation ForecastExplanation        `json:"explanation"`
		Screen      struct {
			Expected  int    `json:"expected"`
			Peak      string `json:"peak"`
			RangeLow  int    `json:"range_low"`
			RangeHigh int    `json:"range_high"`
			Field     string `json:"field"`
		} `json:"screen"`
	} `json:"forecast"`
}

func loadExplainGolden(t *testing.T) explainGolden {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "explain_screens.json"))
	if err != nil {
		t.Fatal(err)
	}
	var g explainGolden
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func (g explainGolden) gapView() GapSurplusView {
	return GapSurplusView{RosterDate: g.Gap.RosterDate, DataSource: g.Gap.DataSource, Cells: g.Gap.Cells}
}

func (g explainGolden) forecastTimeline() ForecastTimeline {
	return ForecastTimeline{ZoneID: g.Forecast.ZoneID, Date: g.Forecast.Date, Intervals: g.Forecast.Intervals, DataSource: "SYNTHETIC"}
}

func (g explainGolden) forecastSplit() ForecastSplit {
	share := g.Forecast.FieldShare
	return ForecastSplit{Zones: []ForecastSplitZone{{ZoneID: g.Forecast.ZoneID, FieldShare: &share}}}
}

// roundTrip: facts as the model receives them.
func roundTrip(t *testing.T, facts map[string]any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(facts)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestExplainGapFactsEqualTheScreen(t *testing.T) {
	g := loadExplainGolden(t)
	want := g.Gap.Screen
	for _, locale := range []string{"en", "ar"} {
		f := roundTrip(t, gapFacts(g.gapView(), g.Zones, "", locale))
		if v := factMap(f, "gap_intervals")["value"]; v != float64(want.Gaps) {
			t.Fatalf("%s gap intervals %v, screen %d", locale, v, want.Gaps)
		}
		if v := factMap(f, "surplus_intervals")["value"]; v != float64(want.Surplus) {
			t.Fatalf("%s surplus %v, screen %d", locale, v, want.Surplus)
		}
		if v := factStr(factMap(f, "demand_met_share"), "value"); v != want.Met {
			t.Fatalf("%s met %s, screen %s", locale, v, want.Met)
		}
		if v := factStr(factMap(f, "out_of_10_minute_reach_share"), "value"); v != want.OutOfReach {
			t.Fatalf("%s out of reach %s, screen %s", locale, v, want.OutOfReach)
		}
		w := factMap(f, "worst_gap")
		if w["agents_short"] != float64(-want.Worst.Value) || w["zone_code"] != want.Worst.ZoneCode || w["interval_starts_at"] != want.Worst.Time {
			t.Fatalf("%s worst %+v, screen %+v", locale, w, want.Worst)
		}
		if mc := factMap(f, "main_cause")["label"]; mc != tr(gapLabels["cause."+want.MainCause], locale) {
			t.Fatalf("%s main cause %v", locale, mc)
		}
		for _, c := range f["gap_intervals_by_cause"].([]any) {
			m := c.(map[string]any)
			found := false
			for k, n := range want.CauseCounts {
				if m["label"] == tr(gapLabels["cause."+k], locale) {
					found = m["gap_intervals"] == float64(n)
				}
			}
			if !found {
				t.Fatalf("%s cause %+v, screen %+v", locale, m, want.CauseCounts)
			}
		}
		if _, ok := f["zones"]; ok {
			t.Fatal("per-zone counts are not on the screen")
		}
	}
	one := gapFacts(g.gapView(), shownZones(g.Zones, g.Zones[1].ID), g.Zones[1].ID, "en")
	if factMap(one, "gap_intervals")["value"] != 3 || one["scope"] != "Riyadh North" {
		t.Fatalf("one zone %+v", one)
	}
}

func TestExplainForecastFactsEqualTheScreen(t *testing.T) {
	g := loadExplainGolden(t)
	want := g.Forecast.Screen
	s := forecastScreenOf(g.forecastTimeline(), g.forecastSplit(), g.Forecast.ZoneID)
	f := roundTrip(t, forecastFacts(s, &g.Forecast.Explanation, "Riyadh Central", g.Forecast.Date, "SYNTHETIC", "en"))
	if factMap(f, "expected_cases")["value"] != float64(want.Expected) || factStr(factMap(f, "peak_interval"), "starts_at") != want.Peak {
		t.Fatalf("expected/peak %+v", f)
	}
	r := factMap(f, "likely_range_at_peak")
	if r["low_cases"] != float64(want.RangeLow) || r["high_cases"] != float64(want.RangeHigh) || factStr(factMap(f, "field_share"), "value") != want.Field {
		t.Fatalf("range/field %+v %+v", r, f["field_share"])
	}
	for _, k := range []string{"low", "high", "peak_hour", "expected_by_hour"} {
		if _, ok := f[k]; ok {
			t.Fatalf("%s is not on the screen", k)
		}
	}
}

func TestExplainFactsCarryArabicLabels(t *testing.T) {
	g := loadExplainGolden(t)
	gap := gapFacts(g.gapView(), g.Zones, "", "ar")
	raw, _ := json.Marshal(gap)
	s := string(raw)
	for _, want := range []string{"العجز والفائض", "الأحد", "20 سبتمبر 2026", "جميع المناطق", "الرياض الوسطى", "فترات العجز", "المندوبون", "عدد المندوبين في المناوبة غير كافٍ", "المركبات", "الجغرافيا", "لا يمكن الوصول إليها خلال 10 دقائق"} {
		if !strings.Contains(s, want) {
			t.Fatalf("Arabic gap facts lack %q: %s", want, s)
		}
	}
	for _, en := range []string{"Gap and Surplus", "Sunday", "Riyadh", "People", "Sept"} {
		if strings.Contains(s, en) {
			t.Fatalf("Arabic gap facts keep %q", en)
		}
	}
	fx := forecastFacts(forecastScreenOf(g.forecastTimeline(), g.forecastSplit(), g.Forecast.ZoneID), &g.Forecast.Explanation, zoneName(g.Zones[0], "ar"), g.Forecast.Date, "SYNTHETIC", "ar")
	raw, _ = json.Marshal(fx)
	s = string(raw)
	for _, want := range []string{"مستكشف التوقعات", "الرياض الوسطى", "الأحد", "الاتجاه العام", "البلاغات المتوقعة", "يوم معتاد"} {
		if !strings.Contains(s, want) {
			t.Fatalf("Arabic forecast facts lack %q: %s", want, s)
		}
	}
	for _, en := range []string{"Forecast Explorer", "Sunday", "Trend", "Riyadh"} {
		if strings.Contains(s, en) {
			t.Fatalf("Arabic forecast facts keep %q", en)
		}
	}
	en := gapFacts(g.gapView(), g.Zones, "", "en")
	if c := factMap(en, "main_cause"); c["meaning"] != "not enough agents on shift" {
		t.Fatalf("people meaning %+v", c)
	}
	if !strings.Contains(factStr(factMap(en, "out_of_10_minute_reach_share"), "meaning"), "CANNOT be reached within 10 minutes") {
		t.Fatal("out of reach meaning")
	}
}

func TestExplainPromptStatesTheDomainAndRules(t *testing.T) {
	for _, want := range []string{"motor accident cases", "agents", "Never write patients", "Quote only numbers that appear in the facts", "add no numbers", "exactly as given", "CANNOT be reached within 10 minutes", "not enough agents on shift", "never Markdown", "Answer in %s"} {
		if !strings.Contains(explainSystem, want) {
			t.Fatalf("prompt lacks %q", want)
		}
	}
	if !strings.Contains(explainLanguage("ar"), "Arabic") || !strings.Contains(explainLanguage("ar"), "المندوبون") {
		t.Fatal("Arabic terms")
	}
}

func TestNumbersInReadsBothDigitSets(t *testing.T) {
	cases := map[string][]float64{
		"48 gap intervals, 7% out of reach": {48, 7},
		"٤٨ فترة عجز و٧٪":                   {48, 7},
		"multiplier 0.94 at 17:15":          {0.94, 17, 15},
		"٠٫٩٤ و1,250 بلاغ":                  {0.94, 1250},
		"zones 3, 4 and 5":                  {3, 4, 5},
	}
	for text, want := range cases {
		got := numbersIn(text)
		if len(got) != len(want) {
			t.Fatalf("%q: %+v", text, got)
		}
		for i := range want {
			if got[i].Value != want[i] {
				t.Fatalf("%q: %+v", text, got)
			}
		}
	}
	allowed := allowedNumbers(map[string]any{"share": 0.07, "pct": "65%", "n": 48, "t": "13:15"})
	if bad := unknownNumbers("48 intervals; 7% and ٦٥٪ out of reach; 0.65; at 13:15", allowed); len(bad) != 0 {
		t.Fatalf("equivalents refused: %v", bad)
	}
	if bad := unknownNumbers("only 93% reachable, 21 gaps", allowed); len(bad) != 2 {
		t.Fatalf("invented numbers passed: %v", bad)
	}
}

func explainAR(t *testing.T, f *fakeProvider) AssistantExplanation {
	t.Helper()
	setupAssistant(t, f)
	stubExplainFacts(t)
	out, err := ExplainWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"target": "gap_surplus", "date": "2026-09-20", "locale": "ar"})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestExplainNumberGuardPasses(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply("في الرياض الوسطى 4 فترات عجز، و48% من الطلب الميداني خارج نطاق 10 دقائق.")}}
	out := explainAR(t, f)
	if len(f.seen) != 1 || !strings.HasPrefix(out.Text, "في الرياض") || !strings.Contains(f.seen[0].System, "Arabic") {
		t.Fatalf("out %+v calls %d", out, len(f.seen))
	}
	if ev := eventsWith("assistant.explain"); len(ev) != 1 || ev[0].Detail["answer_path"] != explainPathChecked {
		t.Fatalf("audit %+v", ev)
	}
}

func TestExplainNumberGuardRetriesOnce(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply("يمكن الوصول إلى 52% فقط، و21 فترة عجز."), textReply("فترات العجز: 4، وخارج نطاق 10 دقائق: 48%.")}}
	out := explainAR(t, f)
	if len(f.seen) != 2 || out.Text != "فترات العجز: 4، وخارج نطاق 10 دقائق: 48%." {
		t.Fatalf("out %q calls %d", out.Text, len(f.seen))
	}
	retry := f.seen[1].Messages
	if len(retry) != 3 || retry[1].Role != "assistant" || !strings.Contains(retry[2].Text, "52, 21") {
		t.Fatalf("retry turn %+v", retry)
	}
	if ev := eventsWith("assistant.explain"); len(ev) != 1 || ev[0].Detail["answer_path"] != explainPathRetried {
		t.Fatalf("audit %+v", ev)
	}
}

func TestExplainNumberGuardFallsBack(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply("21 فترة عجز."), textReply("ما زالت 21 فترة.")}}
	out := explainAR(t, f)
	if len(f.seen) != 2 || strings.Contains(out.Text, "21") || !strings.HasPrefix(out.Text, tr(fallbackText["lead"], "ar")) {
		t.Fatalf("fallback %q", out.Text)
	}
	for _, want := range []string{"فترات العجز: 4", "الطلب المُلبّى: 58%", "48%", "الرياض الوسطى", "00:00", "عدد المندوبين في المناوبة غير كافٍ"} {
		if !strings.Contains(out.Text, want) {
			t.Fatalf("fallback lacks %q: %s", want, out.Text)
		}
	}
	if ev := eventsWith("assistant.explain"); len(ev) != 1 || ev[0].Detail["answer_path"] != explainPathFallback {
		t.Fatalf("audit %+v", ev)
	}
}

func TestExplainFallbackHoldsOnlyFactNumbers(t *testing.T) {
	g := loadExplainGolden(t)
	for _, locale := range []string{"en", "ar"} {
		gap := gapFacts(g.gapView(), g.Zones, "", locale)
		if bad := unknownNumbers(fallbackSummary(ExplainGapSurplus, roundTrip(t, gap), locale), allowedNumbers(roundTrip(t, gap))); len(bad) != 0 {
			t.Fatalf("%s gap fallback: %v", locale, bad)
		}
		fx := forecastFacts(forecastScreenOf(g.forecastTimeline(), g.forecastSplit(), g.Forecast.ZoneID), &g.Forecast.Explanation, zoneName(g.Zones[0], locale), g.Forecast.Date, "SYNTHETIC", locale)
		text := fallbackSummary(ExplainForecastExplorer, roundTrip(t, fx), locale)
		if bad := unknownNumbers(text, allowedNumbers(roundTrip(t, fx))); len(bad) != 0 || !strings.Contains(text, "62%") {
			t.Fatalf("%s forecast fallback %q: %v", locale, text, bad)
		}
	}
}

func TestExplainLabelsMatchTheScreen(t *testing.T) {
	for i, locale := range []string{"en", "ar"} {
		for screen, labels := range map[string]map[string][2]string{"gap_surplus": gapLabels, "forecast_explorer": forecastLabels} {
			raw, err := os.ReadFile(filepath.Join("..", "..", "..", "web", "messages", "ops", screen, locale+".json"))
			if err != nil {
				t.Fatal(err)
			}
			var msgs map[string]any
			if err := json.Unmarshal(raw, &msgs); err != nil {
				t.Fatal(err)
			}
			for key, pair := range labels {
				parts := strings.Split(key, ".")
				got, _ := msgs[parts[0]].(map[string]any)[parts[1]].(string)
				if got != pair[i] {
					t.Fatalf("%s %s %s: %q here, %q on screen", screen, locale, key, pair[i], got)
				}
			}
		}
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "web", "messages", locale+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var nav struct {
			Nav struct {
				Ops map[string]struct {
					Title string `json:"title"`
				} `json:"ops"`
			} `json:"nav"`
		}
		if err := json.Unmarshal(raw, &nav); err != nil {
			t.Fatal(err)
		}
		for target, pair := range screenTitles {
			if nav.Nav.Ops[target].Title != pair[i] {
				t.Fatalf("%s %s title %q, screen %q", locale, target, pair[i], nav.Nav.Ops[target].Title)
			}
		}
	}
}

func TestDemoSampleRuleHasAnArabicName(t *testing.T) {
	ar, _ := demoSampleRule()["name_ar"].(string)
	if ar == "" || !strings.ContainsRune(ar, 'ع') {
		t.Fatalf("RULE-090 name_ar %q", ar)
	}
}
