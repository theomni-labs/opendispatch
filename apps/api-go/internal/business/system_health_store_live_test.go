// SPDX-License-Identifier: AGPL-3.0-only

// Live: job runs and diagnostics bundles kept in Postgres.
package business

import (
	"context"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestPostgresSystemHealthSurvivesARestartAndStaysPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresSystemHealth(conn)
	t.Cleanup(UseMemorySystemHealth)
	a, b := adminOf(freshTenant()), adminOf(freshTenant())
	bundle, err := CreateDiagnosticsBundle(a)
	if err != nil {
		t.Fatal(err)
	}
	jobs, err := ListJobRuns(a, JobRunQuery{})
	if err != nil || len(jobs.Items) != len(seedJobs(a)) {
		t.Fatalf("job runs: %d %v", len(jobs.Items), err)
	}
	UseMemorySystemHealth()
	UsePostgresSystemHealth(conn)
	got, err := DownloadDiagnosticsBundle(a, bundle.ID)
	if err != nil || got.ContentBase64 == "" {
		t.Fatalf("after a restart: %+v %v", got, err)
	}
	if _, err := DownloadDiagnosticsBundle(b, bundle.ID); err == nil {
		t.Fatal("another customer downloaded the bundle")
	}
	again, err := ListJobRuns(a, JobRunQuery{})
	if err != nil || len(again.Items) != len(jobs.Items) {
		t.Fatalf("job runs after a restart: %d %v", len(again.Items), err)
	}
	if err := ReseedSystemHealthForTest(context.Background(), &tenancy.Connection{Pool: ownerPool(t)}); err != nil {
		t.Fatal(err)
	}
}

func TestPostgresSystemHealthNamesTheTimescaleMode(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresSystemHealth(conn)
	t.Cleanup(UseMemorySystemHealth)
	got, err := GetSystemHealth(adminOf(freshTenant()))
	if err != nil {
		t.Fatal(err)
	}
	var hyper bool
	if err := ownerPool(t).QueryRow(context.Background(), `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')`).Scan(&hyper); err != nil {
		t.Fatal(err)
	}
	for _, c := range got.Components {
		if c.Name != "database" || c.Detail == nil {
			continue
		}
		if hyper && !strings.HasPrefix(*c.Detail, "TimescaleDB ") {
			t.Errorf("timescale mode: detail %q", *c.Detail)
		}
		if !hyper && *c.Detail != "Plain Postgres; no TimescaleDB" {
			t.Errorf("plain mode: detail %q", *c.Detail)
		}
		return
	}
	t.Fatal("no database component")
}
