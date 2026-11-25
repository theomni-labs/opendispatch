// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors system.ts's security_compliance part.
package business

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

var controlStatuses = []string{"not_started", "in_progress", "evidenced", "not_applicable"}

// ControlEvidence mirrors the contract type.
type ControlEvidence struct {
	datactx.BaseRecord
	Framework    string  `json:"framework"`
	ControlRef   string  `json:"control_ref"`
	TitleEn      string  `json:"title_en"`
	Status       string  `json:"status"`
	EvidenceNote *string `json:"evidence_note"`
	ReviewedAt   *string `json:"reviewed_at"`
}

// SessionPolicy mirrors the contract type.
type SessionPolicy struct {
	SessionLengthMinutes  int `json:"session_length_minutes"`
	IdleTimeoutMinutes    int `json:"idle_timeout_minutes"`
	MaxConcurrentSessions int `json:"max_concurrent_sessions"`
}

var defaultSessionPolicy = SessionPolicy{SessionLengthMinutes: 480, IdleTimeoutMinutes: 30, MaxConcurrentSessions: 3}

// SupportAccessSetting mirrors the contract type.
type SupportAccessSetting struct {
	Enabled          bool `json:"enabled"`
	MaxDurationHours int  `json:"max_duration_hours"`
}

// SupportAccessEvent mirrors the contract type.
type SupportAccessEvent struct {
	datactx.BaseRecord
	StartedAt       string  `json:"started_at"`
	EndedAt         *string `json:"ended_at"`
	GrantedByUserID string  `json:"granted_by_user_id"`
	Reason          string  `json:"reason"`
}

var (
	securityMu      sync.Mutex
	controlEvidence []ControlEvidence
	supportEvents   []SupportAccessEvent
	securitySeeded  bool
)

// ResetSecurityComplianceForTest empties both stores.
func ResetSecurityComplianceForTest() {
	securityMu.Lock()
	controlEvidence, supportEvents, securitySeeded = nil, nil, true
	securityMu.Unlock()
}

// ReloadSecurityComplianceForTest restores the seeds.
func ReloadSecurityComplianceForTest() {
	securityMu.Lock()
	controlEvidence, supportEvents, securitySeeded = nil, nil, false
	securityMu.Unlock()
}

type controlSeed struct{ framework, ref, title, status, note string }

var controlSeeds = []controlSeed{
	{"NCA", "NCA-AC-01", "Access is limited by role and zone", "evidenced", "Role matrix reviewed with the Administrator."},
	{"NCA", "NCA-AC-02", "Emergency access is audited", "evidenced", "Every emergency sign-in raises an alert and an audit event."},
	{"NCA", "NCA-LG-01", "Audit log is append only", "evidenced", ""},
	{"NCA", "NCA-CR-01", "Data is encrypted in transit and at rest", "in_progress", "Waiting for the customer cluster settings."},
	{"NCA", "NCA-BK-01", "Backups are confirmed and restore drills are held", "in_progress", "Last restore drill not yet recorded."},
	{"NCA", "NCA-IR-01", "Incident contact is recorded", "not_started", ""},
	{"PDPL", "PDPL-DR-01", "Data stays in the Kingdom", "evidenced", "Private install in the customer cluster."},
	{"PDPL", "PDPL-RT-01", "Retention schedule for personal data", "in_progress", ""},
	{"PDPL", "PDPL-SR-01", "Data subject request process", "not_started", ""},
	{"PDPL", "PDPL-XB-01", "No cross-border transfer without approval", "not_applicable", "No data leaves the customer network."},
	{"other", "OpenDispatch-SUP-01", "Vendor support access is off unless granted", "evidenced", "Support access is switched off by default."},
}

// seedSecurityLocked mirrors seedControls and seedSupportEvents.
func seedSecurityLocked(cx context.Context, ctx reqctx.RequestContext) {
	if securitySeeded {
		return
	}
	securitySeeded = true
	controls, events := securitySeedRows(ctx, adminUserID(cx))
	controlEvidence = append(controlEvidence, controls...)
	supportEvents = append(supportEvents, events...)
}

