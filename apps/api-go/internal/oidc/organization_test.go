// SPDX-License-Identifier: AGPL-3.0-only

package oidc_test

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc/oidctest"
)

const tenantC = "33333333-3333-4333-8333-333333333333"

func TestOrganizationsOf_ReadsEveryDocumentedShape(t *testing.T) {
	cases := map[string]struct {
		in   any
		want []oidc.Organization
	}{
		"absent":            {nil, nil},
		"a list of aliases": {[]any{"acme", "globex"}, []oidc.Organization{{Alias: "acme"}, {Alias: "globex"}}},
		"one alias":         {"acme", []oidc.Organization{{Alias: "acme"}}},
		"an empty string":   {"", nil},
		"a map with ids": {map[string]any{"globex": map[string]any{"id": "g-1"}, "acme": map[string]any{"id": "a-1", "dept": []any{"x"}}},
			[]oidc.Organization{{Alias: "acme", ID: "a-1"}, {Alias: "globex", ID: "g-1"}}},
		"a map without ids": {map[string]any{"acme": map[string]any{}}, []oidc.Organization{{Alias: "acme"}}},
		"not strings":       {[]any{1, true, ""}, nil},
		"a number":          {42.0, nil},
	}
	for name, c := range cases {
		if got := oidc.OrganizationsOf(c.in); !reflect.DeepEqual(got, c.want) && !(len(got) == 0 && len(c.want) == 0) {
			t.Errorf("%s: got %+v, want %+v", name, got, c.want)
		}
	}
}

func TestResolveTenant_EveryCase(t *testing.T) {
	iss := "https://kc.example/realms/shared"
	private := []oidc.Tenant{{TenantID: tenantA, Issuer: "https://kc.customer.example/realms/opendispatch"}}
	shared := []oidc.Tenant{
		{TenantID: tenantA, Issuer: iss, Organization: "acme"},
		{TenantID: tenantB, Issuer: iss, Organization: "globex", OrganizationID: "g-1"},
	}
	org := func(alias, id string) oidc.Organization { return oidc.Organization{Alias: alias, ID: id} }
	cases := []struct {
		name    string
		entries []oidc.Tenant
		orgs    []oidc.Organization
		want    string
		err     error
	}{
		{"unknown issuer", nil, []oidc.Organization{org("acme", "")}, "", oidc.ErrUnknownIssuer},
		{"private, no organization", private, nil, tenantA, nil},
		{"private ignores an organization", private, []oidc.Organization{org("anything", "")}, tenantA, nil},
		{"shared, no organization", shared, nil, "", oidc.ErrNoOrganization},
		{"shared, known organization", shared, []oidc.Organization{org("acme", "whatever")}, tenantA, nil},
		{"shared, unknown organization", shared, []oidc.Organization{org("initech", "")}, "", oidc.ErrUnknownOrganization},
		{"shared, id matches", shared, []oidc.Organization{org("globex", "g-1")}, tenantB, nil},
		{"shared, alias reused with another id", shared, []oidc.Organization{org("globex", "g-2")}, "", oidc.ErrUnknownOrganization},
		{"shared, id required but absent", shared, []oidc.Organization{org("globex", "")}, "", oidc.ErrUnknownOrganization},
		{"two organizations, one maps", shared, []oidc.Organization{org("initech", ""), org("acme", "")}, tenantA, nil},
		{"two organizations, both map", shared, []oidc.Organization{org("acme", ""), org("globex", "g-1")}, "", oidc.ErrAmbiguousOrganization},
		{"one shared customer still needs it", shared[:1], nil, "", oidc.ErrNoOrganization},
	}
	for _, c := range cases {
		got, err := oidc.ResolveTenant(c.entries, c.orgs)
		if !errors.Is(err, c.err) || got.TenantID != c.want {
			t.Errorf("%s: got %q %v, want %q %v", c.name, got.TenantID, err, c.want, c.err)
		}
	}
}

// sharedRig: one provider, two customers by org.
func sharedRig(t *testing.T) (*oidctest.Provider, *oidc.Verifier) {
	t.Helper()
	p := oidctest.New("opendispatch", "s", people)
	t.Cleanup(p.Close)
	reg, err := oidc.NewConfigRegistry([]oidc.Tenant{
		{TenantID: tenantA, Issuer: p.Issuer, ClientID: "opendispatch", RedirectURI: "http://app.test/cb", AllowInsecureHTTP: true, Organization: "acme", InstallMode: "shared"},
		{TenantID: tenantB, Issuer: p.Issuer, ClientID: "opendispatch", RedirectURI: "http://app.test/cb", AllowInsecureHTTP: true, Organization: "globex", InstallMode: "shared"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return p, &oidc.Verifier{Registry: reg, Skew: time.Second, Keys: func(tn oidc.Tenant) oidc.KeySource {
		return &oidc.RemoteKeys{URL: tn.Issuer + "/jwks"}
	}}
}

func TestVerify_SharedIssuerResolvesByOrganization(t *testing.T) {
	p, v := sharedRig(t)
	cases := []struct {
		name  string
		claim any
		want  string
		err   error
	}{
		{"acme", []any{"acme"}, tenantA, nil},
		{"globex as a map", map[string]any{"globex": map[string]any{"id": "g"}}, tenantB, nil},
		{"no claim", nil, "", oidc.ErrNoOrganization},
		{"unknown", []any{"initech"}, "", oidc.ErrUnknownOrganization},
		{"both", []any{"acme", "globex"}, "", oidc.ErrAmbiguousOrganization},
		{"one of two maps", []any{"initech", "globex"}, tenantB, nil},
	}
	for _, c := range cases {
		extra := map[string]any{}
		if c.claim != nil {
			extra["organization"] = c.claim
		}
		claims, tenant, err := v.Verify(context.Background(), p.IDToken(people["planner"], oidctest.TokenOptions{Extra: extra}), "")
		if !errors.Is(err, c.err) || tenant.TenantID != c.want {
			t.Errorf("%s: got %q %v, want %q %v", c.name, tenant.TenantID, err, c.want, c.err)
		}
		if err != nil && claims != nil {
			t.Errorf("%s: a refused token must yield no claims", c.name)
		}
	}
}

func TestVerify_ARefusedOrganizationStillNeedsAGoodSignature(t *testing.T) {
	p, v := sharedRig(t)
	other := oidctest.New("opendispatch", "s", people)
	defer other.Close()
	// Another provider signs a token claiming p's issuer.
	raw := other.IDToken(people["planner"], oidctest.TokenOptions{Issuer: p.Issuer, Extra: map[string]any{"organization": []any{"acme"}}})
	if _, _, err := v.Verify(context.Background(), raw, ""); !errors.Is(err, oidc.ErrUnknownKey) {
		t.Fatalf("got %v", err)
	}
}
