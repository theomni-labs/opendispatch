// SPDX-License-Identifier: AGPL-3.0-only

// Ports the classification-rule part of rules.ts.
// Not Postgres in TS either (readAll/upsert from
// ./internal/store): in-memory here too, like
// auditlog.go. Migrations 0005/0020 exist but TS
// hasn't cut over -- matching that, not the schema.
package business

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

const moduleClassificationRules = access.ModuleAdminClassificationRules

var ruleCodePattern = regexp.MustCompile(`^RULE-[0-9]{3}[A-Z]?$`)
var ruleFieldNamePattern = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

var ruleOperators = []string{"eq", "neq", "lt", "lte", "gt", "gte", "in"}
var ruleOutcomes = []string{"remote_eligible", "field_mandatory", "field_preferred"}
var ruleStatusFilters = []string{"draft", "active", "retired"}

// RulePredicate mirrors RulePredicate. Value is a
// string, float64, bool, or []any of string/float64.
type RulePredicate struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    any    `json:"value"`
}

// RuleCondition mirrors RuleCondition.
type RuleCondition struct {
	Match      string          `json:"match"`
	Predicates []RulePredicate `json:"predicates"`
}

// ClassificationRule mirrors the contract type.
type ClassificationRule struct {
	datactx.BaseRecord
	RuleCode      string  `json:"rule_code"`
	NameEn        string  `json:"name_en"`
	NameAr        *string `json:"name_ar"`
	Status        string  `json:"status"`
	ActiveVersion *int    `json:"active_version"`
	SourceNote    *string `json:"source_note"`
}

// RuleVersion mirrors the contract type.
type RuleVersion struct {
	datactx.BaseRecord
	RuleID          string        `json:"rule_id"`
	RuleCode        string        `json:"rule_code"`
	Version         int           `json:"version"`
	Condition       RuleCondition `json:"condition"`
	ConditionTextEn string        `json:"condition_text_en"`
	Outcome         string        `json:"outcome"`
	Status          string        `json:"status"`
	EffectiveFrom   *string       `json:"effective_from"`
	EffectiveTo     *string       `json:"effective_to"`
	SubmittedAt     *string       `json:"submitted_at"`
	DecidedAt       *string       `json:"decided_at"`
	DecidedByUserID *string       `json:"decided_by_user_id"`
	DecisionNote    *string       `json:"decision_note"`
}

// Approval mirrors the contract's Approval.
type Approval struct {
	datactx.BaseRecord
	SubjectType     string  `json:"subject_type"`
	SubjectID       string  `json:"subject_id"`
	Status          string  `json:"status"`
	SummaryEn       string  `json:"summary_en"`
	RequestedAt     string  `json:"requested_at"`
	DecidedAt       *string `json:"decided_at"`
	DecidedByUserID *string `json:"decided_by_user_id"`
	DecisionNote    *string `json:"decision_note"`
}

type ruleVersionWrite struct {
	Condition       RuleCondition
	ConditionTextEn string
	Outcome         string
	EffectiveFrom   *string
	EffectiveTo     *string
}

type ruleCreateInput struct {
	RuleCode     string
	NameEn       string
	NameAr       *string
	SourceNote   *string
	FirstVersion ruleVersionWrite
}

var (
	rulesMu       sync.Mutex
	rulesStore    []ClassificationRule
	versionStore  []RuleVersion
	approvalStore []Approval
	rulesSeeded   bool
)

// ResetRulesForTest clears the in-memory store.
func ResetRulesForTest() {
	rulesMu.Lock()
	rulesStore = nil
	versionStore = nil
	approvalStore = nil
	rulesSeeded = false
	rulesMu.Unlock()
}

