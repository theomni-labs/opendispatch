// SPDX-License-Identifier: AGPL-3.0-only

package weather

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var testCities = []City{
	{ID: "c1", Code: "RD", NameEn: "Riyadh", Lat: 24.71, Lon: 46.68, HasPoint: true},
	{ID: "c2", Code: "JD", NameEn: "Jeddah", Lat: 21.54, Lon: 39.17, HasPoint: true},
	{ID: "c3", Code: "XX", NameEn: "Nowhere"},
}

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestParseConfigDefaultsToNone(t *testing.T) {
	c, err := ParseConfig(env(nil))
	if err != nil || c.Kind != "none" {
		t.Fatalf("got %+v %v", c, err)
	}
	if _, ok := c.Build().(NoneSource); !ok {
		t.Fatal("default source is not none")
	}
	d, err := NoneSource{}.Days(context.Background(), testCities, "2026-01-01", "2026-01-02")
	if d != nil || err != nil {
		t.Fatal("none returned weather")
	}
}

func TestParseConfigRefusals(t *testing.T) {
	bad := []map[string]string{
		{EnvSource: "rss"},
		{EnvSource: "file"},
		{EnvSource: "openmeteo", EnvTimeoutMs: "5"},
		{EnvSource: "openmeteo", EnvURL: "ftp://x"},
		{EnvSource: "openmeteo", EnvURL: "http://wx.example", EnvAPIKey: "k-123"},
		{EnvSource: "openmeteo", EnvURL: "https://wx.example?apikey=1"},
	}
	for _, m := range bad {
		if _, err := ParseConfig(env(m)); err == nil {
			t.Errorf("accepted %v", m)
		}
	}
	c, err := ParseConfig(env(map[string]string{EnvSource: "openmeteo", EnvURL: "http://open-meteo.wx.svc:8080"}))
	if err != nil || c.ArchiveURL != OpenMeteoArchiveURL {
		t.Fatalf("self-hosted http without key: %+v %v", c, err)
	}
}

func TestConfigStringHidesKey(t *testing.T) {
	c, err := ParseConfig(env(map[string]string{EnvSource: "openmeteo", EnvAPIKey: "sekr3t-value", EnvFile: "/x.csv"}))
	if err != nil {
		t.Fatal(err)
	}
	if s := c.String(); strings.Contains(s, "sekr3t") || !strings.Contains(s, "key=set") {
		t.Fatalf("String: %s", s)
	}
	if _, ok := c.Build().(Fallback); !ok {
		t.Fatal("a feed with a file should fall back to it")
	}
}

