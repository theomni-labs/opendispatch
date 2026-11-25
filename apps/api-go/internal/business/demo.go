// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors apps/web/src/lib/data/demo.ts.
// Writes: demo reset (Administrator, platform.demo).
package business

import (
	"context"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

// DemoResetResult mirrors the contract type.
type DemoResetResult struct {
	ResetAt string `json:"reset_at"`
	Cleared bool   `json:"cleared"`
}

// ResetAllState puts every in-memory store back to the fixtures.
func ResetAllState() {
	datactx.SetNowForTest(nil)
	auditlog.ResetForTest()
	ReloadLeaveCalendarForTest()
	ResetRulesForTest()
	ResetOverridesForTest()
	ResetForecastRunsForTest()
	ResetForecastCoreForTest()
	settingsstore.ReloadForTest()
	ReloadSettingsZonesForTest()
	ResetRemoteReviewsForTest()
	ReloadReplayCasesForTest()
	ReloadDispatchAssignmentsForTest()
	ResetDispatchEngineOutputsForTest()
	ReloadForecastFixturesForTest()
	ReloadScenariosForTest()
	ReloadSimulationsForTest()
	ReloadSimZonesForTest()
	ReloadStandbyForTest()
	ReloadDashboardsForTest()
	ReloadFieldShareZonesForTest()
	ReloadSecurityComplianceForTest()
	ReloadIntegrationsForTest()
	ResetAPIWebhooksForTest()
	ResetSystemHealthForTest()
	ReloadRemoteZonesForTest()
	ReloadNotificationsForTest()
	ReloadModelVersionsForTest()
	ResetUsersForTest()
	ResetIdentityForTest()
}

// ResetDemoData mirrors resetDemoData: audited after the reset.
func ResetDemoData(rc reqctx.RequestContext) (DemoResetResult, error) {
	guard := auditlog.Guard{Func: func() error {
		if err := datactx.RequirePlatform(rc, datactx.PlatformDemo); err != nil {
			return err
		}
		if rc.Role != access.RoleAdministrator {
			return dataerr.Forbidden(string(rc.Role) + " may not reset the demo data: only an administrator may.")
		}
		return nil
	}}
	return auditlog.WriteWithAudit(context.Background(), rc, guard, auditlog.WriteMeta{Action: "demo.reset", EntityType: "demo"}, func(ctx context.Context) (auditlog.AuditedWrite[DemoResetResult], error) {
		ResetAllState()
		return auditlog.AuditedWrite[DemoResetResult]{Result: DemoResetResult{ResetAt: datactx.NowISO(), Cleared: true}, SummaryEn: "Demo data reset to the fixtures."}, nil
	})
}