// ensureRulesSeeded: lazy, from fixtures, once (mirrors
// ensureLeaveAgentsSeeded). ClassificationRule,
// RuleVersion and Approval all have committed fixtures
// that TS's demo store loads as its baseline (readAll
// falls back to fixtureRecords); a test that wants its
// own rows resets first, so this only fires in
// production and in tests that don't care about rules.
func ensureRulesSeeded() {
	rulesMu.Lock()
	seeded := rulesSeeded
	rulesMu.Unlock()
	if seeded {
		return
	}
	rules, rulesErr := fixtures.Records[ClassificationRule]("ClassificationRule")
	versions, versionsErr := fixtures.Records[RuleVersion]("RuleVersion")
	approvals, approvalsErr := fixtures.Records[Approval]("Approval")
	rulesMu.Lock()
	if !rulesSeeded {
		if rulesErr == nil {
			rulesStore = rules
		}
		if versionsErr == nil {
			versionStore = versions
		}
		if approvalsErr == nil {
			approvalStore = approvals
		}
		rulesSeeded = true
	}
	rulesMu.Unlock()
}

// requireRuleCode mirrors requireRuleCode.
func requireRuleCode(value any) (string, error) {
	s, ok := value.(string)
	if !ok || !ruleCodePattern.MatchString(s) {
		return "", dataerr.Invalid("rule_code must look like RULE-003 or RULE-003A.")
	}
	return s, nil
}

// requireVersionNumber: version is unknown-typed.
func requireVersionNumber(value any) (int, error) {
	var f float64
	switch v := value.(type) {
	case int:
		f = float64(v)
	case float64:
		f = v
	default:
		return 0, dataerr.Invalid("version must be a whole number from 1.")
	}
	if math.IsNaN(f) || f != math.Trunc(f) || f < 1 {
		return 0, dataerr.Invalid("version must be a whole number from 1.")
	}
	return int(f), nil
}

func requireRule(ctx context.Context, tenantID string, ruleCodeAny any) (ClassificationRule, error) {
	code, err := requireRuleCode(ruleCodeAny)
	if err != nil {
		return ClassificationRule{}, err
	}
	rows, err := allRules(ctx, tenantID)
	if err != nil {
		return ClassificationRule{}, err
	}
	for _, r := range rows {
		if r.RuleCode == code {
			return r, nil
		}
	}
	return ClassificationRule{}, dataerr.NotFound(fmt.Sprintf("Rule %s not found.", code))
}

func requireVersion(ctx context.Context, tenantID string, ruleCodeAny any, versionAny any) (RuleVersion, error) {
	versionNum, err := requireVersionNumber(versionAny)
	if err != nil {
		return RuleVersion{}, err
	}
	ruleCode, err := requireRuleCode(ruleCodeAny)
	if err != nil {
		return RuleVersion{}, err
	}
	rows, err := versionsOf(ctx, tenantID, ruleCode)
	if err != nil {
		return RuleVersion{}, err
	}
	for _, v := range rows {
		if v.Version == versionNum {
			return v, nil
		}
	}
	return RuleVersion{}, dataerr.NotFound(fmt.Sprintf("Version %d of %s not found.", versionNum, ruleCode))
}

// ListRulesQuery mirrors listRules' query.
type ListRulesQuery struct {
	Limit  int
	Cursor string
	Status string // "" = unset
}

