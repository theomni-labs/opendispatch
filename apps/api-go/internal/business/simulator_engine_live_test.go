// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"errors"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
)

func TestSimulatorIsAskedWithARosterAndCasesOfTheDay(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()}, enginetest.Behavior{Kind: enginetest.Answer, Body: w.optimizerAnswer()})
	_, err := RunWorkerCycle(ctx, w.conn, w.actors)
	check(t, err)
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID

	if err := RunSimulatorForRoster(ctx, w.conn, rc, w.zoneID, w.tomorrow, "nearest"); !errors.Is(err, ErrEngineInput) {
		t.Fatalf("got %v, want no request for a day without cases", err)
	}
	at := w.tomorrow + "T08:10:00+03:00"
	day := Case{ID: datactx.NewID(), TenantID: w.tenantID, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC", CaseNumber: "C-" + datactx.NewID()[:8], ExternalID: datactx.NewID(),
		RegisteredAt: at, ZoneID: w.zoneID, SubZoneID: w.subID, Latitude: 24.7, Longitude: 46.7, Handling: "field", Extra: map[string]any{}}
	check(t, upsertCasesLive(ctx, w.conn, w.tenantID, []Case{day}))
	answer := `{"schema_version":"1.0","engine":{"name":"simulator","version":"3.0.0"},"zones":[{"zone_id":"` + w.zoneID + `"}]}`
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: answer})
	if err := RunSimulatorForRoster(ctx, w.conn, rc, w.zoneID, w.tomorrow, "nearest"); err != nil {
		t.Fatal(err)
	}
	reqs := w.srv.Requests()
	checkRequest(t, "simulator", []byte(reqs[len(reqs)-1].Body))
	var doc simulatorOutputDoc
	if found, err := readSimulatorDocument(context.Background(), w.tenantID, &doc); err != nil || !found || doc.Engine.Version != "3.0.0" {
		t.Fatalf("got found=%v err=%v doc=%+v, want the kept answer", found, err, doc)
	}
}
