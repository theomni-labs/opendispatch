// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors shift/break parts of data/time.ts.
// Reads: platform.records. Writes: admin here.
// Holiday/Hijri/Prayer/LeavePolicy: later module.
package business

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// ShiftHours mirrors the contract's ShiftHours.
type ShiftHours struct {
	Applies         bool    `json:"applies"`
	StartTime       *string `json:"start_time,omitempty"`
	EndTime         *string `json:"end_time,omitempty"`
	CrossesMidnight bool    `json:"crosses_midnight"`
}

// ShiftKind mirrors ShiftPattern's kind enum.
type ShiftKind string

const (
	ShiftKindField  ShiftKind = "field"
	ShiftKindRemote ShiftKind = "remote"
)

var shiftKinds = []ShiftKind{ShiftKindField, ShiftKindRemote}

// ShiftStatus mirrors ShiftPattern's status enum.
type ShiftStatus string

const (
	ShiftStatusDraft  ShiftStatus = "draft"
	ShiftStatusActive ShiftStatus = "active"
)

var shiftStatuses = []ShiftStatus{ShiftStatusDraft, ShiftStatusActive}

// ShiftPattern mirrors the contract's ShiftPattern.
type ShiftPattern struct {
	datactx.BaseRecord
	Code        string         `json:"code"`
	NameEn      string         `json:"name_en"`
	NameAr      *string        `json:"name_ar"`
	Kind        ShiftKind      `json:"kind"`
	Normal      ShiftHours     `json:"normal"`
	Ramadan     ShiftHours     `json:"ramadan"`
	BreakRuleID *string        `json:"break_rule_id"`
	Status      ShiftStatus    `json:"status"`
	Extra       map[string]any `json:"extra"`
}

// BreakRule mirrors the contract's BreakRule.
type BreakRule struct {
	datactx.BaseRecord
	Code                  string  `json:"code"`
	NameEn                string  `json:"name_en"`
	NameAr                *string `json:"name_ar"`
	BreakMinutes          int     `json:"break_minutes"`
	AfterConsecutiveHours float64 `json:"after_consecutive_hours"`
}

// Reads

func scanShiftHours(raw []byte) (ShiftHours, error) {
	var h ShiftHours
	if err := json.Unmarshal(raw, &h); err != nil {
		return ShiftHours{}, err
	}
	return h, nil
}

func allShiftPatterns(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]ShiftPattern, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]ShiftPattern, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, code, name_en, name_ar, kind, normal, ramadan, break_rule_id, status, extra FROM shift_patterns ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []ShiftPattern
		for rows.Next() {
			var s ShiftPattern
			var createdAt, updatedAt time.Time
			var normalRaw, ramadanRaw, extraRaw []byte
			if err := rows.Scan(&s.ID, &s.TenantID, &createdAt, &updatedAt, &s.CreatedBy, &s.DataSource, &s.Code, &s.NameEn, &s.NameAr, &s.Kind, &normalRaw, &ramadanRaw, &s.BreakRuleID, &s.Status, &extraRaw); err != nil {
				return nil, err
			}
			s.CreatedAt, s.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			if s.Normal, err = scanShiftHours(normalRaw); err != nil {
				return nil, err
			}
			if s.Ramadan, err = scanShiftHours(ramadanRaw); err != nil {
				return nil, err
			}
			if s.Extra, err = scanExtra(extraRaw); err != nil {
				return nil, err
			}
			out = append(out, s)
		}
		return out, rows.Err()
	})
}

func oneShiftPattern(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*ShiftPattern, error) {
	rows, err := allShiftPatterns(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	for _, s := range rows {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, nil
}

func allBreakRules(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]BreakRule, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]BreakRule, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, code, name_en, name_ar, break_minutes, after_consecutive_hours FROM break_rules ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []BreakRule
		for rows.Next() {
			var b BreakRule
			var createdAt, updatedAt time.Time
			if err := rows.Scan(&b.ID, &b.TenantID, &createdAt, &updatedAt, &b.CreatedBy, &b.DataSource, &b.Code, &b.NameEn, &b.NameAr, &b.BreakMinutes, &b.AfterConsecutiveHours); err != nil {
				return nil, err
			}
			b.CreatedAt, b.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			out = append(out, b)
		}
		return out, rows.Err()
	})
}

