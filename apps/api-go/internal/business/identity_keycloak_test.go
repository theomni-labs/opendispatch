// SPDX-License-Identifier: AGPL-3.0-only

// Keycloak sync against a fake admin API.
package business

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/keycloakadmin"
)

const fakeAdminSecret = "fake-service-account-value"

// fakeKeycloak: the admin API calls OpenDispatch makes.
type fakeKeycloak struct {
	mu       sync.Mutex
	idps     map[string]keycloakadmin.IdentityProvider
	mappers  map[string][]keycloakadmin.Mapper
	bodies   []string
	failNext map[string]int
	nextID   int
	srv      *httptest.Server
}

func newFakeKeycloak(t *testing.T) *fakeKeycloak {
	f := &fakeKeycloak{idps: map[string]keycloakadmin.IdentityProvider{}, mappers: map[string][]keycloakadmin.Mapper{}, failNext: map[string]int{}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeKeycloak) client(secret string) *keycloakadmin.Client {
	return keycloakadmin.New(keycloakadmin.Config{BaseURL: f.srv.URL, Realm: "opendispatch", ClientID: "opendispatch-idp-admin", ClientSecret: secret})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (f *fakeKeycloak) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	raw, _ := io.ReadAll(r.Body)
	f.bodies = append(f.bodies, r.Method+" "+r.URL.Path+" "+string(raw))
	if r.URL.Path == "/realms/opendispatch/protocol/openid-connect/token" {
		form, _ := urlValues(string(raw))
		if form["client_secret"] != fakeAdminSecret || form["grant_type"] != "client_credentials" {
			writeJSON(w, 401, map[string]string{"error": "unauthorized_client"})
			return
		}
		writeJSON(w, 200, map[string]any{"access_token": "fake-token", "expires_in": 300})
		return
	}
	if r.Header.Get("Authorization") != "Bearer fake-token" {
		writeJSON(w, 401, map[string]string{"error": "HTTP 401 Unauthorized"})
		return
	}
	if n := f.failNext[r.Method]; n > 0 {
		f.failNext[r.Method] = n - 1
		writeJSON(w, 500, map[string]string{"errorMessage": "Keycloak is unwell"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/admin/realms/opendispatch/identity-provider")
	switch {
	case path == "/import-config":
		var in map[string]string
		_ = json.Unmarshal(raw, &in)
		if strings.Contains(in["fromUrl"], "unreachable") {
			writeJSON(w, 400, map[string]string{"errorMessage": "Could not import config"})
			return
		}
		if in["providerId"] == "saml" {
			writeJSON(w, 200, map[string]any{"singleSignOnServiceUrl": "https://idp.example.com/sso", "signingCertificate": "MIIBfake", "validateSignature": "true", "enabled": true})
			return
		}
		writeJSON(w, 200, map[string]any{"authorizationUrl": "https://idp.example.com/auth", "tokenUrl": "https://idp.example.com/token", "jwksUrl": "https://idp.example.com/jwks", "issuer": "https://idp.example.com", "validateSignature": true})
	case path == "/instances" && r.Method == "POST":
		var p keycloakadmin.IdentityProvider
		_ = json.Unmarshal(raw, &p)
		if _, ok := f.idps[p.Alias]; ok {
			writeJSON(w, 409, map[string]string{"errorMessage": "exists"})
			return
		}
		f.idps[p.Alias] = p
		w.WriteHeader(201)
	case strings.HasPrefix(path, "/instances/"):
		rest := strings.Split(strings.TrimPrefix(path, "/instances/"), "/")
		alias := rest[0]
		p, ok := f.idps[alias]
		if !ok {
			writeJSON(w, 404, map[string]string{"error": "Could not find identity provider"})
			return
		}
		if len(rest) == 1 {
			switch r.Method {
			case "GET":
				shown := p
				shown.Config = map[string]string{}
				for k, v := range p.Config {
					shown.Config[k] = v
				}
				if shown.Config["clientSecret"] != "" {
					shown.Config["clientSecret"] = "**********"
				}
				writeJSON(w, 200, shown)
			case "PUT":
				var next keycloakadmin.IdentityProvider
				_ = json.Unmarshal(raw, &next)
				if next.Config["clientSecret"] == "**********" {
					next.Config["clientSecret"] = p.Config["clientSecret"]
				}
				f.idps[alias] = next
				w.WriteHeader(204)
			case "DELETE":
				delete(f.idps, alias)
				delete(f.mappers, alias)
				w.WriteHeader(204)
			}
			return
		}
		switch {
		case r.Method == "GET":
			writeJSON(w, 200, f.mappers[alias])
		case r.Method == "POST":
			var m keycloakadmin.Mapper
			_ = json.Unmarshal(raw, &m)
			f.nextID++
			m.ID = "m" + string(rune('0'+f.nextID))
			f.mappers[alias] = append(f.mappers[alias], m)
			w.WriteHeader(201)
		case r.Method == "PUT":
			var m keycloakadmin.Mapper
			_ = json.Unmarshal(raw, &m)
			for i, old := range f.mappers[alias] {
				if old.ID == rest[2] {
					f.mappers[alias][i] = m
				}
			}
			w.WriteHeader(204)
		case r.Method == "DELETE":
			kept := f.mappers[alias][:0]
			for _, old := range f.mappers[alias] {
				if old.ID != rest[2] {
					kept = append(kept, old)
				}
			}
			f.mappers[alias] = kept
			w.WriteHeader(204)
		}
	default:
		writeJSON(w, 404, map[string]string{"error": "unknown"})
	}
}

func urlValues(body string) (map[string]string, error) {
	out := map[string]string{}
	for _, kv := range strings.Split(body, "&") {
		k, v, _ := strings.Cut(kv, "=")
		out[k] = v
	}
	return out, nil
}

func (f *fakeKeycloak) mapperNamed(alias, name string) *keycloakadmin.Mapper {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, m := range f.mappers[alias] {
		if m.Name == name {
			return &m
		}
	}
	return nil
}

func (f *fakeKeycloak) idp(alias string) (keycloakadmin.IdentityProvider, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.idps[alias]
	return p, ok
}

// withFakeKeycloak: a fresh fake and captured logs.
func withFakeKeycloak(t *testing.T) (*fakeKeycloak, *bytes.Buffer) {
	resetIdentityDeps()
	auditlog.ResetForTest()
	f := newFakeKeycloak(t)
	UseKeycloakAdmin(f.client(fakeAdminSecret))
	logs := &bytes.Buffer{}
	log.SetOutput(logs)
	t.Cleanup(func() { UseKeycloakAdmin(nil); log.SetOutput(os.Stderr) })
	return f, logs
}

const idpClientSecret = "customer-idp-secret-value-1"

func oidcBody(overrides map[string]any) map[string]any {
	out := map[string]any{
		"preset_id": "generic_oidc", "display_name": "Customer IdP", "is_enabled": true,
		"config":        map[string]any{"issuer_url": "https://idp.example.com/realms/customer", "client_id": "opendispatch-broker"},
		"client_secret": idpClientSecret,
	}
	for k, v := range overrides {
		if _, omit := v.(omitKey); omit {
			delete(out, k)
			continue
		}
		out[k] = v
	}
	return out
}

func assertNoSecret(t *testing.T, where string, v any) {
	t.Helper()
	raw, _ := json.Marshal(v)
	if strings.Contains(string(raw), idpClientSecret) {
		t.Fatalf("the client secret appears in %s", where)
	}
}

func TestKeycloakSync_CreateUpdateDisableDelete(t *testing.T) {
	f, logs := withFakeKeycloak(t)
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	created, err := CreateIdentityProvider(admin, oidcBody(nil))
	check(t, err)
	if created.SyncStatus != SyncSynced || created.LastSyncAt == nil || created.LastSyncError != nil {
		t.Fatalf("got %+v, want synced", created)
	}
	kc, ok := f.idp(created.ID)
	if !ok || !kc.Enabled || kc.ProviderID != "oidc" || kc.Config["clientSecret"] != idpClientSecret || kc.Config["clientId"] != "opendispatch-broker" ||
		kc.Config["tokenUrl"] == "" || kc.Config["pkceEnabled"] != "true" || kc.Config["syncMode"] != "FORCE" {
		t.Fatalf("Keycloak got %+v", kc)
	}
	groups := f.mapperNamed(created.ID, mapperGroups)
	if groups == nil || groups.IdentityProviderMapper != "oidc-user-attribute-idp-mapper" || groups.Config["claim"] != "groups" || groups.Config["user.attribute"] != IdPGroupsAttribute {
		t.Fatalf("groups mapper %+v", groups)
	}
	if f.mapperNamed(created.ID, mapperEmail) != nil {
		t.Fatal("standard email claim needs no mapper")
	}

	updated, err := UpdateIdentityProvider(admin, created.ID, oidcBody(map[string]any{"client_secret": omitKey{}, "display_name": "Renamed",
		"claim_mapping": map[string]any{"email": "mail", "name": "name", "groups": "roles"}}))
	check(t, err)
	kc, _ = f.idp(created.ID)
	if updated.SyncStatus != SyncSynced || kc.DisplayName != "Renamed" || kc.Config["clientSecret"] != idpClientSecret {
		t.Fatalf("update: %+v, Keycloak %+v", updated, kc)
	}
	if m := f.mapperNamed(created.ID, mapperGroups); m == nil || m.Config["claim"] != "roles" || len(f.mappers[created.ID]) != 2 {
		t.Fatalf("mappers after update %+v", f.mappers[created.ID])
	}

	disabled, err := UpdateIdentityProvider(admin, created.ID, oidcBody(map[string]any{"client_secret": omitKey{}, "is_enabled": false}))
	check(t, err)
	if kc, _ = f.idp(created.ID); kc.Enabled || disabled.SyncStatus != SyncSynced || f.mapperNamed(created.ID, mapperEmail) != nil {
		t.Fatalf("disable: Keycloak %+v, mappers %+v", kc, f.mappers[created.ID])
	}

	check(t, DeleteIdentityProvider(admin, created.ID))
	if _, ok := f.idp(created.ID); ok {
		t.Fatal("Keycloak still has the provider")
	}

	assertNoSecret(t, "the stored providers", allProviderRowsMemory())
	assertNoSecret(t, "the api answers", []any{created, updated, disabled})
	assertNoSecret(t, "the audit log", auditlog.AllEvents())
	if strings.Contains(logs.String(), idpClientSecret) {
		t.Fatal("the client secret was logged")
	}
	actions := []string{}
	for _, e := range auditlog.AllEvents() {
		actions = append(actions, e.Action+":"+e.Outcome)
		if e.Action == "identity_provider.created" && e.Detail["keycloak_sync"] != SyncSynced {
			t.Fatalf("create audit detail %+v", e.Detail)
		}
	}
	want := "identity_provider.created:success identity_provider.updated:success identity_provider.updated:success identity_provider.deleted:success"
	if strings.Join(actions, " ") != want {
		t.Fatalf("audit %v", actions)
	}
	if !strings.Contains(strings.Join(f.bodies, "\n"), idpClientSecret) {
		t.Fatal("the secret never reached Keycloak")
	}
}

func TestKeycloakSync_FailureIsStoredWithReason(t *testing.T) {
	_, _ = withFakeKeycloak(t)
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	failed, err := CreateIdentityProvider(admin, oidcBody(map[string]any{"config": map[string]any{"issuer_url": "https://unreachable.example", "client_id": "x"}}))
	check(t, err)
	if failed.SyncStatus != SyncFailed || failed.LastSyncError == nil || !strings.Contains(*failed.LastSyncError, "discovery document") {
		t.Fatalf("got %+v, want failed with the reason", failed)
	}
	page, err := ListIdentityProviders(admin, datactx.PageQuery{})
	check(t, err)
	if !page.KeycloakConnected || page.Items[1].SyncStatus != SyncFailed {
		t.Fatalf("list %+v", page)
	}
	events := auditlog.AllEvents()
	if last := events[len(events)-1]; last.Detail["keycloak_sync"] != SyncFailed || last.Detail["keycloak_error"] == nil {
		t.Fatalf("audit %+v", last)
	}
	result, err := TestIdentityProviderConnection(admin, failed.ID)
	check(t, err)
	if result.OK || result.Steps[0].Code != "keycloak" || result.Steps[0].OK || result.Steps[1].OK {
		t.Fatalf("test %+v", result)
	}
}

func TestKeycloakSync_RefusedServiceAccountFails(t *testing.T) {
	f, _ := withFakeKeycloak(t)
	UseKeycloakAdmin(f.client("wrong-value"))
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	got, err := CreateIdentityProvider(admin, oidcBody(nil))
	check(t, err)
	if got.SyncStatus != SyncFailed || !strings.Contains(*got.LastSyncError, "service account was refused") {
		t.Fatalf("got %+v", got)
	}
}

func TestKeycloakSync_DeleteRefusedWhenKeycloakFails(t *testing.T) {
	f, _ := withFakeKeycloak(t)
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	created, err := CreateIdentityProvider(admin, oidcBody(nil))
	check(t, err)
	f.mu.Lock()
	f.failNext["DELETE"] = 1
	f.mu.Unlock()
	if err := DeleteIdentityProvider(admin, created.ID); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict", err)
	}
	if _, err := GetIdentityProvider(admin, created.ID); err != nil {
		t.Fatalf("provider gone from OpenDispatch: %v", err)
	}
	check(t, DeleteIdentityProvider(admin, created.ID))
}

func TestKeycloakSync_TestConnectionAsksKeycloak(t *testing.T) {
	_, _ = withFakeKeycloak(t)
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	created, err := CreateIdentityProvider(admin, oidcBody(nil))
	check(t, err)
	result, err := TestIdentityProviderConnection(admin, created.ID)
	check(t, err)
	codes := []string{}
	for _, s := range result.Steps {
		codes = append(codes, s.Code)
	}
	if !result.OK || strings.Join(codes, ",") != "keycloak,reach,discovery,client,claims" {
		t.Fatalf("test %+v", result)
	}
}

const fakeCert = "-----BEGIN CERTIFICATE-----\nMIIC8DCCAdigAwIBAgIQSyntheticSyntheticSyntheticSyntheticSyntheticAB\nSyntheticSyntheticSyntheticSyntheticSyntheticSyntheticSynthetic==\n-----END CERTIFICATE-----\n"

func TestKeycloakSync_GenericSAMLSettings(t *testing.T) {
	f, _ := withFakeKeycloak(t)
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	body := map[string]any{"preset_id": "generic_saml", "display_name": "SAML", "is_enabled": true,
		"config": map[string]any{"sso_url": "https://idp.example.com/sso", "entity_id": "https://idp.example.com/meta", "signing_certificate": fakeCert,
			"name_id_format": "email", "principal_type": "email"}}
	created, err := CreateIdentityProvider(admin, body)
	check(t, err)
	kc, _ := f.idp(created.ID)
	if created.SyncStatus != SyncSynced || kc.ProviderID != "saml" || strings.Contains(kc.Config["signingCertificate"], "BEGIN") || kc.Config["signingCertificate"] == "" ||
		kc.Config["idpEntityId"] != "https://idp.example.com/meta" || kc.Config["nameIDPolicyFormat"] != nameIDFormats["email"] ||
		kc.Config["principalType"] != "ATTRIBUTE" || kc.Config["validateSignature"] != "true" || kc.Config["wantAssertionsSigned"] != "true" {
		t.Fatalf("Keycloak got %+v (%+v)", kc, created)
	}
	for _, name := range []string{mapperGroups, mapperEmail, mapperName} {
		if m := f.mapperNamed(created.ID, name); m == nil || m.IdentityProviderMapper != "saml-user-attribute-idp-mapper" || m.Config["attribute.name"] == "" {
			t.Fatalf("mapper %s: %+v", name, m)
		}
	}
	bad := map[string]any{"preset_id": "generic_saml", "display_name": "SAML", "is_enabled": true,
		"config": map[string]any{"sso_url": "https://idp.example.com/sso", "entity_id": "x", "signing_certificate": "AB:CD"}}
	if _, err := CreateIdentityProvider(admin, bad); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("fingerprint instead of certificate: got %v, want Invalid", err)
	}
}

func TestKeycloakSync_DryRunStoresOnly(t *testing.T) {
	resetIdentityDeps()
	UseKeycloakAdmin(nil)
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	created, err := CreateIdentityProvider(admin, oidcBody(nil))
	check(t, err)
	if created.SyncStatus != SyncNotConfigured || created.LastSyncAt != nil {
		t.Fatalf("got %+v, want stored only", created)
	}
	page, err := ListIdentityProviders(admin, datactx.PageQuery{})
	check(t, err)
	if page.KeycloakConnected || page.Items[0].SyncStatus != "" || page.Items[1].SyncStatus != SyncNotConfigured {
		t.Fatalf("list %+v", page)
	}
	result, err := TestIdentityProviderConnection(admin, created.ID)
	check(t, err)
	if result.Steps[0].Code == "keycloak" {
		t.Fatalf("dry run asked Keycloak: %+v", result)
	}
	check(t, DeleteIdentityProvider(admin, created.ID))
}
