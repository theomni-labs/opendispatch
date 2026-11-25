// SPDX-License-Identifier: AGPL-3.0-only

package weather

import (
	"context"
	"testing"
)

func TestSyntheticSourceMatchesTheHistoryGenerator(t *testing.T) {
	cities := []City{{ID: "r", NameEn: "Riyadh"}, {ID: "j", NameEn: "Jeddah"}}
	days, err := SyntheticSource{Seed: DemoSeed}.Days(context.Background(), cities, "2026-01-01", "2026-01-31")
	if err != nil || len(days) != 62 {
		t.Fatalf("got %d days, %v", len(days), err)
	}
	for _, d := range days {
		name := map[string]string{"r": "Riyadh", "j": "Jeddah"}[d.CityID]
		want := Synthetic(DemoSeed, name, d.Date)
		if d.Source != SyntheticLabel || !d.Known() || *d.RainMM != *want.RainMM || *d.DustEvent != *want.DustEvent {
			t.Fatalf("day %+v differs from the generator", d)
		}
	}
	if _, err := (SyntheticSource{}).Days(context.Background(), cities, "2026-02-01", "2026-01-01"); err == nil {
		t.Fatal("a reversed range must fail")
	}
}

func TestSyntheticConfig(t *testing.T) {
	c, err := ParseConfig(func(k string) string {
		return map[string]string{EnvSource: "synthetic", EnvSeed: "42"}[k]
	})
	if err != nil || c.Kind != "synthetic" || c.Seed != 42 {
		t.Fatalf("%+v %v", c, err)
	}
	if s, ok := c.Build().(SyntheticSource); !ok || s.Seed != 42 || s.Name() != "synthetic" {
		t.Fatalf("built %#v", c.Build())
	}
	if _, err := ParseConfig(func(k string) string {
		return map[string]string{EnvSource: "synthetic", EnvSeed: "x"}[k]
	}); err == nil {
		t.Fatal("a bad seed must fail")
	}
	d, _ := ParseConfig(func(string) string { return "" })
	if d.Seed != DemoSeed {
		t.Fatalf("default seed %d", d.Seed)
	}
}
