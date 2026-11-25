// SPDX-License-Identifier: AGPL-3.0-only

package forecastcal

import (
	"encoding/json"
	"reflect"
	"testing"
)

func names(f Features) []string {
	var out []string
	for _, e := range f.Events {
		out = append(out, e.Type+":"+e.Name)
	}
	return out
}

func TestPaydayOnTheConfiguredDayAndShortMonths(t *testing.T) {
	c := Config{PaydayDay: 27}
	for date, want := range map[string]bool{"2026-09-27": true, "2026-09-26": false, "2026-09-28": false} {
		if got := c.For(date).IsPayday; got == nil || *got != want {
			t.Fatalf("%s: payday %v, want %v", date, got, want)
		}
	}
	c = Config{PaydayDay: 30}
	if p := c.For("2026-02-28").IsPayday; p == nil || !*p {
		t.Fatal("a short month pays on its last day")
	}
	if p := c.For("2026-02-27").IsPayday; p == nil || *p {
		t.Fatal("the day before is not payday")
	}
	if p := (Config{}).For("2026-09-27").IsPayday; p != nil {
		t.Fatal("payday off must be omitted, not false")
	}
}

func TestEidHajjAndNationalDaysFromTheCalendar(t *testing.T) {
	c := Config{}
	cases := map[string][]string{
		"2026-03-20": {"eid:Eid al-Fitr"},
		"2026-03-19": nil,
		"2026-03-23": {"eid:Eid al-Fitr"},
		"2026-03-24": nil,
		"2026-05-18": nil,
		"2026-05-25": {"hajj:Hajj"},
		"2026-05-26": {"hajj:Arafah Day", "hajj:Hajj"},
		"2026-05-27": {"eid:Eid al-Adha", "hajj:Hajj"},
		"2026-09-23": {"national_day:National Day"},
		"2026-02-22": {"national_day:Founding Day"},
		"2026-09-14": nil,
	}
	for date, want := range cases {
		f := c.For(date)
		if got := names(f); !reflect.DeepEqual(got, want) {
			t.Fatalf("%s (hijri %+v): events %v, want %v", date, f.Hijri, got, want)
		}
	}
	if !c.For("2026-03-01").IsRamadan || c.For("2026-04-10").IsRamadan {
		t.Fatal("ramadan flag is wrong")
	}
}

func TestEmptySettingsOmitSchoolAndEvents(t *testing.T) {
	f := Config{PaydayDay: 27}.For("2026-09-14")
	if f.SchoolInSession != nil || len(f.Events) != 0 {
		t.Fatalf("unknown must be omitted: %+v", f)
	}
}

func TestSettingsDriveTermsSeasonAndUmrah(t *testing.T) {
	c := Config{
		SchoolTerms:  []Range{{"2026-08-23", "2026-12-10", "T1"}, {"2026-12-27", "2027-03-12", "T2"}},
		SeasonEvents: []Range{{"2026-10-10", "2026-10-12", "Riyadh Season"}},
		UmrahWindows: []Range{{"2026-10-11", "2026-10-20", "Umrah"}},
	}
	in := func(d string) *bool { return c.For(d).SchoolInSession }
	if v := in("2026-09-14"); v == nil || !*v {
		t.Fatal("inside a term")
	}
	if v := in("2026-12-15"); v == nil || *v {
		t.Fatal("between terms is a break")
	}
	if in("2026-08-01") != nil || in("2027-06-01") != nil {
		t.Fatal("outside the listed span is unknown")
	}
	if got := names(c.For("2026-10-11")); !reflect.DeepEqual(got, []string{"season_event:Riyadh Season", "umrah:Umrah"}) {
		t.Fatalf("events %v", got)
	}
	if got := names(c.For("2026-10-15")); !reflect.DeepEqual(got, []string{"umrah:Umrah"}) {
		t.Fatalf("events %v", got)
	}
	bad := Config{SchoolTerms: []Range{{"2026-09-10", "2026-09-01", "x"}}}
	if bad.For("2026-09-05").SchoolInSession != nil {
		t.Fatal("an invalid range must be ignored")
	}
}

