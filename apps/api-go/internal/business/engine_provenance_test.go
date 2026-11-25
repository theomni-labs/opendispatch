// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"math"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
)

func TestInputProvenanceIsIllustrativeUnlessEverySourceIsReal(t *testing.T) {
	cases := []struct {
		in           []string
		illustrative bool
		source       string
	}{
		{nil, true, "SYNTHETIC"},
		{[]string{"SYNTHETIC"}, true, "SYNTHETIC"},
		{[]string{"LIVE", "SYNTHETIC"}, true, "SYNTHETIC"},
		{[]string{"LIVE", "bogus"}, true, "SYNTHETIC"},
		{[]string{"LIVE", "IMPORTED"}, false, "IMPORTED"},
		{[]string{"LIVE"}, false, "LIVE"},
	}
	for _, c := range cases {
		if ill, src := inputProvenance(c.in); ill != c.illustrative || src != c.source {
			t.Errorf("%v: got %v %q, want %v %q", c.in, ill, src, c.illustrative, c.source)
		}
	}
}

func TestStampProvenanceIgnoresTheEnginesClaim(t *testing.T) {
	out := string(stampProvenance(engines.Simulator, []byte(`{"illustrative":false,"data_source":"LIVE","x":1}`), []string{"SYNTHETIC"}))
	if !strings.Contains(out, `"illustrative":true`) || !strings.Contains(out, `"data_source":"SYNTHETIC"`) || !strings.Contains(out, `"x":1`) {
		t.Fatalf("got %s, want the flags set from the inputs", out)
	}
}

func goodForecast() ForecasterEngineOutput {
	var doc ForecasterEngineOutput
	doc.IntervalMinutes = 15
	doc.Values = []EngineValue{{ZoneID: "z", IntervalStart: "2026-09-14T00:30:00+03:00", IntervalIndex: 2, Low: 0, Expected: 1.5, High: 3, FieldExpected: 1, RemoteInferredExpected: 0.5}}
	return doc
}

func TestForecastValuesOK(t *testing.T) {
	if !forecastValuesOK(goodForecast(), "2026-09-13", 2) {
		t.Fatal("a good answer was refused")
	}
	bad := map[string]func(v *EngineValue){
		"negative":      func(v *EngineValue) { v.Low = -1 },
		"nan":           func(v *EngineValue) { v.Expected = math.NaN() },
		"inf":           func(v *EngineValue) { v.High = math.Inf(1) },
		"low above":     func(v *EngineValue) { v.Low = 2 },
		"high below":    func(v *EngineValue) { v.High = 1 },
		"split":         func(v *EngineValue) { v.RemoteInferredExpected = 0.9 },
		"before":        func(v *EngineValue) { v.IntervalStart = "2026-09-12T23:45:00+03:00"; v.IntervalIndex = 95 },
		"after horizon": func(v *EngineValue) { v.IntervalStart = "2026-09-15T00:00:00+03:00"; v.IntervalIndex = 0 },
		"wrong index":   func(v *EngineValue) { v.IntervalIndex = 3 },
	}
	for name, edit := range bad {
		doc := goodForecast()
		edit(&doc.Values[0])
		if forecastValuesOK(doc, "2026-09-13", 2) {
			t.Errorf("%s answer was accepted", name)
		}
	}
	twice := goodForecast()
	same := twice.Values[0]
	same.IntervalStart = "2026-09-13T21:30:00Z"
	twice.Values = append(twice.Values, same)
	if forecastValuesOK(twice, "2026-09-13", 2) {
		t.Error("the same slot twice was accepted")
	}
	other := goodForecast()
	next := other.Values[0]
	next.SubZoneID = "s2"
	other.Values = append(other.Values, next)
	if !forecastValuesOK(other, "2026-09-13", 2) {
		t.Error("the same slot in two sub-zones was refused")
	}
}
