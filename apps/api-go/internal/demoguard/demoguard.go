// SPDX-License-Identifier: AGPL-3.0-only

// Package demoguard decides which database hosts the demo seeding tools may write to.
package demoguard

import (
	"os"
	"strings"
)

// EnvHosts names extra hosts, comma separated, that count as local for the demo
// tools, for example the database service name inside docker compose.
const EnvHosts = "OPENDISPATCH_DEMO_DB_HOSTS"

// LocalHost reports whether host is 127.0.0.1, localhost, or listed in EnvHosts.
func LocalHost(host string) bool {
	if host == "127.0.0.1" || host == "localhost" {
		return true
	}
	for _, h := range strings.Split(os.Getenv(EnvHosts), ",") {
		if h = strings.TrimSpace(h); h != "" && h == host {
			return true
		}
	}
	return false
}