// ListRules mirrors listRules.
func ListRules(ctx reqctx.RequestContext, query ListRulesQuery) (datactx.PageResult[ClassificationRule], error) {
	if err := reqctx.RequireAccess(ctx, moduleClassificationRules, access.AccessView); err != nil {
		return datactx.PageResult[ClassificationRule]{}, err
	}
	if query.Status != "" && !stringInList(query.Status, ruleStatusFilters) {
		return datactx.PageResult[ClassificationRule]{}, dataerr.Invalid("status must be draft, active or retired.")
	}
	var filtered []ClassificationRule
	ruleRows, err := allRules(context.Background(), ctx.CustomerID)
	if err != nil {
		return datactx.PageResult[ClassificationRule]{}, err
	}
	for _, r := range ruleRows {
		if query.Status == "" || r.Status == query.Status {
			filtered = append(filtered, r)
		}
	}
	return datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

func stringInList(s string, list []string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// GetRule mirrors getRule.
func GetRule(ctx reqctx.RequestContext, ruleCode any) (ClassificationRule, error) {
	if err := reqctx.RequireAccess(ctx, moduleClassificationRules, access.AccessView); err != nil {
		return ClassificationRule{}, err
	}
	return requireRule(context.Background(), ctx.CustomerID, ruleCode)
}

// ListRuleVersions mirrors listRuleVersions.
func ListRuleVersions(ctx reqctx.RequestContext, ruleCode any, query datactx.PageQuery) (datactx.PageResult[RuleVersion], error) {
	if err := reqctx.RequireAccess(ctx, moduleClassificationRules, access.AccessView); err != nil {
		return datactx.PageResult[RuleVersion]{}, err
	}
	rule, err := requireRule(context.Background(), ctx.CustomerID, ruleCode)
	if err != nil {
		return datactx.PageResult[RuleVersion]{}, err
	}
	rows, err := versionsOf(context.Background(), ctx.CustomerID, rule.RuleCode)
	if err != nil {
		return datactx.PageResult[RuleVersion]{}, err
	}
	return datactx.Paginate(rows, query)
}

func isFiniteNumber(v any) bool {
	switch n := v.(type) {
	case float64:
		return !math.IsNaN(n) && !math.IsInf(n, 0)
	case int:
		return true
	}
	return false
}

func parsePredicate(input any) (RulePredicate, error) {
	o, err := datactx.Object(input, "Predicate", []string{"field", "operator", "value"})
	if err != nil {
		return RulePredicate{}, err
	}
	field, err := datactx.String(o, "field", datactx.StrOpts{Max: 64, HasMax: true, Pattern: ruleFieldNamePattern})
	if err != nil {
		return RulePredicate{}, err
	}
	operator, err := datactx.EnumOf(o, "operator", ruleOperators)
	if err != nil {
		return RulePredicate{}, err
	}
	value := o["value"]
	if s, ok := value.(string); ok && len(s) > 120 {
		return RulePredicate{}, dataerr.Invalid("Predicate: value must have at most 120 characters.")
	}
	if list, ok := value.([]any); ok {
		for _, item := range list {
			_, isStr := item.(string)
			if !isStr && !isFiniteNumber(item) {
				return RulePredicate{}, dataerr.Invalid("Predicate: a list value holds strings or numbers.")
			}
		}
		return RulePredicate{Field: field, Operator: operator, Value: list}, nil
	}
	switch v := value.(type) {
	case string, bool:
	case float64, int:
		if !isFiniteNumber(v) {
			return RulePredicate{}, dataerr.Invalid("Predicate: value must be a string, number, boolean or list.")
		}
	default:
		return RulePredicate{}, dataerr.Invalid("Predicate: value must be a string, number, boolean or list.")
	}
	if operator == "in" {
		return RulePredicate{}, dataerr.Invalid("Predicate: the in operator needs a list value.")
	}
	return RulePredicate{Field: field, Operator: operator, Value: value}, nil
}

func parseCondition(input any) (RuleCondition, error) {
	o, err := datactx.Object(input, "Condition", []string{"match", "predicates"})
	if err != nil {
		return RuleCondition{}, err
	}
	match, err := datactx.EnumOf(o, "match", []string{"all", "any"})
	if err != nil {
		return RuleCondition{}, err
	}
	list, ok := o["predicates"].([]any)
	if !ok || len(list) < 1 {
		return RuleCondition{}, dataerr.Invalid("Condition: at least one predicate is needed.")
	}
	predicates := make([]RulePredicate, len(list))
	for i, item := range list {
		p, err := parsePredicate(item)
		if err != nil {
			return RuleCondition{}, err
		}
		predicates[i] = p
	}
	return RuleCondition{Match: match, Predicates: predicates}, nil
}

// optDateOrNull: absent and explicit null both mean
// nil here -- both are treated alike downstream.
func optDateOrNull(o datactx.Obj, key string) (*string, error) {
	if v, ok := o[key]; ok && v == nil {
		return nil, nil
	}
	s, has, err := datactx.OptDate(o, key)
	if err != nil {
		return nil, err
	}
	if !has {
		return nil, nil
	}
	return &s, nil
}

func nullableOptString(o datactx.Obj, key string, max int) (*string, error) {
	if v, ok := o[key]; ok && v == nil {
		return nil, nil
	}
	s, has, err := datactx.OptString(o, key, datactx.StrOpts{Max: max, HasMax: true})
	if err != nil {
		return nil, err
	}
	if !has {
		return nil, nil
	}
	return &s, nil
}

func parseVersionWrite(input any) (ruleVersionWrite, error) {
	o, err := datactx.Object(input, "Rule version", []string{"condition", "condition_text_en", "outcome", "effective_from", "effective_to"})
	if err != nil {
		return ruleVersionWrite{}, err
	}
	from, err := optDateOrNull(o, "effective_from")
	if err != nil {
		return ruleVersionWrite{}, err
	}
	to, err := optDateOrNull(o, "effective_to")
	if err != nil {
		return ruleVersionWrite{}, err
	}
	if from != nil && to != nil && *to < *from {
		return ruleVersionWrite{}, dataerr.Invalid("Rule version: effective_to must not be before effective_from.")
	}
	condition, err := parseCondition(o["condition"])
	if err != nil {
		return ruleVersionWrite{}, err
	}
	conditionText, err := datactx.String(o, "condition_text_en", datactx.StrOpts{Min: 1, Max: 500, HasMin: true, HasMax: true})
	if err != nil {
		return ruleVersionWrite{}, err
	}
	outcome, err := datactx.EnumOf(o, "outcome", ruleOutcomes)
	if err != nil {
		return ruleVersionWrite{}, err
	}
	return ruleVersionWrite{Condition: condition, ConditionTextEn: conditionText, Outcome: outcome, EffectiveFrom: from, EffectiveTo: to}, nil
}

func parseRuleCreate(input any) (ruleCreateInput, error) {
	o, err := datactx.Object(input, "Rule", []string{"rule_code", "name_en", "name_ar", "source_note", "first_version"})
	if err != nil {
		return ruleCreateInput{}, err
	}
	ruleCode, err := datactx.String(o, "rule_code", datactx.StrOpts{Pattern: ruleCodePattern})
	if err != nil {
		return ruleCreateInput{}, err
	}
	nameEn, err := datactx.String(o, "name_en", datactx.StrOpts{Min: 1, Max: 200, HasMin: true, HasMax: true})
	if err != nil {
		return ruleCreateInput{}, err
	}
	nameAr, err := nullableOptString(o, "name_ar", 200)
	if err != nil {
		return ruleCreateInput{}, err
	}
	sourceNote, err := nullableOptString(o, "source_note", 500)
	if err != nil {
		return ruleCreateInput{}, err
	}
	firstVersion, err := parseVersionWrite(o["first_version"])
	if err != nil {
		return ruleCreateInput{}, err
	}
	return ruleCreateInput{RuleCode: ruleCode, NameEn: nameEn, NameAr: nameAr, SourceNote: sourceNote, FirstVersion: firstVersion}, nil
}

func parseDecision(input any) (*string, error) {
	if input == nil {
		input = map[string]any{}
	}
	o, err := datactx.Object(input, "Decision", []string{"note"})
	if err != nil {
		return nil, err
	}
	return datactx.NullableString(o, "note", datactx.StrOpts{Max: 500, HasMax: true})
}

func draftVersion(ctx reqctx.RequestContext, rule ClassificationRule, version int, write ruleVersionWrite, at string) RuleVersion {
	return RuleVersion{
		BaseRecord:      datactx.NewRecord(ctx, "", at),
		RuleID:          rule.ID,
		RuleCode:        rule.RuleCode,
		Version:         version,
		Condition:       write.Condition,
		ConditionTextEn: write.ConditionTextEn,
		Outcome:         write.Outcome,
		Status:          "draft",
		EffectiveFrom:   write.EffectiveFrom,
		EffectiveTo:     write.EffectiveTo,
	}
}

func entityIDOfAny(value any) *string {
	if value == nil {
		return nil
	}
	s, ok := value.(string)
	if !ok {
		s = fmt.Sprintf("%v", value)
	}
	return &s
}

func truncateStr(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// CreateRule mirrors createRule.
func CreateRule(ctx reqctx.RequestContext, body any) (ClassificationRule, error) {
	var codePtr *string
	if o, ok := body.(map[string]any); ok {
		if s, ok := o["rule_code"].(string); ok {
			codePtr = &s
		}
	}
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleClassificationRules}, auditlog.WriteMeta{Action: "rule.created", EntityType: "rule", EntityID: codePtr}, func(uctx context.Context) (auditlog.AuditedWrite[ClassificationRule], error) {
		input, err := parseRuleCreate(body)
		if err != nil {
			return auditlog.AuditedWrite[ClassificationRule]{}, err
		}
		existingRules, err := allRules(uctx, ctx.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[ClassificationRule]{}, err
		}
		for _, r := range existingRules {
			if r.RuleCode == input.RuleCode {
				return auditlog.AuditedWrite[ClassificationRule]{}, dataerr.Conflict("Rule " + input.RuleCode + " already exists.")
			}
		}
		at := datactx.NowISO()
		rule := ClassificationRule{
			BaseRecord: datactx.NewRecord(ctx, "", at),
			RuleCode:   input.RuleCode,
			NameEn:     input.NameEn,
			NameAr:     input.NameAr,
			Status:     "draft",
			SourceNote: input.SourceNote,
		}
		var writes ruleWrites
		writes.rule(rule)
		writes.version(draftVersion(ctx, rule, 1, input.FirstVersion, at))
		if err := writes.commit(uctx, ctx.CustomerID); err != nil {
			return auditlog.AuditedWrite[ClassificationRule]{}, err
		}
		code := rule.RuleCode
		return auditlog.AuditedWrite[ClassificationRule]{Result: rule, EntityID: &code, SummaryEn: rule.RuleCode + " drafted (version 1, Draft).", Detail: map[string]any{"rule_code": rule.RuleCode, "version": 1}}, nil
	})
}

// CreateRuleVersionDraft mirrors the TS function.
func CreateRuleVersionDraft(ctx reqctx.RequestContext, ruleCode any, body any) (RuleVersion, error) {
	entityID := entityIDOfAny(ruleCode)
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleClassificationRules}, auditlog.WriteMeta{Action: "rule.version_drafted", EntityType: "rule", EntityID: entityID}, func(uctx context.Context) (auditlog.AuditedWrite[RuleVersion], error) {
		rule, err := requireRule(uctx, ctx.CustomerID, ruleCode)
		if err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		if rule.Status == "retired" {
			return auditlog.AuditedWrite[RuleVersion]{}, dataerr.Conflict(rule.RuleCode + " is retired.")
		}
		write, err := parseVersionWrite(body)
		if err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		versions, err := versionsOf(uctx, ctx.CustomerID, rule.RuleCode)
		if err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		for _, v := range versions {
			if v.Status == "draft" || v.Status == "submitted" {
				return auditlog.AuditedWrite[RuleVersion]{}, dataerr.Conflict(rule.RuleCode + " already has a version waiting (draft or submitted).")
			}
		}
		next := 0
		for _, v := range versions {
			if v.Version > next {
				next = v.Version
			}
		}
		next++
		created := draftVersion(ctx, rule, next, write, datactx.NowISO())
		if err := (ruleWrites{versions: []RuleVersion{created}}).commit(uctx, ctx.CustomerID); err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		code := rule.RuleCode
		return auditlog.AuditedWrite[RuleVersion]{Result: created, EntityID: &code, SummaryEn: fmt.Sprintf("%s version %d drafted (Draft).", rule.RuleCode, next), Detail: map[string]any{"rule_code": rule.RuleCode, "version": next}}, nil
	})
}