func writeFile(t *testing.T, dir, body string) string {
	t.Helper()
	p := filepath.Join(dir, "weather.csv")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

const goodCSV = "city,date,rain_mm,dust_event,max_temp_c,visibility_km\n" +
	"Riyadh,2026-01-01,4.2,false,19.5,6\n" +
	"JD,2026-01-01,,true,,1.2\n" +
	"riyadh,2026-01-02,0,no,21,\n" +
	"Riyadh,2026-01-02,1,no,21,\n" +
	"Riyadh,2026-01-03,-1,no,21,\n" +
	"Riyadh,01/04/2026,0,no,21,\n" +
	"Riyadh,2026-01-05,0,maybe,21,\n" +
	"Taif,2026-01-01,0,false,20,10\n"

func TestFileSourceParsesAndValidates(t *testing.T) {
	f := NewFileSource(writeFile(t, t.TempDir(), "\xef\xbb\xbf"+goodCSV))
	days, err := f.Days(context.Background(), testCities, "2026-01-01", "2026-01-31")
	if err == nil || !strings.Contains(err.Error(), "1 city name") {
		t.Fatalf("want an unmatched-city warning, got %v", err)
	}
	if len(days) != 3 {
		t.Fatalf("days %d: %+v", len(days), days)
	}
	if days[0].CityID != "c1" || *days[0].RainMM != 4.2 || days[0].Source != "file" {
		t.Fatalf("first %+v", days[0])
	}
	jd := days[2]
	if jd.CityID != "c2" || jd.RainMM != nil || !*jd.DustEvent || *jd.VisibilityKM != 1.2 {
		t.Fatalf("code match %+v", jd)
	}
	if n := len(f.Issues()); n != 4 {
		t.Fatalf("issues %v", f.Issues())
	}
}

func TestFileSourceRefusesBadHeader(t *testing.T) {
	f := NewFileSource(writeFile(t, t.TempDir(), "city,date,rain\nRiyadh,2026-01-01,1\n"))
	if _, err := f.Days(context.Background(), testCities, "2026-01-01", "2026-01-02"); err == nil {
		t.Fatal("bad header accepted")
	}
	f = NewFileSource(filepath.Join(t.TempDir(), "missing.csv"))
	if _, err := f.Days(context.Background(), testCities, "2026-01-01", "2026-01-02"); err == nil {
		t.Fatal("missing file accepted")
	}
}

func TestFileSourceReloadsOnChange(t *testing.T) {
	dir := t.TempDir()
	p := writeFile(t, dir, "city,date,rain_mm,dust_event,max_temp_c,visibility_km\nRiyadh,2026-01-01,1,,,\n")
	f := NewFileSource(p)
	d, _ := f.Days(context.Background(), testCities, "2026-01-01", "2026-01-01")
	if len(d) != 1 || *d[0].RainMM != 1 {
		t.Fatalf("%+v", d)
	}
	writeFile(t, dir, "city,date,rain_mm,dust_event,max_temp_c,visibility_km\nRiyadh,2026-01-01,7.5,,,\n")
	later := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(p, later, later); err != nil {
		t.Fatal(err)
	}
	d, _ = f.Days(context.Background(), testCities, "2026-01-01", "2026-01-01")
	if len(d) != 1 || *d[0].RainMM != 7.5 {
		t.Fatalf("not reloaded: %+v", d)
	}
}

func TestRangeChecked(t *testing.T) {
	f := NewFileSource("unused")
	for _, r := range [][2]string{{"2026-02-01", "2026-01-01"}, {"x", "2026-01-01"}, {"2020-01-01", "2026-01-01"}} {
		if _, err := f.Days(context.Background(), testCities, r[0], r[1]); !errors.Is(err, ErrRange) {
			t.Errorf("%v: %v", r, err)
		}
	}
}

type fixed struct {
	days []Day
	err  error
}

func (f fixed) Name() string { return "fixed" }
func (f fixed) Days(context.Context, []City, string, string) ([]Day, error) {
	return f.days, f.err
}

func TestFallbackFillsGaps(t *testing.T) {
	p := fixed{days: []Day{{CityID: "c1", Date: "2026-01-01", RainMM: ptr(2.0), Source: "feed"}}, err: errors.New("c2 failed")}
	s := fixed{days: []Day{{CityID: "c1", Date: "2026-01-01", RainMM: ptr(9.0)}, {CityID: "c2", Date: "2026-01-01", RainMM: ptr(3.0)}}}
	got, err := Fallback{Primary: p, Secondary: s}.Days(context.Background(), testCities, "2026-01-01", "2026-01-01")
	if err == nil || len(got) != 2 || *got[0].RainMM != 2 || *got[1].RainMM != 3 {
		t.Fatalf("%+v %v", got, err)
	}
}

func TestSyntheticDeterministicAndSeasonal(t *testing.T) {
	a, b := Synthetic(7, "Riyadh", "2026-01-15"), Synthetic(7, "riyadh", "2026-01-15")
	if *a.RainMM != *b.RainMM || *a.MaxTempC != *b.MaxTempC || *a.VisibilityKM != *b.VisibilityKM {
		t.Fatal("not deterministic")
	}
	count := func(city string, months []time.Month, pick func(Flags) bool) float64 {
		n, k := 0, 0
		for y := 2024; y <= 2026; y++ {
			for _, m := range months {
				for d := 1; d <= 28; d++ {
					day := Synthetic(1, city, time.Date(y, m, d, 0, 0, 0, 0, time.UTC).Format(dateLayout))
					n++
					if pick(FlagsOf(day)) {
						k++
					}
				}
			}
		}
		return float64(k) / float64(n)
	}
	winter, summer := []time.Month{12, 1, 2}, []time.Month{6, 7, 8}
	spring := []time.Month{3, 4, 5}
	if w, s := count("Riyadh", winter, func(f Flags) bool { return f.Rain }), count("Riyadh", summer, func(f Flags) bool { return f.Rain }); w < 0.05 || s > 0.01 {
		t.Errorf("rain winter %.3f summer %.3f", w, s)
	}
	if sp, w := count("Riyadh", spring, func(f Flags) bool { return f.Dust }), count("Riyadh", winter, func(f Flags) bool { return f.Dust }); sp < 2*w {
		t.Errorf("dust spring %.3f winter %.3f", sp, w)
	}
	if h, w := count("Dammam", summer, func(f Flags) bool { return f.Heat }), count("Dammam", winter, func(f Flags) bool { return f.Heat }); h < 0.2 || w > 0 {
		t.Errorf("heat summer %.3f winter %.3f", h, w)
	}
	lowDust := count("Riyadh", spring, func(f Flags) bool { return f.Dust && f.LowVis })
	if dust := count("Riyadh", spring, func(f Flags) bool { return f.Dust }); lowDust < 0.4*dust {
		t.Errorf("dust should lower visibility: %.3f of %.3f", lowDust, dust)
	}
}

func TestEffectsMultiplier(t *testing.T) {
	e := DefaultEffects()
	d := Day{RainMM: ptr(5.0), DustEvent: ptr(true), VisibilityKM: ptr(1.0), MaxTempC: ptr(30.0)}
	if m := e.Multiplier(d); m < 1.30*1.15*1.10-1e-9 || m > 1.30*1.15*1.10+1e-9 {
		t.Fatalf("multiplier %v", m)
	}
	if e.Multiplier(Day{}) != 1 {
		t.Fatal("unknown weather must be 1")
	}
}