// securitySeedRows: the sample controls and grant.
func securitySeedRows(ctx reqctx.RequestContext, granted *string) ([]ControlEvidence, []SupportAccessEvent) {
	var controls []ControlEvidence
	for i, c := range controlSeeds {
		row := ControlEvidence{
			BaseRecord: seedBaseFor(ctx, "control|"+c.ref, "2026-08-25T10:00:00+03:00"),
			Framework:  c.framework, ControlRef: c.ref, TitleEn: c.title, Status: c.status,
		}
		if c.note != "" {
			note := c.note
			row.EvidenceNote = &note
		}
		if c.status == "evidenced" {
			at := fmt.Sprintf("2026-09-0%d", i%5+1) + "T10:00:00+03:00"
			row.ReviewedAt = &at
		}
		row.CreatedAt = nudgedCreatedAt(row.CreatedAt, i)
		controls = append(controls, row)
	}
	grantedBy := datactx.DeterministicUUID("seed|no-admin")
	if granted != nil {
		grantedBy = *granted
	}
	ended := "2026-08-20T12:00:00+03:00"
	events := []SupportAccessEvent{{
		BaseRecord: seedBaseFor(ctx, "support|1", "2026-08-20T10:00:00+03:00"),
		StartedAt:  "2026-08-20T10:00:00+03:00", EndedAt: &ended, GrantedByUserID: grantedBy,
		Reason: "Onboarding call, granted by the Administrator.",
	}}
	return controls, events
}

// UpsertControlEvidenceForTest: store upsert, no seeding.
func UpsertControlEvidenceForTest(c ControlEvidence) {
	securityMu.Lock()
	defer securityMu.Unlock()
	for i, x := range controlEvidence {
		if x.ID == c.ID {
			controlEvidence[i] = c
			return
		}
	}
	controlEvidence = append(controlEvidence, c)
}

func allControlEvidenceMemory(cx context.Context, ctx reqctx.RequestContext) []ControlEvidence {
	securityMu.Lock()
	defer securityMu.Unlock()
	seedSecurityLocked(cx, ctx)
	out := make([]ControlEvidence, len(controlEvidence))
	copy(out, controlEvidence)
	return out
}

func oneControlEvidence(cx context.Context, ctx reqctx.RequestContext, id string) (*ControlEvidence, error) {
	all, err := loadControlEvidence(cx, ctx)
	if err != nil {
		return nil, err
	}
	for _, c := range all {
		if c.ID == id {
			return &c, nil
		}
	}
	return nil, nil
}

func allSupportAccessEventsMemory(cx context.Context, ctx reqctx.RequestContext) []SupportAccessEvent {
	securityMu.Lock()
	defer securityMu.Unlock()
	seedSecurityLocked(cx, ctx)
	out := make([]SupportAccessEvent, len(supportEvents))
	copy(out, supportEvents)
	return out
}

func upsertSupportAccessEventMemory(e SupportAccessEvent) {
	securityMu.Lock()
	defer securityMu.Unlock()
	for i, x := range supportEvents {
		if x.ID == e.ID {
			supportEvents[i] = e
			return
		}
	}
	supportEvents = append(supportEvents, e)
}

// ControlEvidenceQuery: listControlEvidence's query.
type ControlEvidenceQuery struct {
	Limit     int
	Cursor    string
	Framework string
}

