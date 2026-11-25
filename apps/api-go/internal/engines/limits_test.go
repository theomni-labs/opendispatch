// SPDX-License-Identifier: AGPL-3.0-only

package engines_test

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
)

func TestLimitsMatchTheServer(t *testing.T) {
	if engines.ForecasterMaxResponse != 160<<20 || engines.DefaultMaxResponse != 8<<20 || engines.MaxHistoryRecords != 2_000_000 {
		t.Fatal("caps changed: update the documented limits and the engine server defaults")
	}
}
