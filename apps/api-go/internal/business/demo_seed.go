// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// Demo seed: one sample rule, waiting spots on.
const (
	DemoSampleRuleCode = "RULE-090"
	demoSeedNote       = "Demo seed: a sample on synthetic data, not a Customer rule."
)

// DemoSeedResult says what the seed did.
type DemoSeedResult struct {
	RuleCreated       bool
	RepositionEnabled bool
}

func demoSeedActor(tenant, user string, role access.Role) reqctx.RequestContext {
	return reqctx.RequestContext{CustomerID: tenant, UserID: user, Role: role, ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}, InstallMode: access.InstallPrivate}
}

// demoSampleRule: minor, no injury, under 5,000 SAR.
func demoSampleRule() map[string]any {
	ar := "عيّنة: أضرار طفيفة، دون إصابة، مطالبة أقل من 5,000 ريال → عن بُعد"
	return map[string]any{
		"rule_code": DemoSampleRuleCode, "name_en": "Sample: minor damage, no injury, claim under 5,000 SAR → remote", "name_ar": ar,
		"source_note": demoSeedNote,
		"first_version": map[string]any{
			"condition": map[string]any{"match": "all", "predicates": []any{
				map[string]any{"field": "severity", "operator": "eq", "value": "minor"},
				map[string]any{"field": "injury_present", "operator": "eq", "value": false},
				map[string]any{"field": "claim_value_sar", "operator": "lt", "value": 5000.0},
			}},
			"condition_text_en": "Severity is minor, no injury, and the claim value is under 5,000 SAR.",
			"outcome":           "remote_eligible",
		},
	}
}

// SeedDemoDispatch: idempotent, every write audited.
func SeedDemoDispatch(ctx context.Context, tenant string) (DemoSeedResult, error) {
	var res DemoSeedResult
	adminID, supID, err := demoSeedUsers(ctx, tenant)
	if err != nil {
		return res, err
	}
	admin := demoSeedActor(tenant, adminID, access.RoleAdministrator)
	supervisor := demoSeedActor(tenant, supID, access.RoleDispatchSupervisor)
	rules, err := allRules(ctx, tenant)
	if err != nil {
		return res, err
	}
	exists := false
	for _, r := range rules {
		exists = exists || r.RuleCode == DemoSampleRuleCode
	}
	if !exists {
		if _, err := CreateRule(admin, demoSampleRule()); err != nil {
			return res, fmt.Errorf("demo seed: create %s: %w", DemoSampleRuleCode, err)
		}
		if _, err := SubmitRuleVersion(admin, DemoSampleRuleCode, 1.0); err != nil {
			return res, fmt.Errorf("demo seed: submit %s: %w", DemoSampleRuleCode, err)
		}
		if _, err := ApproveRuleVersion(supervisor, DemoSampleRuleCode, 1.0, map[string]any{"note": demoSeedNote}); err != nil {
			return res, fmt.Errorf("demo seed: approve %s: %w", DemoSampleRuleCode, err)
		}
		res.RuleCreated = true
	}
	if !getReposition(ctx, tenant) {
		if _, err := UpdateLiveAssignmentSettings(admin, map[string]any{"dispatch_reposition": true}); err != nil {
			return res, fmt.Errorf("demo seed: waiting spots: %w", err)
		}
		res.RepositionEnabled = true
	}
	if res.RuleCreated || res.RepositionEnabled {
		_, err = auditlog.RecordAudit(admin, auditlog.AuditInput{
			Action: "demo.seeded", EntityType: "setting", ActorType: "system",
			SummaryEn: "Demo seed (synthetic only): sample rule " + DemoSampleRuleCode + " approved, waiting spots on.",
			Detail:    map[string]any{"rule_code": DemoSampleRuleCode, "rule_created": res.RuleCreated, "reposition_enabled": res.RepositionEnabled},
		}, "", "")
	}
	return res, err
}

// demoSeedUsers: maker and checker, real users.
func demoSeedUsers(ctx context.Context, tenant string) (string, string, error) {
	users, err := allUsers(ctx, tenant)
	if err != nil {
		return "", "", err
	}
	var admin, sup string
	for _, u := range users {
		if u.Status != "active" || u.IsEmergencyAdmin {
			continue
		}
		if admin == "" && u.AssignedRole == access.RoleAdministrator {
			admin = u.ID
		}
		if sup == "" && u.AssignedRole == access.RoleDispatchSupervisor {
			sup = u.ID
		}
	}
	if admin == "" || sup == "" {
		return "", "", fmt.Errorf("demo seed: needs an active Administrator and Dispatch Supervisor user")
	}
	return admin, sup, nil
}
