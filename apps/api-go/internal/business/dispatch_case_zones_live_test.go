// SPDX-License-Identifier: AGPL-3.0-only

// Live: zones of named cases match the old read.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

func TestDispatchCaseZones_MatchesEveryCaseRead(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	fx := seedSQLCases(t, ctx, conn, rc)
	var rows []Assignment
	for i, id := range fx.caseIDs {
		if i%3 == 0 {
			rows = append(rows, Assignment{CaseID: id})
		}
	}
	rows = append(rows, Assignment{CaseID: "not-a-uuid"}, Assignment{CaseID: datactx.NewID()})
	for _, c := range allReplayCases() {
		rows = append(rows, Assignment{CaseID: c.ID})
	}
	got, err := dispatchCaseZones(ctx, conn, rc.CustomerID, rows)
	check(t, err)
	live, err := allCasesLive(ctx, conn, rc.CustomerID)
	check(t, err)
	want := map[string]string{}
	for _, c := range live {
		want[c.ID] = c.ZoneID
	}
	for _, c := range allReplayCases() {
		want[c.ID] = c.ZoneID
	}
	for _, a := range rows {
		g, gok := got[a.CaseID]
		w, wok := want[a.CaseID]
		if g != w || gok != wok {
			t.Fatalf("case %s: zone %q (%v), want %q (%v)", a.CaseID, g, gok, w, wok)
		}
	}
}