// ListControlEvidence mirrors listControlEvidence.
func ListControlEvidence(ctx reqctx.RequestContext, query ControlEvidenceQuery) (datactx.PageResult[ControlEvidence], error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminSecurityCompliance, access.AccessView); err != nil {
		return datactx.PageResult[ControlEvidence]{}, err
	}
	all, err := loadControlEvidence(context.Background(), ctx)
	if err != nil {
		return datactx.PageResult[ControlEvidence]{}, err
	}
	var rows []ControlEvidence
	for _, c := range all {
		if query.Framework != "" && c.Framework != query.Framework {
			continue
		}
		rows = append(rows, c)
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// UpdateControlEvidence mirrors the TS write.
func UpdateControlEvidence(ctx reqctx.RequestContext, id string, body any) (ControlEvidence, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminSecurityCompliance}, auditlog.WriteMeta{Action: "control_evidence.updated", EntityType: "control_evidence", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[ControlEvidence], error) {
		if _, err := importutil.RequireID(id, "Control"); err != nil {
			return auditlog.AuditedWrite[ControlEvidence]{}, err
		}
		existing, err := oneControlEvidence(uctx, ctx, id)
		if err != nil {
			return auditlog.AuditedWrite[ControlEvidence]{}, err
		}
		if existing == nil {
			return auditlog.AuditedWrite[ControlEvidence]{}, dataerr.NotFound("Control not found.")
		}
		input, err := datactx.Object(body, "Control evidence", []string{"status", "evidence_note"})
		if err != nil {
			return auditlog.AuditedWrite[ControlEvidence]{}, err
		}
		status, err := datactx.EnumOf(input, "status", controlStatuses)
		if err != nil {
			return auditlog.AuditedWrite[ControlEvidence]{}, err
		}
		note, err := datactx.NullableString(input, "evidence_note", datactx.StrOpts{Max: 1000, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[ControlEvidence]{}, err
		}
		at := datactx.NowISO()
		updated := *existing
		updated.Status, updated.EvidenceNote, updated.ReviewedAt, updated.UpdatedAt = status, note, &at, at
		if err := saveControlEvidence(uctx, ctx.CustomerID, updated); err != nil {
			return auditlog.AuditedWrite[ControlEvidence]{}, err
		}
		return auditlog.AuditedWrite[ControlEvidence]{Result: updated, SummaryEn: "Control " + existing.ControlRef + " set to " + status + ".", Detail: map[string]any{"framework": existing.Framework, "from": existing.Status, "to": status}}, nil
	})
}

// GetSessionPolicy mirrors getSessionPolicy.
func GetSessionPolicy(ctx reqctx.RequestContext) (SessionPolicy, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminSecurityCompliance, access.AccessView); err != nil {
		return SessionPolicy{}, err
	}
	return readSettingStrict(context.Background(), ctx.CustomerID, "security.session_policy", defaultSessionPolicy)
}

// UpdateSessionPolicy mirrors updateSessionPolicy.
func UpdateSessionPolicy(ctx reqctx.RequestContext, body any) (SessionPolicy, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminSecurityCompliance}, auditlog.WriteMeta{Action: "session_policy.updated", EntityType: "setting", EntityID: strPtr("security.session_policy")}, func(uctx context.Context) (auditlog.AuditedWrite[SessionPolicy], error) {
		input, err := datactx.Object(body, "Session policy", []string{"session_length_minutes", "idle_timeout_minutes", "max_concurrent_sessions"})
		if err != nil {
			return auditlog.AuditedWrite[SessionPolicy]{}, err
		}
		length, err := datactx.Int(input, "session_length_minutes", datactx.NumOpts{Min: 5, Max: 1440, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[SessionPolicy]{}, err
		}
		idle, err := datactx.Int(input, "idle_timeout_minutes", datactx.NumOpts{Min: 1, Max: 240, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[SessionPolicy]{}, err
		}
		maxSessions, err := datactx.Int(input, "max_concurrent_sessions", datactx.NumOpts{Min: 1, Max: 20, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[SessionPolicy]{}, err
		}
		if idle > length {
			return auditlog.AuditedWrite[SessionPolicy]{}, dataerr.Invalid("Session policy: the idle timeout is longer than the session.")
		}
		policy := SessionPolicy{SessionLengthMinutes: length, IdleTimeoutMinutes: idle, MaxConcurrentSessions: maxSessions}
		before, err := readSettingStrict(uctx, ctx.CustomerID, "security.session_policy", defaultSessionPolicy)
		if err != nil {
			return auditlog.AuditedWrite[SessionPolicy]{}, err
		}
		if err := settingsstore.Put(uctx, ctx.CustomerID, "security.session_policy", policy); err != nil {
			return auditlog.AuditedWrite[SessionPolicy]{}, err
		}
		return auditlog.AuditedWrite[SessionPolicy]{Result: policy, SummaryEn: "Session policy updated.", Detail: map[string]any{"from": before, "to": policy}}, nil
	})
}

// GetSupportAccessSetting mirrors the TS read.
func GetSupportAccessSetting(ctx reqctx.RequestContext) (SupportAccessSetting, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminSecurityCompliance, access.AccessView); err != nil {
		return SupportAccessSetting{}, err
	}
	return readSupportAccess(context.Background(), ctx.CustomerID)
}

