// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
)

func TestDegradationAlertFollowsTheModelDegradedRule(t *testing.T) {
	w := newEngineWorld(t)
	setForecastSetting(t, w.tenantID, keyDegradationAlerted, map[string]string{}, map[string]string{})
	setForecastSetting(t, w.tenantID, KeyDegradationWindow, 1, defaultDegradeWindow)
	yesterday := shiftDateBy(w.today, -1)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.yesterdayAnswer(yesterday)})
	ctx := context.Background()
	_, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": yesterday, "horizon_days": 1.0})
	check(t, err)
	seeded, err := notificationRuleFor(context.Background(), w.tenantID, "model_degraded")
	check(t, err)
	rule := NotificationRule{BaseRecord: datactx.NewRecord(w.actors.Forecast, "", datactx.NowISO()), EventType: "model_degraded"}
	if seeded != nil {
		saved := *seeded
		rule = saved
		t.Cleanup(func() { _ = saveNotificationRule(context.Background(), w.tenantID, saved) })
	}
	rule.Channels, rule.RecipientRoles, rule.Severity, rule.IsEnabled = []string{"in_app"}, []access.Role{access.RoleAdministrator}, "critical", false
	check(t, saveNotificationRule(context.Background(), w.tenantID, rule))
	seen := map[string]bool{}
	before, err := allNotifications(context.Background(), w.tenantID)
	check(t, err)
	for _, r := range before {
		seen[r.ID] = true
	}
	alerts := func() (n int, critical bool) {
		rows, err := allNotifications(context.Background(), w.tenantID)
		check(t, err)
		for _, r := range rows {
			if !seen[r.ID] && r.TitleEn == "Forecast error above the limit" {
				n++
				critical = r.Severity == "critical" && r.RecipientRole != nil && *r.RecipientRole == "administrator"
			}
		}
		return n, critical
	}

	res, err := RunDegradationCheck(ctx, w.conn, w.actors.Forecast, yesterday)
	check(t, err)
	if n, _ := alerts(); res == nil || len(res.Alerted) != 1 || n != 0 {
		t.Fatalf("rule off: %d alerts, result %+v", n, res)
	}
	if got := auditSummaries(t, w, "forecast.degradation"); len(got) != 1 {
		t.Fatalf("the detection is audited even with the rule off: %v", got)
	}

	rule.IsEnabled = true
	check(t, saveNotificationRule(context.Background(), w.tenantID, rule))
	setForecastSetting(t, w.tenantID, keyDegradationAlerted, map[string]string{}, map[string]string{})
	_, err = RunDegradationCheck(ctx, w.conn, w.actors.Forecast, yesterday)
	check(t, err)
	if n, critical := alerts(); n != 1 || !critical {
		t.Fatalf("rule on: %d alerts (critical to the Administrator: %v), want one", n, critical)
	}
}
