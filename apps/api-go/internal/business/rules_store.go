// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"regexp"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// ruleWrites: the rows one action changes; they are stored together or not at all.
type ruleWrites struct {
	rules     []ClassificationRule
	versions  []RuleVersion
	approvals []Approval
}

func (w *ruleWrites) rule(r ClassificationRule) { w.rules = append(w.rules, r) }
func (w *ruleWrites) version(v RuleVersion)     { w.versions = append(w.versions, v) }
func (w *ruleWrites) approval(a Approval)       { w.approvals = append(w.approvals, a) }

// rulesBackend holds rules, versions and approvals: memory by default (unit tests), Postgres in the api.
type rulesBackend interface {
	rules(ctx context.Context, tenantID string) ([]ClassificationRule, error)
	versions(ctx context.Context, tenantID, ruleCode string) ([]RuleVersion, error)
	allVersions(ctx context.Context, tenantID string) ([]RuleVersion, error)
	approvals(ctx context.Context, tenantID string) ([]Approval, error)
	write(ctx context.Context, tenantID string, w ruleWrites) error
}

var rulesData rulesBackend = memoryRules{}

// UsePostgresRules moves rules, versions and approvals into their tables.
func UsePostgresRules(conn *tenancy.Connection) { rulesData = pgRules{conn: conn} }

// UseMemoryRules puts the in-memory store back (tests).
func UseMemoryRules() { rulesData = memoryRules{} }

func allRules(ctx context.Context, tenantID string) ([]ClassificationRule, error) {
	return rulesData.rules(ctx, tenantID)
}

func versionsOf(ctx context.Context, tenantID, ruleCode string) ([]RuleVersion, error) {
	return rulesData.versions(ctx, tenantID, ruleCode)
}

func allRuleVersions(ctx context.Context, tenantID string) ([]RuleVersion, error) {
	return rulesData.allVersions(ctx, tenantID)
}

func allApprovals(ctx context.Context, tenantID string) ([]Approval, error) {
	return rulesData.approvals(ctx, tenantID)
}

func pendingApproval(ctx context.Context, tenantID, versionID string) (*Approval, error) {
	rows, err := allApprovals(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for _, a := range rows {
		if a.SubjectType == "rule_version" && a.SubjectID == versionID && a.Status == "pending" {
			row := a
			return &row, nil
		}
	}
	return nil, nil
}

func (w ruleWrites) commit(ctx context.Context, tenantID string) error {
	return rulesData.write(ctx, tenantID, w)
}

// saveApproval: one approval row (other domains, such as rosters, share the approvals table).
func saveApproval(ctx context.Context, tenantID string, a Approval) error {
	return ruleWrites{approvals: []Approval{a}}.commit(ctx, tenantID)
}

// rulesOrLog: for readers that cannot return an error; a failure is logged, never hidden.
func rulesOrLog(ctx context.Context, tenantID string) []ClassificationRule {
	rows, err := allRules(ctx, tenantID)
	if err != nil {
		log.Printf("rules: read failed: %v", err)
	}
	return rows
}

func approvalsOrLog(ctx context.Context, tenantID string) []Approval {
	rows, err := allApprovals(ctx, tenantID)
	if err != nil {
		log.Printf("approvals: read failed: %v", err)
	}
	return rows
}

// ---- memory ----

type memoryRules struct{}

func (memoryRules) rules(_ context.Context, _ string) ([]ClassificationRule, error) {
	ensureRulesSeeded()
	rulesMu.Lock()
	out := make([]ClassificationRule, len(rulesStore))
	copy(out, rulesStore)
	rulesMu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].RuleCode < out[j].RuleCode })
	return out, nil
}

func (memoryRules) versions(_ context.Context, _, ruleCode string) ([]RuleVersion, error) {
	ensureRulesSeeded()
	rulesMu.Lock()
	var out []RuleVersion
	for _, v := range versionStore {
		if v.RuleCode == ruleCode {
			out = append(out, v)
		}
	}
	rulesMu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}

func (memoryRules) allVersions(_ context.Context, _ string) ([]RuleVersion, error) {
	ensureRulesSeeded()
	rulesMu.Lock()
	out := append([]RuleVersion(nil), versionStore...)
	rulesMu.Unlock()
	return out, nil
}

func (memoryRules) approvals(_ context.Context, _ string) ([]Approval, error) {
	ensureRulesSeeded()
	rulesMu.Lock()
	out := make([]Approval, len(approvalStore))
	copy(out, approvalStore)
	rulesMu.Unlock()
	return out, nil
}

