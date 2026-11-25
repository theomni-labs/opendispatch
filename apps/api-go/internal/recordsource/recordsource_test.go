// SPDX-License-Identifier: AGPL-3.0-only

package recordsource

import "testing"

func env(v string) func(string) string {
	return func(k string) string {
		if k == Env {
			return v
		}
		return ""
	}
}

func TestDefaultIsSynthetic(t *testing.T) {
	defer SetForTest("")()
	if err := Load(env("")); err != nil {
		t.Fatal(err)
	}
	if got := Get(); got != "SYNTHETIC" {
		t.Fatalf("default = %q, want SYNTHETIC", got)
	}
}

func TestCustomerLiveWhenSet(t *testing.T) {
	defer SetForTest("")()
	if err := Load(env("LIVE")); err != nil {
		t.Fatal(err)
	}
	if got := Get(); got != "LIVE" {
		t.Fatalf("got %q, want LIVE", got)
	}
}

func TestUnknownValueRefused(t *testing.T) {
	defer SetForTest("SYNTHETIC")()
	for _, bad := range []string{"IMPORTED", "customer_live", "live", " SYNTHETIC"} {
		if err := Load(env(bad)); err == nil {
			t.Fatalf("%q accepted, want refused", bad)
		}
	}
	if got := Get(); got != "SYNTHETIC" {
		t.Fatalf("a refused value changed the setting to %q", got)
	}
}

func TestGetPanicsOnUnknownEnv(t *testing.T) {
	restore := SetForTest("")
	defer restore()
	mu.Lock()
	loaded = false
	mu.Unlock()
	t.Setenv(Env, "BOGUS")
	defer func() {
		if recover() == nil {
			t.Fatal("Get did not refuse an unknown value")
		}
	}()
	Get()
}
