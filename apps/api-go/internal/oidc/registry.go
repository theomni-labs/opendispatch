// SPDX-License-Identifier: AGPL-3.0-only

package oidc

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
)

// Tenant is what we know about one customer's identity provider. The issuer and the organisation come from the token; the
// customer is never taken from request input, only from an entry here.
type Tenant struct {
	TenantID     string `json:"tenant_id"`
	Issuer       string `json:"issuer"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"-"`
	// SecretEnv names the environment variable that holds the client secret, so the file itself holds no secret.
	SecretEnv   string   `json:"client_secret_env"`
	Audience    string   `json:"audience"`
	RedirectURI string   `json:"redirect_uri"`
	Scopes      []string `json:"scopes"`
	GroupsClaim string   `json:"groups_claim"`
	InstallMode string   `json:"install_mode"`
	// ProviderID ties the tenant to an identity provider record, so only its group rules apply; empty means the rules for any provider.
	ProviderID string `json:"provider_id"`
	// AllowInsecureHTTP is for a local mock identity provider only.
	AllowInsecureHTTP bool `json:"allow_insecure_http"`
	// Keycloak organisation alias; shared tier only.
	Organization string `json:"organization"`
	// Optional: the claim's id must match too.
	OrganizationID string `json:"organization_id"`
}

// Registry answers which customer a token belongs to. platform.tenants will sit behind it.
type Registry interface {
	// IssuerTenants: every customer on one issuer.
	IssuerTenants(issuer string) []Tenant
	ByTenantID(tenantID string) (Tenant, bool)
	// Tenants lists every customer that can sign in, in a stable order.
	Tenants() []Tenant
}

var uuidShape = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// ConfigRegistry is a fixed list, read from a file at start.
type ConfigRegistry struct {
	byIssuer map[string][]Tenant
	byTenant map[string]Tenant
	order    []Tenant
}

// NewConfigRegistry checks every entry: an unusable one stops the start rather than being skipped, so a typo cannot silently
// leave a customer unable to sign in.
func NewConfigRegistry(tenants []Tenant) (*ConfigRegistry, error) {
	r := &ConfigRegistry{byIssuer: map[string][]Tenant{}, byTenant: map[string]Tenant{}}
	for i, t := range tenants {
		if !uuidShape.MatchString(t.TenantID) {
			return nil, fmt.Errorf("oidc tenant %d: tenant_id must be a uuid", i)
		}
		if t.Issuer == "" || t.ClientID == "" || t.RedirectURI == "" {
			return nil, fmt.Errorf("oidc tenant %s: issuer, client_id and redirect_uri are required", t.TenantID)
		}
		if len(t.Issuer) < 8 || (t.Issuer[:8] != "https://" && !t.AllowInsecureHTTP) {
			return nil, fmt.Errorf("oidc tenant %s: the issuer must use https", t.TenantID)
		}
		if t.OrganizationID != "" && t.Organization == "" {
			return nil, fmt.Errorf("oidc tenant %s: organization_id needs organization", t.TenantID)
		}
		if t.Audience == "" {
			t.Audience = t.ClientID
		}
		if t.GroupsClaim == "" {
			t.GroupsClaim = "groups"
		}
		if len(t.Scopes) == 0 {
			t.Scopes = []string{"openid", "email", "profile"}
		}
		if t.InstallMode == "" {
			t.InstallMode = "private"
		}
		if t.SecretEnv != "" {
			t.ClientSecret = os.Getenv(t.SecretEnv)
		}
		for _, other := range r.byIssuer[t.Issuer] {
			// A shared issuer: every entry names its org.
			if other.Organization == "" || t.Organization == "" {
				return nil, fmt.Errorf("oidc tenant %s: the issuer %s is listed twice; a shared issuer needs an organization on every entry", t.TenantID, t.Issuer)
			}
			if other.Organization == t.Organization {
				return nil, fmt.Errorf("oidc tenant %s: the organization %s of %s is listed twice", t.TenantID, t.Organization, t.Issuer)
			}
		}
		if _, dup := r.byTenant[t.TenantID]; dup {
			return nil, fmt.Errorf("oidc tenant %s is listed twice", t.TenantID)
		}
		r.byIssuer[t.Issuer] = append(r.byIssuer[t.Issuer], t)
		r.byTenant[t.TenantID] = t
		r.order = append(r.order, t)
	}
	return r, nil
}

// LoadTenantsFile reads a JSON array of tenants.
func LoadTenantsFile(path string) (*ConfigRegistry, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var tenants []Tenant
	if err := json.Unmarshal(raw, &tenants); err != nil {
		return nil, fmt.Errorf("oidc tenants file %s: %w", path, err)
	}
	return NewConfigRegistry(tenants)
}

func (r *ConfigRegistry) IssuerTenants(issuer string) []Tenant {
	return append([]Tenant(nil), r.byIssuer[issuer]...)
}

func (r *ConfigRegistry) ByTenantID(tenantID string) (Tenant, bool) {
	t, ok := r.byTenant[tenantID]
	return t, ok
}

func (r *ConfigRegistry) Tenants() []Tenant { return append([]Tenant(nil), r.order...) }
