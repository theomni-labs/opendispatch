// SPDX-License-Identifier: AGPL-3.0-only

package business

import "context"

// MaintenanceOn says whether maintenance mode is on for a customer. A read failure counts as on (the feed is asked to retry).
func MaintenanceOn(tenant string) bool {
	log, err := readSettingStrict(context.Background(), tenant, "dispatch.fallback_log", []DispatchFallbackEvent(nil))
	if err != nil {
		return true
	}
	on := false
	for _, e := range log {
		if e.Kind == "maintenance" {
			on = e.Active
		}
	}
	return on
}