// UpdateRuleVersionDraft mirrors the TS function.
func UpdateRuleVersionDraft(ctx reqctx.RequestContext, ruleCode any, versionAny any, body any) (RuleVersion, error) {
	entityID := fmt.Sprintf("%v:%v", ruleCode, versionAny)
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleClassificationRules}, auditlog.WriteMeta{Action: "rule.draft_updated", EntityType: "rule_version", EntityID: &entityID}, func(uctx context.Context) (auditlog.AuditedWrite[RuleVersion], error) {
		current, err := requireVersion(uctx, ctx.CustomerID, ruleCode, versionAny)
		if err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		if current.Status != "draft" {
			return auditlog.AuditedWrite[RuleVersion]{}, dataerr.Conflict("Only drafts can be changed.")
		}
		write, err := parseVersionWrite(body)
		if err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		next := current
		next.Condition = write.Condition
		next.ConditionTextEn = write.ConditionTextEn
		next.Outcome = write.Outcome
		next.EffectiveFrom = write.EffectiveFrom
		next.EffectiveTo = write.EffectiveTo
		next.UpdatedAt = datactx.NowISO()
		if err := (ruleWrites{versions: []RuleVersion{next}}).commit(uctx, ctx.CustomerID); err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		id := next.ID
		return auditlog.AuditedWrite[RuleVersion]{Result: next, EntityID: &id, SummaryEn: fmt.Sprintf("%s version %d draft changed.", current.RuleCode, current.Version), Detail: map[string]any{"rule_code": current.RuleCode, "version": current.Version}}, nil
	})
}

