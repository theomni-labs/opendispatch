// SPDX-License-Identifier: AGPL-3.0-only

package main

import "testing"

func TestTheDemoOutageControlIsReadInDemoModeOnly(t *testing.T) {
	env := func(string) string { return "/tmp/demo/feedsim.outage" }
	if got := demoOutageControlPath("demo", env); got != "/tmp/demo/feedsim.outage" {
		t.Fatalf("demo: %q", got)
	}
	if got := demoOutageControlPath("oidc", env); got != "" {
		t.Fatalf("oidc: %q, want ignored", got)
	}
	if got := demoOutageControlPath("demo", func(string) string { return "" }); got != "" {
		t.Fatalf("unset: %q", got)
	}
}
