// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors system.ts's admin.data_sources part.
package business

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

var integrationKinds = []string{"case_feed", "agent_feed", "assignment_channel", "weather_feed", "routing_feed", "other"}
var integrationHealths = []string{"healthy", "degraded", "down", "unknown", "disabled"}

// Integration mirrors the contract type.
type Integration struct {
	datactx.BaseRecord
	CredentialRef          *string `json:"credential_ref"`
	Direction              string  `json:"direction"`
	EndpointLabel          *string `json:"endpoint_label"`
	FallbackTimeoutSeconds *int    `json:"fallback_timeout_seconds"`
	Health                 string  `json:"health"`
	IsEnabled              bool    `json:"is_enabled"`
	Kind                   string  `json:"kind"`
	LastErrorAt            *string `json:"last_error_at"`
	LastErrorMessage       *string `json:"last_error_message"`
	LastSuccessAt          *string `json:"last_success_at"`
	NameEn                 string  `json:"name_en"`
}

// IntegrationTestResult mirrors the contract type.
type IntegrationTestResult struct {
	CheckedAt string  `json:"checked_at"`
	LatencyMs *int    `json:"latency_ms"`
	Message   *string `json:"message"`
	OK        bool    `json:"ok"`
}

// IntegrationHealthSummary: one health-list row.
type IntegrationHealthSummary struct {
	IntegrationID string  `json:"integration_id"`
	Kind          string  `json:"kind"`
	NameEn        string  `json:"name_en"`
	Health        string  `json:"health"`
	LastSuccessAt *string `json:"last_success_at"`
}

// IntegrationsHealth mirrors the contract type.
type IntegrationsHealth struct {
	AsOf         string                     `json:"as_of"`
	Overall      string                     `json:"overall"`
	Integrations []IntegrationHealthSummary `json:"integrations"`
	DataSource   string                     `json:"data_source"`
}

var (
	integrationsMu     sync.Mutex
	integrations       []Integration
	integrationsSeeded bool
)

// ResetIntegrationsForTest empties the store.
func ResetIntegrationsForTest() {
	integrationsMu.Lock()
	integrations, integrationsSeeded = nil, true
	integrationsMu.Unlock()
}

// ReloadIntegrationsForTest restores the fixtures.
func ReloadIntegrationsForTest() {
	integrationsMu.Lock()
	integrations, integrationsSeeded = nil, false
	integrationsMu.Unlock()
}

func seedIntegrationsLocked() {
	if integrationsSeeded {
		return
	}
	integrationsSeeded = true
	if rows, err := fixtures.Records[Integration]("Integration"); err == nil {
		integrations = append(integrations, rows...)
	}
}

// UpsertIntegrationForTest: store upsert, no seeding.
func UpsertIntegrationForTest(i Integration) {
	integrationsMu.Lock()
	defer integrationsMu.Unlock()
	for idx, x := range integrations {
		if x.ID == i.ID {
			integrations[idx] = i
			return
		}
	}
	integrations = append(integrations, i)
}

func allIntegrationsMemory() []Integration {
	integrationsMu.Lock()
	defer integrationsMu.Unlock()
	seedIntegrationsLocked()
	out := make([]Integration, len(integrations))
	copy(out, integrations)
	return out
}

func oneIntegration(ctx context.Context, tenant, id string) (*Integration, error) {
	rows, err := allIntegrations(ctx, tenant)
	if err != nil {
		return nil, err
	}
	for _, i := range rows {
		if i.ID == id {
			return &i, nil
		}
	}
	return nil, nil
}

// worstHealth mirrors worst().
func worstHealth(statuses []string) string {
	down, degraded := false, false
	for _, s := range statuses {
		if s == "down" {
			down = true
		}
		if s == "degraded" {
			degraded = true
		}
	}
	if down {
		return "down"
	}
	if degraded {
		return "degraded"
	}
	return "healthy"
}

func hashOf(text string) uint32 {
	sum := sha256.Sum256([]byte(text))
	return binary.BigEndian.Uint32(sum[:4])
}

// IntegrationQuery mirrors listIntegrations' query.
type IntegrationQuery struct {
	Limit  int
	Cursor string
}

