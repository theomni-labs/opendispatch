// SPDX-License-Identifier: AGPL-3.0-only

// Integration: a real Keycloak brokers a sign-in.
package business

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/keycloakadmin"
)

// kcAdmin: master-realm calls that set up the test.
type kcAdmin struct {
	t    *testing.T
	base string
	tok  string
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func newKCAdmin(t *testing.T, base, password string) *kcAdmin {
	form := url.Values{"grant_type": {"password"}, "client_id": {"admin-cli"}, "username": {"admin"}, "password": {password}}
	res, err := http.PostForm(base+"/realms/master/protocol/openid-connect/token", form)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tok); err != nil || tok.AccessToken == "" {
		t.Fatalf("master admin sign-in: %d %v", res.StatusCode, err)
	}
	return &kcAdmin{t: t, base: base, tok: tok.AccessToken}
}

func (a *kcAdmin) call(method, path string, in, out any) int {
	a.t.Helper()
	var body io.Reader
	if in != nil {
		raw, _ := json.Marshal(in)
		body = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, a.base+"/admin"+path, body)
	req.Header.Set("Authorization", "Bearer "+a.tok)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		a.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 && res.StatusCode != 404 {
		a.t.Fatalf("%s %s: %d %s", method, path, res.StatusCode, raw)
	}
	if out != nil && len(raw) > 0 {
		_ = json.Unmarshal(raw, out)
	}
	return res.StatusCode
}

func (a *kcAdmin) id(path, field, want string) string {
	var rows []map[string]any
	a.call("GET", path, nil, &rows)
	for _, r := range rows {
		if r[field] == want {
			return r["id"].(string)
		}
	}
	a.t.Fatalf("%s: no %s=%s", path, field, want)
	return ""
}

// setUpOpenDispatchRealm: what the first-run Job does.
func (a *kcAdmin) setUpOpenDispatchRealm(realm, webSecret, adminSecret string) {
	a.call("POST", "/realms", map[string]any{
		"realm": realm, "enabled": true, "sslRequired": "none",
		"clients": []any{
			map[string]any{
				"clientId": "opendispatch-web", "enabled": true, "publicClient": false, "secret": webSecret,
				"standardFlowEnabled": true, "directAccessGrantsEnabled": false, "redirectUris": []string{"http://127.0.0.1:1/cb"},
				"protocolMappers": []any{
					map[string]any{"name": "groups", "protocol": "openid-connect", "protocolMapper": "oidc-group-membership-mapper",
						"config": map[string]string{"claim.name": "groups", "full.path": "false", "id.token.claim": "true", "access.token.claim": "true", "userinfo.token.claim": "true"}},
					map[string]any{"name": "idp-groups", "protocol": "openid-connect", "protocolMapper": "oidc-usermodel-attribute-mapper",
						"config": map[string]string{"user.attribute": IdPGroupsAttribute, "claim.name": "groups", "multivalued": "true", "jsonType.label": "String",
							"id.token.claim": "true", "access.token.claim": "true", "userinfo.token.claim": "true"}},
				},
			},
			map[string]any{
				"clientId": "opendispatch-idp-admin", "enabled": true, "publicClient": false, "secret": adminSecret,
				"standardFlowEnabled": false, "serviceAccountsEnabled": true,
			},
		},
		"groups": []any{map[string]any{"name": "opendispatch-local"}},
	}, nil)
	cid := a.id("/realms/"+realm+"/clients?clientId=opendispatch-idp-admin", "clientId", "opendispatch-idp-admin")
	var sa map[string]any
	a.call("GET", "/realms/"+realm+"/clients/"+cid+"/service-account-user", nil, &sa)
	rm := a.id("/realms/"+realm+"/clients?clientId=realm-management", "clientId", "realm-management")
	var roles []map[string]any
	a.call("GET", "/realms/"+realm+"/clients/"+rm+"/roles", nil, &roles)
	var grant []map[string]any
	for _, r := range roles {
		if r["name"] == "manage-identity-providers" || r["name"] == "view-identity-providers" {
			grant = append(grant, r)
		}
	}
	a.call("POST", "/realms/"+realm+"/users/"+sa["id"].(string)+"/role-mappings/clients/"+rm, grant, nil)
	var profile map[string]any
	a.call("GET", "/realms/"+realm+"/users/profile", nil, &profile)
	attrs, _ := profile["attributes"].([]any)
	profile["attributes"] = append(attrs, map[string]any{"name": IdPGroupsAttribute, "multivalued": true,
		"permissions": map[string]any{"view": []string{"admin"}, "edit": []string{"admin"}}})
	a.call("PUT", "/realms/"+realm+"/users/profile", profile, nil)
}

