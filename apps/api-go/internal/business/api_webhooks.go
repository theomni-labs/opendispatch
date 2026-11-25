// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors the API/webhooks part of system.ts.
// In-memory, same reasoning as rules.go.
package business

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"net/url"
	"strings"
	"sync"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

var (
	clientScopeValues = []string{"read", "write", "feeds"}
	eventTypeValues   = []string{"assignment.created", "assignment.overridden", "fallback.state_changed", "forecast.completed", "roster.approved", "rule.approved", "import.completed"}
	rateScopeValues   = []string{"read", "write", "feeds"}
)

// ApiClient mirrors the contract's ApiClient.
type ApiClient struct {
	datactx.BaseRecord
	Name       string   `json:"name"`
	Scopes     []string `json:"scopes"`
	IsRevoked  bool     `json:"is_revoked"`
	SecretHint string   `json:"secret_hint"`
	LastUsedAt *string  `json:"last_used_at"`
}

// ApiClientCreated mirrors createApiClient's result.
type ApiClientCreated struct {
	Client ApiClient `json:"client"`
	Secret string    `json:"secret"`
}

// Webhook mirrors the contract's Webhook.
type Webhook struct {
	datactx.BaseRecord
	Name              string   `json:"name"`
	TargetURL         string   `json:"target_url"`
	EventTypes        []string `json:"event_types"`
	IsEnabled         bool     `json:"is_enabled"`
	SigningSecretHint string   `json:"signing_secret_hint"`
	LastDeliveryAt    *string  `json:"last_delivery_at"`
	LastStatus        *string  `json:"last_status"`
}

// WebhookDelivery mirrors the contract type.
type WebhookDelivery struct {
	datactx.BaseRecord
	WebhookID    string  `json:"webhook_id"`
	EventType    string  `json:"event_type"`
	Status       string  `json:"status"`
	HTTPStatus   int     `json:"http_status"`
	AttemptedAt  string  `json:"attempted_at"`
	AttemptCount int     `json:"attempt_count"`
	ErrorMessage *string `json:"error_message"`
}

// ApiRateLimit is one scope's entry.
type ApiRateLimit struct {
	Scope             string `json:"scope"`
	RequestsPerMinute int    `json:"requests_per_minute"`
	Burst             int    `json:"burst"`
}

// ApiRateLimits mirrors the contract type.
type ApiRateLimits struct {
	Limits []ApiRateLimit `json:"limits"`
}

// WebhookTestResult mirrors the contract type.
type WebhookTestResult struct {
	Delivered  bool `json:"delivered"`
	HTTPStatus int  `json:"http_status"`
	LatencyMs  int  `json:"latency_ms"`
}

// WebhookDeliveryRetryResult: the contract type.
type WebhookDeliveryRetryResult struct {
	Delivery  WebhookDelivery `json:"delivery"`
	Delivered bool            `json:"delivered"`
	Message   string          `json:"message"`
}

var (
	apiWebhooksMu    sync.Mutex
	apiClientsStore  []ApiClient
	webhooksStore    []Webhook
	deliveriesStore  []WebhookDelivery
	apiClientsSeeded bool
	webhooksSeeded   bool
	deliveriesSeeded bool
)

// ResetAPIWebhooksForTest clears all state.
func ResetAPIWebhooksForTest() {
	apiWebhooksMu.Lock()
	apiClientsStore, webhooksStore, deliveriesStore = nil, nil, nil
	apiClientsSeeded, webhooksSeeded, deliveriesSeeded = false, false, false
	apiWebhooksMu.Unlock()
}

// seedBaseFor mirrors seedBase.
func seedBaseFor(ctx reqctx.RequestContext, name, at string) datactx.BaseRecord {
	return seedBaseOf(ctx.CustomerID, name, at)
}

func seedBaseOf(tenant, name, at string) datactx.BaseRecord {
	return datactx.BaseRecord{
		ID: datactx.DeterministicUUID("seed|" + name), TenantID: tenant,
		CreatedAt: at, UpdatedAt: at, CreatedBy: nil, DataSource: "SYNTHETIC",
	}
}

