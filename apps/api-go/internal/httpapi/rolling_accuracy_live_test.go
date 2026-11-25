// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"net/http"
	"testing"
)

func TestRollingAccuracyRoute_AdministratorOnly(t *testing.T) {
	rig := newDemoRig(t)
	viewer := newBrowser()
	if code, _ := rig.signIn(viewer, `{"assigned_role":"viewer_auditor","install_mode":"private","zone_ids":[]}`); code != http.StatusOK {
		t.Fatalf("sign-in: %d", code)
	}
	if code := getJSON(t, viewer, rig.srv.URL+"/models/accuracy", nil); code != http.StatusForbidden {
		t.Fatalf("a viewer's read: got %d", code)
	}
	admin := newBrowser()
	if code, _ := rig.signIn(admin, `{"assigned_role":"administrator","install_mode":"private","zone_ids":[]}`); code != http.StatusOK {
		t.Fatalf("sign-in: %d", code)
	}
	var acc struct {
		WindowDays int     `json:"window_days"`
		Target     float64 `json:"mape_target"`
		Zones      []any   `json:"zones"`
		Hours      []any   `json:"hours"`
		Weekdays   []any   `json:"weekdays"`
	}
	if code := getJSON(t, admin, rig.srv.URL+"/models/accuracy", &acc); code != http.StatusOK || acc.WindowDays < 7 || acc.Target <= 0 ||
		acc.Zones == nil || acc.Hours == nil || acc.Weekdays == nil {
		t.Fatalf("the administrator's read: got %d %+v", code, acc)
	}
}
