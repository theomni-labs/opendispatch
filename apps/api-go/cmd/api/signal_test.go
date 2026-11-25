// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"bytes"
	"context"
	"log"
	"os"
	"strings"
	"syscall"
	"testing"
)

func TestASignalLeavesALogLineBeforeTheApiStops(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	sigs := make(chan os.Signal, 1)
	sigs <- syscall.SIGTERM
	var shut bool
	code := -1
	logSignalAndStop(sigs, func(context.Context) error { shut = true; return nil }, func(c int) { code = c })
	if !shut || code != 0 || !strings.Contains(buf.String(), "api: received terminated, shutting down") {
		t.Fatalf("got shut=%v code=%d log=%q, want a logged, graceful stop", shut, code, buf.String())
	}
}
