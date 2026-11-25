// SPDX-License-Identifier: AGPL-3.0-only

// Ports identity.ts. In-memory. README has the zone
// snapshot note under Sign-in and Identity.
package business

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const moduleSignInIdentity = access.ModuleAdminSignInIdentity

// Contract types

// ClaimMapping mirrors the contract's ClaimMapping.
type ClaimMapping struct {
	Email  string `json:"email"`
	Name   string `json:"name"`
	Groups string `json:"groups"`
}

// PresetField: one field of a preset.
type PresetField struct {
	Key         string  `json:"key"`
	LabelEn     string  `json:"label_en"`
	Required    bool    `json:"required"`
	Secret      bool    `json:"secret"`
	Placeholder *string `json:"placeholder"`
}

// IdentityPreset mirrors IdentityProviderPreset.
type IdentityPreset struct {
	ID            string        `json:"id"`
	NameEn        string        `json:"name_en"`
	Protocol      string        `json:"protocol"`
	Fields        []PresetField `json:"fields"`
	DefaultClaims ClaimMapping  `json:"default_claims"`
	NotesEn       []string      `json:"notes_en"`
}

// IdentityProvider mirrors the contract type.
type IdentityProvider struct {
	ID                       string            `json:"id"`
	PresetID                 string            `json:"preset_id"`
	DisplayName              string            `json:"display_name"`
	Protocol                 string            `json:"protocol"`
	IsEnabled                bool              `json:"is_enabled"`
	EmailDomains             []string          `json:"email_domains"`
	Config                   map[string]string `json:"config"`
	ClaimMapping             ClaimMapping      `json:"claim_mapping"`
	HasSecret                bool              `json:"has_secret"`
	SignedAssertionsRequired bool              `json:"signed_assertions_required"`
	LastTestAt               *string           `json:"last_test_at"`
	LastTestOk               *bool             `json:"last_test_ok"`
	ReadOnly                 bool              `json:"read_only"`
	DataSource               string            `json:"data_source"`
	SyncStatus               string            `json:"sync_status,omitempty"`
	LastSyncAt               *string           `json:"last_sync_at,omitempty"`
	LastSyncError            *string           `json:"last_sync_error,omitempty"`
}

// IdentityProviderPage: list and Keycloak state.
type IdentityProviderPage struct {
	Items             []IdentityProvider `json:"items"`
	Page              datactx.PageInfo   `json:"page"`
	KeycloakConnected bool               `json:"keycloak_connected"`
}

// ConnectionTestStep mirrors the contract type.
type ConnectionTestStep struct {
	Code    string  `json:"code"`
	Name    string  `json:"name"`
	OK      bool    `json:"ok"`
	Message *string `json:"message"`
}

// ConnectionTestResult mirrors the contract type.
type ConnectionTestResult struct {
	OK            bool                 `json:"ok"`
	CheckedAt     string               `json:"checked_at"`
	ReferenceCode *string              `json:"reference_code"`
	Steps         []ConnectionTestStep `json:"steps"`
}

// IdentityProviderChangeReceipt: the contract type.
type IdentityProviderChangeReceipt struct {
	RequestedAt   string `json:"requested_at"`
	ReferenceCode string `json:"reference_code"`
}

// RoleMapping mirrors the contract type.
type RoleMapping struct {
	datactx.BaseRecord
	IdentityProviderID *string     `json:"identity_provider_id"`
	GroupMatch         string      `json:"group_match"`
	GroupMatchType     string      `json:"group_match_type"`
	AssignedRole       access.Role `json:"assigned_role"`
	ZoneIDs            []string    `json:"zone_ids"`
	Priority           int         `json:"priority"`
	IsEnabled          bool        `json:"is_enabled"`
}

// RoleMappingPreview mirrors the contract type.
type RoleMappingPreview struct {
	AssignedRole      *access.Role `json:"assigned_role"`
	ZoneIDs           []string     `json:"zone_ids"`
	MatchedMappingIDs []string     `json:"matched_mapping_ids"`
}

// SignInPolicy mirrors the contract type.
type SignInPolicy struct {
	ForceSSOEmailDomains        []string `json:"force_sso_email_domains"`
	RequireMFAClaim             bool     `json:"require_mfa_claim"`
	AllowLocalUsersForOutsiders bool     `json:"allow_local_users_for_outsiders"`
	EmergencyAdminEnabled       bool     `json:"emergency_admin_enabled"`
}

// SignInResult mirrors the contract type.
type SignInResult struct {
	Outcome       string       `json:"outcome"`
	IsMock        bool         `json:"is_mock"`
	UserID        *string      `json:"user_id"`
	AssignedRole  *access.Role `json:"assigned_role"`
	ZoneIDs       []string     `json:"zone_ids"`
	ReferenceCode *string      `json:"reference_code"`
}

// SessionUser: SessionContext's user field.
type SessionUser struct {
	ID              string      `json:"id"`
	DisplayName     string      `json:"display_name"`
	Email           string      `json:"email"`
	AssignedRole    access.Role `json:"assigned_role"`
	ZoneIDs         []string    `json:"zone_ids"`
	PreferredLocale string      `json:"preferred_locale"`
}

// SessionTenant: SessionContext's tenant field.
type SessionTenant struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
}

// SessionContext mirrors the contract type.
type SessionContext struct {
	User        SessionUser         `json:"user"`
	Tenant      SessionTenant       `json:"tenant"`
	InstallMode access.InstallMode  `json:"install_mode"`
	IsDemo      bool                `json:"is_demo"`
	Modules     []ModuleAccessEntry `json:"modules"`
}

// Presets

func presetField(key, labelEn string, required bool, placeholder *string, secret bool) PresetField {
	return PresetField{Key: key, LabelEn: labelEn, Required: required, Secret: secret, Placeholder: placeholder}
}

var oidcClaims = ClaimMapping{Email: "email", Name: "name", Groups: "groups"}
var samlClaims = ClaimMapping{
	Email:  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
	Name:   "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
	Groups: "http://schemas.xmlsoap.org/claims/Group",
}
var entraSamlClaims = ClaimMapping{Email: samlClaims.Email, Name: samlClaims.Name, Groups: "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"}

const samlNote = "Signed assertions are always required."