func outcomeLabel(outcome string) string {
	return strings.Replace(outcome, "_", " ", 1)
}

// SubmitRuleVersion mirrors submitRuleVersion.
func SubmitRuleVersion(ctx reqctx.RequestContext, ruleCode any, versionAny any) (RuleVersion, error) {
	entityID := fmt.Sprintf("%v:%v", ruleCode, versionAny)
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleClassificationRules}, auditlog.WriteMeta{Action: "rule.submitted", EntityType: "rule_version", EntityID: &entityID}, func(uctx context.Context) (auditlog.AuditedWrite[RuleVersion], error) {
		current, err := requireVersion(uctx, ctx.CustomerID, ruleCode, versionAny)
		if err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		if current.Status != "draft" {
			return auditlog.AuditedWrite[RuleVersion]{}, dataerr.Conflict("Only a draft can be submitted.")
		}
		at := datactx.NowISO()
		next := current
		next.Status = "submitted"
		next.SubmittedAt = &at
		next.UpdatedAt = at
		approval := Approval{
			BaseRecord:  datactx.NewRecord(ctx, "", at),
			SubjectType: "rule_version",
			SubjectID:   current.ID,
			Status:      "pending",
			SummaryEn:   truncateStr(fmt.Sprintf("%s version %d: %s gives %s", current.RuleCode, current.Version, current.ConditionTextEn, outcomeLabel(current.Outcome)), 300),
			RequestedAt: at,
		}
		created := approval
		if err := (ruleWrites{versions: []RuleVersion{next}, approvals: []Approval{approval}}).commit(uctx, ctx.CustomerID); err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		id := current.ID
		return auditlog.AuditedWrite[RuleVersion]{Result: next, EntityID: &id, SummaryEn: fmt.Sprintf("%s version %d submitted for approval.", current.RuleCode, current.Version), Detail: map[string]any{"rule_code": current.RuleCode, "version": current.Version, "approval_id": created.ID}}, nil
	})
}

