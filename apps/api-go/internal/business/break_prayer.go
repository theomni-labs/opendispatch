// SPDX-License-Identifier: AGPL-3.0-only

// Breaks and prayer: the policy setting.
package business

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

const (
	prayerPolicyKey = "breaks.prayer_policy"
	prayerWindowKey = "breaks.prayer_window_minutes"
	// PolicyClear: a break never overlaps a prayer.
	PolicyClear = "clear_of_prayer"
	// PolicyLinedUp: a break covers a prayer window.
	PolicyLinedUp     = "lined_up_with_prayer"
	minPrayerWindow   = 5
	maxPrayerWindow   = 90
	breakPrayerCost   = 10000.0
	breakLinedUpBonus = 50.0
)

var prayerPolicies = []string{PolicyClear, PolicyLinedUp}

// PrayerPolicy: how breaks meet prayer windows.
type PrayerPolicy struct {
	Mode   string
	Window int
}

// DefaultPrayerPolicy: clear of 30 minutes.
var DefaultPrayerPolicy = PrayerPolicy{Mode: PolicyClear, Window: PrayerWindowMinutes}

func (p PrayerPolicy) window() int {
	if p.Window < minPrayerWindow || p.Window > maxPrayerWindow {
		return PrayerWindowMinutes
	}
	return p.Window
}

func (p PrayerPolicy) linedUp() bool { return p.Mode == PolicyLinedUp }

func validPrayerWindow(n int) bool { return n >= minPrayerWindow && n <= maxPrayerWindow }

// prayerPolicyOf: stored, else the default.
func prayerPolicyOf(ctx context.Context, tenant string) PrayerPolicy {
	if ctx == nil {
		ctx = context.Background()
	}
	out := DefaultPrayerPolicy
	if m := readSetting(ctx, tenant, prayerPolicyKey, PolicyClear); containsStr(prayerPolicies, m) {
		out.Mode = m
	}
	if w := readSetting(ctx, tenant, prayerWindowKey, PrayerWindowMinutes); validPrayerWindow(w) {
		out.Window = w
	}
	return out
}

// validBreakPrayerSetting: raw writes.
func validBreakPrayerSetting(key string, value any) error {
	switch key {
	case prayerPolicyKey:
		if s, ok := value.(string); !ok || !containsStr(prayerPolicies, s) {
			return fmt.Errorf("%s must be one of %s", key, strings.Join(prayerPolicies, ", "))
		}
	case prayerWindowKey:
		n, ok := value.(float64)
		if i, isInt := value.(int); isInt {
			n, ok = float64(i), true
		}
		if !ok || n != math.Trunc(n) || !validPrayerWindow(int(n)) {
			return fmt.Errorf("%s must be a whole number from %d to %d", key, minPrayerWindow, maxPrayerWindow)
		}
	}
	return nil
}

// UpdateBreakPrayerPolicy: set it, audited.
func UpdateBreakPrayerPolicy(rc reqctx.RequestContext, body any) (SettingsSnapshot, error) {
	type out = auditlog.AuditedWrite[SettingsSnapshot]
	meta := auditlog.WriteMeta{Action: "settings.break_prayer_changed", EntityType: "setting", EntityID: strPtr(prayerPolicyKey)}
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminShiftBreakPolicies}, meta, func(ctx context.Context) (out, error) {
		input, err := datactx.Object(body, "Breaks and prayer", []string{"prayer_policy", "prayer_window_minutes"})
		if err != nil {
			return out{}, err
		}
		mode, hasMode, err := datactx.OptEnum(input, "prayer_policy", prayerPolicies)
		if err != nil {
			return out{}, err
		}
		window, hasWindow, err := datactx.OptInt(input, "prayer_window_minutes", datactx.NumOpts{Min: minPrayerWindow, Max: maxPrayerWindow, HasMin: true, HasMax: true})
		if err != nil {
			return out{}, err
		}
		if !hasMode && !hasWindow {
			return out{}, dataerr.Invalid("Breaks and prayer: nothing to change.")
		}
		before := prayerPolicyOf(ctx, rc.CustomerID)
		next := before
		var kvs []settingsstore.KV
		if hasMode {
			next.Mode = mode
			kvs = append(kvs, settingsstore.KV{Key: prayerPolicyKey, Value: mode})
		}
		if hasWindow {
			next.Window = window
			kvs = append(kvs, settingsstore.KV{Key: prayerWindowKey, Value: window})
		}
		if err := settingsstore.PutMany(ctx, rc.CustomerID, kvs...); err != nil {
			return out{}, err
		}
		snap, err := settingsSnapshot(ctx, rc)
		if err != nil {
			return out{}, err
		}
		summary := fmt.Sprintf("Breaks and prayer changed from %s, %d min to %s, %d min.", before.Mode, before.window(), next.Mode, next.window())
		detail := map[string]any{"prayer_policy": map[string]any{"from": before.Mode, "to": next.Mode}, "prayer_window_minutes": map[string]any{"from": before.window(), "to": next.window()}}
		params := map[string]any{"from": before.Mode, "to": next.Mode, "fromMin": before.window(), "toMin": next.window()}
		return out{Result: snap, SummaryEn: summary, Detail: sumDetail(detail, params)}, nil
	})
}

// alignedShare: one window holds the other whole.
func alignedShare(shared, window, length int) bool {
	return shared > 0 && (shared == window || shared == length)
}

// linesUpWithPrayer: lined up with a window.
func linesUpWithPrayer(startMin, endMin int, prayers []PrayerMinute, p PrayerPolicy) bool {
	if !p.linedUp() || PrayerConflictOf(startMin, endMin, prayers, p) != nil {
		return false
	}
	w := p.window()
	for _, pr := range prayers {
		if alignedShare(overlapMinutes(startMin, endMin, pr.Minute, pr.Minute+w), w, endMin-startMin) {
			return true
		}
	}
	return false
}

// prayerCost: the policy's cost of a slot.
func prayerCost(startMin, endMin int, prayers []PrayerMinute, p PrayerPolicy) float64 {
	if PrayerConflictOf(startMin, endMin, prayers, p) != nil {
		return breakPrayerCost
	}
	if linesUpWithPrayer(startMin, endMin, prayers, p) {
		return -breakLinedUpBonus
	}
	return 0
}

// breakStarts: the grid, plus adhans if lined up.
func breakStarts(in BreakInput, prayers []PrayerMinute, pol PrayerPolicy) []int {
	earliest := ceilToGrid(in.StartMin + int(in.AfterHours*60))
	latest := floorToGrid(in.EndMin - in.BreakMinutes)
	var out []int
	for start := earliest; start <= latest; start += breakGrid {
		out = append(out, start)
	}
	if !pol.linedUp() {
		return out
	}
	lo, hi := in.StartMin+int(math.Ceil(in.AfterHours*60)), in.EndMin-in.BreakMinutes
	for _, p := range prayers {
		if p.Minute >= lo && p.Minute <= hi && p.Minute%breakGrid != 0 {
			out = append(out, p.Minute)
		}
	}
	sort.Ints(out)
	return out
}

// atAdhan: a minute that is an adhan.
func atAdhan(minute int, prayers []PrayerMinute) bool {
	for _, p := range prayers {
		if p.Minute == minute {
			return true
		}
	}
	return false
}
