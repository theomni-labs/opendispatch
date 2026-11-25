// SPDX-License-Identifier: AGPL-3.0-only

// IdPs configured in Keycloak.
package business

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/keycloakadmin"
)

// Sync states of a provider (contract enum).
const (
	SyncSynced        = "synced"
	SyncFailed        = "failed"
	SyncNotConfigured = "not_configured"
)

// IdPGroupsAttribute: user attribute for IdP groups.
const IdPGroupsAttribute = "opendispatch_idp_groups"

const (
	mapperGroups = "opendispatch-groups"
	mapperEmail  = "opendispatch-email"
	mapperName   = "opendispatch-name"
)

var keycloakAdminClient atomic.Pointer[keycloakadmin.Client]

// UseKeycloakAdmin: nil means stored only.
func UseKeycloakAdmin(c *keycloakadmin.Client) { keycloakAdminClient.Store(c) }

// KeycloakConnected: admin access is configured.
func KeycloakConnected() bool { return keycloakAdminClient.Load() != nil }

func kcContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 45*time.Second)
}

var nameIDFormats = map[string]string{
	"persistent":  "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent",
	"email":       "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
	"transient":   "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
	"unspecified": "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
}

var principalTypes = []string{"subject", "email"}

// metadataURL: what Keycloak fetches for a provider.
func metadataURL(p IdentityProvider) string {
	c := p.Config
	wellKnown := func(issuer string) string {
		return strings.TrimSuffix(strings.TrimSpace(issuer), "/") + "/.well-known/openid-configuration"
	}
	switch p.PresetID {
	case "entra_id_oidc":
		return "https://login.microsoftonline.com/" + url.PathEscape(strings.TrimSpace(c["directory_tenant_id"])) + "/v2.0/.well-known/openid-configuration"
	case "okta":
		host := strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(c["okta_domain"]), "https://"), "/")
		return "https://" + host + "/.well-known/openid-configuration"
	case "google_workspace":
		return "https://accounts.google.com/.well-known/openid-configuration"
	case "adfs_oidc", "ping_identity", "generic_oidc":
		return wellKnown(c["issuer_url"])
	case "entra_id_saml", "adfs_saml":
		return strings.TrimSpace(c["metadata_url"])
	}
	return ""
}

var pemArmour = regexp.MustCompile(`-----(BEGIN|END) CERTIFICATE-----|\s+`)
var base64Body = regexp.MustCompile(`^[A-Za-z0-9+/=]+$`)

// certificateBody drops the PEM armour.
func certificateBody(pem string) (string, bool) {
	body := pemArmour.ReplaceAllString(pem, "")
	return body, len(body) >= 64 && base64Body.MatchString(body)
}

// validateSAMLSettings checks generic SAML values.
func validateSAMLSettings(p IdentityProvider) error {
	if p.PresetID != "generic_saml" {
		return nil
	}
	if _, ok := certificateBody(p.Config["signing_certificate"]); !ok {
		return dataerr.Invalid("Identity provider: the signing certificate must be a PEM or base64 certificate.")
	}
	if f := p.Config["name_id_format"]; f != "" && nameIDFormats[f] == "" {
		return dataerr.Invalid("Identity provider: NameID format must be one of persistent, email, transient, unspecified.")
	}
	if t := p.Config["principal_type"]; t != "" && t != principalTypes[0] && t != principalTypes[1] {
		return dataerr.Invalid("Identity provider: principal type must be subject or email.")
	}
	return nil
}

// wantedConfig: the Keycloak settings OpenDispatch owns.
func wantedConfig(ctx context.Context, kc *keycloakadmin.Client, p IdentityProvider) (map[string]string, error) {
	cfg := map[string]string{"syncMode": "FORCE", "hideOnLogin": "false"}
	if p.Protocol == "oidc" {
		imported, err := kc.ImportConfig(ctx, "oidc", metadataURL(p))
		if err != nil {
			return nil, fmt.Errorf("Keycloak could not read the discovery document: %w", err)
		}
		for k, v := range imported {
			cfg[k] = v
		}
		scopes := strings.TrimSpace(p.Config["scopes"])
		if scopes == "" {
			scopes = "openid email profile"
		}
		cfg["clientId"] = strings.TrimSpace(p.Config["client_id"])
		cfg["clientAuthMethod"] = "client_secret_post"
		cfg["defaultScope"] = scopes
		cfg["validateSignature"] = "true"
		cfg["useJwksUrl"] = "true"
		cfg["pkceEnabled"] = "true"
		cfg["pkceMethod"] = "S256"
		return cfg, nil
	}
	if u := metadataURL(p); u != "" {
		imported, err := kc.ImportConfig(ctx, "saml", u)
		if err != nil {
			return nil, fmt.Errorf("Keycloak could not read the SAML metadata: %w", err)
		}
		for k, v := range imported {
			cfg[k] = v
		}
	} else {
		body, _ := certificateBody(p.Config["signing_certificate"])
		cfg["singleSignOnServiceUrl"] = strings.TrimSpace(p.Config["sso_url"])
		cfg["signingCertificate"] = body
		format := nameIDFormats[p.Config["name_id_format"]]
		if format == "" {
			format = nameIDFormats["persistent"]
		}
		cfg["nameIDPolicyFormat"] = format
	}
	if id := strings.TrimSpace(p.Config["entity_id"]); id != "" {
		cfg["idpEntityId"] = id
	}
	if p.Config["principal_type"] == "email" {
		cfg["principalType"] = "ATTRIBUTE"
		cfg["principalAttribute"] = p.ClaimMapping.Email
	} else {
		cfg["principalType"] = "SUBJECT"
	}
	cfg["validateSignature"] = "true"
	cfg["wantAssertionsSigned"] = "true"
	cfg["postBindingResponse"] = "true"
	cfg["postBindingAuthnRequest"] = "true"
	return cfg, nil
}

