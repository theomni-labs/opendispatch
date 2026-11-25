// SPDX-License-Identifier: AGPL-3.0-only

// Package auditlog mirrors internal/audit-log.ts.
// INTERNAL: no public write/append (review M2).
// Events go to a Store: memory by default, Postgres in the api.
package auditlog

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"regexp"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

var actionPattern = regexp.MustCompile(`^[a-z][a-z0-9_.]*$`)

// AuditEvent mirrors the contract's AuditEvent.
type AuditEvent struct {
	ID            string         `json:"id"`
	TenantID      string         `json:"tenant_id"`
	CreatedAt     string         `json:"created_at"`
	CreatedBy     *string        `json:"created_by"`
	DataSource    string         `json:"data_source"`
	UpdatedAt     string         `json:"updated_at"`
	OccurredAt    string         `json:"occurred_at"`
	ActorType     string         `json:"actor_type"`
	ActorUserID   *string        `json:"actor_user_id"`
	Action        string         `json:"action"`
	EntityType    string         `json:"entity_type"`
	EntityID      *string        `json:"entity_id"`
	Outcome       string         `json:"outcome"`
	SummaryEn     string         `json:"summary_en"`
	CorrelationID *string        `json:"correlation_id"`
	Detail        map[string]any `json:"detail"`
}

// RequestContext: what RecordAudit needs.
type RequestContext interface {
	AuditCustomerID() string
	AuditUserID() *string
}

// AuditInput mirrors audit-log.ts's AuditInput.
type AuditInput struct {
	Action        string
	EntityType    string
	EntityID      *string // nil = not named
	SummaryEn     string
	Detail        map[string]any
	Outcome       string // "" -> "success"
	ActorType     string // "" -> "user"
	CorrelationID *string
	// Given=false: default to ctx's user, not null.
	ActorUserID      *string
	ActorUserIDGiven bool
}