// identityPresets mirrors IDENTITY_PRESETS exactly.
var identityPresets = []IdentityPreset{
	{
		ID: "entra_id_oidc", NameEn: "Microsoft Entra ID (OIDC)", Protocol: "oidc",
		Fields: []PresetField{
			presetField("directory_tenant_id", "Directory (tenant) ID", true, ptr("00000000-0000-0000-0000-000000000000"), false),
			presetField("client_id", "Application (client) ID", true, ptr("00000000-0000-0000-0000-000000000000"), false),
			presetField("client_secret", "Client secret", true, nil, true),
		},
		DefaultClaims: oidcClaims,
		NotesEn:       []string{"Send only the groups assigned to the application.", "Entra ID sends at most 200 groups in a token; above that it sends none.", "Groups are mapped by object ID."},
	},
	{
		ID: "entra_id_saml", NameEn: "Microsoft Entra ID (SAML)", Protocol: "saml",
		Fields: []PresetField{
			presetField("metadata_url", "App federation metadata URL", true, ptr("https://idp.example.com/federationmetadata.xml"), false),
			presetField("entity_id", "Entity ID", false, ptr("https://sts.example.com/"), false),
		},
		DefaultClaims: entraSamlClaims,
		NotesEn:       []string{"Send only the groups assigned to the application.", "Entra ID sends at most 150 groups in a SAML assertion; above that it sends none.", "Groups are mapped by object ID.", samlNote},
	},
	{
		ID: "adfs_saml", NameEn: "Microsoft ADFS (SAML)", Protocol: "saml",
		Fields: []PresetField{
			presetField("metadata_url", "Federation metadata URL", true, ptr("https://adfs.example.com/FederationMetadata/2007-06/FederationMetadata.xml"), false),
			presetField("entity_id", "Entity ID", false, ptr("http://adfs.example.com/adfs/services/trust"), false),
		},
		DefaultClaims: samlClaims,
		NotesEn:       []string{"Add a claim rule that sends the email, name and group claims.", samlNote},
	},
	{
		ID: "adfs_oidc", NameEn: "Microsoft ADFS (OIDC)", Protocol: "oidc",
		Fields: []PresetField{
			presetField("issuer_url", "ADFS issuer URL", true, ptr("https://adfs.example.com/adfs"), false),
			presetField("client_id", "Client ID", true, nil, false),
			presetField("client_secret", "Client secret", true, nil, true),
		},
		DefaultClaims: oidcClaims,
		NotesEn:       []string{"Add the groups claim to the application group in ADFS."},
	},
	{
		ID: "okta", NameEn: "Okta", Protocol: "oidc",
		Fields: []PresetField{
			presetField("okta_domain", "Okta domain", true, ptr("example.okta.com"), false),
			presetField("client_id", "Client ID", true, nil, false),
			presetField("client_secret", "Client secret", true, nil, true),
		},
		DefaultClaims: oidcClaims,
		NotesEn:       []string{"Add a groups claim to the authorization server."},
	},
	{
		ID: "google_workspace", NameEn: "Google Workspace", Protocol: "oidc",
		Fields: []PresetField{
			presetField("client_id", "Client ID", true, nil, false),
			presetField("client_secret", "Client secret", true, nil, true),
			presetField("hosted_domain", "Workspace domain", false, ptr("example.com"), false),
		},
		DefaultClaims: oidcClaims,
		NotesEn:       []string{"Groups need Cloud Identity group claims to be enabled."},
	},
	{
		ID: "ping_identity", NameEn: "Ping Identity", Protocol: "oidc",
		Fields: []PresetField{
			presetField("issuer_url", "Issuer URL", true, ptr("https://auth.example.com/as"), false),
			presetField("client_id", "Client ID", true, nil, false),
			presetField("client_secret", "Client secret", true, nil, true),
		},
		DefaultClaims: oidcClaims,
		NotesEn:       []string{"Map the groups attribute to the groups claim."},
	},
	{
		ID: "generic_oidc", NameEn: "Generic OIDC", Protocol: "oidc",
		Fields: []PresetField{
			presetField("issuer_url", "Issuer URL", true, ptr("https://idp.example.com/realms/example"), false),
			presetField("client_id", "Client ID", true, nil, false),
			presetField("client_secret", "Client secret", true, nil, true),
			presetField("scopes", "Scopes", false, ptr("openid email profile"), false),
		},
		DefaultClaims: oidcClaims,
		NotesEn:       []string{},
	},
	{
		ID: "generic_saml", NameEn: "Generic SAML 2.0", Protocol: "saml",
		Fields: []PresetField{
			presetField("sso_url", "Single sign-on URL", true, ptr("https://idp.example.com/sso"), false),
			presetField("entity_id", "Entity ID", true, ptr("https://idp.example.com/metadata"), false),
			presetField("signing_certificate", "Signing certificate", true, ptr("-----BEGIN CERTIFICATE-----"), false),
			presetField("name_id_format", "NameID format", false, ptr("persistent"), false),
			presetField("principal_type", "User identified by", false, ptr("subject"), false),
		},
		DefaultClaims: samlClaims,
		NotesEn:       []string{samlNote, "Keycloak checks the signature. OpenDispatch stores only the settings."},
	},
}

// ListIdentityProviderPresets: paginated.
func ListIdentityProviderPresets(ctx reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[IdentityPreset], error) {
	if err := reqctx.RequireAccess(ctx, moduleSignInIdentity, access.AccessView); err != nil {
		return datactx.PageResult[IdentityPreset]{}, err
	}
	return datactx.Paginate(identityPresets, query)
}

func identityPresetOf(id string) (*IdentityPreset, error) {
	for i := range identityPresets {
		if identityPresets[i].ID == id {
			return &identityPresets[i], nil
		}
	}
	return nil, dataerr.Invalid(fmt.Sprintf("Identity provider: unknown preset %s.", id))
}

// Providers

// MockProviderID: the labelled mock provider.
const MockProviderID = "mock-provider"

func mockProvider() IdentityProvider {
	return IdentityProvider{
		ID: MockProviderID, PresetID: "generic_oidc", DisplayName: "Mock provider (demo only)",
		Protocol: "oidc", IsEnabled: true, EmailDomains: []string{}, Config: map[string]string{},
		ClaimMapping: oidcClaims, HasSecret: false, SignedAssertionsRequired: true,
		ReadOnly: true, DataSource: "SYNTHETIC",
	}
}

var (
	identityMu          sync.Mutex
	providerStore       []IdentityProvider
	roleMappingStore    []RoleMapping
	roleMappingsSeeded  bool
	identityKnownZones  map[string]bool
	emergencyFailureKey = "auth.emergency_failures"
)

// ResetIdentityForTest clears this file's stores.
func ResetIdentityForTest() {
	identityMu.Lock()
	providerStore = nil
	roleMappingStore, roleMappingsSeeded = nil, false
	identityKnownZones = nil
	identityMu.Unlock()
}

// SeedIdentityZoneIDsForTest: the zone-id snapshot.
func SeedIdentityZoneIDsForTest(ids []string) {
	identityMu.Lock()
	identityKnownZones = make(map[string]bool, len(ids))
	for _, id := range ids {
		identityKnownZones[id] = true
	}
	identityMu.Unlock()
}

// RefreshIdentityZones: zones the rules may name.
func RefreshIdentityZones(goCtx context.Context, conn *tenancy.Connection, tenantID string) error {
	zones, err := allZones(goCtx, conn, tenantID)
	if err != nil {
		return err
	}
	ids := make([]string, len(zones))
	for i, z := range zones {
		ids[i] = z.ID
	}
	SeedIdentityZoneIDsForTest(ids)
	return nil
}

func knownIdentityZone(id string) bool {
	identityMu.Lock()
	defer identityMu.Unlock()
	return identityKnownZones[id]
}

func allProviderRowsMemory() []IdentityProvider {
	identityMu.Lock()
	out := make([]IdentityProvider, len(providerStore))
	copy(out, providerStore)
	identityMu.Unlock()
	return out
}

func oneProviderRowMemory(id string) *IdentityProvider {
	for _, p := range allProviderRowsMemory() {
		if p.ID == id {
			row := p
			return &row
		}
	}
	return nil
}

func upsertProviderRowMemory(p IdentityProvider) IdentityProvider {
	identityMu.Lock()
	defer identityMu.Unlock()
	for i, x := range providerStore {
		if x.ID == p.ID {
			providerStore[i] = p
			return p
		}
	}
	providerStore = append(providerStore, p)
	return p
}

func removeProviderRowMemory(id string) {
	identityMu.Lock()
	defer identityMu.Unlock()
	for i, x := range providerStore {
		if x.ID == id {
			providerStore = append(providerStore[:i], providerStore[i+1:]...)
			return
		}
	}
}

// allProviders: the mock provider, then stored ones.
func allProviders(ctx context.Context, tenant string, installMode access.InstallMode) ([]IdentityProvider, error) {
	stored, err := providerStoreBackend.all(ctx, tenant)
	if err != nil {
		return nil, err
	}
	out := make([]IdentityProvider, 0, len(stored)+1)
	out = append(out, mockProvider())
	connected := KeycloakConnected()
	for _, p := range stored {
		if installMode == access.InstallShared {
			p.ReadOnly = true
		}
		if !connected || p.SyncStatus == "" {
			p.SyncStatus, p.LastSyncAt, p.LastSyncError = SyncNotConfigured, nil, nil
		}
		out = append(out, p)
	}
	return out, nil
}

func findProvider(ctx context.Context, tenant string, installMode access.InstallMode, id string) (*IdentityProvider, error) {
	all, err := allProviders(ctx, tenant, installMode)
	if err != nil {
		return nil, err
	}
	for _, p := range all {
		if p.ID == id {
			row := p
			return &row, nil
		}
	}
	return nil, nil
}