// ListIntegrations mirrors listIntegrations.
func ListIntegrations(ctx reqctx.RequestContext, query IntegrationQuery) (datactx.PageResult[Integration], error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminDataSources, access.AccessView); err != nil {
		return datactx.PageResult[Integration]{}, err
	}
	stored, err := allIntegrations(context.Background(), ctx.CustomerID)
	if err != nil {
		return datactx.PageResult[Integration]{}, err
	}
	rows := overlayFeedHealth(ctx.CustomerID, stored, time.Now())
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// GetIntegration mirrors getIntegration.
func GetIntegration(ctx reqctx.RequestContext, id string) (*Integration, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminDataSources, access.AccessView); err != nil {
		return nil, err
	}
	if _, err := importutil.RequireID(id, "Integration"); err != nil {
		return nil, err
	}
	stored, err := allIntegrations(context.Background(), ctx.CustomerID)
	if err != nil {
		return nil, err
	}
	var found *Integration
	for _, i := range overlayFeedHealth(ctx.CustomerID, stored, time.Now()) {
		if i.ID == id {
			found = &i
			break
		}
	}
	return datactx.RequireFound(found, "Integration")
}

// UpdateIntegration mirrors updateIntegration.
func UpdateIntegration(ctx reqctx.RequestContext, id string, body any) (Integration, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminDataSources}, auditlog.WriteMeta{Action: "integration.updated", EntityType: "integration", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[Integration], error) {
		if _, err := importutil.RequireID(id, "Integration"); err != nil {
			return auditlog.AuditedWrite[Integration]{}, err
		}
		existing, err := oneIntegration(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[Integration]{}, err
		}
		if existing == nil {
			return auditlog.AuditedWrite[Integration]{}, dataerr.NotFound("Integration not found.")
		}
		input, err := datactx.Object(body, "Integration", []string{"is_enabled", "endpoint_label", "credential_ref", "fallback_timeout_seconds"})
		if err != nil {
			return auditlog.AuditedWrite[Integration]{}, err
		}
		enabled := existing.IsEnabled
		if v, has, err := datactx.OptBool(input, "is_enabled"); err != nil {
			return auditlog.AuditedWrite[Integration]{}, err
		} else if has {
			enabled = v
		}
		credential := existing.CredentialRef
		if datactx.Has(input, "credential_ref") {
			c, err := datactx.NullableString(input, "credential_ref", datactx.StrOpts{Max: 200, HasMax: true})
			if err != nil {
				return auditlog.AuditedWrite[Integration]{}, err
			}
			if c != nil && !strings.HasPrefix(*c, "secret://") {
				return auditlog.AuditedWrite[Integration]{}, dataerr.Invalid("Integration: credential_ref must be a reference (secret://...), never the secret itself.")
			}
			credential = c
		}
		endpointLabel := existing.EndpointLabel
		if datactx.Has(input, "endpoint_label") {
			e, err := datactx.NullableString(input, "endpoint_label", datactx.StrOpts{Max: 200, HasMax: true})
			if err != nil {
				return auditlog.AuditedWrite[Integration]{}, err
			}
			endpointLabel = e
		}
		timeout := existing.FallbackTimeoutSeconds
		if datactx.Has(input, "fallback_timeout_seconds") {
			raw := input["fallback_timeout_seconds"]
			if raw == nil {
				timeout = nil
			} else {
				t, err := datactx.Int(input, "fallback_timeout_seconds", datactx.NumOpts{Min: 1, Max: 300, HasMin: true, HasMax: true})
				if err != nil {
					return auditlog.AuditedWrite[Integration]{}, err
				}
				timeout = &t
			}
		}
		health := existing.Health
		if !enabled {
			health = "disabled"
		} else if existing.Health == "disabled" {
			health = "unknown"
		}
		updated := *existing
		updated.IsEnabled = enabled
		updated.EndpointLabel = endpointLabel
		updated.CredentialRef = credential
		updated.FallbackTimeoutSeconds = timeout
		updated.Health = health
		updated.UpdatedAt = datactx.NowISO()
		if err := saveIntegration(uctx, ctx.CustomerID, updated); err != nil {
			return auditlog.AuditedWrite[Integration]{}, err
		}
		switchNote := ""
		if enabled != existing.IsEnabled {
			if enabled {
				switchNote = " and switched on"
			} else {
				switchNote = " and switched off"
			}
		}
		return auditlog.AuditedWrite[Integration]{Result: updated, SummaryEn: "Integration " + existing.NameEn + " updated" + switchNote + ".", Detail: map[string]any{"kind": existing.Kind, "is_enabled": enabled}}, nil
	})
}

