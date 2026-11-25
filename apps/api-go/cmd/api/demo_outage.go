// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"log"
	"os"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
)

// demoOutageControlPath: set in demo mode only.
func demoOutageControlPath(mode string, getenv func(string) string) string {
	path := getenv("OPENDISPATCH_DEMO_FEEDSIM_CONTROL")
	if path == "" {
		return ""
	}
	if mode != "demo" {
		log.Printf("OPENDISPATCH_DEMO_FEEDSIM_CONTROL ignored: not demo mode")
		return ""
	}
	return path
}

func demoOutageFromEnv(mode string) {
	if path := demoOutageControlPath(mode, os.Getenv); path != "" {
		business.UseDemoFeedOutageControl(path)
	}
}