func seedClientRows(tenant string) []ApiClient {
	lastReporting, lastFeeds, lastOld := "2026-09-12T23:00:00+03:00", "2026-09-13T06:55:00+03:00", "2026-08-01T12:00:00+03:00"
	return []ApiClient{
		{BaseRecord: seedBaseOf(tenant, "api_client|reporting", "2026-08-20T10:00:00+03:00"), Name: "Reporting export (read only)", Scopes: []string{"read"}, IsRevoked: false, SecretHint: "x7q2", LastUsedAt: &lastReporting},
		{BaseRecord: seedBaseOf(tenant, "api_client|feeds", "2026-08-21T09:30:00+03:00"), Name: "Feed gateway (simulator)", Scopes: []string{"feeds"}, IsRevoked: false, SecretHint: "m4c9", LastUsedAt: &lastFeeds},
		{BaseRecord: seedBaseOf(tenant, "api_client|old", "2026-07-15T08:00:00+03:00"), Name: "Old export client", Scopes: []string{"read", "write"}, IsRevoked: true, SecretHint: "r1b8", LastUsedAt: &lastOld},
	}
}

func seedWebhookRows(tenant string) []Webhook {
	lastDelivery, lastStatus := "2026-09-12T15:10:00+03:00", "succeeded"
	return []Webhook{{
		BaseRecord: seedBaseOf(tenant, "webhook|roster", "2026-08-22T11:00:00+03:00"), Name: "Roster approved to the planning tool", TargetURL: "https://hooks.example.com/opendispatch/roster",
		EventTypes: []string{"roster.approved"}, IsEnabled: true, SigningSecretHint: "k9f2",
		LastDeliveryAt: &lastDelivery, LastStatus: &lastStatus,
	}}
}

func seedDeliveryRows(tenant string) []WebhookDelivery {
	type row struct {
		at     string
		status string
		http   int
	}
	rows := []row{
		{"2026-09-12T15:10:00+03:00", "succeeded", 200},
		{"2026-09-11T14:05:00+03:00", "succeeded", 200},
		{"2026-09-10T09:40:00+03:00", "failed", 503},
	}
	hookID := seedWebhookRows(tenant)[0].ID
	var out []WebhookDelivery
	for i, r := range rows {
		var errMsg *string
		attempts := 1
		if r.status == "failed" {
			m := "The target answered with 503."
			errMsg = &m
			attempts = 3
		}
		out = append(out, WebhookDelivery{
			BaseRecord: seedBaseOf(tenant, "delivery|"+itoa(i), r.at), WebhookID: hookID, EventType: "roster.approved",
			Status: r.status, HTTPStatus: r.http, AttemptedAt: r.at, AttemptCount: attempts, ErrorMessage: errMsg,
		})
	}
	return out
}

func seedAPIClientsOnce(ctx reqctx.RequestContext) {
	if _, isPg := apiWebhookData.(pgAPIWebhooks); isPg {
		return
	}
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	if apiClientsSeeded {
		return
	}
	apiClientsStore = append(apiClientsStore, seedClientRows(ctx.CustomerID)...)
	apiClientsSeeded = true
}

var seedWebhookID = ""

func seedWebhooksOnce(ctx reqctx.RequestContext) {
	if _, isPg := apiWebhookData.(pgAPIWebhooks); isPg {
		return
	}
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	if webhooksSeeded {
		return
	}
	rows := seedWebhookRows(ctx.CustomerID)
	seedWebhookID = rows[0].ID
	webhooksStore = append(webhooksStore, rows...)
	webhooksSeeded = true
}

func seedDeliveriesOnce(ctx reqctx.RequestContext) {
	if _, isPg := apiWebhookData.(pgAPIWebhooks); isPg {
		return
	}
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	if deliveriesSeeded {
		return
	}
	deliveriesStore = append(deliveriesStore, seedDeliveryRows(ctx.CustomerID)...)
	deliveriesSeeded = true
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	digits := []byte{}
	for i > 0 {
		digits = append([]byte{byte('0' + i%10)}, digits...)
		i /= 10
	}
	return string(digits)
}

func upsertAPIClientMemory(c ApiClient) {
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	for i, x := range apiClientsStore {
		if x.ID == c.ID {
			apiClientsStore[i] = c
			return
		}
	}
	apiClientsStore = append(apiClientsStore, c)
}

