// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

// Set once a customer is bootstrapped.
const firstRunBootstrapKey = "auth.first_run_bootstrap_rule"

// Bootstrap outcomes.
const (
	BootstrapCreated     = "created"
	BootstrapAlreadyDone = "already_done"
	BootstrapRulesExist  = "rules_exist"
)

// BootstrapResult: what the bootstrap did.
type BootstrapResult struct {
	Outcome string
	RuleID  string
}

var errBootstrapSkip = errors.New("bootstrap skipped")

// First Administrator rule, once.
func BootstrapAdministratorRule(c context.Context, tenantID string, installMode access.InstallMode, group string) (BootstrapResult, error) {
	group = strings.TrimSpace(group)
	if group == "" || len(group) > 256 {
		return BootstrapResult{}, dataerr.Invalid("Bootstrap: the administrators group must be 1 to 256 characters.")
	}
	if !guidPattern.MatchString(tenantID) {
		return BootstrapResult{}, dataerr.Invalid("Bootstrap: the customer id must be a uuid.")
	}
	if !access.IsInstallMode(string(installMode)) {
		return BootstrapResult{}, dataerr.Invalid(fmt.Sprintf("Bootstrap: unknown install mode %q.", installMode))
	}
	inMode := false
	for _, r := range access.RolesForInstallMode(installMode) {
		inMode = inMode || r == access.RoleAdministrator
	}
	if !inMode {
		return BootstrapResult{}, dataerr.Invalid("Bootstrap: this install mode has no Administrator role.")
	}
	sys := reqctx.PreSessionContext{CustomerID: tenantID, InstallMode: installMode}
	ruleID := datactx.DeterministicUUID("first-run-administrator-rule:" + tenantID)
	var skipped BootstrapResult
	meta := auditlog.WriteMeta{Action: "role_mapping.created", EntityType: "role_mapping", ActorType: "system"}
	guard := auditlog.Guard{Func: func() error { return nil }}
	_, err := auditlog.WriteWithAudit(c, sys, guard, meta, func(uc context.Context) (auditlog.AuditedWrite[RoleMapping], error) {
		done, err := settingsstore.Has(uc, tenantID, firstRunBootstrapKey)
		if err != nil {
			return auditlog.AuditedWrite[RoleMapping]{}, err
		}
		if done {
			skipped = BootstrapResult{Outcome: BootstrapAlreadyDone, RuleID: ruleID}
			return auditlog.AuditedWrite[RoleMapping]{}, errBootstrapSkip
		}
		rules, err := allRoleMappings(uc, tenantID)
		if err != nil {
			return auditlog.AuditedWrite[RoleMapping]{}, err
		}
		if len(rules) > 0 {
			skipped = BootstrapResult{Outcome: BootstrapRulesExist}
			return auditlog.AuditedWrite[RoleMapping]{}, errBootstrapSkip
		}
		// labelled as an Admin-made rule is
		rule := RoleMapping{
			BaseRecord: datactx.NewRecordPreSession(sys, ruleID, datactx.NowISO()),
			GroupMatch: group, GroupMatchType: "exact", AssignedRole: access.RoleAdministrator,
			ZoneIDs: []string{}, Priority: 1, IsEnabled: true,
		}
		if err := saveRoleMapping(uc, rule); err != nil {
			return auditlog.AuditedWrite[RoleMapping]{}, err
		}
		if err := settingsstore.Put(uc, tenantID, firstRunBootstrapKey, ruleID); err != nil {
			return auditlog.AuditedWrite[RoleMapping]{}, err
		}
		id := rule.ID
		return auditlog.AuditedWrite[RoleMapping]{
			Result: rule, EntityID: &id,
			SummaryEn: fmt.Sprintf("Group rule for %s created by the first-run bootstrap (%s).", group, access.RoleAdministrator),
			Detail:    map[string]any{"assigned_role": access.RoleAdministrator, "zone_ids": []string{}, "source": "first_run_bootstrap"},
		}, nil
	})
	if errors.Is(err, errBootstrapSkip) {
		return skipped, nil
	}
	if err != nil {
		return BootstrapResult{}, err
	}
	return BootstrapResult{Outcome: BootstrapCreated, RuleID: ruleID}, nil
}