// supportAccessSetting: inside cx's unit.
func supportAccessSetting(cx context.Context, ctx reqctx.RequestContext) (SupportAccessSetting, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminSecurityCompliance, access.AccessView); err != nil {
		return SupportAccessSetting{}, err
	}
	return readSupportAccess(cx, ctx.CustomerID)
}

func readSupportAccess(ctx context.Context, tenant string) (SupportAccessSetting, error) {
	enabled, err := readSettingStrict(ctx, tenant, "support_access.enabled", false)
	if err != nil {
		return SupportAccessSetting{}, err
	}
	hours, err := readSettingStrict(ctx, tenant, "support_access.max_duration_hours", 8)
	if err != nil {
		return SupportAccessSetting{}, err
	}
	return SupportAccessSetting{Enabled: enabled, MaxDurationHours: hours}, nil
}

// UpdateSupportAccessSetting mirrors the TS write.
func UpdateSupportAccessSetting(ctx reqctx.RequestContext, body any) (SupportAccessSetting, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminSecurityCompliance}, auditlog.WriteMeta{Action: "support_access.updated", EntityType: "setting", EntityID: strPtr("support_access")}, func(uctx context.Context) (auditlog.AuditedWrite[SupportAccessSetting], error) {
		input, err := datactx.Object(body, "Support access", []string{"enabled", "max_duration_hours"})
		if err != nil {
			return auditlog.AuditedWrite[SupportAccessSetting]{}, err
		}
		enabled, err := datactx.Bool(input, "enabled")
		if err != nil {
			return auditlog.AuditedWrite[SupportAccessSetting]{}, err
		}
		maxHours, err := datactx.Int(input, "max_duration_hours", datactx.NumOpts{Min: 1, Max: 72, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[SupportAccessSetting]{}, err
		}
		before, err := readSupportAccess(uctx, ctx.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[SupportAccessSetting]{}, err
		}
		next := SupportAccessSetting{Enabled: enabled, MaxDurationHours: maxHours}
		if err := settingsstore.PutMany(uctx, ctx.CustomerID, settingsstore.KV{Key: "support_access.enabled", Value: next.Enabled}, settingsstore.KV{Key: "support_access.max_duration_hours", Value: next.MaxDurationHours}); err != nil {
			return auditlog.AuditedWrite[SupportAccessSetting]{}, err
		}
		onOff := "switched off"
		if next.Enabled {
			onOff = "switched on"
		}
		return auditlog.AuditedWrite[SupportAccessSetting]{Result: next, SummaryEn: "Vendor support access " + onOff + ".", Detail: map[string]any{"from": before, "to": next}}, nil
	})
}

func wholeSeconds(t time.Time) time.Time {
	return t.Truncate(time.Second)
}

func isOpenGrant(e SupportAccessEvent, now time.Time) bool {
	if e.EndedAt == nil {
		return true
	}
	end, err := datactx.EpochOf(*e.EndedAt)
	if err != nil {
		return true
	}
	return end.After(now)
}