// ListIdentityProviders: mock provider first.
func ListIdentityProviders(ctx reqctx.RequestContext, query datactx.PageQuery) (IdentityProviderPage, error) {
	if err := reqctx.RequireAccess(ctx, moduleSignInIdentity, access.AccessView); err != nil {
		return IdentityProviderPage{}, err
	}
	all, err := allProviders(context.Background(), ctx.CustomerID, ctx.InstallMode)
	if err != nil {
		return IdentityProviderPage{}, err
	}
	page, err := datactx.Paginate(all, query)
	if err != nil {
		return IdentityProviderPage{}, err
	}
	return IdentityProviderPage{Items: page.Items, Page: page.Page, KeycloakConnected: KeycloakConnected()}, nil
}

// GetIdentityProvider mirrors getIdentityProvider.
func GetIdentityProvider(ctx reqctx.RequestContext, providerID string) (IdentityProvider, error) {
	if err := reqctx.RequireAccess(ctx, moduleSignInIdentity, access.AccessView); err != nil {
		return IdentityProvider{}, err
	}
	if _, err := importutil.RequireCode(providerID, "Identity provider"); err != nil {
		return IdentityProvider{}, err
	}
	p, err := findProvider(context.Background(), ctx.CustomerID, ctx.InstallMode, providerID)
	if err != nil {
		return IdentityProvider{}, err
	}
	if p != nil {
		return *p, nil
	}
	return IdentityProvider{}, dataerr.NotFound("Identity provider not found.")
}

var hostnamePattern = regexp.MustCompile(`(?i)^(?:[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$`)

func dedupeLower(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, v := range values {
		lv := strings.ToLower(v)
		if !seen[lv] {
			seen[lv] = true
			out = append(out, lv)
		}
	}
	return out
}

func providerFromBody(body any, existing *IdentityProvider) (IdentityProvider, string, error) {
	p, secret, err := providerFromBodyRaw(body, existing)
	if err != nil {
		return IdentityProvider{}, "", err
	}
	if err := validateSAMLSettings(p); err != nil {
		return IdentityProvider{}, "", err
	}
	return p, secret, nil
}

func providerFromBodyRaw(body any, existing *IdentityProvider) (IdentityProvider, string, error) {
	input, err := datactx.Object(body, "Identity provider", []string{"preset_id", "display_name", "is_enabled", "email_domains", "config", "client_secret", "claim_mapping"})
	if err != nil {
		return IdentityProvider{}, "", err
	}
	presetID, err := datactx.String(input, "preset_id", datactx.StrOpts{HasMax: true, Max: 64})
	if err != nil {
		return IdentityProvider{}, "", err
	}
	preset, err := identityPresetOf(presetID)
	if err != nil {
		return IdentityProvider{}, "", err
	}
	rawConfig := datactx.Obj{}
	if datactx.Has(input, "config") {
		rawConfig, err = datactx.Object(input["config"], "Identity provider config", nil)
		if err != nil {
			return IdentityProvider{}, "", err
		}
	}
	config := map[string]string{}
	for key, value := range rawConfig {
		var known *PresetField
		for i := range preset.Fields {
			if preset.Fields[i].Key == key && !preset.Fields[i].Secret {
				known = &preset.Fields[i]
				break
			}
		}
		if known == nil {
			return IdentityProvider{}, "", dataerr.Invalid(fmt.Sprintf("Identity provider: %s is not a setting of the %s preset.", key, preset.NameEn))
		}
		s, ok := value.(string)
		if !ok || len(s) > 8192 {
			return IdentityProvider{}, "", dataerr.Invalid(fmt.Sprintf("Identity provider: %s must be text of at most 8192 characters.", key))
		}
		config[key] = s
	}
	for _, f := range preset.Fields {
		if f.Required && !f.Secret && strings.TrimSpace(config[f.Key]) == "" {
			return IdentityProvider{}, "", dataerr.Invalid(fmt.Sprintf("Identity provider: %s is required.", f.LabelEn))
		}
	}
	var secretField *PresetField
	for i := range preset.Fields {
		if preset.Fields[i].Secret {
			secretField = &preset.Fields[i]
			break
		}
	}
	secretGiven, secret := false, ""
	if datactx.Has(input, "client_secret") {
		s, err := datactx.String(input, "client_secret", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 512})
		if err != nil {
			return IdentityProvider{}, "", err
		}
		secretGiven = s != ""
		if secretField != nil {
			secret = s
		}
	}
	existingHasSecret := existing != nil && existing.HasSecret
	if secretField != nil && !secretGiven && !existingHasSecret && secretField.Required {
		return IdentityProvider{}, "", dataerr.Invalid(fmt.Sprintf("Identity provider: %s is required.", secretField.LabelEn))
	}
	var emailDomains []string
	if datactx.Has(input, "email_domains") {
		emailDomains, err = datactx.StringList(input, "email_domains", datactx.ListOpts{HasMax: true, Max: 253})
		if err != nil {
			return IdentityProvider{}, "", err
		}
	}
	for _, d := range emailDomains {
		if !hostnamePattern.MatchString(d) {
			return IdentityProvider{}, "", dataerr.Invalid(fmt.Sprintf("Identity provider: %s is not a domain name.", d))
		}
	}
	claimMapping := preset.DefaultClaims
	if datactx.Has(input, "claim_mapping") {
		claimsInput, err := datactx.Object(input["claim_mapping"], "Claim mapping", []string{"email", "name", "groups"})
		if err != nil {
			return IdentityProvider{}, "", err
		}
		email, err := datactx.String(claimsInput, "email", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 128})
		if err != nil {
			return IdentityProvider{}, "", err
		}
		name, err := datactx.String(claimsInput, "name", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 128})
		if err != nil {
			return IdentityProvider{}, "", err
		}
		groups, err := datactx.String(claimsInput, "groups", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 128})
		if err != nil {
			return IdentityProvider{}, "", err
		}
		claimMapping = ClaimMapping{Email: email, Name: name, Groups: groups}
	}
	displayName, err := datactx.String(input, "display_name", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 120})
	if err != nil {
		return IdentityProvider{}, "", err
	}
	isEnabled, err := datactx.Bool(input, "is_enabled")
	if err != nil {
		return IdentityProvider{}, "", err
	}
	id := preset.ID + "-" + datactx.NewID()[:8]
	if existing != nil {
		id = existing.ID
	}
	hasSecret := false
	if secretField != nil {
		hasSecret = secretGiven || existingHasSecret
	}
	provider := IdentityProvider{
		ID: id, PresetID: preset.ID, DisplayName: displayName, Protocol: preset.Protocol,
		IsEnabled: isEnabled, EmailDomains: dedupeLower(emailDomains), Config: config,
		ClaimMapping: claimMapping, HasSecret: hasSecret, SignedAssertionsRequired: true,
		ReadOnly: false, DataSource: recordsource.Get(),
	}
	if existing != nil {
		provider.LastTestAt = existing.LastTestAt
		provider.LastTestOk = existing.LastTestOk
	}
	return provider, secret, nil
}

// CreateIdentityProvider: from a preset.
func CreateIdentityProvider(ctx reqctx.RequestContext, body any) (IdentityProvider, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleSignInIdentity}, auditlog.WriteMeta{Action: "identity_provider.created", EntityType: "identity_provider"}, func(uctx context.Context) (auditlog.AuditedWrite[IdentityProvider], error) {
		provider, secret, err := providerFromBody(body, nil)
		if err != nil {
			return auditlog.AuditedWrite[IdentityProvider]{}, err
		}
		applySync(&provider, secret)
		if err := saveProvider(uctx, ctx.CustomerID, provider); err != nil {
			return auditlog.AuditedWrite[IdentityProvider]{}, err
		}
		id := provider.ID
		detail := syncDetail(provider)
		detail["preset_id"], detail["protocol"] = provider.PresetID, provider.Protocol
		return auditlog.AuditedWrite[IdentityProvider]{
			Result: provider, EntityID: &id,
			SummaryEn: fmt.Sprintf("Identity provider %s added (%s).", provider.DisplayName, provider.PresetID),
			Detail:    detail,
		}, nil
	})
}