func TestValidateSetting(t *testing.T) {
	var ok, bad any
	_ = json.Unmarshal([]byte(`[{"start":"2026-09-01","end":"2026-09-02","name":"a"}]`), &ok)
	_ = json.Unmarshal([]byte(`[{"start":"2026-09-03","end":"2026-09-02"}]`), &bad)
	good := map[string]any{KeyPaydayDay: 27.0, KeySchoolTerms: ok, KeySeasonEvents: []any{}, KeyPlanningMode: "high", KeyGateMinImprove: 0.1, "other": 1}
	for k, v := range good {
		if err := ValidateSetting(k, v); err != nil {
			t.Fatalf("%s: %v", k, err)
		}
	}
	wrong := map[string]any{KeyPaydayDay: 32.0, KeyUmrahWindows: bad, KeySchoolTerms: "x", KeyPlanningMode: "max", KeyGateWorseZones: 2.0}
	for k, v := range wrong {
		if ValidateSetting(k, v) == nil {
			t.Fatalf("%s should be refused", k)
		}
	}
}

func TestGateBaselineSetting(t *testing.T) {
	for _, v := range []any{"naive", "segment"} {
		if err := ValidateSetting(KeyGateBaseline, v); err != nil {
			t.Fatalf("%v: %v", v, err)
		}
	}
	for _, v := range []any{"", "Segment", 1.0, nil} {
		if ValidateSetting(KeyGateBaseline, v) == nil {
			t.Fatalf("%v should be refused", v)
		}
	}
}

func TestHorizonSettingsAreWholeDaysInRange(t *testing.T) {
	for _, v := range []any{7.0, 10.0, 30.0, 14} {
		if err := ValidateSetting(KeyHorizonDays, v); err != nil {
			t.Fatalf("horizon %v: %v", v, err)
		}
	}
	for _, v := range []any{6.0, 31.0, 10.5, "10", nil, 0.0} {
		if ValidateSetting(KeyHorizonDays, v) == nil {
			t.Fatalf("horizon %v should be refused", v)
		}
	}
	for _, v := range []any{1.0, 10.0, 14.0, 30.0} {
		if err := ValidateSetting(KeyHorizonChunkDays, v); err != nil {
			t.Fatalf("chunk %v: %v", v, err)
		}
	}
	for _, v := range []any{0.0, 31.0, 2.5, "7"} {
		if ValidateSetting(KeyHorizonChunkDays, v) == nil {
			t.Fatalf("chunk %v should be refused", v)
		}
	}
	if DefaultHorizonDays != 10 || DefaultHorizonChunkDays != 10 || Descriptions[KeyHorizonDays] == "" || Descriptions[KeyHorizonChunkDays] == "" {
		t.Fatal("defaults must stay at 10 days and be described")
	}
}

func TestSalaryWindowIsTheFixedWeek(t *testing.T) {
	c := Config{SalaryWindowStart: DefaultSalaryWindowStart}
	for date, want := range map[string]bool{
		"2026-10-24": false, "2026-10-25": true, "2026-10-31": true,
		"2026-02-24": false, "2026-02-25": true, "2026-02-28": true,
	} {
		if w := c.For(date).SalaryWindow; w == nil || *w != want {
			t.Fatalf("%s: salary window %v, want %v", date, w, want)
		}
	}
	if w := (Config{}).For("2026-10-27").SalaryWindow; w != nil {
		t.Fatal("no start day must leave the window unknown")
	}
}

func TestDerivedRangesListTheFixedEvents(t *testing.T) {
	got := map[string]DerivedRange{}
	for _, r := range DerivedRanges("2026-05-15", "2026-06-05") {
		got[r.Name] = r
	}
	want := map[string][2]string{
		"Hajj Pre-Season":  {"2026-05-18", "2026-05-24"},
		"Hajj":             {"2026-05-25", "2026-05-30"},
		"Arafah Day":       {"2026-05-26", "2026-05-26"},
		"Eid al-Adha":      {"2026-05-27", "2026-05-30"},
		"Hajj Post-Season": {"2026-05-31", "2026-06-01"},
	}
	for name, w := range want {
		if r, ok := got[name]; !ok || r.Start != w[0] || r.End != w[1] || !r.Hijri {
			t.Fatalf("%s: %+v, want %v", name, got[name], w)
		}
	}
}

func TestListOnlyEventsAreNotSentToTheModel(t *testing.T) {
	for _, date := range []string{"2026-05-18", "2026-06-01"} {
		if ev := (Config{}).For(date).Events; len(ev) != 0 {
			t.Fatalf("%s: %+v", date, ev)
		}
	}
}