func findAPIClientMemory(id string) (ApiClient, bool) {
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	for _, x := range apiClientsStore {
		if x.ID == id {
			return x, true
		}
	}
	return ApiClient{}, false
}

func allAPIClientsMemory() []ApiClient {
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	out := make([]ApiClient, len(apiClientsStore))
	copy(out, apiClientsStore)
	return out
}

func upsertWebhookMemory(h Webhook) {
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	for i, x := range webhooksStore {
		if x.ID == h.ID {
			webhooksStore[i] = h
			return
		}
	}
	webhooksStore = append(webhooksStore, h)
}

func findWebhookMemory(id string) (Webhook, bool) {
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	for _, x := range webhooksStore {
		if x.ID == id {
			return x, true
		}
	}
	return Webhook{}, false
}

func allWebhooksMemory() []Webhook {
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	out := make([]Webhook, len(webhooksStore))
	copy(out, webhooksStore)
	return out
}

func removeWebhookMemory(id string) {
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	for i, x := range webhooksStore {
		if x.ID == id {
			webhooksStore = append(webhooksStore[:i], webhooksStore[i+1:]...)
			return
		}
	}
}

func upsertDeliveryMemory(d WebhookDelivery) {
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	for i, x := range deliveriesStore {
		if x.ID == d.ID {
			deliveriesStore[i] = d
			return
		}
	}
	deliveriesStore = append(deliveriesStore, d)
}

func findDeliveryMemory(id string) (WebhookDelivery, bool) {
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	for _, x := range deliveriesStore {
		if x.ID == id {
			return x, true
		}
	}
	return WebhookDelivery{}, false
}

func allDeliveriesMemory() []WebhookDelivery {
	apiWebhooksMu.Lock()
	defer apiWebhooksMu.Unlock()
	out := make([]WebhookDelivery, len(deliveriesStore))
	copy(out, deliveriesStore)
	return out
}

// ApiClientQuery mirrors listApiClients' query.
type ApiClientQuery struct {
	Limit  int
	Cursor string
}

// ListApiClients mirrors listApiClients.
func ListApiClients(ctx reqctx.RequestContext, query ApiClientQuery) (datactx.PageResult[ApiClient], error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminAPIWebhooks, access.AccessView); err != nil {
		return datactx.PageResult[ApiClient]{}, err
	}
	seedAPIClientsOnce(ctx)
	rows, err := allAPIClients(context.Background(), ctx.CustomerID)
	if err != nil {
		return datactx.PageResult[ApiClient]{}, err
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// CreateApiClient mirrors createApiClient.
func CreateApiClient(ctx reqctx.RequestContext, body any) (ApiClientCreated, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminAPIWebhooks}, auditlog.WriteMeta{Action: "api_client.created", EntityType: "api_client"}, func(uctx context.Context) (auditlog.AuditedWrite[ApiClientCreated], error) {
		seedAPIClientsOnce(ctx)
		input, err := datactx.Object(body, "API client", []string{"name", "scopes"})
		if err != nil {
			return auditlog.AuditedWrite[ApiClientCreated]{}, err
		}
		name, err := datactx.String(input, "name", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[ApiClientCreated]{}, err
		}
		scopes, err := datactx.EnumList(input, "scopes", clientScopeValues, datactx.ListOpts{Min: 1, HasMin: true})
		if err != nil {
			return auditlog.AuditedWrite[ApiClientCreated]{}, err
		}
		secret, err := randomSecret()
		if err != nil {
			return auditlog.AuditedWrite[ApiClientCreated]{}, err
		}
		hint := secret
		if len(hint) > 4 {
			hint = hint[len(hint)-4:]
		}
		client := ApiClient{
			BaseRecord: datactx.NewRecord(ctx, "", ""), Name: name, Scopes: scopes,
			IsRevoked: false, SecretHint: hint, LastUsedAt: nil,
		}
		if err := saveAPIClient(uctx, ctx.CustomerID, client); err != nil {
			return auditlog.AuditedWrite[ApiClientCreated]{}, err
		}
		id := client.ID
		return auditlog.AuditedWrite[ApiClientCreated]{
			Result: ApiClientCreated{Client: client, Secret: secret}, EntityID: &id,
			SummaryEn: "API client " + client.Name + " created.", Detail: sumDetail(map[string]any{"scopes": scopes}, map[string]any{"name": client.Name}),
		}, nil
	})
}

