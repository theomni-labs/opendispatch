// SPDX-License-Identifier: AGPL-3.0-only

// Live: integrations in Postgres.
package business

import (
	"context"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func liveIntegration(tenant, kind string) Integration {
	at := datactx.NowISO()
	return Integration{
		BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenant, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
		Kind:       kind, NameEn: "Feed " + kind, Direction: "inbound", IsEnabled: true, Health: "unknown",
	}
}

func TestPostgresIntegrationsSurviveARestartAndStayPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresIntegrations(conn)
	t.Cleanup(UseMemoryIntegrations)
	a, b := freshTenant(), freshTenant()
	feed, weather := liveIntegration(a, "case_feed"), liveIntegration(a, "weather_feed")
	for _, i := range []Integration{feed, weather} {
		if err := saveIntegration(context.Background(), a, i); err != nil {
			t.Fatal(err)
		}
	}
	rc := adminOf(a)
	if _, err := UpdateIntegration(rc, weather.ID, map[string]any{"is_enabled": false, "credential_ref": "secret://vault/weather", "fallback_timeout_seconds": 30.0}); err != nil {
		t.Fatal(err)
	}
	UseMemoryIntegrations()
	UsePostgresIntegrations(conn)
	got, err := GetIntegration(rc, weather.ID)
	if err != nil || got.Health != "disabled" || got.IsEnabled || got.CredentialRef == nil || *got.CredentialRef != "secret://vault/weather" || got.FallbackTimeoutSeconds == nil || *got.FallbackTimeoutSeconds != 30 {
		t.Fatalf("after a restart: %+v %v", got, err)
	}
	if rows, _ := allIntegrations(context.Background(), b); len(rows) != 0 {
		t.Fatalf("another customer sees %d integrations", len(rows))
	}
}

func TestPostgresIntegrationsKeepTheFeedHealthOverlay(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresIntegrations(conn)
	t.Cleanup(UseMemoryIntegrations)
	a := freshTenant()
	feed := liveIntegration(a, "case_feed")
	if err := saveIntegration(context.Background(), a, feed); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	FeedStateSource = func(context.Context, string) ([]FeedState, error) {
		return []FeedState{{Feed: "case", LastReceived: &old}}, nil
	}
	t.Cleanup(func() { FeedStateSource = nil })
	got, err := GetIntegration(adminOf(a), feed.ID)
	if err != nil || got.Health != "down" {
		t.Fatalf("overlay: %+v %v", got, err)
	}
	stored, _ := allIntegrations(context.Background(), a)
	if len(stored) != 1 || stored[0].Health != "unknown" {
		t.Fatalf("the stored health changed: %+v", stored)
	}
}

func TestPostgresIntegrationsReseedFromTheFixtures(t *testing.T) {
	conn := settingsConn(t)
	owner := &tenancy.Connection{Pool: ownerPool(t)}
	UsePostgresIntegrations(conn)
	t.Cleanup(UseMemoryIntegrations)
	if err := ReseedIntegrationsForTest(context.Background(), owner); err != nil {
		t.Fatal(err)
	}
	tenant, _ := fixtures.TenantID()
	want, _ := fixtures.Records[Integration]("Integration")
	rows, err := allIntegrations(context.Background(), tenant)
	if err != nil || len(rows) != len(want) {
		t.Fatalf("%d of %d fixtures (%v)", len(rows), len(want), err)
	}
}