// UpdateIdentityProvider: same preset, new settings.
func UpdateIdentityProvider(ctx reqctx.RequestContext, providerID string, body any) (IdentityProvider, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleSignInIdentity}, auditlog.WriteMeta{Action: "identity_provider.updated", EntityType: "identity_provider", EntityID: &providerID}, func(uctx context.Context) (auditlog.AuditedWrite[IdentityProvider], error) {
		if _, err := importutil.RequireCode(providerID, "Identity provider"); err != nil {
			return auditlog.AuditedWrite[IdentityProvider]{}, err
		}
		if providerID == MockProviderID {
			return auditlog.AuditedWrite[IdentityProvider]{}, dataerr.Conflict("The mock provider cannot be changed.")
		}
		existing, err := providerStoreBackend.one(uctx, ctx.CustomerID, providerID)
		if err != nil {
			return auditlog.AuditedWrite[IdentityProvider]{}, err
		}
		if existing == nil {
			return auditlog.AuditedWrite[IdentityProvider]{}, dataerr.NotFound("Identity provider not found.")
		}
		provider, secret, err := providerFromBody(body, existing)
		if err != nil {
			return auditlog.AuditedWrite[IdentityProvider]{}, err
		}
		if provider.PresetID != existing.PresetID {
			return auditlog.AuditedWrite[IdentityProvider]{}, dataerr.Invalid("Identity provider: the preset cannot be changed; add a new provider.")
		}
		applySync(&provider, secret)
		if err := saveProvider(uctx, ctx.CustomerID, provider); err != nil {
			return auditlog.AuditedWrite[IdentityProvider]{}, err
		}
		detail := syncDetail(provider)
		detail["is_enabled"] = provider.IsEnabled
		return auditlog.AuditedWrite[IdentityProvider]{
			Result: provider, SummaryEn: fmt.Sprintf("Identity provider %s updated.", provider.DisplayName),
			Detail: detail,
		}, nil
	})
}

// DeleteIdentityProvider: refused if a rule uses it.
func DeleteIdentityProvider(ctx reqctx.RequestContext, providerID string) error {
	_, err := auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleSignInIdentity}, auditlog.WriteMeta{Action: "identity_provider.deleted", EntityType: "identity_provider", EntityID: &providerID}, func(uctx context.Context) (auditlog.AuditedWrite[struct{}], error) {
		if _, err := importutil.RequireCode(providerID, "Identity provider"); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		if providerID == MockProviderID {
			return auditlog.AuditedWrite[struct{}]{}, dataerr.Conflict("The mock provider cannot be removed.")
		}
		existing, err := providerStoreBackend.one(uctx, ctx.CustomerID, providerID)
		if err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		if existing == nil {
			return auditlog.AuditedWrite[struct{}]{}, dataerr.NotFound("Identity provider not found.")
		}
		mappings, err := allRoleMappings(uctx, ctx.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		for _, m := range mappings {
			if m.IdentityProviderID != nil && *m.IdentityProviderID == providerID {
				return auditlog.AuditedWrite[struct{}]{}, dataerr.Conflict("Remove the group rules of this provider first.")
			}
		}
		if err := deleteFromKeycloak(providerID); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, dataerr.Conflict("Keycloak could not remove the provider: " + syncReason(err, ""))
		}
		if err := providerStoreBackend.remove(uctx, ctx.CustomerID, providerID); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		return auditlog.AuditedWrite[struct{}]{SummaryEn: fmt.Sprintf("Identity provider %s removed.", existing.DisplayName),
			Detail: map[string]any{"keycloak_removed": KeycloakConnected()}}, nil
	})
	return err
}

func referenceCode(prefix string, seed string, length int) string {
	sum := sha256.Sum256([]byte(seed))
	hexSum := strings.ToUpper(hex.EncodeToString(sum[:]))
	if length > len(hexSum) {
		length = len(hexSum)
	}
	return prefix + "-" + hexSum[:length]
}

// RequestIdentityProviderChange: DG5.
func RequestIdentityProviderChange(ctx reqctx.RequestContext, body any) (IdentityProviderChangeReceipt, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{Func: func() error {
		return reqctx.RequireAccess(ctx, moduleSignInIdentity, access.AccessView)
	}}, auditlog.WriteMeta{Action: "identity.change_requested", EntityType: "identity_provider"}, func(uctx context.Context) (auditlog.AuditedWrite[IdentityProviderChangeReceipt], error) {
		input, err := datactx.Object(body, "Change request", []string{"provider_id", "change"})
		if err != nil {
			return auditlog.AuditedWrite[IdentityProviderChangeReceipt]{}, err
		}
		var providerID *string
		if v, ok := input["provider_id"]; ok && v != nil {
			s, ok := v.(string)
			if !ok {
				return auditlog.AuditedWrite[IdentityProviderChangeReceipt]{}, dataerr.Invalid("Change request: provider_id must be a string.")
			}
			code, err := importutil.RequireCode(s, "Identity provider")
			if err != nil {
				return auditlog.AuditedWrite[IdentityProviderChangeReceipt]{}, err
			}
			if len(code) > 128 {
				return auditlog.AuditedWrite[IdentityProviderChangeReceipt]{}, dataerr.Invalid("Change request: provider_id is too long.")
			}
			known, err := findProvider(uctx, ctx.CustomerID, ctx.InstallMode, code)
			if err != nil {
				return auditlog.AuditedWrite[IdentityProviderChangeReceipt]{}, err
			}
			if known == nil {
				return auditlog.AuditedWrite[IdentityProviderChangeReceipt]{}, dataerr.NotFound("Identity provider not found.")
			}
			providerID = &code
		}
		change, err := datactx.String(input, "change", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 1000})
		if err != nil {
			return auditlog.AuditedWrite[IdentityProviderChangeReceipt]{}, err
		}
		requestedAt := datactx.NowISO()
		pidForSeed := ""
		if providerID != nil {
			pidForSeed = *providerID
		}
		reference := referenceCode("CHG", fmt.Sprintf("%s|%s|%s|%s", ctx.UserID, requestedAt, pidForSeed, change), 8)
		notifyRole(uctx, ctx, access.RoleAdministrator, "security", "info", RaisedNotification{
			TitleEn:  "Identity provider change requested",
			BodyEn:   ptr(fmt.Sprintf("A change to the identity providers was requested. Reference %s.", reference)),
			LinkPath: ptr("/admin/sign-in-identity"),
		})
		return auditlog.AuditedWrite[IdentityProviderChangeReceipt]{
			Result: IdentityProviderChangeReceipt{RequestedAt: requestedAt, ReferenceCode: reference}, EntityID: providerID,
			SummaryEn: fmt.Sprintf("Change to the identity providers requested (%s).", reference),
			Detail:    map[string]any{"reference_code": reference, "provider_id": providerID, "change": change},
		}, nil
	})
}

