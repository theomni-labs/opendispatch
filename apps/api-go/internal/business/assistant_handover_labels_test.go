// SPDX-License-Identifier: AGPL-3.0-only

// Handover labels equal the screens' words.
package business

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func messageAt(t *testing.T, file string, path ...string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "web", "messages", file))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	for _, p := range path {
		m, _ = m[p].(map[string]any)
	}
	return m
}

func TestHandoverMapsTheWallDayToTheBoardDay(t *testing.T) {
	if n := dayShift("2026-10-04", "2026-09-13"); n != -21 || shiftDate("2026-10-05", n) != "2026-09-14" || shiftDate("2026-09-13", 0) != "2026-09-13" {
		t.Fatalf("shift %d", n)
	}
}

func TestHandoverLabelsMatchTheScreens(t *testing.T) {
	for i, locale := range []string{"en", "ar"} {
		for _, c := range []struct {
			labels map[string][2]string
			file   string
			path   []string
		}{
			{alertCategoryLabels, "admin/notifications_alerts/" + locale + ".json", []string{"cat"}},
			{alertSeverityLabels, "admin/notifications_alerts/" + locale + ".json", []string{"sev"}},
			{reasonCodeLabels, locale + ".json", []string{"opendispatch", "reasonCode"}},
			{unmetCauseLabels, "ops/live_dispatch_board/" + locale + ".json", []string{"ur", "causes"}},
		} {
			msgs := messageAt(t, c.file, c.path...)
			for key, pair := range c.labels {
				if msgs[key] != pair[i] {
					t.Fatalf("%s %v %s: %q here, %q on screen", c.file, c.path, key, pair[i], msgs[key])
				}
			}
		}
	}
}
