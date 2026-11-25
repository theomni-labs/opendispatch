// SPDX-License-Identifier: AGPL-3.0-only

// Live: the Updates PATCH writes on Postgres.
package business

import (
	"sync"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func TestPatchLive_InterleavedAndConcurrentSavesKeepEveryChange(t *testing.T) {
	conn := settingsConn(t)
	settingsstore.UsePostgres(conn)
	t.Cleanup(settingsstore.UseMemory)
	auditlog.ResetForTest()
	a := adminOf(freshTenant())
	checkInterleavedSave(t, a)

	var wg sync.WaitGroup
	errs := make([]error, 3)
	run := []func() error{
		func() error {
			_, err := PatchUpdateChangePolicy(a, map[string]any{"emergency_override_enabled": false})
			return err
		},
		func() error {
			_, err := PatchUpdateConnection(a, map[string]any{"proxy": map[string]any{"address": "proxy.local:3128"}})
			return err
		},
		func() error {
			_, err := PatchUpdateChangeWindows(a, map[string]any{"add_blackouts": []any{map[string]any{"label": "Eid", "entered_as": "gregorian", "start_gregorian": "2027-03-09", "end_gregorian": "2027-03-12"}}})
			return err
		},
	}
	for i, fn := range run {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = fn()
		}()
	}
	wg.Wait()
	for _, err := range errs {
		checkOK(t, err, "concurrent patch")
	}
	p, _ := GetUpdateChangePolicy(a)
	c, _ := GetUpdateConnection(a)
	w, _ := GetUpdateChangeWindows(a)
	if p.EmergencyOverrideEnabled || p.EmergencyReasonMinLength != 77 || c.Mode != "offline" || c.Proxy.Address == nil || len(w.Blackouts) == 0 {
		t.Fatalf("a change was lost: policy %+v connection %+v blackouts %d", p, c, len(w.Blackouts))
	}
	if ok, _ := auditActions(t, a, "update.connection_changed"); ok != 2 {
		t.Fatalf("connection audit events %d, want 2", ok)
	}

	b := adminOf(freshTenant())
	other, err := GetUpdateConnection(b)
	checkOK(t, err, "other customer")
	if other.Mode != "connected" || other.Proxy.Address != nil {
		t.Fatalf("customer b sees customer a's connection: %+v", other)
	}
	if bp, _ := GetUpdateChangePolicy(b); !bp.EmergencyOverrideEnabled || bp.EmergencyReasonMinLength != 20 {
		t.Fatalf("customer b sees customer a's policy: %+v", bp)
	}
}