// wantedMappers: groups; email and name if needed.
func wantedMappers(p IdentityProvider) []keycloakadmin.Mapper {
	importer, key := "oidc-user-attribute-idp-mapper", "claim"
	if p.Protocol == "saml" {
		importer, key = "saml-user-attribute-idp-mapper", "attribute.name"
	}
	mapper := func(name, from, to string) keycloakadmin.Mapper {
		return keycloakadmin.Mapper{Name: name, IdentityProviderAlias: p.ID, IdentityProviderMapper: importer,
			Config: map[string]string{key: from, "user.attribute": to, "syncMode": "FORCE"}}
	}
	out := []keycloakadmin.Mapper{mapper(mapperGroups, p.ClaimMapping.Groups, IdPGroupsAttribute)}
	if p.Protocol == "saml" || p.ClaimMapping.Email != "email" {
		out = append(out, mapper(mapperEmail, p.ClaimMapping.Email, "email"))
	}
	if p.Protocol == "saml" || p.ClaimMapping.Name != "name" {
		out = append(out, mapper(mapperName, p.ClaimMapping.Name, "firstName"))
	}
	return out
}

// syncToKeycloak creates or updates the provider.
func syncToKeycloak(p IdentityProvider, secret string) error {
	kc := keycloakAdminClient.Load()
	if kc == nil {
		return nil
	}
	ctx, cancel := kcContext()
	defer cancel()
	existing, err := kc.GetIdentityProvider(ctx, p.ID)
	if err != nil {
		return err
	}
	cfg, err := wantedConfig(ctx, kc, p)
	if err != nil {
		return err
	}
	rep := keycloakadmin.IdentityProvider{Alias: p.ID, DisplayName: p.DisplayName, Enabled: p.IsEnabled,
		FirstBrokerLoginFlowAlias: "first broker login", Config: map[string]string{}}
	rep.ProviderID = map[string]string{"oidc": "oidc", "saml": "saml"}[p.Protocol]
	if existing != nil {
		rep.TrustEmail, rep.StoreToken = existing.TrustEmail, existing.StoreToken
		if existing.FirstBrokerLoginFlowAlias != "" {
			rep.FirstBrokerLoginFlowAlias = existing.FirstBrokerLoginFlowAlias
		}
		for k, v := range existing.Config {
			rep.Config[k] = v
		}
	}
	for k, v := range cfg {
		rep.Config[k] = v
	}
	if p.Protocol == "oidc" {
		switch {
		case secret != "":
			rep.Config["clientSecret"] = secret
		case existing == nil && p.HasSecret:
			return errors.New("Keycloak does not have the client secret yet. Enter it again and save.")
		}
	}
	if existing == nil {
		err = kc.CreateIdentityProvider(ctx, rep)
	} else {
		err = kc.UpdateIdentityProvider(ctx, rep)
	}
	if err != nil {
		return err
	}
	return syncMappers(ctx, kc, p)
}

