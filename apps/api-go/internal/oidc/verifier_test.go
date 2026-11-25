// SPDX-License-Identifier: AGPL-3.0-only

package oidc_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc/oidctest"
)

const tenantA = "11111111-1111-4111-8111-111111111111"
const tenantB = "22222222-2222-4222-8222-222222222222"

var people = map[string]oidctest.User{
	"planner": {Subject: "sub-planner", Email: "planner@customer.example", Name: "Pia Planner", Groups: []string{"opendispatch-planners", "staff"}},
}

type countingTransport struct{ hits atomic.Int64 }

func (c *countingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	c.hits.Add(1)
	return http.DefaultTransport.RoundTrip(r)
}

// rig: a verifier for one or two mock providers, with the key cache configured as a test needs.
type rig struct {
	a, b *oidctest.Provider
	v    *oidc.Verifier
	hits *countingTransport
}

func newRig(t *testing.T, minRefresh time.Duration) *rig {
	t.Helper()
	a := oidctest.New("opendispatch", "secret-a", people)
	b := oidctest.New("opendispatch", "secret-b", people)
	t.Cleanup(a.Close)
	t.Cleanup(b.Close)
	reg, err := oidc.NewConfigRegistry([]oidc.Tenant{
		{TenantID: tenantA, Issuer: a.Issuer, ClientID: "opendispatch", RedirectURI: "http://app.test/auth/callback", AllowInsecureHTTP: true},
		{TenantID: tenantB, Issuer: b.Issuer, ClientID: "opendispatch", RedirectURI: "http://app.test/auth/callback", AllowInsecureHTTP: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	hits := &countingTransport{}
	sources := map[string]oidc.KeySource{}
	v := &oidc.Verifier{Registry: reg, Skew: time.Second, Keys: func(tn oidc.Tenant) oidc.KeySource {
		if s, ok := sources[tn.Issuer]; ok {
			return s
		}
		s := &oidc.RemoteKeys{URL: tn.Issuer + "/jwks", Client: &http.Client{Transport: hits, Timeout: 5 * time.Second}, MinRefresh: minRefresh}
		sources[tn.Issuer] = s
		return s
	}}
	return &rig{a: a, b: b, v: v, hits: hits}
}

func refused(t *testing.T, r *rig, raw, nonce string, want error) {
	t.Helper()
	claims, _, err := r.v.Verify(context.Background(), raw, nonce)
	if !errors.Is(err, want) {
		t.Fatalf("got claims=%v err=%v, want %v", claims, err, want)
	}
	if claims != nil {
		t.Fatal("a refused token must yield no claims")
	}
}

func TestVerify_AGoodTokenGivesTheClaimsAndTheCustomer(t *testing.T) {
	r := newRig(t, time.Millisecond)
	raw := r.a.IDToken(people["planner"], oidctest.TokenOptions{Nonce: "n-1"})
	claims, tenant, err := r.v.Verify(context.Background(), raw, "n-1")
	if err != nil {
		t.Fatal(err)
	}
	if tenant.TenantID != tenantA || claims.Subject != "sub-planner" || claims.Email != "planner@customer.example" || claims.Name != "Pia Planner" {
		t.Fatalf("got %+v for %+v", claims, tenant)
	}
	if strings.Join(claims.Groups, ",") != "opendispatch-planners,staff" {
		t.Fatalf("groups: %v", claims.Groups)
	}
}

func TestVerify_AnUnknownIssuerIsRefused(t *testing.T) {
	r := newRig(t, time.Millisecond)
	refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{Issuer: "https://evil.example"}), "", oidc.ErrUnknownIssuer)
}

func TestVerify_ATokenSignedByAnotherProviderIsRefused(t *testing.T) {
	r := newRig(t, time.Millisecond)
	// A signs a token that says it comes from B: B's key set has no such key.
	refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{Issuer: r.b.Issuer}), "", oidc.ErrUnknownKey)
}

func TestVerify_ABadSignatureIsRefused(t *testing.T) {
	r := newRig(t, time.Millisecond)
	forged, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	// The right key id, the wrong private key.
	refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{SignWith: forged}), "", oidc.ErrSignature)
}

