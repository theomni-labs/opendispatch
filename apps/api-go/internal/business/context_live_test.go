// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"os"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	ctxTenant     = "8f3c2a10-5b7e-4d64-9a21-3c6e0d7b1a55"
	riyadhCentral = "091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a"
	riyadhNorth   = "eecf5c7f-237c-443c-b331-b75ba3fb26fc"
	reemPlanner   = "c52b2a62-8878-4cc0-b774-1247fc153dcc"
)

func liveConn(t *testing.T) *tenancy.Connection {
	t.Helper()
	url := os.Getenv("OPENDISPATCH_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("OPENDISPATCH_TEST_DATABASE_URL not set")
	}
	ResetUsersForTest()
	if err := SeedUsersFromFixtures(); err != nil {
		t.Fatal(err)
	}
	conn, err := tenancy.OpenConnection(context.Background(), url)
	if err != nil {
		t.Fatalf("open connection: %v", err)
	}
	t.Cleanup(conn.Close)
	return conn
}

func TestPickDemoUser_MatchesZonesElseFirstNeverEmergency(t *testing.T) {
	ResetUsersForTest()
	got, err := PickDemoUser(ctxTenant, "planner", []string{riyadhCentral, riyadhNorth, "32bec504-0000-0000-0000-000000000000"})
	if err != nil || got == nil || got.ID != reemPlanner {
		t.Fatalf("got %+v %v, want the first planner", got, err)
	}
	admin, err := PickDemoUser(ctxTenant, "administrator", nil)
	if err != nil || admin == nil || admin.IsEmergencyAdmin {
		t.Fatalf("got %+v %v, want a non-emergency administrator", admin, err)
	}
}

func TestContextForDemoSession_ChosenZonesAndModeAndRule22(t *testing.T) {
	conn := liveConn(t)
	ctx := context.Background()
	rc, err := ContextForDemoSession(ctx, conn, ctxTenant, reemPlanner, access.InstallShared, []string{riyadhNorth, "not-a-zone"})
	if err != nil || rc == nil {
		t.Fatalf("got %+v %v", rc, err)
	}
	if rc.Role != "planner" || rc.InstallMode != "shared" || len(rc.ZoneScope.ZoneIDs) != 1 || rc.ZoneScope.ZoneIDs[0] != riyadhNorth {
		t.Fatalf("got %+v", rc)
	}
	own, err := ContextForDemoSession(ctx, conn, ctxTenant, reemPlanner, access.InstallPrivate, nil)
	if err != nil || own == nil || len(own.ZoneScope.ZoneIDs) != 3 {
		t.Fatalf("own zones: got %+v %v", own, err)
	}
	approver, _ := PickDemoUser(ctxTenant, "change_approver", nil)
	if approver == nil {
		t.Fatal("no change approver in the fixtures")
	}
	none, err := ContextForDemoSession(ctx, conn, ctxTenant, approver.ID, access.InstallShared, nil)
	if err != nil || none != nil {
		t.Fatalf("a role the install mode lacks gets no context: %+v %v", none, err)
	}
}