// randomSecret: the TS opendispatch_<base64url> secret.
func randomSecret() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "opendispatch_" + base64.RawURLEncoding.EncodeToString(buf), nil
}

// RevokeApiClient mirrors revokeApiClient.
func RevokeApiClient(ctx reqctx.RequestContext, id string) error {
	_, err := auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminAPIWebhooks}, auditlog.WriteMeta{Action: "api_client.revoked", EntityType: "api_client", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[struct{}], error) {
		if _, err := importutil.RequireID(id, "API client"); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		seedAPIClientsOnce(ctx)
		existing, ok, err := findAPIClient(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		if !ok {
			return auditlog.AuditedWrite[struct{}]{}, dataerr.NotFound("API client not found.")
		}
		if existing.IsRevoked {
			return auditlog.AuditedWrite[struct{}]{}, dataerr.Conflict("The API client is already revoked.")
		}
		existing.IsRevoked = true
		existing.UpdatedAt = datactx.NowISO()
		if err := saveAPIClient(uctx, ctx.CustomerID, existing); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		return auditlog.AuditedWrite[struct{}]{SummaryEn: "API client " + existing.Name + " revoked.", Detail: sumDetail(nil, map[string]any{"name": existing.Name})}, nil
	})
	return err
}

// RotateApiClient: a new key, returned once.
func RotateApiClient(ctx reqctx.RequestContext, id string) (ApiClientCreated, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminAPIWebhooks}, auditlog.WriteMeta{Action: "api_client.rotated", EntityType: "api_client", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[ApiClientCreated], error) {
		if _, err := importutil.RequireID(id, "API client"); err != nil {
			return auditlog.AuditedWrite[ApiClientCreated]{}, err
		}
		seedAPIClientsOnce(ctx)
		existing, ok, err := findAPIClient(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[ApiClientCreated]{}, err
		}
		if !ok {
			return auditlog.AuditedWrite[ApiClientCreated]{}, dataerr.NotFound("API client not found.")
		}
		if existing.IsRevoked {
			return auditlog.AuditedWrite[ApiClientCreated]{}, dataerr.Conflict("A revoked API client cannot be rotated.")
		}
		secret, err := randomSecret()
		if err != nil {
			return auditlog.AuditedWrite[ApiClientCreated]{}, err
		}
		existing.SecretHint = secret[len(secret)-4:]
		existing.UpdatedAt = datactx.NowISO()
		if err := saveAPIClient(uctx, ctx.CustomerID, existing); err != nil {
			return auditlog.AuditedWrite[ApiClientCreated]{}, err
		}
		return auditlog.AuditedWrite[ApiClientCreated]{
			Result: ApiClientCreated{Client: existing, Secret: secret}, SummaryEn: "API client " + existing.Name + " key rotated.", Detail: sumDetail(nil, map[string]any{"name": existing.Name}),
		}, nil
	})
}

// WebhookQuery mirrors listWebhooks' query.
type WebhookQuery struct {
	Limit  int
	Cursor string
}

// ListWebhooks mirrors listWebhooks.
func ListWebhooks(ctx reqctx.RequestContext, query WebhookQuery) (datactx.PageResult[Webhook], error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminAPIWebhooks, access.AccessView); err != nil {
		return datactx.PageResult[Webhook]{}, err
	}
	seedWebhooksOnce(ctx)
	seedDeliveriesOnce(ctx)
	rows, err := allWebhooks(context.Background(), ctx.CustomerID)
	if err != nil {
		return datactx.PageResult[Webhook]{}, err
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// GetWebhook mirrors getWebhook.
func GetWebhook(ctx reqctx.RequestContext, id string) (Webhook, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminAPIWebhooks, access.AccessView); err != nil {
		return Webhook{}, err
	}
	if _, err := importutil.RequireID(id, "Webhook"); err != nil {
		return Webhook{}, err
	}
	seedWebhooksOnce(ctx)
	seedDeliveriesOnce(ctx)
	hook, ok, err := findWebhook(context.Background(), ctx.CustomerID, id)
	if err != nil {
		return Webhook{}, err
	}
	if !ok {
		return Webhook{}, dataerr.NotFound("Webhook not found.")
	}
	return hook, nil
}

