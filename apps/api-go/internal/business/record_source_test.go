// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

// app-made records follow the install.
func TestRecordSource_AppMadeRecordsFollowTheInstall(t *testing.T) {
	for _, want := range []string{"SYNTHETIC", "LIVE"} {
		t.Run(want, func(t *testing.T) {
			defer recordsource.SetForTest(want)()
			bootstrapEmpty(t)
			ctx := context.Background()
			res, err := BootstrapAdministratorRule(ctx, bootTenant, access.InstallPrivate, "opendispatch-administrators")
			check(t, err)
			admin := reqctx.RequestContext{CustomerID: bootTenant, UserID: datactx.NewID(), Role: access.RoleAdministrator,
				ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}, InstallMode: access.InstallPrivate}
			made, err := CreateRoleMapping(admin, map[string]any{"group_match": "planners", "group_match_type": "exact", "assigned_role": "viewer_auditor"})
			check(t, err)
			check(t, settingsstore.Put(ctx, bootTenant, "rs.business", true))
			entries, err := settingsstore.WithPrefix(ctx, bootTenant, "rs.business")
			check(t, err)
			rules, err := allRoleMappings(ctx, bootTenant)
			check(t, err)
			got := map[string]string{"admin rule": made.DataSource, "setting": entries[0].DataSource,
				"record": datactx.NewRecord(admin, "", "").DataSource}
			for _, r := range rules {
				if r.ID == res.RuleID {
					got["bootstrap rule"] = r.DataSource
				}
			}
			for i, e := range auditlog.AllEvents() {
				got[fmt.Sprintf("audit %d", i)] = e.DataSource
			}
			if len(got) < 5 {
				t.Fatalf("missing records: %v", got)
			}
			for what, src := range got {
				if src != want {
					t.Fatalf("%s labelled %q, want %q", what, src, want)
				}
			}
		})
	}
}
