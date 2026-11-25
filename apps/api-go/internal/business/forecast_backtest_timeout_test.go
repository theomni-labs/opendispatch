// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"testing"
	"time"
)

func TestBacktestTimeoutFrom(t *testing.T) {
	for in, want := range map[string]time.Duration{"": 20 * time.Minute, "90": 90 * time.Minute, "4": 20 * time.Minute, "601": 20 * time.Minute, "x": 20 * time.Minute, " 5 ": 5 * time.Minute} {
		if got := backtestTimeoutFrom(in); got != want {
			t.Errorf("%q: got %v, want %v", in, got, want)
		}
	}
}
