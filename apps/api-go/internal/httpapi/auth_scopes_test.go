// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc"
)

func TestScopesFor_AsksForTheCustomersOrganisationOnly(t *testing.T) {
	base := []string{"openid", "email"}
	cases := []struct {
		t    oidc.Tenant
		want string
	}{
		{oidc.Tenant{Scopes: base}, "openid email"},
		{oidc.Tenant{Scopes: base, Organization: "acme"}, "openid email organization:acme"},
		{oidc.Tenant{Scopes: []string{"openid", "organization"}, Organization: "acme"}, "openid organization"},
		{oidc.Tenant{Scopes: []string{"openid", "organization:*"}, Organization: "acme"}, "openid organization:*"},
	}
	for _, c := range cases {
		if got := scopesFor(c.t); got != c.want {
			t.Errorf("got %q, want %q", got, c.want)
		}
	}
	if len(base) != 2 {
		t.Fatal("the tenant's scopes must not change")
	}
}