// TestIdentityProviderConnection: scripted.
func TestIdentityProviderConnection(ctx reqctx.RequestContext, providerID string) (ConnectionTestResult, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleSignInIdentity}, auditlog.WriteMeta{Action: "identity_provider.tested", EntityType: "identity_provider", EntityID: &providerID}, func(uctx context.Context) (auditlog.AuditedWrite[ConnectionTestResult], error) {
		if _, err := importutil.RequireCode(providerID, "Identity provider"); err != nil {
			return auditlog.AuditedWrite[ConnectionTestResult]{}, err
		}
		provider, err := findProvider(uctx, ctx.CustomerID, ctx.InstallMode, providerID)
		if err != nil {
			return auditlog.AuditedWrite[ConnectionTestResult]{}, err
		}
		if provider == nil {
			return auditlog.AuditedWrite[ConnectionTestResult]{}, dataerr.NotFound("Identity provider not found.")
		}
		preset, err := identityPresetOf(provider.PresetID)
		if err != nil {
			return auditlog.AuditedWrite[ConnectionTestResult]{}, err
		}
		filled := provider.ID == MockProviderID
		if !filled {
			filled = true
			for _, f := range preset.Fields {
				if f.Required && !f.Secret && strings.TrimSpace(provider.Config[f.Key]) == "" {
					filled = false
					break
				}
			}
		}
		invalid := false
		for _, v := range provider.Config {
			if strings.Contains(strings.ToLower(v), "invalid") {
				invalid = true
				break
			}
		}
		checkedAt := datactx.NowISO()
		var reachMsg, discoveryMsg, clientMsg *string
		if filled {
			if invalid {
				reachMsg = ptr("The provider address did not answer.")
			}
		} else {
			reachMsg = ptr("A required setting is empty.")
		}
		clientOK := provider.ID == MockProviderID || provider.HasSecret
		if !clientOK {
			clientMsg = ptr("No client secret was given.")
		}
		var steps []ConnectionTestStep
		if KeycloakConnected() && provider.ID != MockProviderID {
			steps = keycloakTestSteps(*provider)
		} else if provider.Protocol == "oidc" {
			steps = []ConnectionTestStep{
				{Code: "reach", Name: "Reach the provider", OK: filled && !invalid, Message: reachMsg},
				{Code: "discovery", Name: "Read the discovery document", OK: filled && !invalid, Message: discoveryMsg},
				{Code: "client", Name: "Check the client", OK: clientOK, Message: clientMsg},
				{Code: "claims", Name: "Find the email, name and groups claims", OK: filled && !invalid, Message: nil},
			}
		} else {
			steps = []ConnectionTestStep{
				{Code: "reach", Name: "Reach the provider", OK: filled && !invalid, Message: reachMsg},
				{Code: "saml", Name: "Read the SAML settings", OK: filled && !invalid, Message: nil},
				{Code: "signed", Name: "Signed assertions are required", OK: true, Message: nil},
				{Code: "attrs", Name: "Find the email, name and groups attributes", OK: filled && !invalid, Message: nil},
			}
		}
		ok := true
		for _, s := range steps {
			if !s.OK {
				ok = false
				break
			}
		}
		var ref *string
		if !ok {
			ref = ptr(referenceCode("IDP", provider.ID, 6))
		}
		result := ConnectionTestResult{OK: ok, CheckedAt: checkedAt, ReferenceCode: ref, Steps: steps}
		if provider.ID != MockProviderID {
			updated := *provider
			if stored, err := providerStoreBackend.one(uctx, ctx.CustomerID, provider.ID); err == nil && stored != nil {
				updated = *stored
			}
			updated.ReadOnly, updated.LastTestAt, updated.LastTestOk = false, &checkedAt, &ok
			if err := saveProvider(uctx, ctx.CustomerID, updated); err != nil {
				return auditlog.AuditedWrite[ConnectionTestResult]{}, err
			}
		}
		status := "failed"
		if ok {
			status = "passed"
		}
		return auditlog.AuditedWrite[ConnectionTestResult]{Result: result, SummaryEn: fmt.Sprintf("Connection test for %s: %s.", provider.DisplayName, status), Detail: map[string]any{"ok": ok}}, nil
	})
}

// Group-to-role rules and the preview

var matchTypes = []string{"exact", "object_id", "prefix"}
var guidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// seedRoleMappingsLocked loads the fixture rules once; identityMu held.
func seedRoleMappingsLocked() {
	if roleMappingsSeeded {
		return
	}
	roleMappingsSeeded = true
	if rows, err := fixtures.Records[RoleMapping]("RoleMapping"); err == nil {
		roleMappingStore = rows
	}
}

func byMappingPriority(rows []RoleMapping) {
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Priority != rows[j].Priority {
			return rows[i].Priority < rows[j].Priority
		}
		return rows[i].ID < rows[j].ID
	})
}

// ListRoleMappings mirrors listRoleMappings.
func ListRoleMappings(ctx reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[RoleMapping], error) {
	if err := reqctx.RequireAccess(ctx, moduleSignInIdentity, access.AccessView); err != nil {
		return datactx.PageResult[RoleMapping]{}, err
	}
	rows, err := allRoleMappings(context.Background(), ctx.CustomerID)
	if err != nil {
		return datactx.PageResult[RoleMapping]{}, err
	}
	byMappingPriority(rows)
	return datactx.Paginate(rows, query)
}

func maxMappingPriority(ctx context.Context, tenantID string) (int, error) {
	max := 0
	rows, err := allRoleMappings(ctx, tenantID)
	if err != nil {
		return 0, err
	}
	for _, m := range rows {
		if m.Priority > max {
			max = m.Priority
		}
	}
	return max, nil
}

func mappingFromBody(cx context.Context, ctx reqctx.RequestContext, body any, existing *RoleMapping) (RoleMapping, error) {
	input, err := datactx.Object(body, "Group rule", []string{"identity_provider_id", "group_match", "group_match_type", "assigned_role", "zone_ids", "priority", "is_enabled"})
	if err != nil {
		return RoleMapping{}, err
	}
	role, err := datactx.EnumOf(input, "assigned_role", access.Roles)
	if err != nil {
		return RoleMapping{}, err
	}
	inMode := false
	for _, r := range access.RolesForInstallMode(ctx.InstallMode) {
		if r == role {
			inMode = true
			break
		}
	}
	if !inMode {
		return RoleMapping{}, dataerr.Invalid(fmt.Sprintf("Group rule: %s does not exist in a %s install.", role, ctx.InstallMode))
	}
	matchType, err := datactx.EnumOf(input, "group_match_type", matchTypes)
	if err != nil {
		return RoleMapping{}, err
	}
	match, err := datactx.String(input, "group_match", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 256})
	if err != nil {
		return RoleMapping{}, err
	}
	if matchType == "object_id" && !guidPattern.MatchString(match) {
		return RoleMapping{}, dataerr.Invalid("Group rule: an object ID must be a GUID.")
	}
	var providerID *string
	if v, ok := input["identity_provider_id"]; ok && v != nil {
		s, err := datactx.String(input, "identity_provider_id", datactx.StrOpts{HasMax: true, Max: 128})
		if err != nil {
			return RoleMapping{}, err
		}
		providerID = &s
	}
	if providerID != nil {
		found, err := findProvider(cx, ctx.CustomerID, ctx.InstallMode, *providerID)
		if err != nil {
			return RoleMapping{}, err
		}
		if found == nil {
			return RoleMapping{}, dataerr.NotFound("Identity provider not found.")
		}
	}
	zones := []string{}
	if access.ScopeAppliesTo(role) == access.ScopeAssignedZones {
		zones, err = datactx.UUIDList(input, "zone_ids", true)
		if err != nil {
			return RoleMapping{}, err
		}
		if len(zones) == 0 {
			return RoleMapping{}, dataerr.Invalid("Group rule: a role with assigned zones needs at least one zone.")
		}
		for _, id := range zones {
			if !knownIdentityZone(id) {
				return RoleMapping{}, dataerr.Invalid(fmt.Sprintf("Group rule: zone %s does not exist.", id))
			}
		}
	}
	priority, hasPriority, err := datactx.OptInt(input, "priority", datactx.NumOpts{HasMin: true, Min: 1})
	if err != nil {
		return RoleMapping{}, err
	}
	if !hasPriority {
		if existing != nil {
			priority = existing.Priority
		} else {
			top, err := maxMappingPriority(cx, ctx.CustomerID)
			if err != nil {
				return RoleMapping{}, err
			}
			priority = top + 1
		}
	}
	isEnabled, hasEnabled, err := datactx.OptBool(input, "is_enabled")
	if err != nil {
		return RoleMapping{}, err
	}
	if !hasEnabled {
		isEnabled = true
	}
	at := datactx.NowISO()
	base := datactx.NewRecord(ctx, "", at)
	if existing != nil {
		base = existing.BaseRecord
		base.UpdatedAt = at
	}
	return RoleMapping{
		BaseRecord: base, IdentityProviderID: providerID, GroupMatch: match, GroupMatchType: matchType,
		AssignedRole: role, ZoneIDs: zones, Priority: priority, IsEnabled: isEnabled,
	}, nil
}