func TestVerify_ATamperedPayloadIsRefused(t *testing.T) {
	r := newRig(t, time.Millisecond)
	parts := strings.Split(r.a.IDToken(people["planner"], oidctest.TokenOptions{}), ".")
	other := strings.Split(r.a.IDToken(oidctest.User{Subject: "sub-admin", Email: "admin@customer.example", Groups: []string{"opendispatch-admins"}}, oidctest.TokenOptions{}), ".")
	refused(t, r, parts[0]+"."+other[1]+"."+parts[2], "", oidc.ErrSignature)
}

func TestVerify_ForbiddenAlgorithmsAreRefused(t *testing.T) {
	r := newRig(t, time.Millisecond)
	refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{Alg: "none"}), "", oidc.ErrAlgorithm)
	// Algorithm confusion: HS256 with the published public key as the shared secret.
	key, _ := r.a.Key()
	der, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	pemKey := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{Alg: "HS256", HMACKey: pemKey}), "", oidc.ErrAlgorithm)
}

func TestVerify_ATokenWithoutAKeyIdIsRefused(t *testing.T) {
	r := newRig(t, time.Millisecond)
	refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{KeyID: "-"}), "", oidc.ErrNoKeyID)
}

func TestVerify_TimeClaimsAreEnforced(t *testing.T) {
	r := newRig(t, time.Millisecond)
	now := time.Now()
	refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{Expiry: now.Add(-time.Minute), IssuedAt: now.Add(-time.Hour)}), "", oidc.ErrExpired)
	refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{NotBefore: now.Add(time.Hour)}), "", oidc.ErrNotYetValid)
	// Inside the skew it still passes.
	wide := newRig(t, time.Millisecond)
	wide.v.Skew = 30 * time.Second
	if _, _, err := wide.v.Verify(context.Background(), wide.a.IDToken(people["planner"], oidctest.TokenOptions{Expiry: now.Add(-5 * time.Second), IssuedAt: now.Add(-time.Hour)}), ""); err != nil {
		t.Fatalf("within the skew: %v", err)
	}
}

func TestVerify_TheAudienceMustBeThisApplication(t *testing.T) {
	r := newRig(t, time.Millisecond)
	refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{Audience: "some-other-app"}), "", oidc.ErrAudience)
}

func TestVerify_TheNonceMustMatch(t *testing.T) {
	r := newRig(t, time.Millisecond)
	raw := r.a.IDToken(people["planner"], oidctest.TokenOptions{Nonce: "right"})
	refused(t, r, raw, "wrong", oidc.ErrNonce)
	refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{}), "expected", oidc.ErrNonce)
}

func TestVerify_ExpiryAndSubjectAreRequired(t *testing.T) {
	r := newRig(t, time.Millisecond)
	refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{OmitExpiry: true}), "", oidc.ErrMissingExpiry)
	refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{OmitSubject: true}), "", oidc.ErrMissingSubject)
}

func TestVerify_GarbageIsMalformed(t *testing.T) {
	r := newRig(t, time.Millisecond)
	for _, raw := range []string{"", "abc", "a.b.c", "....", strings.Repeat("x", 100)} {
		refused(t, r, raw, "", oidc.ErrMalformed)
	}
}

func TestVerify_ARotatedKeyIsPickedUp(t *testing.T) {
	r := newRig(t, time.Millisecond)
	if _, _, err := r.v.Verify(context.Background(), r.a.IDToken(people["planner"], oidctest.TokenOptions{}), ""); err != nil {
		t.Fatal(err)
	}
	r.a.RotateKey()
	time.Sleep(5 * time.Millisecond)
	if _, _, err := r.v.Verify(context.Background(), r.a.IDToken(people["planner"], oidctest.TokenOptions{}), ""); err != nil {
		t.Fatalf("after a rotation: %v", err)
	}
}