func oneBreakRule(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*BreakRule, error) {
	rows, err := allBreakRules(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	for _, b := range rows {
		if b.ID == id {
			return &b, nil
		}
	}
	return nil, nil
}

// ShiftPatternQuery mirrors its query type.
type ShiftPatternQuery struct {
	Limit  int
	Cursor string
}

// ListShiftPatterns mirrors listShiftPatterns.
func ListShiftPatterns(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query ShiftPatternQuery) (datactx.PageResult[ShiftPattern], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[ShiftPattern]{}, err
	}
	rows, err := allShiftPatterns(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[ShiftPattern]{}, err
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// GetShiftPattern mirrors getShiftPattern.
func GetShiftPattern(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (*ShiftPattern, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return nil, err
	}
	if _, err := importutil.RequireID(id, "Shift pattern"); err != nil {
		return nil, err
	}
	found, err := oneShiftPattern(ctx, conn, rc.CustomerID, id)
	if err != nil {
		return nil, err
	}
	return datactx.RequireFound(found, "Shift pattern")
}

// BreakRuleQuery mirrors listBreakRules' query.
type BreakRuleQuery struct {
	Limit  int
	Cursor string
}

// ListBreakRules mirrors listBreakRules.
func ListBreakRules(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query BreakRuleQuery) (datactx.PageResult[BreakRule], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[BreakRule]{}, err
	}
	rows, err := allBreakRules(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[BreakRule]{}, err
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// Writes (admin.shift_break_policies)

// crosses_midnight is derived here, not from input.
func shiftHoursFrom(input datactx.Obj, key string) (ShiftHours, error) {
	raw, ok := input[key]
	if !ok {
		return ShiftHours{}, dataerr.Invalid("Shift pattern " + key + " hours: expected an object.")
	}
	hours, err := datactx.Object(raw, "Shift pattern "+key+" hours", []string{"applies", "start_time", "end_time", "crosses_midnight"})
	if err != nil {
		return ShiftHours{}, err
	}
	applies, err := datactx.Bool(hours, "applies")
	if err != nil {
		return ShiftHours{}, err
	}
	if !applies {
		return ShiftHours{Applies: false}, nil
	}
	start, err := datactx.Time(hours, "start_time")
	if err != nil {
		return ShiftHours{}, err
	}
	end, err := datactx.Time(hours, "end_time")
	if err != nil {
		return ShiftHours{}, err
	}
	if start == end {
		return ShiftHours{}, dataerr.Invalid("Shift pattern " + key + " hours: start and end are the same.")
	}
	// 00:00 end = midnight: ends the day, no cross.
	crosses := end != "00:00" && end < start
	return ShiftHours{Applies: true, StartTime: &start, EndTime: &end, CrossesMidnight: crosses}, nil
}

var shiftKeys = []string{"code", "name_en", "name_ar", "kind", "normal", "ramadan", "break_rule_id", "status"}

func shiftFrom(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any, existing *ShiftPattern) (ShiftPattern, error) {
	var zero ShiftPattern
	input, err := datactx.Object(body, "Shift pattern", shiftKeys)
	if err != nil {
		return zero, err
	}
	code, err := datactx.String(input, "code", datactx.StrOpts{Min: 1, Max: 32, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	all, err := allShiftPatterns(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	existingID := ""
	if existing != nil {
		existingID = existing.ID
	}
	for _, s := range all {
		if s.Code == code && s.ID != existingID {
			return zero, dataerr.Conflict("Shift code " + code + " is already used.")
		}
	}
	breakRuleID, err := datactx.UUID(input, "break_rule_id")
	if err != nil {
		return zero, err
	}
	rule, err := oneBreakRule(ctx, conn, rc.CustomerID, breakRuleID)
	if err != nil {
		return zero, err
	}
	if _, err := datactx.RequireFound(rule, "Break rule"); err != nil {
		return zero, err
	}
	at := datactx.NowISO()
	var base datactx.BaseRecord
	if existing == nil {
		base = datactx.NewRecord(rc, "", at)
	} else {
		base = existing.BaseRecord
		base.UpdatedAt = at
	}
	nameEn, err := datactx.String(input, "name_en", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	nameAr, err := datactx.NullableString(input, "name_ar", datactx.StrOpts{Max: 120, HasMax: true})
	if err != nil {
		return zero, err
	}
	kind, err := datactx.EnumOf(input, "kind", shiftKinds)
	if err != nil {
		return zero, err
	}
	normal, err := shiftHoursFrom(input, "normal")
	if err != nil {
		return zero, err
	}
	ramadan, err := shiftHoursFrom(input, "ramadan")
	if err != nil {
		return zero, err
	}
	// New patterns start as a draft; else keep existing.
	status, hasStatus, err := datactx.OptEnum(input, "status", shiftStatuses)
	if err != nil {
		return zero, err
	}
	if !hasStatus {
		if existing != nil {
			status = existing.Status
		} else {
			status = ShiftStatusDraft
		}
	}
	extra := map[string]any{}
	if existing != nil {
		extra = existing.Extra
	}
	return ShiftPattern{BaseRecord: base, Code: code, NameEn: nameEn, NameAr: nameAr, Kind: kind, Normal: normal, Ramadan: ramadan, BreakRuleID: &breakRuleID, Status: status, Extra: extra}, nil
}

func upsertShiftPatternTx(ctx context.Context, tx pgx.Tx, s ShiftPattern) error {
	normal, err := json.Marshal(s.Normal)
	if err != nil {
		return err
	}
	ramadan, err := json.Marshal(s.Ramadan)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO shift_patterns (tenant_id, id, data_source, created_at, updated_at, created_by, code, name_en, name_ar, kind, normal, ramadan, break_rule_id, status, extra)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, code=$7, name_en=$8, name_ar=$9, kind=$10, normal=$11, ramadan=$12, break_rule_id=$13, status=$14, extra=$15`,
		s.TenantID, s.ID, s.DataSource, s.CreatedAt, s.UpdatedAt, s.CreatedBy, s.Code, s.NameEn, s.NameAr, s.Kind, normal, ramadan, s.BreakRuleID, s.Status, s.Extra)
	return err
}

func upsertShiftPattern(ctx context.Context, conn *tenancy.Connection, tenantID string, s ShiftPattern) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, upsertShiftPatternTx(ctx, tx, s)
	})
	return err
}

// CreateShiftPattern mirrors createShiftPattern.
func CreateShiftPattern(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (ShiftPattern, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminShiftBreakPolicies}, auditlog.WriteMeta{Action: "shift_pattern.created", EntityType: "shift_pattern"}, func(ctx context.Context) (auditlog.AuditedWrite[ShiftPattern], error) {
		shift, err := shiftFrom(ctx, conn, rc, body, nil)
		if err != nil {
			return auditlog.AuditedWrite[ShiftPattern]{}, err
		}
		if err := upsertShiftPattern(ctx, conn, rc.CustomerID, shift); err != nil {
			return auditlog.AuditedWrite[ShiftPattern]{}, err
		}
		id := shift.ID
		return auditlog.AuditedWrite[ShiftPattern]{Result: shift, EntityID: &id, SummaryEn: "Shift pattern " + shift.Code + " created.", Detail: sumDetail(nil, map[string]any{"code": shift.Code})}, nil
	})
}

// UpdateShiftPattern mirrors updateShiftPattern.
func UpdateShiftPattern(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (ShiftPattern, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminShiftBreakPolicies}, auditlog.WriteMeta{Action: "shift_pattern.updated", EntityType: "shift_pattern", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[ShiftPattern], error) {
		if _, err := importutil.RequireID(id, "Shift pattern"); err != nil {
			return auditlog.AuditedWrite[ShiftPattern]{}, err
		}
		existing, err := oneShiftPattern(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[ShiftPattern]{}, err
		}
		if _, err := datactx.RequireFound(existing, "Shift pattern"); err != nil {
			return auditlog.AuditedWrite[ShiftPattern]{}, err
		}
		shift, err := shiftFrom(ctx, conn, rc, body, existing)
		if err != nil {
			return auditlog.AuditedWrite[ShiftPattern]{}, err
		}
		if err := upsertShiftPattern(ctx, conn, rc.CustomerID, shift); err != nil {
			return auditlog.AuditedWrite[ShiftPattern]{}, err
		}
		return auditlog.AuditedWrite[ShiftPattern]{Result: shift, SummaryEn: "Shift pattern " + shift.Code + " updated.", Detail: sumDetail(nil, map[string]any{"code": shift.Code})}, nil
	})
}

var breakRuleKeys = []string{"code", "name_en", "name_ar", "break_minutes", "after_consecutive_hours"}

// hours is int (Postgres); TS allows a float.
func breakRuleFrom(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any, existing *BreakRule) (BreakRule, error) {
	var zero BreakRule
	input, err := datactx.Object(body, "Break rule", breakRuleKeys)
	if err != nil {
		return zero, err
	}
	code, err := datactx.String(input, "code", datactx.StrOpts{Min: 1, Max: 32, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	all, err := allBreakRules(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	existingID := ""
	if existing != nil {
		existingID = existing.ID
	}
	for _, b := range all {
		if b.Code == code && b.ID != existingID {
			return zero, dataerr.Conflict("Break rule code " + code + " is already used.")
		}
	}
	hours, err := datactx.Number(input, "after_consecutive_hours", datactx.NumOpts{Max: 12, HasMax: true})
	if err != nil {
		return zero, err
	}
	if hours <= 0 {
		return zero, dataerr.Invalid("Break rule: after_consecutive_hours must be more than 0.")
	}
	at := datactx.NowISO()
	var base datactx.BaseRecord
	if existing == nil {
		base = datactx.NewRecord(rc, "", at)
	} else {
		base = existing.BaseRecord
		base.UpdatedAt = at
	}
	nameEn, err := datactx.String(input, "name_en", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	nameAr, err := datactx.NullableString(input, "name_ar", datactx.StrOpts{Max: 120, HasMax: true})
	if err != nil {
		return zero, err
	}
	breakMinutes, err := datactx.Int(input, "break_minutes", datactx.NumOpts{Min: 1, Max: 180, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	return BreakRule{BaseRecord: base, Code: code, NameEn: nameEn, NameAr: nameAr, BreakMinutes: breakMinutes, AfterConsecutiveHours: hours}, nil
}

func upsertBreakRuleTx(ctx context.Context, tx pgx.Tx, b BreakRule) error {
	_, err := tx.Exec(ctx, `INSERT INTO break_rules (tenant_id, id, data_source, created_at, updated_at, created_by, code, name_en, name_ar, break_minutes, after_consecutive_hours)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, code=$7, name_en=$8, name_ar=$9, break_minutes=$10, after_consecutive_hours=$11`,
		b.TenantID, b.ID, b.DataSource, b.CreatedAt, b.UpdatedAt, b.CreatedBy, b.Code, b.NameEn, b.NameAr, b.BreakMinutes, b.AfterConsecutiveHours)
	return err
}

func upsertBreakRule(ctx context.Context, conn *tenancy.Connection, tenantID string, b BreakRule) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, upsertBreakRuleTx(ctx, tx, b)
	})
	return err
}

// CreateBreakRule mirrors createBreakRule.
func CreateBreakRule(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (BreakRule, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminShiftBreakPolicies}, auditlog.WriteMeta{Action: "break_rule.created", EntityType: "break_rule"}, func(ctx context.Context) (auditlog.AuditedWrite[BreakRule], error) {
		rule, err := breakRuleFrom(ctx, conn, rc, body, nil)
		if err != nil {
			return auditlog.AuditedWrite[BreakRule]{}, err
		}
		if err := upsertBreakRule(ctx, conn, rc.CustomerID, rule); err != nil {
			return auditlog.AuditedWrite[BreakRule]{}, err
		}
		id := rule.ID
		return auditlog.AuditedWrite[BreakRule]{Result: rule, EntityID: &id, SummaryEn: "Break rule " + rule.Code + " created.", Detail: sumDetail(nil, map[string]any{"code": rule.Code})}, nil
	})
}

// UpdateBreakRule mirrors updateBreakRule.
func UpdateBreakRule(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (BreakRule, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminShiftBreakPolicies}, auditlog.WriteMeta{Action: "break_rule.updated", EntityType: "break_rule", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[BreakRule], error) {
		if _, err := importutil.RequireID(id, "Break rule"); err != nil {
			return auditlog.AuditedWrite[BreakRule]{}, err
		}
		existing, err := oneBreakRule(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[BreakRule]{}, err
		}
		if _, err := datactx.RequireFound(existing, "Break rule"); err != nil {
			return auditlog.AuditedWrite[BreakRule]{}, err
		}
		rule, err := breakRuleFrom(ctx, conn, rc, body, existing)
		if err != nil {
			return auditlog.AuditedWrite[BreakRule]{}, err
		}
		if err := upsertBreakRule(ctx, conn, rc.CustomerID, rule); err != nil {
			return auditlog.AuditedWrite[BreakRule]{}, err
		}
		return auditlog.AuditedWrite[BreakRule]{Result: rule, SummaryEn: "Break rule " + rule.Code + " updated.", Detail: sumDetail(nil, map[string]any{"code": rule.Code})}, nil
	})
}