// CreateRoleMapping mirrors createRoleMapping.
func CreateRoleMapping(ctx reqctx.RequestContext, body any) (RoleMapping, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleSignInIdentity}, auditlog.WriteMeta{Action: "role_mapping.created", EntityType: "role_mapping"}, func(uctx context.Context) (auditlog.AuditedWrite[RoleMapping], error) {
		mapping, err := mappingFromBody(uctx, ctx, body, nil)
		if err != nil {
			return auditlog.AuditedWrite[RoleMapping]{}, err
		}
		if err := saveRoleMapping(uctx, mapping); err != nil {
			return auditlog.AuditedWrite[RoleMapping]{}, err
		}
		id := mapping.ID
		return auditlog.AuditedWrite[RoleMapping]{
			Result: mapping, EntityID: &id,
			SummaryEn: fmt.Sprintf("Group rule for %s created (%s).", mapping.GroupMatch, mapping.AssignedRole),
			Detail:    map[string]any{"assigned_role": mapping.AssignedRole, "zone_ids": mapping.ZoneIDs},
		}, nil
	})
}

// UpdateRoleMapping mirrors updateRoleMapping.
func UpdateRoleMapping(ctx reqctx.RequestContext, id string, body any) (RoleMapping, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleSignInIdentity}, auditlog.WriteMeta{Action: "role_mapping.updated", EntityType: "role_mapping", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[RoleMapping], error) {
		if _, err := importutil.RequireID(id, "Group rule"); err != nil {
			return auditlog.AuditedWrite[RoleMapping]{}, err
		}
		existing, err := oneRoleMapping(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[RoleMapping]{}, err
		}
		if existing == nil {
			return auditlog.AuditedWrite[RoleMapping]{}, dataerr.NotFound("Group rule not found.")
		}
		mapping, err := mappingFromBody(uctx, ctx, body, existing)
		if err != nil {
			return auditlog.AuditedWrite[RoleMapping]{}, err
		}
		if err := saveRoleMapping(uctx, mapping); err != nil {
			return auditlog.AuditedWrite[RoleMapping]{}, err
		}
		return auditlog.AuditedWrite[RoleMapping]{
			Result: mapping, SummaryEn: fmt.Sprintf("Group rule for %s updated (%s).", mapping.GroupMatch, mapping.AssignedRole),
			Detail: map[string]any{"assigned_role": mapping.AssignedRole, "zone_ids": mapping.ZoneIDs},
		}, nil
	})
}

// DeleteRoleMapping mirrors deleteRoleMapping.
func DeleteRoleMapping(ctx reqctx.RequestContext, id string) error {
	_, err := auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleSignInIdentity}, auditlog.WriteMeta{Action: "role_mapping.deleted", EntityType: "role_mapping", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[struct{}], error) {
		if _, err := importutil.RequireID(id, "Group rule"); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		existing, err := oneRoleMapping(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		if existing == nil {
			return auditlog.AuditedWrite[struct{}]{}, dataerr.NotFound("Group rule not found.")
		}
		if err := deleteRoleMapping(uctx, ctx.CustomerID, id); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		return auditlog.AuditedWrite[struct{}]{SummaryEn: fmt.Sprintf("Group rule for %s deleted.", existing.GroupMatch)}, nil
	})
	return err
}

func groupMatches(m RoleMapping, groups []string) bool {
	for _, g := range groups {
		switch m.GroupMatchType {
		case "exact":
			if g == m.GroupMatch {
				return true
			}
		case "object_id":
			if strings.EqualFold(g, m.GroupMatch) {
				return true
			}
		case "prefix":
			if strings.HasPrefix(g, m.GroupMatch) {
				return true
			}
		}
	}
	return false
}

// resolveRoleFromGroups: no match, no role.
func resolveRoleFromGroups(ctx context.Context, tenantID string, installMode access.InstallMode, groups []string, providerID *string) (RoleMappingPreview, error) {
	var usable []RoleMapping
	allowedRoles := access.RolesForInstallMode(installMode)
	rules, err := allRoleMappings(ctx, tenantID)
	if err != nil {
		return RoleMappingPreview{}, err
	}
	for _, m := range rules {
		if !m.IsEnabled {
			continue
		}
		keep := m.IdentityProviderID == nil
		if !keep && providerID != nil && *m.IdentityProviderID == *providerID {
			keep = true
		}
		if !keep {
			continue
		}
		roleInMode := false
		for _, r := range allowedRoles {
			if r == m.AssignedRole {
				roleInMode = true
				break
			}
		}
		if !roleInMode {
			continue
		}
		usable = append(usable, m)
	}
	byMappingPriority(usable)
	var matched []RoleMapping
	for _, m := range usable {
		if groupMatches(m, groups) {
			matched = append(matched, m)
		}
	}
	if len(matched) == 0 {
		return RoleMappingPreview{ZoneIDs: []string{}, MatchedMappingIDs: []string{}}, nil
	}
	first := matched[0]
	zoneIDs := []string{}
	if access.ScopeAppliesTo(first.AssignedRole) == access.ScopeAssignedZones {
		seen := map[string]bool{}
		for _, m := range matched {
			if m.AssignedRole != first.AssignedRole {
				continue
			}
			for _, z := range m.ZoneIDs {
				if !seen[z] {
					seen[z] = true
					zoneIDs = append(zoneIDs, z)
				}
			}
		}
	}
	ids := make([]string, len(matched))
	for i, m := range matched {
		ids[i] = m.ID
	}
	role := first.AssignedRole
	return RoleMappingPreview{AssignedRole: &role, ZoneIDs: zoneIDs, MatchedMappingIDs: ids}, nil
}

// PreviewRoleMappings: read only despite POST.
func PreviewRoleMappings(ctx reqctx.RequestContext, body any) (RoleMappingPreview, error) {
	if err := reqctx.RequireAccess(ctx, moduleSignInIdentity, access.AccessView); err != nil {
		return RoleMappingPreview{}, err
	}
	input, err := datactx.Object(body, "Role preview", []string{"identity_provider_id", "groups"})
	if err != nil {
		return RoleMappingPreview{}, err
	}
	groups, err := datactx.StringList(input, "groups", datactx.ListOpts{HasMax: true, Max: 256})
	if err != nil {
		return RoleMappingPreview{}, err
	}
	var providerID *string
	if v, ok := input["identity_provider_id"]; ok && v != nil {
		s, err := datactx.String(input, "identity_provider_id", datactx.StrOpts{HasMax: true, Max: 128})
		if err != nil {
			return RoleMappingPreview{}, err
		}
		providerID = &s
	}
	return resolveRoleFromGroups(context.Background(), ctx.CustomerID, ctx.InstallMode, groups, providerID)
}

// Sign-in policy

var defaultSignInPolicy = SignInPolicy{
	ForceSSOEmailDomains: []string{"demo.example"}, RequireMFAClaim: false,
	AllowLocalUsersForOutsiders: false, EmergencyAdminEnabled: true,
}

func readSignInPolicy(ctx context.Context, tenant string) (SignInPolicy, error) {
	var p SignInPolicy
	var err error
	if p.ForceSSOEmailDomains, err = readSettingStrict(ctx, tenant, "auth.force_sso_email_domains", defaultSignInPolicy.ForceSSOEmailDomains); err != nil {
		return p, err
	}
	if p.RequireMFAClaim, err = readSettingStrict(ctx, tenant, "auth.require_mfa_claim", defaultSignInPolicy.RequireMFAClaim); err != nil {
		return p, err
	}
	if p.AllowLocalUsersForOutsiders, err = readSettingStrict(ctx, tenant, "auth.local_users_for_outsiders", defaultSignInPolicy.AllowLocalUsersForOutsiders); err != nil {
		return p, err
	}
	p.EmergencyAdminEnabled, err = readSettingStrict(ctx, tenant, "auth.emergency_admin_enabled", defaultSignInPolicy.EmergencyAdminEnabled)
	return p, err
}

// GetSignInPolicy mirrors getSignInPolicy.
func GetSignInPolicy(ctx reqctx.RequestContext) (SignInPolicy, error) {
	if err := reqctx.RequireAccess(ctx, moduleSignInIdentity, access.AccessView); err != nil {
		return SignInPolicy{}, err
	}
	return readSignInPolicy(context.Background(), ctx.CustomerID)
}