// GrantSupportAccess mirrors grantSupportAccess.
func GrantSupportAccess(ctx reqctx.RequestContext, body any) (SupportAccessEvent, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminSecurityCompliance}, auditlog.WriteMeta{Action: "support_access.granted", EntityType: "support_access"}, func(uctx context.Context) (auditlog.AuditedWrite[SupportAccessEvent], error) {
		input, err := datactx.Object(body, "Support access grant", []string{"hours", "reason"})
		if err != nil {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, err
		}
		hours, err := datactx.Int(input, "hours", datactx.NumOpts{Min: 1, Max: 72, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, err
		}
		reason, err := datactx.String(input, "reason", datactx.StrOpts{Min: 1, Max: 500, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, err
		}
		setting, err := supportAccessSetting(uctx, ctx)
		if err != nil {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, err
		}
		if !setting.Enabled {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, dataerr.Conflict("Support access is switched off. Switch it on first.")
		}
		if hours > setting.MaxDurationHours {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, dataerr.Invalid("Support access: the longest grant is too short for this request.")
		}
		start := wholeSeconds(time.Now())
		events, err := loadSupportAccessEvents(uctx, ctx)
		if err != nil {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, err
		}
		for _, e := range events {
			if isOpenGrant(e, start) {
				return auditlog.AuditedWrite[SupportAccessEvent]{}, dataerr.Conflict("Support access is already granted. End it before granting again.")
			}
		}
		startedISO := datactx.ToRiyadhISO(start)
		endedISO := datactx.ToRiyadhISO(start.Add(time.Duration(hours) * time.Hour))
		event := SupportAccessEvent{
			BaseRecord:      datactx.NewRecord(ctx, "", startedISO),
			StartedAt:       startedISO,
			EndedAt:         &endedISO,
			GrantedByUserID: ctx.UserID,
			Reason:          reason,
		}
		if err := saveSupportAccessEvent(uctx, ctx.CustomerID, event); err != nil {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, err
		}
		hourWord := "hours"
		if hours == 1 {
			hourWord = "hour"
		}
		return auditlog.AuditedWrite[SupportAccessEvent]{Result: event, EntityID: &event.ID, SummaryEn: "Vendor support access granted for " + strconv.Itoa(hours) + " " + hourWord + ".", Detail: map[string]any{"hours": hours, "reason": reason, "ends_at": endedISO}}, nil
	})
}

// EndSupportAccess mirrors endSupportAccess.
func EndSupportAccess(ctx reqctx.RequestContext, id string) (SupportAccessEvent, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminSecurityCompliance}, auditlog.WriteMeta{Action: "support_access.ended", EntityType: "support_access", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[SupportAccessEvent], error) {
		if _, err := importutil.RequireID(id, "Support access grant"); err != nil {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, err
		}
		var existing *SupportAccessEvent
		events, err := loadSupportAccessEvents(uctx, ctx)
		if err != nil {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, err
		}
		for _, e := range events {
			if e.ID == id {
				ev := e
				existing = &ev
				break
			}
		}
		if existing == nil {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, dataerr.NotFound("Support access grant not found.")
		}
		now := wholeSeconds(time.Now())
		if !isOpenGrant(*existing, now) {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, dataerr.Conflict("The support access has already ended.")
		}
		at := datactx.ToRiyadhISO(now)
		ended := *existing
		ended.EndedAt, ended.UpdatedAt = &at, at
		if err := saveSupportAccessEvent(uctx, ctx.CustomerID, ended); err != nil {
			return auditlog.AuditedWrite[SupportAccessEvent]{}, err
		}
		return auditlog.AuditedWrite[SupportAccessEvent]{Result: ended, SummaryEn: "Vendor support access ended.", Detail: map[string]any{"was_due_to_end_at": existing.EndedAt}}, nil
	})
}

// ListSupportAccessEvents mirrors the TS function.
func ListSupportAccessEvents(ctx reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[SupportAccessEvent], error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminSecurityCompliance, access.AccessView); err != nil {
		return datactx.PageResult[SupportAccessEvent]{}, err
	}
	rows, err := loadSupportAccessEvents(context.Background(), ctx)
	if err != nil {
		return datactx.PageResult[SupportAccessEvent]{}, err
	}
	sortByStartedAtDesc(rows)
	return datactx.Paginate(rows, query)
}

func sortByStartedAtDesc(rows []SupportAccessEvent) {
	for i := 0; i < len(rows); i++ {
		for j := i + 1; j < len(rows); j++ {
			ti, _ := datactx.EpochOf(rows[i].StartedAt)
			tj, _ := datactx.EpochOf(rows[j].StartedAt)
			if tj.After(ti) {
				rows[i], rows[j] = rows[j], rows[i]
			}
		}
	}
}