func syncMappers(ctx context.Context, kc *keycloakadmin.Client, p IdentityProvider) error {
	have, err := kc.Mappers(ctx, p.ID)
	if err != nil {
		return err
	}
	byName := map[string]keycloakadmin.Mapper{}
	for _, m := range have {
		byName[m.Name] = m
	}
	wanted := map[string]bool{}
	for _, m := range wantedMappers(p) {
		wanted[m.Name] = true
		if old, ok := byName[m.Name]; ok {
			m.ID = old.ID
			err = kc.UpdateMapper(ctx, p.ID, m)
		} else {
			err = kc.CreateMapper(ctx, p.ID, m)
		}
		if err != nil {
			return err
		}
	}
	for _, m := range have {
		if strings.HasPrefix(m.Name, "opendispatch-") && !wanted[m.Name] {
			if err := kc.DeleteMapper(ctx, p.ID, m.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

// deleteFromKeycloak: a missing provider is fine.
func deleteFromKeycloak(alias string) error {
	kc := keycloakAdminClient.Load()
	if kc == nil {
		return nil
	}
	ctx, cancel := kcContext()
	defer cancel()
	return kc.DeleteIdentityProvider(ctx, alias)
}

// syncReason: a short reason with no secret in it.
func syncReason(err error, secret string) string {
	msg := err.Error()
	if secret != "" {
		msg = strings.ReplaceAll(msg, secret, "[secret]")
	}
	if len(msg) > 300 {
		msg = msg[:300]
	}
	return msg
}

// applySync syncs and records the outcome on p.
func applySync(p *IdentityProvider, secret string) {
	now := datactx.NowISO()
	p.LastSyncAt = &now
	if !KeycloakConnected() {
		p.SyncStatus, p.LastSyncAt, p.LastSyncError = SyncNotConfigured, nil, nil
		return
	}
	if err := syncToKeycloak(*p, secret); err != nil {
		reason := syncReason(err, secret)
		p.SyncStatus, p.LastSyncError = SyncFailed, &reason
		return
	}
	p.SyncStatus, p.LastSyncError = SyncSynced, nil
}

// syncDetail: the audit detail of a sync.
func syncDetail(p IdentityProvider) map[string]any {
	d := map[string]any{"keycloak_sync": p.SyncStatus}
	if p.LastSyncError != nil {
		d["keycloak_error"] = *p.LastSyncError
	}
	return d
}

// keycloakTestSteps: Keycloak itself checks the IdP.
func keycloakTestSteps(p IdentityProvider) []ConnectionTestStep {
	kc := keycloakAdminClient.Load()
	ctx, cancel := kcContext()
	defer cancel()
	fail := func(err error) *string { s := syncReason(err, ""); return &s }
	var have *keycloakadmin.IdentityProvider
	var mappers []keycloakadmin.Mapper
	kcStep := ConnectionTestStep{Code: "keycloak", Name: "Set up in Keycloak", OK: true}
	have, err := kc.GetIdentityProvider(ctx, p.ID)
	if err == nil && have != nil {
		mappers, err = kc.Mappers(ctx, p.ID)
	}
	switch {
	case err != nil:
		kcStep.OK, kcStep.Message = false, fail(err)
	case have == nil:
		kcStep.OK, kcStep.Message = false, ptr("Keycloak has no such provider. Save it again.")
	}
	groupsMapped := false
	for _, m := range mappers {
		if m.Name == mapperGroups && (m.Config["claim"] == p.ClaimMapping.Groups || m.Config["attribute.name"] == p.ClaimMapping.Groups) && m.Config["user.attribute"] == IdPGroupsAttribute {
			groupsMapped = true
		}
	}
	reach := ConnectionTestStep{Code: "reach", Name: "Reach the provider", OK: true}
	imported := map[string]string{}
	if u := metadataURL(p); u != "" {
		imported, err = kc.ImportConfig(ctx, p.Protocol, u)
		if err != nil {
			reach.OK, reach.Message = false, ptr("Keycloak could not fetch the metadata: "+syncReason(err, ""))
			imported = map[string]string{}
		}
	} else {
		reach.Message = ptr("No metadata address; Keycloak uses the settings given.")
		if have != nil {
			imported = have.Config
		}
	}
	cfg := map[string]string{}
	if have != nil {
		cfg = have.Config
	}
	if p.Protocol == "oidc" {
		disc := imported["authorizationUrl"] != "" && imported["tokenUrl"] != "" && imported["jwksUrl"] != ""
		client := cfg["clientId"] != "" && cfg["clientSecret"] != ""
		var clientMsg *string
		if have != nil && !client {
			clientMsg = ptr("Keycloak has no client ID or secret for it.")
		}
		return []ConnectionTestStep{kcStep, reach,
			{Code: "discovery", Name: "Read the discovery document", OK: disc},
			{Code: "client", Name: "Check the client", OK: client, Message: clientMsg},
			{Code: "claims", Name: "Find the email, name and groups claims", OK: groupsMapped}}
	}
	samlOK := imported["singleSignOnServiceUrl"] != ""
	signed := cfg["validateSignature"] == "true" && cfg["signingCertificate"] != ""
	return []ConnectionTestStep{kcStep, reach,
		{Code: "saml", Name: "Read the SAML settings", OK: samlOK},
		{Code: "signed", Name: "Signed assertions are required", OK: signed},
		{Code: "attrs", Name: "Find the email, name and groups attributes", OK: groupsMapped}}
}
