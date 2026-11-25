// SPDX-License-Identifier: AGPL-3.0-only

package oidc

import "sort"

// OrganizationClaim is Keycloak 26's claim name.
const OrganizationClaim = "organization"

// Organization is one entry of the claim.
type Organization struct {
	Alias string
	ID    string
}

// OrganizationsOf reads Keycloak's documented claim shapes.
func OrganizationsOf(v any) []Organization {
	switch x := v.(type) {
	case string:
		if x != "" {
			return []Organization{{Alias: x}}
		}
	case []any:
		var out []Organization
		for _, item := range x {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, Organization{Alias: s})
			}
		}
		return out
	case map[string]any:
		out := make([]Organization, 0, len(x))
		for alias, attrs := range x {
			if alias == "" {
				continue
			}
			org := Organization{Alias: alias}
			if m, ok := attrs.(map[string]any); ok {
				org.ID, _ = m["id"].(string)
			}
			out = append(out, org)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Alias < out[j].Alias })
		return out
	}
	return nil
}

// ResolveTenant picks the customer for a token.
func ResolveTenant(entries []Tenant, orgs []Organization) (Tenant, error) {
	if len(entries) == 0 {
		return Tenant{}, ErrUnknownIssuer
	}
	// Dedicated or private: one issuer, one customer.
	if len(entries) == 1 && entries[0].Organization == "" {
		return entries[0], nil
	}
	if len(orgs) == 0 {
		return Tenant{}, ErrNoOrganization
	}
	var found []Tenant
	for _, e := range entries {
		if e.Organization == "" {
			continue
		}
		for _, o := range orgs {
			if o.Alias == e.Organization && (e.OrganizationID == "" || e.OrganizationID == o.ID) {
				found = append(found, e)
				break
			}
		}
	}
	switch len(found) {
	case 0:
		return Tenant{}, ErrUnknownOrganization
	case 1:
		return found[0], nil
	}
	return Tenant{}, ErrAmbiguousOrganization
}