func webhookFrom(ctx reqctx.RequestContext, body any, existing *Webhook) (Webhook, error) {
	var zero Webhook
	input, err := datactx.Object(body, "Webhook", []string{"name", "target_url", "event_types", "is_enabled"})
	if err != nil {
		return zero, err
	}
	target, err := datactx.String(input, "target_url", datactx.StrOpts{Max: 500, HasMax: true})
	if err != nil {
		return zero, err
	}
	if err := validateWebhookURL(target); err != nil {
		return zero, err
	}
	at := datactx.NowISO()
	var base datactx.BaseRecord
	signingHint := ""
	var lastDeliveryAt, lastStatus *string
	if existing == nil {
		base = datactx.NewRecord(ctx, "", at)
		hint, err := randomHexHint()
		if err != nil {
			return zero, err
		}
		signingHint = hint
	} else {
		base = existing.BaseRecord
		base.UpdatedAt = at
		signingHint = existing.SigningSecretHint
		lastDeliveryAt = existing.LastDeliveryAt
		lastStatus = existing.LastStatus
	}
	name, err := datactx.String(input, "name", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	eventTypes, err := datactx.EnumList(input, "event_types", eventTypeValues, datactx.ListOpts{Min: 1, HasMin: true})
	if err != nil {
		return zero, err
	}
	isEnabled, hasEnabled, err := datactx.OptBool(input, "is_enabled")
	if err != nil {
		return zero, err
	}
	if !hasEnabled {
		isEnabled = true
	}
	return Webhook{
		BaseRecord: base, Name: name, TargetURL: target, EventTypes: eventTypes, IsEnabled: isEnabled,
		SigningSecretHint: signingHint, LastDeliveryAt: lastDeliveryAt, LastStatus: lastStatus,
	}, nil
}

// validateWebhookURL: https, or localhost http.
func validateWebhookURL(target string) error {
	parsed, err := url.Parse(target)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return dataerr.Invalid("Webhook: target_url is not a valid URL.")
	}
	isHTTPS := parsed.Scheme == "https"
	isLocalHTTP := parsed.Scheme == "http" && parsed.Hostname() == "localhost"
	if !isHTTPS && !isLocalHTTP {
		return dataerr.Invalid("Webhook: target_url must use https.")
	}
	return nil
}

// randomHexHint mirrors the TS 4-char hex hint.
func randomHexHint() (string, error) {
	buf := make([]byte, 3)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	full := hex.EncodeToString(buf)
	return full[:4], nil
}

// CreateWebhook mirrors createWebhook.
func CreateWebhook(ctx reqctx.RequestContext, body any) (Webhook, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminAPIWebhooks}, auditlog.WriteMeta{Action: "webhook.created", EntityType: "webhook"}, func(uctx context.Context) (auditlog.AuditedWrite[Webhook], error) {
		seedWebhooksOnce(ctx)
		hook, err := webhookFrom(ctx, body, nil)
		if err != nil {
			return auditlog.AuditedWrite[Webhook]{}, err
		}
		if err := saveWebhook(uctx, ctx.CustomerID, hook); err != nil {
			return auditlog.AuditedWrite[Webhook]{}, err
		}
		id := hook.ID
		return auditlog.AuditedWrite[Webhook]{Result: hook, EntityID: &id, SummaryEn: "Webhook " + hook.Name + " created.", Detail: sumDetail(map[string]any{"event_types": hook.EventTypes}, map[string]any{"name": hook.Name})}, nil
	})
}