func demoToday(ctx context.Context, tenant string) string {
	return todayIn(ctx, tenant)
}

func addDays(date string, days int) string {
	t, _ := time.Parse("2006-01-02", date)
	return t.AddDate(0, 0, days).Format("2006-01-02")
}

func decide(ctx reqctx.RequestContext, ruleCode any, versionAny any, body any, decision string) (RuleVersion, error) {
	action := "rule.rejected"
	if decision == "approved" {
		action = "rule.approved"
	}
	entityID := fmt.Sprintf("%v:%v", ruleCode, versionAny)
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{Func: func() error {
		return reqctx.RequireAccess(ctx, moduleClassificationRules, access.AccessView)
	}}, auditlog.WriteMeta{Action: action, EntityType: "rule_version", EntityID: &entityID}, func(uctx context.Context) (auditlog.AuditedWrite[RuleVersion], error) {
		note, err := parseDecision(body)
		if err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		current, err := requireVersion(uctx, ctx.CustomerID, ruleCode, versionAny)
		if err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		approval, err := pendingApproval(uctx, ctx.CustomerID, current.ID)
		if err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		requesterID := "system"
		if approval != nil && approval.CreatedBy != nil {
			requesterID = *approval.CreatedBy
		} else if current.CreatedBy != nil {
			requesterID = *current.CreatedBy
		}
		check := access.CheckApproval(access.ApprovalRequest{
			Role: ctx.Role, RequesterUserID: requesterID, ApproverUserID: ctx.UserID,
			Kind: access.ApprovalRule, InstallMode: ctx.InstallMode, HasInstallMode: true,
		})
		if !check.Allowed {
			verb := "reject"
			if decision == "approved" {
				verb = "approve"
			}
			return auditlog.AuditedWrite[RuleVersion]{}, dataerr.Forbidden(fmt.Sprintf("%s may not %s %v version %v (%s).", ctx.Role, verb, ruleCode, versionAny, check.Reason))
		}
		if current.Status != "submitted" {
			return auditlog.AuditedWrite[RuleVersion]{}, dataerr.Conflict(fmt.Sprintf("Version %d of %s is %s, not submitted.", current.Version, current.RuleCode, current.Status))
		}
		rule, err := requireRule(uctx, ctx.CustomerID, ruleCode)
		if err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		at := datactx.NowISO()
		today := demoToday(uctx, ctx.CustomerID)
		userID := ctx.UserID

		if decision == "rejected" {
			next := current
			next.DecidedAt, next.DecidedByUserID, next.DecisionNote, next.UpdatedAt = &at, &userID, note, at
			next.Status = "rejected"
			var writes ruleWrites
			writes.version(next)
			if approval != nil {
				a := *approval
				a.DecidedAt, a.DecidedByUserID, a.DecisionNote, a.UpdatedAt = &at, &userID, note, at
				a.Status = "rejected"
				writes.approval(a)
			}
			if err := writes.commit(uctx, ctx.CustomerID); err != nil {
				return auditlog.AuditedWrite[RuleVersion]{}, err
			}
			id := current.ID
			return auditlog.AuditedWrite[RuleVersion]{Result: next, EntityID: &id, SummaryEn: fmt.Sprintf("%s version %d rejected.", rule.RuleCode, current.Version), Detail: map[string]any{"rule_code": rule.RuleCode, "version": current.Version}}, nil
		}

		effectiveFrom := today
		if current.EffectiveFrom != nil {
			effectiveFrom = *current.EffectiveFrom
		}
		next := current
		next.DecidedAt, next.DecidedByUserID, next.DecisionNote, next.UpdatedAt = &at, &userID, note, at
		next.Status = "active"
		next.EffectiveFrom = &effectiveFrom
		var writes ruleWrites
		olderVersions, err := versionsOf(uctx, ctx.CustomerID, rule.RuleCode)
		if err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		for _, old := range olderVersions {
			if old.Status != "active" || old.ID == current.ID {
				continue
			}
			end := addDays(effectiveFrom, -1)
			if old.EffectiveTo != nil && *old.EffectiveTo < end {
				end = *old.EffectiveTo
			}
			o := old
			o.Status, o.EffectiveTo, o.UpdatedAt = "superseded", &end, at
			writes.version(o)
		}
		writes.version(next)
		r := rule
		av := current.Version
		r.Status, r.ActiveVersion, r.UpdatedAt = "active", &av, at
		writes.rule(r)
		if approval != nil {
			a := *approval
			a.DecidedAt, a.DecidedByUserID, a.DecisionNote, a.UpdatedAt = &at, &userID, note, at
			a.Status = "approved"
			writes.approval(a)
		}
		if err := writes.commit(uctx, ctx.CustomerID); err != nil {
			return auditlog.AuditedWrite[RuleVersion]{}, err
		}
		id := current.ID
		return auditlog.AuditedWrite[RuleVersion]{Result: next, EntityID: &id, SummaryEn: fmt.Sprintf("%s version %d approved; it takes effect from %s.", rule.RuleCode, current.Version, effectiveFrom), Detail: map[string]any{"rule_code": rule.RuleCode, "version": current.Version, "effective_from": effectiveFrom}}, nil
	})
}

