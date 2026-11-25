// SPDX-License-Identifier: AGPL-3.0-only

// Live: model versions in Postgres.
package business

import (
	"context"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func liveModelVersion(tenant, version, status string) ModelVersion {
	at := datactx.NowISO()
	return ModelVersion{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenant, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"}, Version: version, Status: status, IsPlaceholder: true}
}

func TestPostgresModelVersionSwitchSurvivesARestartAndStaysPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresModelVersions(conn)
	t.Cleanup(UseMemoryModelVersions)
	a, b := freshTenant(), freshTenant()
	v1, v2 := liveModelVersion(a, "v1", "active"), liveModelVersion(a, "v2", "candidate")
	if err := modelVersionData.save(context.Background(), a, []ModelVersion{v1, v2}); err != nil {
		t.Fatal(err)
	}
	rc := adminOf(a)
	state, err := SwitchModelVersion(rc, v2.ID, map[string]any{"reason": "better"})
	if err != nil || state.ActiveVersion != "v2" {
		t.Fatalf("switch: %+v %v", state, err)
	}
	UseMemoryModelVersions()
	UsePostgresModelVersions(conn)
	after, err := GetModelState(rc)
	if err != nil || after.ActiveVersion != "v2" {
		t.Fatalf("after a restart: %+v %v", after, err)
	}
	rows, _ := modelVersionData.versions(context.Background(), a)
	status := map[string]string{}
	for _, v := range rows {
		status[v.Version] = v.Status
	}
	if status["v1"] != "retired" || status["v2"] != "active" {
		t.Fatalf("statuses: %v", status)
	}
	if other, _ := GetModelState(adminOf(b)); other.ActiveVersion != "none" {
		t.Fatalf("another customer sees %s", other.ActiveVersion)
	}
}

func TestPostgresModelVersionSwitchIsAllOrNothing(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresModelVersions(conn)
	t.Cleanup(UseMemoryModelVersions)
	a := freshTenant()
	v1 := liveModelVersion(a, "v1", "active")
	if err := modelVersionData.save(context.Background(), a, []ModelVersion{v1}); err != nil {
		t.Fatal(err)
	}
	retired := v1
	retired.Status = "retired"
	bad := liveModelVersion(a, "v2", "active")
	bad.CreatedAt = "not a time"
	if err := modelVersionData.save(context.Background(), a, []ModelVersion{retired, bad}); err == nil {
		t.Fatal("a bad row was accepted")
	}
	got, err := activeModelVersion(context.Background(), a)
	if err != nil || got == nil || got.Version != "v1" {
		t.Fatalf("a failed switch changed the active version: %+v %v", got, err)
	}
}

func TestPostgresModelVersionsReseedFromTheFixtures(t *testing.T) {
	conn := settingsConn(t)
	owner := &tenancy.Connection{Pool: ownerPool(t)}
	UsePostgresModelVersions(conn)
	t.Cleanup(UseMemoryModelVersions)
	if err := ReseedModelVersionsForTest(context.Background(), owner); err != nil {
		t.Fatal(err)
	}
	tenant, _ := fixtures.TenantID()
	want, _ := fixtures.Records[ModelVersion]("ModelVersion")
	rows, err := modelVersionData.versions(context.Background(), tenant)
	if err != nil || len(rows) != len(want) {
		t.Fatalf("%d of %d fixtures (%v)", len(rows), len(want), err)
	}
}

func TestPostgresPlaceholderRefusedInEngineModeStaysPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresModelVersions(conn)
	t.Cleanup(UseMemoryModelVersions)
	useMockEngines(t, time.Second)
	a, b := freshTenant(), freshTenant()
	a1, a2 := liveModelVersion(a, "v1", "active"), liveModelVersion(a, "v2", "candidate")
	b1, b2 := liveModelVersion(b, "v1", "active"), liveModelVersion(b, "v2", "candidate")
	if err := modelVersionData.save(context.Background(), a, []ModelVersion{a1, a2}); err != nil {
		t.Fatal(err)
	}
	if err := modelVersionData.save(context.Background(), b, []ModelVersion{b1, b2}); err != nil {
		t.Fatal(err)
	}
	if _, err := SwitchModelVersion(adminOf(a), a2.ID, map[string]any{"reason": "try"}); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict", err)
	}
	for _, tn := range []string{a, b} {
		if s, _ := GetModelState(adminOf(tn)); s.ActiveVersion != "v1" {
			t.Fatalf("%s sees %s", tn, s.ActiveVersion)
		}
	}
	UseFixtureEngines()
	if _, err := SwitchModelVersion(adminOf(b), b2.ID, map[string]any{"reason": "ok"}); err != nil {
		t.Fatalf("fixture mode: %v", err)
	}
}
