// SPDX-License-Identifier: AGPL-3.0-only

package main

import "testing"

func TestTheApiRefusesToStartWithoutAnExplicitAuthMode(t *testing.T) {
	for value, ok := range map[string]bool{"": false, "Demo": false, "none": false, "demo": true, "oidc": true} {
		mode, err := authModeFromEnv(func(string) string { return value })
		if ok && (err != nil || mode != value) {
			t.Fatalf("%q: got %q, %v; want accepted", value, mode, err)
		}
		if !ok && err == nil {
			t.Fatalf("%q: accepted as %q; the api must refuse to start", value, mode)
		}
	}
}