func (memoryRules) write(_ context.Context, _ string, w ruleWrites) error {
	ensureRulesSeeded()
	rulesMu.Lock()
	defer rulesMu.Unlock()
	for _, r := range w.rules {
		replaced := false
		for i, x := range rulesStore {
			if x.ID == r.ID {
				rulesStore[i], replaced = r, true
				break
			}
		}
		if !replaced {
			rulesStore = append(rulesStore, r)
		}
	}
	for _, v := range w.versions {
		replaced := false
		for i, x := range versionStore {
			if x.ID == v.ID {
				versionStore[i], replaced = v, true
				break
			}
		}
		if !replaced {
			versionStore = append(versionStore, v)
		}
	}
	for _, a := range w.approvals {
		replaced := false
		for i, x := range approvalStore {
			if x.ID == a.ID {
				approvalStore[i], replaced = a, true
				break
			}
		}
		if !replaced {
			approvalStore = append(approvalStore, a)
		}
	}
	return nil
}

// ---- Postgres ----

type pgRules struct{ conn *tenancy.Connection }

var uuidText = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// uuidOrNil: the id when it is a uuid, else nil (created_by and decided_by columns are uuid).
func uuidOrNil(id *string) *string {
	if id == nil || !uuidText.MatchString(*id) {
		return nil
	}
	return id
}

func isoOf(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func isoPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := isoOf(*t)
	return &s
}

func dayPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format("2006-01-02")
	return &s
}

const ruleColumns = `id::text, tenant_id::text, created_at, updated_at, created_by::text, data_source, rule_code, name_en, name_ar, status, active_version, source_note`
const versionColumns = `id::text, tenant_id::text, created_at, updated_at, created_by::text, data_source, rule_id::text, rule_code, version,
	condition, condition_text_en, outcome, status, effective_from, effective_to, submitted_at, decided_at, decided_by_user_id::text, decision_note`
const approvalColumns = `id::text, tenant_id::text, created_at, updated_at, created_by::text, data_source, subject_type, subject_id::text, status,
	summary_en, requested_at, decided_at, decided_by_user_id::text, decision_note`

func (p pgRules) rules(ctx context.Context, tenantID string) ([]ClassificationRule, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]ClassificationRule, error) {
		rows, err := tx.Query(ctx, `SELECT `+ruleColumns+` FROM classification_rules ORDER BY rule_code`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []ClassificationRule
		for rows.Next() {
			var r ClassificationRule
			var created, updated time.Time
			if err := rows.Scan(&r.ID, &r.TenantID, &created, &updated, &r.CreatedBy, &r.DataSource, &r.RuleCode, &r.NameEn, &r.NameAr, &r.Status, &r.ActiveVersion, &r.SourceNote); err != nil {
				return nil, err
			}
			r.CreatedAt, r.UpdatedAt = isoOf(created), isoOf(updated)
			out = append(out, r)
		}
		return out, rows.Err()
	})
}

func (p pgRules) versions(ctx context.Context, tenantID, ruleCode string) ([]RuleVersion, error) {
	return p.versionsWhere(ctx, tenantID, ruleCode)
}

// versionsWhere: one rule's versions, or every version when ruleCode is empty.
func (p pgRules) versionsWhere(ctx context.Context, tenantID, ruleCode string) ([]RuleVersion, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]RuleVersion, error) {
		rows, err := tx.Query(ctx, `SELECT `+versionColumns+` FROM rule_versions WHERE ($1 = '' OR rule_code = $1) ORDER BY rule_code, version`, ruleCode)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []RuleVersion
		for rows.Next() {
			var v RuleVersion
			var created, updated time.Time
			var from, to *time.Time
			var submitted, decided *time.Time
			var condition []byte
			if err := rows.Scan(&v.ID, &v.TenantID, &created, &updated, &v.CreatedBy, &v.DataSource, &v.RuleID, &v.RuleCode, &v.Version,
				&condition, &v.ConditionTextEn, &v.Outcome, &v.Status, &from, &to, &submitted, &decided, &v.DecidedByUserID, &v.DecisionNote); err != nil {
				return nil, err
			}
			if err := json.Unmarshal(condition, &v.Condition); err != nil {
				return nil, err
			}
			v.CreatedAt, v.UpdatedAt = isoOf(created), isoOf(updated)
			v.EffectiveFrom, v.EffectiveTo, v.SubmittedAt, v.DecidedAt = dayPtr(from), dayPtr(to), isoPtr(submitted), isoPtr(decided)
			out = append(out, v)
		}
		return out, rows.Err()
	})
}

func (p pgRules) allVersions(ctx context.Context, tenantID string) ([]RuleVersion, error) {
	return p.versionsWhere(ctx, tenantID, ``)
}