// UpdateWebhook mirrors updateWebhook.
func UpdateWebhook(ctx reqctx.RequestContext, id string, body any) (Webhook, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminAPIWebhooks}, auditlog.WriteMeta{Action: "webhook.updated", EntityType: "webhook", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[Webhook], error) {
		if _, err := importutil.RequireID(id, "Webhook"); err != nil {
			return auditlog.AuditedWrite[Webhook]{}, err
		}
		seedWebhooksOnce(ctx)
		existing, ok, err := findWebhook(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[Webhook]{}, err
		}
		if !ok {
			return auditlog.AuditedWrite[Webhook]{}, dataerr.NotFound("Webhook not found.")
		}
		hook, err := webhookFrom(ctx, body, &existing)
		if err != nil {
			return auditlog.AuditedWrite[Webhook]{}, err
		}
		if err := saveWebhook(uctx, ctx.CustomerID, hook); err != nil {
			return auditlog.AuditedWrite[Webhook]{}, err
		}
		return auditlog.AuditedWrite[Webhook]{Result: hook, SummaryEn: "Webhook " + hook.Name + " updated.", Detail: sumDetail(nil, map[string]any{"name": hook.Name})}, nil
	})
}

// DeleteWebhook mirrors deleteWebhook.
func DeleteWebhook(ctx reqctx.RequestContext, id string) error {
	_, err := auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminAPIWebhooks}, auditlog.WriteMeta{Action: "webhook.deleted", EntityType: "webhook", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[struct{}], error) {
		if _, err := importutil.RequireID(id, "Webhook"); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		seedWebhooksOnce(ctx)
		existing, ok, err := findWebhook(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		if !ok {
			return auditlog.AuditedWrite[struct{}]{}, dataerr.NotFound("Webhook not found.")
		}
		if err := removeWebhook(uctx, ctx.CustomerID, id); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		return auditlog.AuditedWrite[struct{}]{SummaryEn: "Webhook " + existing.Name + " deleted.", Detail: sumDetail(nil, map[string]any{"name": existing.Name})}, nil
	})
	return err
}

// WebhookDeliveryQuery: one webhook's log, paged.
type WebhookDeliveryQuery struct {
	Limit  int
	Cursor string
}

// ListWebhookDeliveries: newest first, stable ties.
func ListWebhookDeliveries(ctx reqctx.RequestContext, id string, query WebhookDeliveryQuery) (datactx.PageResult[WebhookDelivery], error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminAPIWebhooks, access.AccessView); err != nil {
		return datactx.PageResult[WebhookDelivery]{}, err
	}
	if _, err := importutil.RequireID(id, "Webhook"); err != nil {
		return datactx.PageResult[WebhookDelivery]{}, err
	}
	hook, err := GetWebhook(ctx, id)
	if err != nil {
		return datactx.PageResult[WebhookDelivery]{}, err
	}
	type indexed struct {
		d   WebhookDelivery
		idx int
	}
	all, err := allDeliveries(context.Background(), ctx.CustomerID)
	if err != nil {
		return datactx.PageResult[WebhookDelivery]{}, err
	}
	var forHook []indexed
	for i, d := range all {
		if d.WebhookID == hook.ID {
			forHook = append(forHook, indexed{d, i})
		}
	}
	epoch := func(iso string) int64 {
		t, err := datactx.EpochOf(iso)
		if err != nil {
			return 0
		}
		return t.UnixMilli()
	}
	for i := 0; i < len(forHook); i++ {
		for j := i + 1; j < len(forHook); j++ {
			a, b := forHook[i], forHook[j]
			swap := epoch(a.d.AttemptedAt) < epoch(b.d.AttemptedAt) ||
				(epoch(a.d.AttemptedAt) == epoch(b.d.AttemptedAt) && a.idx < b.idx)
			if swap {
				forHook[i], forHook[j] = forHook[j], forHook[i]
			}
		}
	}
	rows := make([]WebhookDelivery, len(forHook))
	for i, x := range forHook {
		rows[i] = x.d
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

var defaultRateLimits = ApiRateLimits{Limits: []ApiRateLimit{
	{Scope: "read", RequestsPerMinute: 120, Burst: 20},
	{Scope: "write", RequestsPerMinute: 30, Burst: 5},
	{Scope: "feeds", RequestsPerMinute: 600, Burst: 100},
}}

// GetRateLimits: stored, not enforced.
func GetRateLimits(ctx reqctx.RequestContext) (ApiRateLimits, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminAPIWebhooks, access.AccessView); err != nil {
		return ApiRateLimits{}, err
	}
	return readSetting(context.Background(), ctx.CustomerID, "api.rate_limits", defaultRateLimits), nil
}

