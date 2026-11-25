// SPDX-License-Identifier: AGPL-3.0-only

// Live: the case count the comparison uses.
package business

import (
	"context"
	"testing"
)

func TestImportCaseCount_MatchesEveryCaseRead(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	seedSQLCases(t, ctx, conn, rc)
	all, err := allCasesLive(ctx, conn, rc.CustomerID)
	check(t, err)
	n, err := caseCountLive(ctx, conn, rc.CustomerID)
	check(t, err)
	if n != len(all) {
		t.Fatalf("count %d, want %d", n, len(all))
	}
}