// ApproveRuleVersion mirrors approveRuleVersion.
func ApproveRuleVersion(ctx reqctx.RequestContext, ruleCode any, versionAny any, body any) (RuleVersion, error) {
	return decide(ctx, ruleCode, versionAny, body, "approved")
}

// RejectRuleVersion mirrors rejectRuleVersion.
func RejectRuleVersion(ctx reqctx.RequestContext, ruleCode any, versionAny any, body any) (RuleVersion, error) {
	return decide(ctx, ruleCode, versionAny, body, "rejected")
}

// RetireRule mirrors retireRule.
func RetireRule(ctx reqctx.RequestContext, ruleCode any, body any) (ClassificationRule, error) {
	entityID := entityIDOfAny(ruleCode)
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleClassificationRules}, auditlog.WriteMeta{Action: "rule.retired", EntityType: "rule", EntityID: entityID}, func(uctx context.Context) (auditlog.AuditedWrite[ClassificationRule], error) {
		note, err := parseDecision(body)
		if err != nil {
			return auditlog.AuditedWrite[ClassificationRule]{}, err
		}
		rule, err := requireRule(uctx, ctx.CustomerID, ruleCode)
		if err != nil {
			return auditlog.AuditedWrite[ClassificationRule]{}, err
		}
		if rule.Status == "retired" {
			return auditlog.AuditedWrite[ClassificationRule]{}, dataerr.Conflict(rule.RuleCode + " is already retired.")
		}
		at := datactx.NowISO()
		today := demoToday(uctx, ctx.CustomerID)
		userID := ctx.UserID
		var writes ruleWrites
		ruleVersions, err := versionsOf(uctx, ctx.CustomerID, rule.RuleCode)
		if err != nil {
			return auditlog.AuditedWrite[ClassificationRule]{}, err
		}
		for _, row := range ruleVersions {
			if row.Status == "active" {
				end := today
				if row.EffectiveTo != nil && *row.EffectiveTo < today {
					end = *row.EffectiveTo
				}
				noteVal := row.DecisionNote
				if note != nil {
					noteVal = note
				}
				r := row
				r.Status, r.EffectiveTo, r.DecisionNote, r.UpdatedAt = "retired", &end, noteVal, at
				writes.version(r)
			} else if row.Status == "draft" || row.Status == "submitted" {
				approval, err := pendingApproval(uctx, ctx.CustomerID, row.ID)
				if err != nil {
					return auditlog.AuditedWrite[ClassificationRule]{}, err
				}
				if approval != nil {
					a := *approval
					a.Status, a.DecidedAt, a.DecidedByUserID, a.DecisionNote, a.UpdatedAt = "cancelled", &at, &userID, note, at
					writes.approval(a)
				}
				r := row
				r.Status, r.UpdatedAt = "superseded", at
				writes.version(r)
			}
		}
		next := rule
		next.Status, next.ActiveVersion, next.UpdatedAt = "retired", nil, at
		writes.rule(next)
		if err := writes.commit(uctx, ctx.CustomerID); err != nil {
			return auditlog.AuditedWrite[ClassificationRule]{}, err
		}
		id := next.ID
		return auditlog.AuditedWrite[ClassificationRule]{Result: next, EntityID: &id, SummaryEn: rule.RuleCode + " retired.", Detail: map[string]any{"rule_code": rule.RuleCode, "note": note}}, nil
	})
}