func TestVerify_UnknownKeyIdsCannotMakeUsFetchAtWill(t *testing.T) {
	r := newRig(t, time.Hour)
	if _, _, err := r.v.Verify(context.Background(), r.a.IDToken(people["planner"], oidctest.TokenOptions{}), ""); err != nil {
		t.Fatal(err)
	}
	before := r.hits.hits.Load()
	for i := 0; i < 20; i++ {
		refused(t, r, r.a.IDToken(people["planner"], oidctest.TokenOptions{KeyID: "made-up"}), "", oidc.ErrUnknownKey)
	}
	if after := r.hits.hits.Load(); after != before {
		t.Fatalf("20 unknown key ids caused %d key-set fetches, want 0 inside MinRefresh", after-before)
	}
}

func TestDiscover_ChecksTheIssuerAndTheScheme(t *testing.T) {
	p := oidctest.New("opendispatch", "s", people)
	defer p.Close()
	if _, err := oidc.Discover(context.Background(), nil, p.Issuer, true); err != nil {
		t.Fatal(err)
	}
	if _, err := oidc.Discover(context.Background(), nil, p.Issuer, false); err == nil {
		t.Fatal("plain http must be refused unless allowed")
	}
	// The document is served at this issuer's url but names another issuer.
	q := oidctest.New("opendispatch", "s", people)
	defer q.Close()
	q.Issuer = "https://someone-else.example"
	if _, err := oidc.Discover(context.Background(), nil, q.Server().URL, true); err == nil {
		t.Fatal("a document that names another issuer must be refused")
	}
}

func TestRegistry_RefusesAnUnusableEntry(t *testing.T) {
	ok := oidc.Tenant{TenantID: tenantA, Issuer: "https://idp.customer.example", ClientID: "opendispatch", RedirectURI: "https://app/auth/callback"}
	cases := map[string][]oidc.Tenant{
		"tenant id not a uuid": {{TenantID: "nope", Issuer: ok.Issuer, ClientID: "a", RedirectURI: "r"}},
		"plain http issuer":    {{TenantID: tenantA, Issuer: "http://idp.customer.example", ClientID: "a", RedirectURI: "r"}},
		"no client id":         {{TenantID: tenantA, Issuer: ok.Issuer, RedirectURI: "r"}},
		"listed twice":         {ok, {TenantID: tenantB, Issuer: ok.Issuer, ClientID: "a", RedirectURI: "r"}},
		"shared, one without an organization": {
			{TenantID: tenantA, Issuer: ok.Issuer, ClientID: "a", RedirectURI: "r", Organization: "acme"},
			{TenantID: tenantB, Issuer: ok.Issuer, ClientID: "a", RedirectURI: "r"},
		},
		"shared, the same organization twice": {
			{TenantID: tenantA, Issuer: ok.Issuer, ClientID: "a", RedirectURI: "r", Organization: "acme"},
			{TenantID: tenantB, Issuer: ok.Issuer, ClientID: "a", RedirectURI: "r", Organization: "acme"},
		},
		"the same customer twice": {
			{TenantID: tenantA, Issuer: ok.Issuer, ClientID: "a", RedirectURI: "r", Organization: "acme"},
			{TenantID: tenantA, Issuer: ok.Issuer, ClientID: "a", RedirectURI: "r", Organization: "globex"},
		},
		"organization id without an alias": {{TenantID: tenantA, Issuer: ok.Issuer, ClientID: "a", RedirectURI: "r", OrganizationID: "x"}},
	}
	for name, list := range cases {
		if _, err := oidc.NewConfigRegistry(list); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
	reg, err := oidc.NewConfigRegistry([]oidc.Tenant{ok})
	if err != nil {
		t.Fatal(err)
	}
	if got := reg.IssuerTenants(ok.Issuer); len(got) != 1 || got[0].Audience != "opendispatch" || got[0].GroupsClaim != "groups" || got[0].InstallMode != "private" {
		t.Fatalf("defaults not applied: %+v", got)
	}
	if found := reg.IssuerTenants("https://unknown.example"); len(found) != 0 {
		t.Fatal("an unknown issuer must not be found")
	}
}
