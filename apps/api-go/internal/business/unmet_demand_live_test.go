// SPDX-License-Identifier: AGPL-3.0-only

// Live: unreachable-case alerts in Postgres.
package business

import (
	"context"
	"sync"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func TestUnreachableAlertsAreRaisedOncePerCaseUnderConcurrency_LivePostgres(t *testing.T) {
	conn := usePgAudit(t)
	settingsstore.UsePostgres(conn)
	t.Cleanup(settingsstore.UseMemory)
	UsePostgresNotifications(conn)
	t.Cleanup(UseMemoryNotifications)
	seedUnmetBoard(t)
	_, tenant := adminCtx(t)
	ctx := context.Background()
	rule := liveRule(tenant, unreachableEvent)
	rule.RecipientRoles = []access.Role{access.RoleDispatchSupervisor}
	check(t, saveNotificationRule(ctx, tenant, rule))
	sup := roleCtx(tenant, datactx.NewID(), access.RoleDispatchSupervisor)
	_, err := ControlReplay(sup, map[string]any{"action": "seek", "replay_at": "2026-09-13T07:00:00+03:00"})
	check(t, err)
	check(t, settingsstore.Put(ctx, tenant, tenMinuteThresholdKey, 660))

	var wg sync.WaitGroup
	errs := make(chan error, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := ListUnmetDemand(sup, UnmetDemandQuery{})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		check(t, err)
	}

	rows, err := allNotifications(ctx, tenant)
	check(t, err)
	byTitle := map[string]int{}
	for _, n := range rows {
		if n.Category == "dispatch" {
			byTitle[n.TitleEn]++
		}
	}
	want := map[string]int{"Case RD-1 is out of 11-minute reach": 1, "Case RD-2 is out of 11-minute reach": 1, "Case RD-3 is out of 11-minute reach": 1}
	if len(byTitle) != len(want) {
		t.Fatalf("alerts: %v, want one per case", byTitle)
	}
	for title, n := range want {
		if byTitle[title] != n {
			t.Fatalf("alerts: %v, want one per case", byTitle)
		}
	}
	events, err := auditlog.EventsOf(ctx, tenant)
	check(t, err)
	flagged := 0
	for _, e := range events {
		if e.Action == "dispatch.case_unreachable_flagged" {
			flagged += len(e.Detail["case_ids"].([]any))
		}
	}
	if flagged != 3 {
		t.Fatalf("audited %d flagged cases, want 3 (%+v)", flagged, events)
	}
	page, err := ListMyNotifications(sup, NotificationQuery{})
	check(t, err)
	if len(page.Items) != 3 {
		t.Fatalf("the supervisor sees %d alerts, want 3", len(page.Items))
	}
}