// setUpCustomerRealm: the customer's own IdP.
func (a *kcAdmin) setUpCustomerRealm(realm, opendispatchRealm, brokerSecret, userPassword string) {
	a.call("POST", "/realms", map[string]any{
		"realm": realm, "enabled": true, "sslRequired": "none",
		"groups": []any{map[string]any{"name": "customer-dispatch-riyadh"}, map[string]any{"name": "customer-other"}},
		"clients": []any{map[string]any{
			"clientId": "opendispatch-broker", "enabled": true, "publicClient": false, "secret": brokerSecret, "standardFlowEnabled": true,
			"redirectUris": []string{a.base + "/realms/" + opendispatchRealm + "/broker/*"},
			"protocolMappers": []any{map[string]any{"name": "groups", "protocol": "openid-connect", "protocolMapper": "oidc-group-membership-mapper",
				"config": map[string]string{"claim.name": "groups", "full.path": "false", "id.token.claim": "true", "access.token.claim": "true", "userinfo.token.claim": "true"}}},
		}},
		"users": []any{map[string]any{
			"username": "alice", "enabled": true, "email": "alice@demo.example", "emailVerified": true,
			"firstName": "Alice", "lastName": "Synthetic", "groups": []string{"/customer-dispatch-riyadh"},
			"credentials": []any{map[string]any{"type": "password", "value": userPassword, "temporary": false}},
		}},
	}, nil)
}

var formAction = regexp.MustCompile(`<form[^>]*action="([^"]+)"`)

