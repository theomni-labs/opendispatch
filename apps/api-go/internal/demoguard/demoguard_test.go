// SPDX-License-Identifier: AGPL-3.0-only

package demoguard

import "testing"

func TestLocalHost(t *testing.T) {
	t.Setenv(EnvHosts, "")
	for host, want := range map[string]bool{"127.0.0.1": true, "localhost": true, "postgres": false, "db.example.com": false} {
		if got := LocalHost(host); got != want {
			t.Errorf("%s: got %v, want %v", host, got, want)
		}
	}
	t.Setenv(EnvHosts, " postgres , other")
	if !LocalHost("postgres") || !LocalHost("other") || LocalHost("db.example.com") {
		t.Fatal("listed hosts count as local, others do not")
	}
}
