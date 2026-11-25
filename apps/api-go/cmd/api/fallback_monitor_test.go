// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds"
)

func TestFallbackMonitorTenants_OnlyFedTenantsWhenTheBoardReadsTheFeeds(t *testing.T) {
	t.Setenv("FEED_MONITOR_SECRET", strings.Repeat("s", 32))
	keys, err := feeds.NewKeys([]feeds.Key{
		{ID: "a", TenantID: "t1", SecretEnv: "FEED_MONITOR_SECRET", Status: "active", DataSource: "SYNTHETIC"},
		{ID: "b", TenantID: "t1", SecretEnv: "FEED_MONITOR_SECRET", Status: "active", DataSource: "SYNTHETIC"},
	})
	if err != nil {
		t.Fatal(err)
	}
	env := func(source string) func(string) string {
		return func(k string) string {
			if k == "OPENDISPATCH_DISPATCH_SOURCE" {
				return source
			}
			return ""
		}
	}
	if got := fallbackMonitorTenants(keys, env("feeds")); len(got) != 1 || got[0] != "t1" {
		t.Fatalf("got %v, want t1 once", got)
	}
	if got := fallbackMonitorTenants(keys, env("replay")); got != nil {
		t.Fatalf("got %v, want no monitor on the replay", got)
	}
	if got := fallbackMonitorTenants(nil, env("feeds")); got != nil {
		t.Fatalf("got %v, want no monitor without feeds", got)
	}
}