// brokeredSignIn: browser flow to ID token claims.
func brokeredSignIn(t *testing.T, base, realm, alias, webSecret, user, password string) map[string]any {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	var code string
	client := &http.Client{Jar: jar, CheckRedirect: func(req *http.Request, _ []*http.Request) error {
		if req.URL.Host == "127.0.0.1:1" {
			code = req.URL.Query().Get("code")
			return http.ErrUseLastResponse
		}
		return nil
	}}
	q := url.Values{"client_id": {"opendispatch-web"}, "response_type": {"code"}, "scope": {"openid"}, "redirect_uri": {"http://127.0.0.1:1/cb"},
		"kc_idp_hint": {alias}, "state": {randHex(8)}, "nonce": {randHex(8)}}
	res, err := client.Get(base + "/realms/" + realm + "/protocol/openid-connect/auth?" + q.Encode())
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(res.Body)
	res.Body.Close()
	m := formAction.FindSubmatch(page)
	if m == nil {
		t.Fatalf("no login form at %s: %d", res.Request.URL, res.StatusCode)
	}
	res, err = client.PostForm(html.UnescapeString(string(m[1])), url.Values{"username": {user}, "password": {password}, "credentialId": {""}})
	if err != nil {
		t.Fatal(err)
	}
	page, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if code == "" {
		t.Fatalf("no code; stopped at %s (%d): %.400s", res.Request.URL, res.StatusCode, page)
	}
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {"http://127.0.0.1:1/cb"}, "client_id": {"opendispatch-web"}, "client_secret": {webSecret}}
	res, err = http.PostForm(base+"/realms/"+realm+"/protocol/openid-connect/token", form)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var tok struct {
		IDToken string `json:"id_token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tok); err != nil || tok.IDToken == "" {
		t.Fatalf("code exchange: %d %v", res.StatusCode, err)
	}
	parts := strings.Split(tok.IDToken, ".")
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	claims := map[string]any{}
	_ = json.Unmarshal(raw, &claims)
	return claims
}

func groupsOf(claims map[string]any) []string {
	var out []string
	list, _ := claims["groups"].([]any)
	for _, g := range list {
		out = append(out, fmt.Sprint(g))
	}
	return out
}

func TestKeycloakBrokerSignInGetsRoleFromMappedGroup(t *testing.T) {
	base, password := os.Getenv("OPENDISPATCH_KEYCLOAK_IT_URL"), os.Getenv("OPENDISPATCH_KEYCLOAK_IT_ADMIN_PASSWORD")
	if base == "" || password == "" {
		t.Skip("OPENDISPATCH_KEYCLOAK_IT_URL and OPENDISPATCH_KEYCLOAK_IT_ADMIN_PASSWORD not set")
	}
	resetIdentityDeps()
	a := newKCAdmin(t, base, password)
	suffix := randHex(4)
	opendispatchRealm, customerRealm := "opendispatch-it-"+suffix, "customer-it-"+suffix
	webSecret, adminSecret, brokerSecret, userPassword := randHex(16), randHex(16), randHex(16), randHex(12)
	t.Cleanup(func() {
		a.call("DELETE", "/realms/"+opendispatchRealm, nil, nil)
		a.call("DELETE", "/realms/"+customerRealm, nil, nil)
		UseKeycloakAdmin(nil)
	})
	a.setUpOpenDispatchRealm(opendispatchRealm, webSecret, adminSecret)
	a.setUpCustomerRealm(customerRealm, opendispatchRealm, brokerSecret, userPassword)
	kc := keycloakadmin.New(keycloakadmin.Config{BaseURL: base, Realm: opendispatchRealm, ClientID: "opendispatch-idp-admin", ClientSecret: adminSecret})
	UseKeycloakAdmin(kc)

	upsertRoleMappingRow(RoleMapping{
		BaseRecord: bd("00000000-0000-4000-8000-00000000c901", "t1"),
		GroupMatch: "customer-dispatch-riyadh", GroupMatchType: "exact",
		AssignedRole: access.RoleViewerAuditor, ZoneIDs: []string{}, Priority: 1, IsEnabled: true,
	})
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	created, err := CreateIdentityProvider(admin, map[string]any{
		"preset_id": "generic_oidc", "display_name": "Customer IdP", "is_enabled": true,
		"config":        map[string]any{"issuer_url": base + "/realms/" + customerRealm, "client_id": "opendispatch-broker"},
		"client_secret": brokerSecret,
	})
	check(t, err)
	if created.SyncStatus != SyncSynced {
		t.Fatalf("sync: %s %v", created.SyncStatus, created.LastSyncError)
	}
	stored, _ := json.Marshal(oneProviderRowMemory(created.ID))
	if strings.Contains(string(stored), brokerSecret) {
		t.Fatal("the client secret was stored by OpenDispatch")
	}
	result, err := TestIdentityProviderConnection(admin, created.ID)
	check(t, err)
	if !result.OK || result.Steps[0].Code != "keycloak" {
		t.Fatalf("test connection: %+v", result)
	}

	renamed, err := UpdateIdentityProvider(admin, created.ID, map[string]any{
		"preset_id": "generic_oidc", "display_name": "Customer IdP renamed", "is_enabled": true,
		"config": map[string]any{"issuer_url": base + "/realms/" + customerRealm, "client_id": "opendispatch-broker"},
	})
	check(t, err)
	if renamed.SyncStatus != SyncSynced {
		t.Fatalf("update sync: %s %v", renamed.SyncStatus, renamed.LastSyncError)
	}

	claims := brokeredSignIn(t, base, opendispatchRealm, created.ID, webSecret, "alice", userPassword)
	groups := groupsOf(claims)
	if !slices.Contains(groups, "customer-dispatch-riyadh") {
		t.Fatalf("groups claim %v, want customer-dispatch-riyadh from the customer's IdP", groups)
	}
	preview, err := resolveRoleFromGroups(context.Background(), "t1", access.InstallPrivate, groups, nil)
	check(t, err)
	if preview.AssignedRole == nil || *preview.AssignedRole != access.RoleViewerAuditor {
		t.Fatalf("role from %v: %+v", groups, preview)
	}

	userID := a.id("/realms/"+opendispatchRealm+"/users?username=alice&exact=true", "username", "alice")
	groupID := a.id("/realms/"+opendispatchRealm+"/groups?search=opendispatch-local&exact=true", "name", "opendispatch-local")
	a.call("PUT", "/realms/"+opendispatchRealm+"/users/"+userID+"/groups/"+groupID, nil, nil)
	merged := groupsOf(brokeredSignIn(t, base, opendispatchRealm, created.ID, webSecret, "alice", userPassword))
	if !slices.Contains(merged, "opendispatch-local") || !slices.Contains(merged, "customer-dispatch-riyadh") {
		t.Fatalf("groups claim %v, want Keycloak and IdP groups together", merged)
	}

	disabled, err := UpdateIdentityProvider(admin, created.ID, map[string]any{
		"preset_id": "generic_oidc", "display_name": "Customer IdP renamed", "is_enabled": false,
		"config": map[string]any{"issuer_url": base + "/realms/" + customerRealm, "client_id": "opendispatch-broker"},
	})
	check(t, err)
	ctx := context.Background()
	got, err := kc.GetIdentityProvider(ctx, created.ID)
	if err != nil || got == nil || got.Enabled || disabled.SyncStatus != SyncSynced {
		t.Fatalf("disable: %+v %v", got, err)
	}
	check(t, DeleteIdentityProvider(admin, created.ID))
	if got, err := kc.GetIdentityProvider(ctx, created.ID); err != nil || got != nil {
		t.Fatalf("after delete Keycloak still has %+v (%v)", got, err)
	}

	saml, err := CreateIdentityProvider(admin, map[string]any{
		"preset_id": "adfs_saml", "display_name": "Customer SAML", "is_enabled": true,
		"config": map[string]any{"metadata_url": base + "/realms/" + customerRealm + "/protocol/saml/descriptor"},
	})
	check(t, err)
	samlTest, err := TestIdentityProviderConnection(admin, saml.ID)
	check(t, err)
	if saml.SyncStatus != SyncSynced || !samlTest.OK {
		t.Fatalf("SAML from metadata: %s %v %+v", saml.SyncStatus, saml.LastSyncError, samlTest)
	}
	kcSAML, err := kc.GetIdentityProvider(ctx, saml.ID)
	if err != nil || kcSAML.Config["validateSignature"] != "true" || kcSAML.Config["signingCertificate"] == "" {
		t.Fatalf("SAML in Keycloak: %+v %v", kcSAML, err)
	}
	check(t, DeleteIdentityProvider(admin, saml.ID))
}