// UpdateSignInPolicy mirrors updateSignInPolicy.
func UpdateSignInPolicy(ctx reqctx.RequestContext, body any) (SignInPolicy, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleSignInIdentity}, auditlog.WriteMeta{Action: "sign_in_policy.updated", EntityType: "setting", EntityID: ptr("sign_in_policy")}, func(uctx context.Context) (auditlog.AuditedWrite[SignInPolicy], error) {
		input, err := datactx.Object(body, "Sign-in policy", []string{"force_sso_email_domains", "require_mfa_claim", "allow_local_users_for_outsiders", "emergency_admin_enabled"})
		if err != nil {
			return auditlog.AuditedWrite[SignInPolicy]{}, err
		}
		domains, err := datactx.StringList(input, "force_sso_email_domains", datactx.ListOpts{HasMax: true, Max: 253})
		if err != nil {
			return auditlog.AuditedWrite[SignInPolicy]{}, err
		}
		for _, d := range domains {
			if !hostnamePattern.MatchString(d) {
				return auditlog.AuditedWrite[SignInPolicy]{}, dataerr.Invalid(fmt.Sprintf("Sign-in policy: %s is not a domain name.", d))
			}
		}
		requireMFA, err := datactx.Bool(input, "require_mfa_claim")
		if err != nil {
			return auditlog.AuditedWrite[SignInPolicy]{}, err
		}
		allowLocal, err := datactx.Bool(input, "allow_local_users_for_outsiders")
		if err != nil {
			return auditlog.AuditedWrite[SignInPolicy]{}, err
		}
		emergencyEnabled, err := datactx.Bool(input, "emergency_admin_enabled")
		if err != nil {
			return auditlog.AuditedWrite[SignInPolicy]{}, err
		}
		before, err := readSignInPolicy(uctx, ctx.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[SignInPolicy]{}, err
		}
		policy := SignInPolicy{ForceSSOEmailDomains: dedupeLower(domains), RequireMFAClaim: requireMFA, AllowLocalUsersForOutsiders: allowLocal, EmergencyAdminEnabled: emergencyEnabled}
		if err := settingsstore.PutMany(uctx, ctx.CustomerID,
			settingsstore.KV{Key: "auth.force_sso_email_domains", Value: policy.ForceSSOEmailDomains},
			settingsstore.KV{Key: "auth.require_mfa_claim", Value: policy.RequireMFAClaim},
			settingsstore.KV{Key: "auth.local_users_for_outsiders", Value: policy.AllowLocalUsersForOutsiders},
			settingsstore.KV{Key: "auth.emergency_admin_enabled", Value: policy.EmergencyAdminEnabled}); err != nil {
			return auditlog.AuditedWrite[SignInPolicy]{}, err
		}
		return auditlog.AuditedWrite[SignInPolicy]{Result: policy, SummaryEn: "Sign-in policy updated.", Detail: map[string]any{"from": before, "to": policy}}, nil
	})
}

// Sign-in events

// providerErrorSubject: DG13's scripted failure.
const providerErrorSubject = "provider.error"

var slugPattern = regexp.MustCompile(`[^a-z0-9]+`)
var slugTrimPattern = regexp.MustCompile(`^\.+|\.+$`)

func slugEmail(subject string) string {
	if strings.Contains(subject, "@") {
		return subject
	}
	slug := slugPattern.ReplaceAllString(strings.ToLower(subject), ".")
	slug = slugTrimPattern.ReplaceAllString(slug, "")
	if slug == "" {
		slug = "user"
	}
	return slug + "@mock-idp.example"
}

// MockSignIn: demo only. Pre-session.
func MockSignIn(pre reqctx.PreSessionContext, body any) (SignInResult, error) {
	if err := datactx.RequirePreSession(pre); err != nil {
		return SignInResult{}, err
	}
	input, err := datactx.Object(body, "Mock sign-in", []string{"provider_id", "subject", "groups"})
	if err != nil {
		return SignInResult{}, err
	}
	providerID, err := datactx.String(input, "provider_id", datactx.StrOpts{HasMax: true, Max: 128})
	if err != nil {
		return SignInResult{}, err
	}
	subject, err := datactx.String(input, "subject", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 128})
	if err != nil {
		return SignInResult{}, err
	}
	groups, err := datactx.StringList(input, "groups", datactx.ListOpts{HasMax: true, Max: 256})
	if err != nil {
		return SignInResult{}, err
	}
	reference := referenceCode("ODP", fmt.Sprintf("%s|%s|%s", providerID, subject, strings.Join(groups, ",")), 8)
	audit := func(outcome, summary string, userID *string, detail map[string]any) {
		eid := subject
		if userID != nil {
			eid = *userID
		}
		merged := map[string]any{"provider_id": providerID}
		for k, v := range detail {
			merged[k] = v
		}
		_, _ = auditlog.RecordAudit(pre, auditlog.AuditInput{
			Action: "auth.mock_sign_in", EntityType: "user", EntityID: &eid, SummaryEn: summary,
			Outcome: outcome, ActorType: "demo", ActorUserID: userID, ActorUserIDGiven: true, Detail: merged,
		}, "", "")
	}

	if strings.ToLower(subject) == providerErrorSubject {
		audit("failure", fmt.Sprintf("Sign-in through %s failed: the provider returned an error (scripted by the subject %s).", providerID, providerErrorSubject), nil, map[string]any{"scripted": true})
		return SignInResult{Outcome: "error", IsMock: true, ZoneIDs: []string{}, ReferenceCode: &reference}, nil
	}
	provider, err := findProvider(context.Background(), pre.CustomerID, pre.InstallMode, providerID)
	if err != nil {
		return SignInResult{}, err
	}
	if provider == nil || !provider.IsEnabled {
		audit("failure", fmt.Sprintf("Sign-in through %s refused: the provider is unknown or switched off.", providerID), nil, nil)
		return SignInResult{Outcome: "refused_by_provider", IsMock: true, ReferenceCode: &reference}, nil
	}
	var resolveProviderID *string
	if providerID != MockProviderID {
		resolveProviderID = &providerID
	}
	resolved, err := resolveRoleFromGroups(context.Background(), pre.CustomerID, pre.InstallMode, groups, resolveProviderID)
	if err != nil {
		return SignInResult{}, err
	}
	if resolved.AssignedRole == nil {
		audit("denied", fmt.Sprintf("Sign-in of %s refused: no group rule matches.", subject), nil, map[string]any{"groups": len(groups)})
		return SignInResult{Outcome: "no_role_assigned", IsMock: true, ZoneIDs: []string{}, ReferenceCode: &reference}, nil
	}
	email := slugEmail(subject)
	var existing *User
	userRows, err := allUsers(context.Background(), pre.CustomerID)
	if err != nil {
		return SignInResult{}, err
	}
	for _, u := range userRows {
		if (u.KeycloakSubject != nil && *u.KeycloakSubject == subject) || strings.EqualFold(u.Email, email) {
			row := u
			existing = &row
			break
		}
	}
	if existing != nil && existing.Status == "disabled" {
		id := existing.ID
		audit("denied", fmt.Sprintf("Sign-in of %s refused: the account is disabled.", existing.DisplayName), &id, nil)
		return SignInResult{Outcome: "locked", IsMock: true, UserID: &id, ZoneIDs: []string{}, ReferenceCode: &reference}, nil
	}
	at := datactx.NowISO()
	var user User
	created := existing == nil
	if created {
		subj := subject
		displayName := subject
		if strings.Contains(subject, "@") {
			displayName = strings.SplitN(subject, "@", 2)[0]
		}
		user = User{
			BaseRecord: datactx.NewRecordPreSession(pre, "", at), KeycloakSubject: &subj, Email: email,
			DisplayName: displayName, AssignedRole: *resolved.AssignedRole, ZoneIDs: append([]string{}, resolved.ZoneIDs...),
			Status: "active", IsEmergencyAdmin: false, LastSignInAt: &at, PreferredLocale: "en",
		}
	} else {
		user = *existing
		if user.KeycloakSubject == nil {
			subj := subject
			user.KeycloakSubject = &subj
		}
		user.AssignedRole, user.ZoneIDs, user.Status, user.LastSignInAt, user.UpdatedAt = *resolved.AssignedRole, append([]string{}, resolved.ZoneIDs...), "active", &at, at
	}
	if err := saveUser(context.Background(), user); err != nil {
		return SignInResult{}, err
	}
	createdSuffix := ""
	if created {
		createdSuffix = " (account created)"
	}
	uid := user.ID
	audit("success", fmt.Sprintf("%s signed in through the mock provider as %s%s.", user.DisplayName, *resolved.AssignedRole, createdSuffix), &uid, map[string]any{
		"assigned_role": *resolved.AssignedRole, "zone_ids": resolved.ZoneIDs, "created": created,
	})
	role := *resolved.AssignedRole
	return SignInResult{Outcome: "signed_in", IsMock: true, UserID: &uid, AssignedRole: &role, ZoneIDs: append([]string{}, resolved.ZoneIDs...), ReferenceCode: nil}, nil
}

