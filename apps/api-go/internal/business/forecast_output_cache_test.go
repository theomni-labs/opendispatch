// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
)

const otherTenantOfTest = "00000000-0000-4000-8000-0000000000bb"

func keepTestForecast(t *testing.T, tenant, model string) {
	t.Helper()
	doc := ForecasterEngineOutput{ModelVersion: model, GeneratedAt: "2026-09-13T06:00:00+03:00", DataSource: "SYNTHETIC",
		Values: []EngineValue{{ZoneID: "z1", IntervalStart: "2026-09-13T00:00:00+03:00", Expected: 1}}}
	doc.Horizon.StartDate = "2026-09-13"
	body, err := json.Marshal(doc)
	check(t, err)
	check(t, keepAnswer(context.Background(), tenant, engines.Forecaster, "2026-09-13", body, nil))
}

func useCachedEngineMode(t *testing.T) {
	t.Helper()
	UseMemoryEngineAnswers()
	useMockEngines(t, 0)
	t.Cleanup(UseMemoryEngineAnswers)
}

func TestForecasterOutputIsDecodedOncePerKeptAnswer(t *testing.T) {
	useCachedEngineMode(t)
	keepTestForecast(t, tenantOfTest, "m1")
	a, err := cachedForecasterOutput(context.Background(), tenantOfTest)
	check(t, err)
	b, err := cachedForecasterOutput(context.Background(), tenantOfTest)
	check(t, err)
	if a != b || a.doc.ModelVersion != "m1" || len(a.index["z1|2026-09-13"]) != 1 {
		t.Fatalf("want one decoded m1 entry, got %p %p %+v", a, b, a.doc.ModelVersion)
	}
	keepTestForecast(t, tenantOfTest, "m2")
	c, err := cachedForecasterOutput(context.Background(), tenantOfTest)
	check(t, err)
	if c == a || c.doc.ModelVersion != "m2" {
		t.Fatalf("a new kept answer must replace the cached one, got %q", c.doc.ModelVersion)
	}
}

func TestForecasterOutputCacheChangesWithTheStoreBehindIt(t *testing.T) {
	useCachedEngineMode(t)
	keepTestForecast(t, tenantOfTest, "m1")
	if _, err := cachedForecasterOutput(context.Background(), tenantOfTest); err != nil {
		t.Fatal(err)
	}
	m, ok := engineAnswerData.(*memoryEngineAnswers)
	if !ok {
		t.Fatal("want the memory store")
	}
	body, _ := json.Marshal(ForecasterEngineOutput{ModelVersion: "direct"})
	check(t, m.keep(context.Background(), tenantOfTest, engines.Forecaster, "2026-09-14", body, nil))
	got, err := cachedForecasterOutput(context.Background(), tenantOfTest)
	check(t, err)
	if got.doc.ModelVersion != "direct" {
		t.Fatalf("a write that skipped keepAnswer still changes the identity, got %q", got.doc.ModelVersion)
	}
}

func TestForecasterOutputCacheNeverCrossesTenants(t *testing.T) {
	useCachedEngineMode(t)
	keepTestForecast(t, tenantOfTest, "mine")
	mine, err := cachedForecasterOutput(context.Background(), tenantOfTest)
	check(t, err)
	theirs, err := cachedForecasterOutput(context.Background(), otherTenantOfTest)
	check(t, err)
	if theirs == mine || theirs.doc == nil || theirs.doc.ModelVersion == "mine" {
		t.Fatalf("another tenant got the cached answer of the first")
	}
	keepTestForecast(t, otherTenantOfTest, "theirs")
	theirs, err = cachedForecasterOutput(context.Background(), otherTenantOfTest)
	check(t, err)
	again, err := cachedForecasterOutput(context.Background(), tenantOfTest)
	check(t, err)
	if theirs.doc.ModelVersion != "theirs" || again != mine {
		t.Fatalf("got %q and a changed first entry", theirs.doc.ModelVersion)
	}
	forecasterCacheMu.Lock()
	defer forecasterCacheMu.Unlock()
	for tenant, list := range forecasterCache {
		for _, e := range list {
			if e == mine && tenant != tenantOfTest {
				t.Fatalf("the entry is listed under %s", tenant)
			}
		}
	}
}

func TestForecasterOutputCacheKeepsTheLastTwoPerTenant(t *testing.T) {
	useCachedEngineMode(t)
	for _, model := range []string{"m1", "m2", "m3"} {
		m := engineAnswerData.(*memoryEngineAnswers)
		body, _ := json.Marshal(ForecasterEngineOutput{ModelVersion: model})
		check(t, m.keep(context.Background(), tenantOfTest, engines.Forecaster, model, body, nil))
		if _, err := cachedForecasterOutput(context.Background(), tenantOfTest); err != nil {
			t.Fatal(err)
		}
	}
	forecasterCacheMu.Lock()
	n := len(forecasterCache[tenantOfTest])
	forecasterCacheMu.Unlock()
	if n != forecasterCacheKeep {
		t.Fatalf("got %d entries, want %d", n, forecasterCacheKeep)
	}
}

func TestForecasterOutputCacheIsSafeForConcurrentReads(t *testing.T) {
	useCachedEngineMode(t)
	keepTestForecast(t, tenantOfTest, "m1")
	var wg sync.WaitGroup
	got := make([]*forecasterOutput, 16)
	for i := range got {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			e, err := cachedForecasterOutput(context.Background(), tenantOfTest)
			if err == nil {
				got[i] = e
			}
		}(i)
	}
	wg.Wait()
	for _, e := range got {
		if e == nil || e != got[0] || e.doc.ModelVersion != "m1" {
			t.Fatal("concurrent reads must share one decoded entry")
		}
	}
}

func TestFixtureModeForecasterOutputIsCachedToo(t *testing.T) {
	UseFixtureEngines()
	a, err := cachedForecasterOutput(context.Background(), tenantOfTest)
	check(t, err)
	b, err := cachedForecasterOutput(context.Background(), tenantOfTest)
	check(t, err)
	want, err := readForecasterOutput(context.Background(), tenantOfTest)
	check(t, err)
	if a != b || a.doc == nil || a.doc.ModelVersion != want.ModelVersion || len(a.doc.Values) != len(want.Values) {
		t.Fatal("fixture mode: want one entry equal to the fixture")
	}
}
