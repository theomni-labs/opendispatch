// SPDX-License-Identifier: AGPL-3.0-only

package business

import "context"

// Test shims: single-row writes to the in-memory rules store.
func upsertRuleRow(r ClassificationRule) ClassificationRule {
	if err := (ruleWrites{rules: []ClassificationRule{r}}).commit(context.Background(), ""); err != nil {
		panic(err)
	}
	return r
}

func upsertVersionRow(v RuleVersion) RuleVersion {
	if err := (ruleWrites{versions: []RuleVersion{v}}).commit(context.Background(), ""); err != nil {
		panic(err)
	}
	return v
}

func upsertApprovalRow(a Approval) Approval {
	if err := saveApproval(context.Background(), "", a); err != nil {
		panic(err)
	}
	return a
}
