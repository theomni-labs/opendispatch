// SPDX-License-Identifier: AGPL-3.0-only

// Live: the cache over the Postgres answer store.
package business

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
)

func TestPostgresForecasterCacheFollowsTheStoreAndItsTenant(t *testing.T) {
	conn := openConn(t)
	UsePostgresEngineAnswers(conn)
	t.Cleanup(UseMemoryEngineAnswers)
	useMockEngines(t, 0)
	_, tenantA := adminCtx(t)
	_, tenantB := adminCtx(t)
	keepTestForecast(t, tenantA, "a1")
	a, err := cachedForecasterOutput(context.Background(), tenantA)
	check(t, err)
	if again, _ := cachedForecasterOutput(context.Background(), tenantA); again != a || a.doc.ModelVersion != "a1" {
		t.Fatalf("want one a1 entry, got %q", a.doc.ModelVersion)
	}
	b, err := cachedForecasterOutput(context.Background(), tenantB)
	check(t, err)
	if b == a || b.doc == nil || b.doc.ModelVersion == "a1" {
		t.Fatal("tenant B got tenant A's cached answer")
	}
	body, _ := json.Marshal(ForecasterEngineOutput{ModelVersion: "a2"})
	check(t, engineAnswerData.keep(context.Background(), tenantA, engines.Forecaster, "2026-09-14", body, nil))
	a2, err := cachedForecasterOutput(context.Background(), tenantA)
	check(t, err)
	if a2.doc.ModelVersion != "a2" {
		t.Fatalf("a write from elsewhere must change the entry, got %q", a2.doc.ModelVersion)
	}
	if b2, _ := cachedForecasterOutput(context.Background(), tenantB); b2 != b {
		t.Fatal("tenant A's write changed tenant B's entry")
	}
}
