// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
)

func getJSON(t *testing.T, c *http.Client, url string, into any) int {
	t.Helper()
	resp, err := c.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if into != nil && resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
			t.Fatal(err)
		}
	}
	return resp.StatusCode
}

func TestBacktestRoutes_AdministratorOnlyAndTheReadsAnswer(t *testing.T) {
	rig := newDemoRig(t)
	viewer := newBrowser()
	if code, _ := rig.signIn(viewer, `{"assigned_role":"viewer_auditor","install_mode":"private","zone_ids":[]}`); code != http.StatusOK {
		t.Fatalf("sign-in: %d", code)
	}
	auditlog.ResetForTest()
	resp := rig.post(viewer, "/models/backtest", `{}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("a viewer's run: got %d", resp.StatusCode)
	}
	if code := getJSON(t, viewer, rig.srv.URL+"/models/backtest", nil); code != http.StatusForbidden {
		t.Fatalf("a viewer's read: got %d", code)
	}
	var acc struct {
		Dates     []string `json:"dates"`
		Intervals []any    `json:"intervals"`
	}
	if code := getJSON(t, viewer, rig.srv.URL+"/forecasts/accuracy", &acc); code != http.StatusOK || acc.Dates == nil || acc.Intervals == nil {
		t.Fatalf("the accuracy read: got %d %+v", code, acc)
	}
	tenantID, err := fixtures.TenantID()
	if err != nil {
		t.Fatal(err)
	}
	events, err := auditlog.EventsOf(context.Background(), tenantID)
	if err != nil {
		t.Fatal(err)
	}
	denied := 0
	for _, e := range events {
		if e.Action == "forecast.backtest_run" && e.Outcome == "denied" {
			denied++
		}
	}
	if denied != 1 {
		t.Fatalf("got %d denied backtest runs, want 1", denied)
	}

	admin := newBrowser()
	if code, _ := rig.signIn(admin, `{"assigned_role":"administrator","install_mode":"private","zone_ids":[]}`); code != http.StatusOK {
		t.Fatalf("sign-in: %d", code)
	}
	var st struct {
		Run struct {
			State string `json:"state"`
		} `json:"run"`
		ActiveModel string `json:"active_model"`
	}
	if code := getJSON(t, admin, rig.srv.URL+"/models/backtest", &st); code != http.StatusOK || st.Run.State == "" || st.ActiveModel == "" {
		t.Fatalf("the administrator's read: got %d %+v", code, st)
	}
	resp = rig.post(admin, "/models/backtest", `{}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("without the engine a run is refused with 409, got %d", resp.StatusCode)
	}
}
