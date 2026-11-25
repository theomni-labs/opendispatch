// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
)

func TestTheWorkerReadsTheEngineModeFromTheEnvironment(t *testing.T) {
	t.Cleanup(business.UseFixtureEngines)
	enginesFromEnv()
	for _, st := range business.EngineStatuses("") {
		if st.Mode != engines.ModeFixture {
			t.Fatalf("got %+v, want fixture mode by default", st)
		}
	}
	t.Setenv("OPENDISPATCH_ENGINE_MODE", "engine")
	for _, n := range engines.All {
		t.Setenv("OPENDISPATCH_ENGINE_"+strings.ToUpper(string(n))+"_URL", "http://127.0.0.1:1")
	}
	enginesFromEnv()
	for _, st := range business.EngineStatuses("") {
		if st.Mode != engines.ModeEngine {
			t.Fatalf("got %+v, want engine mode", st)
		}
	}
}