const maxEmergencyFailures = 5

var placeholderSecrets = map[string]bool{"replace-me": true}

func isConfigured(secret string) bool {
	return secret != "" && !placeholderSecrets[secret]
}

// sameSecret: constant-time; false if unconfigured.
func sameSecret(given, expected string) bool {
	if !isConfigured(expected) {
		return false
	}
	a := sha256.Sum256([]byte(given))
	b := sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

var totpPattern = regexp.MustCompile(`^[0-9]{6}$`)

// EmergencyAdminSignIn: an assumption.
// Takes the PreSessionContext, like MockSignIn.
func EmergencyAdminSignIn(pre reqctx.PreSessionContext, body any) (SignInResult, error) {
	if err := datactx.RequirePreSession(pre); err != nil {
		return SignInResult{}, err
	}
	input, err := datactx.Object(body, "Emergency sign-in", []string{"email", "password", "totp_code"})
	if err != nil {
		return SignInResult{}, err
	}
	email, err := datactx.String(input, "email", datactx.StrOpts{HasMax: true, Max: 254})
	if err != nil {
		return SignInResult{}, err
	}
	password, err := datactx.String(input, "password", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 256})
	if err != nil {
		return SignInResult{}, err
	}
	code, hasCode, err := datactx.OptString(input, "totp_code", datactx.StrOpts{Pattern: totpPattern})
	if err != nil {
		return SignInResult{}, err
	}
	reference := referenceCode("ODP", fmt.Sprintf("emergency|%s|%s", email, datactx.NowISO()), 8)
	var account *User
	userRows, err := allUsers(context.Background(), pre.CustomerID)
	if err != nil {
		return SignInResult{}, err
	}
	for _, u := range userRows {
		if u.IsEmergencyAdmin && strings.EqualFold(u.Email, email) {
			row := u
			account = &row
			break
		}
	}
	emergencyEnabled, err := readSettingStrict(context.Background(), pre.CustomerID, "auth.emergency_admin_enabled", true)
	if err != nil {
		return SignInResult{}, err
	}
	audit := func(outcome, summary string, userID *string) {
		eid := email
		if userID != nil {
			eid = *userID
		}
		_, _ = auditlog.RecordAudit(pre, auditlog.AuditInput{
			Action: "auth.emergency_admin_sign_in", EntityType: "user", EntityID: &eid, SummaryEn: summary,
			Outcome: outcome, ActorType: "emergency_admin", ActorUserID: userID, ActorUserIDGiven: true,
		}, "", "")
	}

	if account == nil || !emergencyEnabled || account.Status == "disabled" {
		audit("denied", "Emergency sign-in refused: the account is unknown or switched off.", nil)
		return SignInResult{Outcome: "invalid_credentials", ReferenceCode: &reference}, nil
	}
	if !isConfigured(os.Getenv("DEMO_EMERGENCY_ADMIN_PASSWORD")) || !isConfigured(os.Getenv("DEMO_EMERGENCY_ADMIN_TOTP")) {
		audit("failure", "Emergency sign-in refused: the emergency credentials are not configured on this install.", &account.ID)
		return SignInResult{Outcome: "invalid_credentials", ReferenceCode: &reference}, nil
	}
	// Every attempt is counted before it is checked, so parallel guesses cannot all slip under the limit.
	attempts, err := settingsstore.Incr(context.Background(), pre.CustomerID, emergencyFailureKey)
	if err != nil {
		return SignInResult{}, err
	}
	if attempts > maxEmergencyFailures {
		audit("denied", "Emergency sign-in refused: the account is locked after repeated failures.", &account.ID)
		return SignInResult{Outcome: "locked", UserID: &account.ID, ReferenceCode: &reference}, nil
	}
	if !sameSecret(password, os.Getenv("DEMO_EMERGENCY_ADMIN_PASSWORD")) {
		audit("failure", "Emergency sign-in failed: wrong password.", &account.ID)
		return SignInResult{Outcome: "invalid_credentials", ReferenceCode: &reference}, nil
	}
	if !hasCode {
		// A right password alone is not a failure: give the attempt back.
		if _, err := settingsstore.Add(context.Background(), pre.CustomerID, emergencyFailureKey, -1); err != nil {
			return SignInResult{}, err
		}
		return SignInResult{Outcome: "mfa_required", UserID: &account.ID}, nil
	}
	if !sameSecret(code, os.Getenv("DEMO_EMERGENCY_ADMIN_TOTP")) {
		audit("failure", "Emergency sign-in failed: wrong authenticator code.", &account.ID)
		return SignInResult{Outcome: "invalid_credentials", ReferenceCode: &reference}, nil
	}
	if err := settingsstore.Put(context.Background(), pre.CustomerID, emergencyFailureKey, 0); err != nil {
		return SignInResult{}, err
	}
	at := datactx.NowISO()
	next := *account
	next.LastSignInAt, next.UpdatedAt = &at, at
	if err := saveUser(context.Background(), next); err != nil {
		return SignInResult{}, err
	}
	audit("success", "The emergency administrator signed in.", &account.ID)
	raiseNotificationPreSession(context.Background(), pre, "emergency_admin_sign_in", RaisedNotification{
		TitleEn: "Emergency administrator signed in", BodyEn: ptr("The local emergency account was used."), LinkPath: ptr("/admin/audit-log"),
	})
	role := access.RoleAdministrator
	return SignInResult{Outcome: "signed_in", UserID: &account.ID, AssignedRole: &role, ZoneIDs: []string{}}, nil
}

// Session

// GetSessionContext mirrors getSessionContext.
func GetSessionContext(ctx reqctx.RequestContext) (SessionContext, error) {
	if err := datactx.RequirePlatform(ctx, datactx.PlatformSession); err != nil {
		return SessionContext{}, err
	}
	u, err := oneUser(context.Background(), ctx.CustomerID, ctx.UserID)
	if err != nil {
		return SessionContext{}, err
	}
	if u == nil {
		return SessionContext{}, dataerr.NotFound("User not found.")
	}
	zoneIDs := []string{}
	if ctx.ZoneScope.Kind == access.ScopeAssignedZones {
		zoneIDs = append(zoneIDs, ctx.ZoneScope.ZoneIDs...)
	}
	locale := u.PreferredLocale
	if locale == "" {
		locale = "en"
	}
	tenantName, _ := demoCustomerNames()
	return SessionContext{
		User:        SessionUser{ID: u.ID, DisplayName: u.DisplayName, Email: u.Email, AssignedRole: ctx.Role, ZoneIDs: zoneIDs, PreferredLocale: locale},
		Tenant:      SessionTenant{ID: ctx.CustomerID, DisplayName: tenantName},
		InstallMode: ctx.InstallMode, IsDemo: true, Modules: modulesFor(ctx.Role, ctx.InstallMode),
	}, nil
}

// SignOut: every role may sign out.
func SignOut(ctx reqctx.RequestContext) error {
	if err := datactx.RequirePlatform(ctx, datactx.PlatformSession); err != nil {
		return err
	}
	uid := ctx.UserID
	_, err := auditlog.RecordAudit(ctx, auditlog.AuditInput{Action: "auth.sign_out", EntityType: "user", EntityID: &uid, SummaryEn: "Signed out."}, "", "")
	return err
}
