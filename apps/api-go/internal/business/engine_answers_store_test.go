// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"strconv"
	"strings"
	"testing"
)

func TestMemoryEngineAnswersMergeBoundAndSeparateCustomers(t *testing.T) {
	m := &memoryEngineAnswers{rows: map[string]memoryEngineAnswer{}}
	var seen string
	merge := func(prev, _ []byte) []byte { seen = string(prev); return []byte("merged") }
	check(t, m.keep(context.Background(), "t1", "optimizer", "d1", []byte("first"), nil))
	check(t, m.keep(context.Background(), "t1", "optimizer", "d1", []byte("second"), merge))
	if got, _ := m.latest(context.Background(), "t1", "optimizer"); seen != "first" || string(got) != "merged" {
		t.Fatalf("got prev %q and %q, want the merge to see the first answer", seen, got)
	}
	for i := 0; i < engineAnswerKeep+3; i++ {
		check(t, m.keep(context.Background(), "t1", "optimizer", "n"+strconv.Itoa(i), []byte("n"+strconv.Itoa(i)), nil))
	}
	if n := len(m.rows); n != engineAnswerKeep {
		t.Fatalf("got %d kept, want %d", n, engineAnswerKeep)
	}
	if got, _ := m.latest(context.Background(), "t1", "optimizer"); string(got) != "n"+strconv.Itoa(engineAnswerKeep+2) {
		t.Fatalf("got %q, want the newest", got)
	}
	if got, err := m.latest(context.Background(), "t2", "optimizer"); err != nil || got != nil {
		t.Fatalf("another customer sees %q (%v)", got, err)
	}
	if got, err := m.latest(context.Background(), "t1", "simulator"); err != nil || got != nil {
		t.Fatalf("another engine sees %q (%v)", got, err)
	}
}

// checkScenarioScopes runs one backend through the scenario rules.
func checkScenarioScopes(t *testing.T, b engineAnswerBackend, tenant string, count func() int) {
	t.Helper()
	check(t, b.keep(context.Background(), tenant, "simulator", "2026-09-01", []byte(`{"v":"real"}`), nil))
	check(t, b.keep(context.Background(), tenant, "simulator", "scenario:s1", []byte(`{"v":"scenario"}`), nil))
	check(t, b.keep(context.Background(), tenant, "simulator", "scenario:s1:before", []byte(`{"v":"before"}`), nil))
	got, err := b.latest(context.Background(), tenant, "simulator")
	if err != nil || !strings.Contains(string(got), "real") {
		t.Fatalf("got %s (%v), want the real day answer, not a scenario one", got, err)
	}
	for i := 0; i < engineAnswerKeep+3; i++ {
		check(t, b.keep(context.Background(), tenant, "simulator", "scenario:x"+strconv.Itoa(i), []byte(`{"v":"s"}`), nil))
	}
	if got, _ := b.latest(context.Background(), tenant, "simulator"); !strings.Contains(string(got), "real") {
		t.Fatalf("got %s, want scenario runs not to evict the real day", got)
	}
	for i := 0; i < engineAnswerKeep; i++ {
		check(t, b.keep(context.Background(), tenant, "simulator", "2026-09-1"+strconv.Itoa(i), []byte(`{"v":"day"}`), nil))
	}
	if n := count(); n != 2*engineAnswerKeep {
		t.Fatalf("got %d kept, want %d real and %d scenario scopes", n, engineAnswerKeep, engineAnswerKeep)
	}
}

func TestMemoryEngineAnswersLatestSkipsScenarioScopesAndEvictsSeparately(t *testing.T) {
	m := &memoryEngineAnswers{rows: map[string]memoryEngineAnswer{}}
	checkScenarioScopes(t, m, "t1", func() int { return len(m.rows) })
}
