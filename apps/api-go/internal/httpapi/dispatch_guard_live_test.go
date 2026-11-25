// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
)

// Guard first, then the body shape.
func TestDispatchWrites_RoleCheckComesBeforeTheBody(t *testing.T) {
	rig := newDemoRig(t)
	c := newBrowser()
	if code, outcome := rig.signIn(c, `{"assigned_role":"viewer_auditor","install_mode":"private","zone_ids":[]}`); code != http.StatusOK || outcome != "signed_in" {
		t.Fatalf("sign-in: got %d %s", code, outcome)
	}
	auditlog.ResetForTest()
	writes := []struct{ method, path, action string }{
		{http.MethodPut, "/settings/maintenance-mode", "fallback.maintenance_changed"},
		{http.MethodPost, "/live/fallback/signal", "fallback.signal_sent"},
		{http.MethodPost, "/live/replay", "replay.controlled"},
		{http.MethodPost, "/live/replay/outage", "fallback.outage_simulated"},
		{http.MethodPost, "/live/cases/not-a-uuid/accept", "assignment.accepted"},
		{http.MethodPost, "/live/cases/not-a-uuid/override", "assignment.overridden"},
	}
	for _, w := range writes {
		req, err := http.NewRequest(w.method, rig.srv.URL+w.path, strings.NewReader(`"nonsense"`))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s %s: got %d, want 403", w.method, w.path, resp.StatusCode)
		}
	}
	tenantID, err := fixtures.TenantID()
	if err != nil {
		t.Fatal(err)
	}
	events, err := auditlog.EventsOf(context.Background(), tenantID)
	if err != nil {
		t.Fatal(err)
	}
	denied := map[string]int{}
	for _, e := range events {
		if e.Outcome == "denied" {
			denied[e.Action]++
		}
	}
	for _, w := range writes {
		if denied[w.action] != 1 {
			t.Fatalf("%s: got %d denied events, want 1 (all: %v)", w.action, denied[w.action], denied)
		}
	}
}
