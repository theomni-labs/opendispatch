// SPDX-License-Identifier: AGPL-3.0-only

package settingsstore

import (
	"context"
	"testing"
)

func TestGet_ReturnsFallbackWhenUnset(t *testing.T) {
	ResetForTest()
	if got, _ := Get(context.Background(), "t", "nope", "fallback"); got != "fallback" {
		t.Fatalf("got %q, want fallback", got)
	}
}

func TestPutThenGet_ReturnsStoredValue(t *testing.T) {
	ResetForTest()
	_ = Put(context.Background(), "t", "k", "v1")
	if got, _ := Get(context.Background(), "t", "k", "fallback"); got != "v1" {
		t.Fatalf("got %q, want v1", got)
	}
	_ = Put(context.Background(), "t", "k", "v2")
	if got, _ := Get(context.Background(), "t", "k", "fallback"); got != "v2" {
		t.Fatalf("got %q, want v2", got)
	}
}

func TestGet_FallsBackOnTypeMismatch(t *testing.T) {
	ResetForTest()
	_ = Put(context.Background(), "t", "k", 42)
	if got, _ := Get(context.Background(), "t", "k", "fallback"); got != "fallback" {
		t.Fatalf("got %q, want fallback on type mismatch", got)
	}
}

func TestReload_SeedsFixturesAndConvertsNumbers(t *testing.T) {
	ReloadForTest()
	if got, _ := Get(context.Background(), "t", "decision_deadline_ms", -1); got != 2000 {
		t.Fatalf("got %d, want the fixture 2000 as an int", got)
	}
	if ok, _ := Has(context.Background(), "t", "clock_start"); !ok {
		t.Fatal("clock_start should be seeded")
	}
}

func TestDeletePrefix_RemovesMatchingKeys(t *testing.T) {
	ResetForTest()
	_ = Put(context.Background(), "t", "a.one", 1)
	_ = Put(context.Background(), "t", "b.two", 2)
	_ = DeletePrefix(context.Background(), "t", "a.")
	a, _ := Has(context.Background(), "t", "a.one")
	b, _ := Has(context.Background(), "t", "b.two")
	if a || !b {
		t.Fatal("only the a. keys should be gone")
	}
}

func TestSwap_StoresOnlyOverTheStampItRead(t *testing.T) {
	ResetForTest()
	_, stamp, _ := GetStamped(context.Background(), "t", "s", 0)
	if stamp != "" {
		t.Fatalf("unset key stamp %q", stamp)
	}
	if ok, err := Swap(context.Background(), "t", "s", "", 1); !ok || err != nil {
		t.Fatalf("first insert: %v %v", ok, err)
	}
	if ok, _ := Swap(context.Background(), "t", "s", "", 9); ok {
		t.Fatal("a second insert over an unset stamp must lose")
	}
	got, stamp, _ := GetStamped(context.Background(), "t", "s", 0)
	if got != 1 || stamp != "1" {
		t.Fatalf("got %d stamp %q", got, stamp)
	}
	_ = Put(context.Background(), "t", "s", 2)
	if ok, _ := Swap(context.Background(), "t", "s", stamp, 3); ok {
		t.Fatal("a stale stamp must lose")
	}
	if got, _ := Get(context.Background(), "t", "s", 0); got != 2 {
		t.Fatalf("the newer write was lost: %d", got)
	}
}
