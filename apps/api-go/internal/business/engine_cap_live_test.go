// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
)

func TestTheDayCaseCapSaysHowManyCasesItLeftOut(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	day := shiftDateBy(w.today, -1)
	var extra []Case
	for i := 0; i < 3; i++ {
		at := fmt.Sprintf("%sT1%d:07:00+03:00", day, i)
		extra = append(extra, Case{ID: datactx.NewID(), TenantID: w.tenantID, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC", CaseNumber: "X-" + datactx.NewID()[:8], ExternalID: datactx.NewID(),
			RegisteredAt: at, ZoneID: w.zoneID, SubZoneID: w.subID, Latitude: 24.7, Longitude: 46.7, Handling: "field", Extra: map[string]any{}})
	}
	check(t, upsertCasesLive(ctx, w.conn, w.tenantID, extra))
	old := engineDayCaseCap
	engineDayCaseCap = 2
	t.Cleanup(func() { engineDayCaseCap = old })

	cases, dropped, err := loadDayCases(ctx, w.conn, w.tenantID, w.zoneID, day)
	check(t, err)
	if len(cases) != 2 || dropped != 2 {
		t.Fatalf("got %d cases and %d dropped, want 2 and 2 of the 4 on the day", len(cases), dropped)
	}

	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()}, enginetest.Behavior{Kind: enginetest.Answer, Body: w.optimizerAnswer()})
	_, err = RunWorkerCycle(ctx, w.conn, w.actors)
	check(t, err)
	plan, err := loadPlan(ctx, w.conn, w.actors.Roster)
	check(t, err)
	roster := rosterFor(plan, w.zoneID, w.tomorrow)
	if roster == nil {
		t.Fatal("setup: no roster for tomorrow")
	}
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.simulatorAnswer("4.2.0")})
	out, err := runEngineSimulation(ctx, w.conn, w.actors.Roster, plan, roster, day, "nearest")
	check(t, err)
	if !strings.Contains(out.SummaryEn, "Warning: 2 cases were left out") || out.Detail["cases_dropped"] != 2 {
		t.Fatalf("got %q and %v, want the warning with the dropped count", out.SummaryEn, out.Detail["cases_dropped"])
	}
}

func TestCapWarningIsEmptyWhenNothingWasDropped(t *testing.T) {
	if capWarning(0) != "" || !strings.Contains(capWarning(7), "7 cases") {
		t.Fatal("capWarning must be empty for zero and name the count otherwise")
	}
}