func entityIDOf(value *string) *string {
	if value == nil {
		return nil
	}
	s := *value
	if len(s) > 128 {
		s = s[:128]
	}
	return &s
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// nowISO: to the microsecond, what Postgres keeps, so a stored event reads back equal.
func nowISO() string {
	return time.Now().UTC().Truncate(time.Microsecond).Format(time.RFC3339Nano)
}

func newRandomID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// RecordAudit mirrors recordAudit; own transaction.
func RecordAudit(ctx RequestContext, input AuditInput, newID string, at string) (AuditEvent, error) {
	return RecordAuditIn(context.Background(), ctx, input, newID, at)
}

// RecordAuditIn: inside c's unit when it has one.
func RecordAuditIn(c context.Context, ctx RequestContext, input AuditInput, newID string, at string) (AuditEvent, error) {
	if !actionPattern.MatchString(input.Action) || len(input.Action) > 96 {
		return AuditEvent{}, dataerr.Invalid(`Audit action "` + input.Action + `" is not a lower case dotted name.`)
	}
	if newID == "" {
		newID = newRandomID()
	}
	if at == "" {
		at = nowISO()
	}
	actorType := input.ActorType
	if actorType == "" {
		actorType = "user"
	}
	outcome := input.Outcome
	if outcome == "" {
		outcome = "success"
	}
	var actorUserID *string
	if input.ActorUserIDGiven {
		actorUserID = input.ActorUserID
	} else {
		actorUserID = ctx.AuditUserID()
	}
	detail := map[string]any{}
	for k, v := range input.Detail {
		detail[k] = v
	}
	event := AuditEvent{
		ID:            newID,
		TenantID:      ctx.AuditCustomerID(),
		CreatedAt:     at,
		UpdatedAt:     at,
		CreatedBy:     ctx.AuditUserID(),
		DataSource:    recordsource.Get(),
		OccurredAt:    at,
		ActorType:     actorType,
		ActorUserID:   actorUserID,
		Action:        input.Action,
		EntityType:    truncate(input.EntityType, 64),
		EntityID:      entityIDOf(input.EntityID),
		Outcome:       outcome,
		SummaryEn:     truncate(input.SummaryEn, 500),
		CorrelationID: input.CorrelationID,
		Detail:        detail,
	}
	if c == nil {
		c = context.Background()
	}
	writeCtx, cancel := context.WithTimeout(c, 10*time.Second)
	defer cancel()
	if err := activeStore().Insert(writeCtx, event); err != nil {
		return AuditEvent{}, err
	}
	return event, nil
}

// AllEvents: every event in the memory store, oldest first (tests).
func AllEvents() []AuditEvent { return memory.all() }

// ResetForTest clears the in-memory store.
func ResetForTest() { memory.reset() }

// AuditedWrite mirrors AuditedWrite[T].
type AuditedWrite[T any] struct {
	Result    T
	EntityID  *string // overrides meta.EntityID
	SummaryEn string
	Detail    map[string]any
}

// WriteMeta mirrors writeWithAudit's meta parameter.
type WriteMeta struct {
	Action     string
	EntityType string
	EntityID   *string
	ActorType  string // "" -> "user"; "system": no user
}

// Guard: a module id, or a func returning an error.
type Guard struct {
	ModuleID access.ModuleID // used when Func is nil
	Func     func() error
}

// requireAccess: injected, avoids an import cycle.
var requireAccess func(ctx any, moduleID access.ModuleID) error

// SetRequireAccess wires the real edit-access check.
func SetRequireAccess(fn func(ctx any, moduleID access.ModuleID) error) {
	requireAccess = fn
}

// WriteWithAudit: write and audit row, one tx.
func WriteWithAudit[T any](c context.Context, ctx RequestContext, guard Guard, meta WriteMeta, run func(context.Context) (AuditedWrite[T], error)) (T, error) {
	var zero T
	if guardErr := GuardWithAudit(ctx, guard, meta); guardErr != nil {
		return zero, guardErr
	}
	uc, unit, owned := tenancy.BeginUnit(c)
	rollback := func() {
		if owned {
			unit.Rollback(tenancy.Detach(c))
		}
	}
	defer rollback()
	done, err := run(uc)
	if err != nil {
		rollback()
		if de, ok := err.(*dataerr.DataError); ok && de.Code == dataerr.CodeForbidden {
			auditDenied(ctx, meta, err)
		}
		return zero, err
	}
	entityID := done.EntityID
	if entityID == nil {
		entityID = meta.EntityID
	}
	_, auditErr := RecordAuditIn(uc, ctx, AuditInput{Action: meta.Action, EntityType: meta.EntityType, EntityID: entityID, SummaryEn: done.SummaryEn, Detail: done.Detail,
		ActorType: meta.ActorType, ActorUserIDGiven: meta.ActorType == "system"}, "", "")
	if auditErr != nil {
		rollback()
		return zero, auditErr
	}
	if owned {
		if err := unit.Commit(tenancy.Detach(c)); err != nil {
			return zero, err
		}
	}
	return done.Result, nil
}

// GuardWithAudit runs the guard; audits a denial.
func GuardWithAudit(ctx RequestContext, guard Guard, meta WriteMeta) error {
	var guardErr error
	if guard.Func != nil {
		guardErr = guard.Func()
	} else if requireAccess != nil {
		guardErr = requireAccess(ctx, guard.ModuleID)
	}
	if guardErr != nil {
		auditDenied(ctx, meta, guardErr)
	}
	return guardErr
}

func auditDenied(ctx RequestContext, meta WriteMeta, err error) {
	if _, aerr := RecordAudit(ctx, AuditInput{Action: meta.Action, EntityType: meta.EntityType, EntityID: meta.EntityID, SummaryEn: "Denied: " + err.Error(), Outcome: "denied"}, "", ""); aerr != nil {
		log.Printf("audit: denial of %s not recorded: %v", meta.Action, aerr)
	}
}