func rateLimitsFrom(body any) (ApiRateLimits, error) {
	var zero ApiRateLimits
	input, err := datactx.Object(body, "Rate limits", []string{"limits"})
	if err != nil {
		return zero, err
	}
	rawList, ok := input["limits"].([]any)
	if !ok || len(rawList) != len(rateScopeValues) {
		return zero, dataerr.Invalid("Rate limits: give one entry for each of read, write and feeds.")
	}
	byScope := map[string]ApiRateLimit{}
	for _, item := range rawList {
		entry, err := datactx.Object(item, "Rate limit", []string{"scope", "requests_per_minute", "burst"})
		if err != nil {
			return zero, err
		}
		scope, err := datactx.EnumOf(entry, "scope", rateScopeValues)
		if err != nil {
			return zero, err
		}
		if _, dup := byScope[scope]; dup {
			return zero, dataerr.Invalid("Rate limits: " + scope + " is given twice.")
		}
		rpm, err := datactx.Int(entry, "requests_per_minute", datactx.NumOpts{Min: 1, Max: 100_000, HasMin: true, HasMax: true})
		if err != nil {
			return zero, err
		}
		burst, err := datactx.Int(entry, "burst", datactx.NumOpts{Min: 1, Max: 10_000, HasMin: true, HasMax: true})
		if err != nil {
			return zero, err
		}
		byScope[scope] = ApiRateLimit{Scope: scope, RequestsPerMinute: rpm, Burst: burst}
	}
	out := make([]ApiRateLimit, 0, len(rateScopeValues))
	for _, s := range rateScopeValues {
		if v, ok := byScope[s]; ok {
			out = append(out, v)
		}
	}
	return ApiRateLimits{Limits: out}, nil
}

// UpdateRateLimits mirrors updateRateLimits.
func UpdateRateLimits(ctx reqctx.RequestContext, body any) (ApiRateLimits, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminAPIWebhooks}, auditlog.WriteMeta{Action: "api_rate_limits.updated", EntityType: "setting", EntityID: strPtr("api.rate_limits")}, func(uctx context.Context) (auditlog.AuditedWrite[ApiRateLimits], error) {
		next, err := rateLimitsFrom(body)
		if err != nil {
			return auditlog.AuditedWrite[ApiRateLimits]{}, err
		}
		before := readSetting(uctx, ctx.CustomerID, "api.rate_limits", defaultRateLimits)
		if err := settingsstore.Put(uctx, ctx.CustomerID, "api.rate_limits", next); err != nil {
			return auditlog.AuditedWrite[ApiRateLimits]{}, err
		}
		return auditlog.AuditedWrite[ApiRateLimits]{
			Result: next, SummaryEn: "API rate limits updated (stored, not enforced).",
			Detail: map[string]any{"from": before, "to": next},
		}, nil
	})
}

// StubNothingSent marks a result as a stub.
const StubNothingSent = "(stub: nothing was sent)"

func hashLatency(target string) int {
	sum := sha256.Sum256([]byte(target))
	v := binary.BigEndian.Uint32(sum[:4])
	return 40 + int(v%160)
}

func targetLooksBroken(url string) bool {
	return strings.Contains(strings.ToLower(url), "fail")
}