// TestIntegration mirrors testIntegration, a stub.
func TestIntegration(ctx reqctx.RequestContext, id string) (IntegrationTestResult, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminDataSources}, auditlog.WriteMeta{Action: "integration.tested", EntityType: "integration", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[IntegrationTestResult], error) {
		if _, err := importutil.RequireID(id, "Integration"); err != nil {
			return auditlog.AuditedWrite[IntegrationTestResult]{}, err
		}
		integ, err := oneIntegration(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[IntegrationTestResult]{}, err
		}
		if integ == nil {
			return auditlog.AuditedWrite[IntegrationTestResult]{}, dataerr.NotFound("Integration not found.")
		}
		at := datactx.NowISO()
		var result IntegrationTestResult
		switch {
		case !integ.IsEnabled:
			msg := "The integration is switched off."
			result = IntegrationTestResult{OK: false, CheckedAt: at, LatencyMs: nil, Message: &msg}
		case integ.Health == "down":
			msg := "No answer from the feed."
			result = IntegrationTestResult{OK: false, CheckedAt: at, LatencyMs: nil, Message: &msg}
		case integ.Health == "degraded":
			latency := 1800 + int(hashOf(id)%900)
			msg := "Answered, but slowly."
			result = IntegrationTestResult{OK: true, CheckedAt: at, LatencyMs: &latency, Message: &msg}
		default:
			latency := 30 + int(hashOf(id)%90)
			result = IntegrationTestResult{OK: true, CheckedAt: at, LatencyMs: &latency}
		}
		var finalMsg string
		if result.Message != nil {
			finalMsg = *result.Message + " " + StubNothingSent
		} else {
			finalMsg = "Answer scripted from the stored health " + StubNothingSent + "."
		}
		result.Message = &finalMsg
		if result.OK {
			updated := *integ
			updated.LastSuccessAt = &at
			updated.UpdatedAt = at
			if err := saveIntegration(uctx, ctx.CustomerID, updated); err != nil {
				return auditlog.AuditedWrite[IntegrationTestResult]{}, err
			}
		}
		outcome := "ok"
		if !result.OK {
			outcome = "failed"
		}
		return auditlog.AuditedWrite[IntegrationTestResult]{Result: result, SummaryEn: "Integration " + integ.NameEn + " tested: " + outcome + " " + StubNothingSent + ".", Detail: map[string]any{"ok": result.OK, "stub": true}}, nil
	})
}

// GetIntegrationsHealth mirrors the TS function.
func GetIntegrationsHealth(ctx reqctx.RequestContext) (IntegrationsHealth, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminDataSources, access.AccessView); err != nil {
		return IntegrationsHealth{}, err
	}
	stored, err := allIntegrations(context.Background(), ctx.CustomerID)
	if err != nil {
		return IntegrationsHealth{}, err
	}
	all := overlayFeedHealth(ctx.CustomerID, stored, time.Now())
	var enabledHealths []string
	summaries := make([]IntegrationHealthSummary, len(all))
	for i, x := range all {
		if x.IsEnabled {
			enabledHealths = append(enabledHealths, x.Health)
		}
		summaries[i] = IntegrationHealthSummary{IntegrationID: x.ID, Kind: x.Kind, NameEn: x.NameEn, Health: x.Health, LastSuccessAt: x.LastSuccessAt}
	}
	return IntegrationsHealth{AsOf: datactx.NowISO(), Overall: worstHealth(enabledHealths), Integrations: summaries, DataSource: "SYNTHETIC"}, nil
}
