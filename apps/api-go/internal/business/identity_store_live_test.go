// SPDX-License-Identifier: AGPL-3.0-only

// Live: identity providers kept in Postgres.
package business

import (
	"context"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestPostgresIdentityProvidersSurviveARestartAndStayPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresIdentityProviders(conn)
	t.Cleanup(UseMemoryIdentityProviders)
	a, b := adminOf(freshTenant()), adminOf(freshTenant())
	created, err := CreateIdentityProvider(a, cloneEntra(nil))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := TestIdentityProviderConnection(a, created.ID); err != nil {
		t.Fatal(err)
	}
	UseMemoryIdentityProviders()
	UsePostgresIdentityProviders(conn)
	got, err := GetIdentityProvider(a, created.ID)
	if err != nil || got.DisplayName != created.DisplayName || !got.HasSecret || got.LastTestAt == nil || got.LastTestOk == nil || got.Config["client_id"] == "" || len(got.EmailDomains) != len(created.EmailDomains) {
		t.Fatalf("after a restart: %+v %v", got, err)
	}
	if _, err := GetIdentityProvider(b, created.ID); err == nil {
		t.Fatal("another customer sees the provider")
	}
	list, err := ListIdentityProviders(b, datactx.PageQuery{})
	if err != nil || len(list.Items) != 1 {
		t.Fatalf("another customer lists %d providers, want the mock only", len(list.Items))
	}
	if err := DeleteIdentityProvider(a, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := GetIdentityProvider(a, created.ID); err == nil {
		t.Fatal("the provider is still there after the delete")
	}
	if err := ReseedIdentityForTest(context.Background(), &tenancy.Connection{Pool: ownerPool(t)}); err != nil {
		t.Fatal(err)
	}
}

func TestPostgresIdentityProvidersKeepKeycloakSyncState(t *testing.T) {
	conn := settingsConn(t)
	f, _ := withFakeKeycloak(t)
	UsePostgresIdentityProviders(conn)
	t.Cleanup(UseMemoryIdentityProviders)
	a := adminOf(freshTenant())
	ok, err := CreateIdentityProvider(a, oidcBody(nil))
	check(t, err)
	bad, err := CreateIdentityProvider(a, oidcBody(map[string]any{"config": map[string]any{"issuer_url": "https://unreachable.example", "client_id": "x"}}))
	check(t, err)
	got, err := GetIdentityProvider(a, ok.ID)
	if err != nil || got.SyncStatus != SyncSynced || got.LastSyncAt == nil || got.LastSyncError != nil {
		t.Fatalf("synced row: %+v %v", got, err)
	}
	got, err = GetIdentityProvider(a, bad.ID)
	if err != nil || got.SyncStatus != SyncFailed || got.LastSyncError == nil {
		t.Fatalf("failed row: %+v %v", got, err)
	}
	var raw string
	check(t, ownerPool(t).QueryRow(context.Background(), `SELECT row_to_json(p)::text FROM identity_providers p WHERE id = $1`, ok.ID).Scan(&raw))
	if strings.Contains(raw, idpClientSecret) {
		t.Fatal("the client secret is in the database")
	}
	check(t, DeleteIdentityProvider(a, ok.ID))
	check(t, DeleteIdentityProvider(a, bad.ID))
	if _, there := f.idp(ok.ID); there {
		t.Fatal("Keycloak still has the provider")
	}
}