func (p pgRules) approvals(ctx context.Context, tenantID string) ([]Approval, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]Approval, error) {
		rows, err := tx.Query(ctx, `SELECT `+approvalColumns+` FROM approvals ORDER BY requested_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Approval
		for rows.Next() {
			var a Approval
			var created, updated, requested time.Time
			var decided *time.Time
			if err := rows.Scan(&a.ID, &a.TenantID, &created, &updated, &a.CreatedBy, &a.DataSource, &a.SubjectType, &a.SubjectID, &a.Status,
				&a.SummaryEn, &requested, &decided, &a.DecidedByUserID, &a.DecisionNote); err != nil {
				return nil, err
			}
			a.CreatedAt, a.UpdatedAt, a.RequestedAt, a.DecidedAt = isoOf(created), isoOf(updated), isoOf(requested), isoPtr(decided)
			out = append(out, a)
		}
		return out, rows.Err()
	})
}

func (p pgRules) write(ctx context.Context, tenantID string, w ruleWrites) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, r := range w.rules {
			if _, err := tx.Exec(ctx, `INSERT INTO classification_rules (tenant_id, id, data_source, created_at, updated_at, created_by, rule_code, name_en, name_ar, status, active_version, source_note)
				VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12)
				ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar,
				  status = EXCLUDED.status, active_version = EXCLUDED.active_version, source_note = EXCLUDED.source_note`,
				tenantID, r.ID, r.DataSource, r.CreatedAt, r.UpdatedAt, uuidOrNil(r.CreatedBy), r.RuleCode, r.NameEn, r.NameAr, r.Status, r.ActiveVersion, r.SourceNote); err != nil {
				return struct{}{}, err
			}
		}
		for _, v := range w.versions {
			condition, err := json.Marshal(v.Condition)
			if err != nil {
				return struct{}{}, err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO rule_versions (tenant_id, id, data_source, created_at, updated_at, created_by, rule_id, rule_code, version, condition,
				condition_text_en, outcome, status, effective_from, effective_to, submitted_at, decided_at, decided_by_user_id, decision_note)
				VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14::date, $15::date, $16::timestamptz, $17::timestamptz, $18, $19)
				ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, condition = EXCLUDED.condition,
				  condition_text_en = EXCLUDED.condition_text_en, outcome = EXCLUDED.outcome, status = EXCLUDED.status, effective_from = EXCLUDED.effective_from,
				  effective_to = EXCLUDED.effective_to, submitted_at = EXCLUDED.submitted_at, decided_at = EXCLUDED.decided_at,
				  decided_by_user_id = EXCLUDED.decided_by_user_id, decision_note = EXCLUDED.decision_note`,
				tenantID, v.ID, v.DataSource, v.CreatedAt, v.UpdatedAt, uuidOrNil(v.CreatedBy), v.RuleID, v.RuleCode, v.Version, string(condition),
				v.ConditionTextEn, v.Outcome, v.Status, v.EffectiveFrom, v.EffectiveTo, v.SubmittedAt, v.DecidedAt, uuidOrNil(v.DecidedByUserID), v.DecisionNote); err != nil {
				return struct{}{}, err
			}
		}
		for _, a := range w.approvals {
			if _, err := tx.Exec(ctx, `INSERT INTO approvals (tenant_id, id, data_source, created_at, updated_at, created_by, subject_type, subject_id, status, summary_en,
				requested_at, decided_at, decided_by_user_id, decision_note)
				VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz, $13, $14)
				ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, status = EXCLUDED.status, summary_en = EXCLUDED.summary_en,
				  decided_at = EXCLUDED.decided_at, decided_by_user_id = EXCLUDED.decided_by_user_id, decision_note = EXCLUDED.decision_note`,
				tenantID, a.ID, a.DataSource, a.CreatedAt, a.UpdatedAt, uuidOrNil(a.CreatedBy), a.SubjectType, a.SubjectID, a.Status, a.SummaryEn,
				a.RequestedAt, a.DecidedAt, uuidOrNil(a.DecidedByUserID), a.DecisionNote); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return dataerr.Conflict("That rule already exists.")
	}
	return err
}

// ReseedRulesForTest puts rules, versions and approvals back to the fixtures (test routes only, owner connection).
func ReseedRulesForTest(ctx context.Context, owner *tenancy.Connection) error {
	rules, err := fixtures.Records[ClassificationRule]("ClassificationRule")
	if err != nil {
		return err
	}
	versions, err := fixtures.Records[RuleVersion]("RuleVersion")
	if err != nil {
		return err
	}
	approvals, err := fixtures.Records[Approval]("Approval")
	if err != nil {
		return err
	}
	tenantID, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	tx, err := owner.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed
	if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
		return err
	}
	for _, table := range []string{"approvals", "rule_versions", "classification_rules"} {
		if _, err := tx.Exec(ctx, `DELETE FROM `+table); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	for i := range rules {
		rules[i].CreatedAt = nudgedCreatedAt(rules[i].CreatedAt, i)
	}
	for i := range versions {
		versions[i].CreatedAt = nudgedCreatedAt(versions[i].CreatedAt, i)
	}
	for i := range approvals {
		approvals[i].CreatedAt = nudgedCreatedAt(approvals[i].CreatedAt, i)
	}
	return pgRules{conn: owner}.write(ctx, tenantID, ruleWrites{rules: rules, versions: versions, approvals: approvals})
}

// nudgedCreatedAt: fixtures give every row one created_at; a millisecond per row keeps file order, like the seeder.
func nudgedCreatedAt(at string, index int) string {
	t, err := time.Parse(time.RFC3339, at)
	if err != nil {
		return at
	}
	return t.Add(time.Duration(index) * time.Millisecond).UTC().Format(time.RFC3339Nano)
}