// TestWebhook: LABELLED STUB, sends nothing.
func TestWebhook(ctx reqctx.RequestContext, id string) (WebhookTestResult, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminAPIWebhooks}, auditlog.WriteMeta{Action: "webhook.tested", EntityType: "webhook", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[WebhookTestResult], error) {
		if _, err := importutil.RequireID(id, "Webhook"); err != nil {
			return auditlog.AuditedWrite[WebhookTestResult]{}, err
		}
		seedWebhooksOnce(ctx)
		seedDeliveriesOnce(ctx)
		hook, ok, err := findWebhook(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[WebhookTestResult]{}, err
		}
		if !ok {
			return auditlog.AuditedWrite[WebhookTestResult]{}, dataerr.NotFound("Webhook not found.")
		}
		okDelivery := !targetLooksBroken(hook.TargetURL)
		at := datactx.NowISO()
		latency := hashLatency(hook.TargetURL)
		status, httpStatus := "succeeded", 200
		var errMsg *string
		if !okDelivery {
			status, httpStatus = "failed", 500
			m := "The target answered with 500."
			errMsg = &m
		}
		delivery := WebhookDelivery{
			BaseRecord: datactx.NewRecord(ctx, "", at), WebhookID: hook.ID, EventType: hook.EventTypes[0],
			Status: status, HTTPStatus: httpStatus, AttemptedAt: at, AttemptCount: 1, ErrorMessage: errMsg,
		}
		hook.LastDeliveryAt, hook.LastStatus, hook.UpdatedAt = &at, &status, at
		if err := saveDelivery(uctx, ctx.CustomerID, delivery, hook); err != nil {
			return auditlog.AuditedWrite[WebhookTestResult]{}, err
		}
		delivered := "delivered"
		if !okDelivery {
			delivered = "failed"
		}
		return auditlog.AuditedWrite[WebhookTestResult]{
			Result:    WebhookTestResult{Delivered: okDelivery, HTTPStatus: httpStatus, LatencyMs: latency},
			SummaryEn: "Webhook " + hook.Name + " tested: " + delivered + " " + StubNothingSent + ".",
			Detail:    map[string]any{"delivered": okDelivery, "stub": true},
		}, nil
	})
}

// RetryWebhookDelivery: LABELLED STUB too.
func RetryWebhookDelivery(ctx reqctx.RequestContext, id string) (WebhookDeliveryRetryResult, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminAPIWebhooks}, auditlog.WriteMeta{Action: "webhook.delivery_retried", EntityType: "webhook_delivery", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[WebhookDeliveryRetryResult], error) {
		if _, err := importutil.RequireID(id, "Webhook delivery"); err != nil {
			return auditlog.AuditedWrite[WebhookDeliveryRetryResult]{}, err
		}
		seedWebhooksOnce(ctx)
		seedDeliveriesOnce(ctx)
		delivery, ok, err := findDelivery(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[WebhookDeliveryRetryResult]{}, err
		}
		if !ok {
			return auditlog.AuditedWrite[WebhookDeliveryRetryResult]{}, dataerr.NotFound("Webhook delivery not found.")
		}
		if delivery.Status != "failed" {
			return auditlog.AuditedWrite[WebhookDeliveryRetryResult]{}, dataerr.Conflict("Only a failed delivery can be retried.")
		}
		hook, ok, err := findWebhook(uctx, ctx.CustomerID, delivery.WebhookID)
		if err != nil {
			return auditlog.AuditedWrite[WebhookDeliveryRetryResult]{}, err
		}
		if !ok {
			return auditlog.AuditedWrite[WebhookDeliveryRetryResult]{}, dataerr.NotFound("Webhook not found.")
		}
		okDelivery := !targetLooksBroken(hook.TargetURL)
		at := datactx.NowISO()
		status, httpStatus := "succeeded", 200
		var errMsg *string
		if !okDelivery {
			status, httpStatus = "failed", 500
			m := "The target answered with 500."
			errMsg = &m
		}
		delivery.Status, delivery.HTTPStatus, delivery.AttemptedAt = status, httpStatus, at
		delivery.AttemptCount++
		delivery.ErrorMessage, delivery.UpdatedAt = errMsg, at
		hook.LastDeliveryAt, hook.LastStatus, hook.UpdatedAt = &at, &status, at
		if err := saveDelivery(uctx, ctx.CustomerID, delivery, hook); err != nil {
			return auditlog.AuditedWrite[WebhookDeliveryRetryResult]{}, err
		}
		message := "Delivered again " + StubNothingSent + "."
		summary := "Webhook " + hook.Name + ": delivery retried, delivered " + StubNothingSent + "."
		if !okDelivery {
			message = "Failed again, the target answered with 500 " + StubNothingSent + "."
			summary = "Webhook " + hook.Name + ": delivery retried, failed again " + StubNothingSent + "."
		}
		return auditlog.AuditedWrite[WebhookDeliveryRetryResult]{
			Result:    WebhookDeliveryRetryResult{Delivery: delivery, Delivered: okDelivery, Message: message},
			SummaryEn: summary,
			Detail:    map[string]any{"delivered": okDelivery, "attempt_count": delivery.AttemptCount, "stub": true},
		}, nil
	})
}
