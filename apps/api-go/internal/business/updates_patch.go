// SPDX-License-Identifier: AGPL-3.0-only

// The PATCH writes of the Updates screen.
package business

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

// Tries before a busy state answers CONFLICT.
const patchAttempts = 8

var dayNames = [7]string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}

// patchUpdates: read, change, compare-and-swap.
func patchUpdates(ctx context.Context, rc reqctx.RequestContext, change func(*updatesState) error) (*updatesState, error) {
	for range patchAttempts {
		stored, stamp, err := settingsstore.GetStamped[*updatesState](ctx, rc.CustomerID, updatesKey, nil)
		if err != nil {
			return nil, err
		}
		if stored == nil {
			stored = seedUpdatesState(ctx)
		}
		state, after, changed := applyElapsed(ctx, rc, stored)
		if !changed {
			state = cloneState(stored)
		}
		if err := change(state); err != nil {
			return nil, err
		}
		ok, err := settingsstore.Swap(ctx, rc.CustomerID, updatesKey, stamp, state)
		if err != nil {
			return nil, err
		}
		if ok {
			for _, effect := range after {
				effect()
			}
			return state, nil
		}
	}
	return nil, dataerr.Conflict("The updates were changed by another save at the same moment. Try again.")
}

// Rule of the PUT: an enabled proxy needs an address.
func checkProxy(p proxyState) error {
	if p.Enabled && (p.Address == nil || strings.TrimSpace(*p.Address) == "") {
		return dataerr.Invalid("Proxy: address is required when the proxy is enabled.")
	}
	return nil
}

// Rule of the PUT: a second approver needs two.
func checkPolicy(p UpdateChangePolicy) error {
	if p.SecondApproverRequired && len(p.ApproverUserIDs) < 2 {
		return dataerr.Invalid("A second approver is required, so at least two approvers must be listed.")
	}
	return nil
}

// Each id must be an active Change Approver.
func requireChangeApprovers(ctx context.Context, rc reqctx.RequestContext, ids []string) error {
	users, err := allUsers(ctx, rc.CustomerID)
	if err != nil {
		return err
	}
	for _, id := range ids {
		found := false
		for i := range users {
			if users[i].ID == id && isActiveChangeApprover(users[i]) {
				found = true
				break
			}
		}
		if !found {
			return dataerr.Invalid(fmt.Sprintf("approver_user_ids: %s is not an active Change Approver.", id))
		}
	}
	return nil
}

func readDaysOfWeek(o datactx.Obj) ([]int, error) {
	bad := dataerr.Invalid("Recurring window: days_of_week must be a non-empty list of 0 (Sunday) to 6.")
	raw, ok := o["days_of_week"].([]any)
	if !ok || len(raw) == 0 {
		return nil, bad
	}
	days := make([]int, len(raw))
	for i, d := range raw {
		n, isFloat := d.(float64)
		if !isFloat || n != float64(int(n)) || int(n) < 0 || int(n) > 6 {
			return nil, bad
		}
		days[i] = int(n)
	}
	return days, nil
}

func recurringWindowID(label string, days []int, start, end string) string {
	sorted := uniqueSortedInts(days)
	parts := make([]string, len(sorted))
	for i, v := range sorted {
		parts[i] = strconv.Itoa(v)
	}
	return datactx.DeterministicUUID(fmt.Sprintf("updates:recurring:%s:%s:%s:%s", label, strings.Join(parts, ","), start, end))
}

// "Sunday to Thursday, 03:00 to 05:00".
func recurringWindowLabel(days []int, start, end string) string {
	sorted := uniqueSortedInts(days)
	consecutive := true
	names := make([]string, len(sorted))
	for i, d := range sorted {
		names[i] = dayNames[d]
		if i > 0 && d != sorted[i-1]+1 {
			consecutive = false
		}
	}
	dayText := strings.Join(names, ", ")
	if len(sorted) > 2 && consecutive {
		dayText = names[0] + " to " + names[len(names)-1]
	}
	return fmt.Sprintf("%s, %s to %s", dayText, start, end)
}

func readBlackout(raw any, months []HijriMonth) (Blackout, error) {
	o, err := datactx.Object(raw, "Blackout", []string{"label", "entered_as", "start_gregorian", "end_gregorian", "start_hijri", "end_hijri"})
	if err != nil {
		return Blackout{}, err
	}
	label, err := datactx.String(o, "label", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
	if err != nil {
		return Blackout{}, err
	}
	enteredAs, err := datactx.EnumOf(o, "entered_as", enteredAsValues)
	if err != nil {
		return Blackout{}, err
	}
	var startG, endG string
	var startH, endH *HijriDate
	if enteredAs == "hijri" {
		if !datactx.Has(o, "start_hijri") || !datactx.Has(o, "end_hijri") {
			return Blackout{}, dataerr.Invalid("Blackout: a Hijri blackout needs start_hijri and end_hijri.")
		}
		sh, err := readHijriDate(o["start_hijri"], "Blackout start_hijri")
		if err != nil {
			return Blackout{}, err
		}
		eh, err := readHijriDate(o["end_hijri"], "Blackout end_hijri")
		if err != nil {
			return Blackout{}, err
		}
		startH, endH = &sh, &eh
		if startG, err = hijriToGregorianDate(months, sh); err != nil {
			return Blackout{}, err
		}
		if endG, err = hijriToGregorianDate(months, eh); err != nil {
			return Blackout{}, err
		}
	} else {
		if startG, err = datactx.Date(o, "start_gregorian"); err != nil {
			return Blackout{}, err
		}
		if endG, err = datactx.Date(o, "end_gregorian"); err != nil {
			return Blackout{}, err
		}
		startH = gregorianToHijriDate(months, startG)
		endH = gregorianToHijriDate(months, endG)
	}
	if endG < startG {
		return Blackout{}, dataerr.Invalid("Blackout: the end is before the start.")
	}
	return Blackout{
		ID:    datactx.DeterministicUUID(fmt.Sprintf("updates:blackout:%s:%s:%s", label, startG, endG)),
		Label: label, EnteredAs: enteredAs, StartGregorian: startG, EndGregorian: endG, StartHijri: startH, EndHijri: endH,
	}, nil
}

func sortedKeys(o datactx.Obj) []string {
	keys := make([]string, 0, len(o))
	for k := range o {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// Blank text means none: nil.
func blankToNil(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}

// PatchUpdateConnection mirrors patchUpdateConnection.
func PatchUpdateConnection(rc reqctx.RequestContext, body any) (UpdateConnectionSettings, error) {
	type out = auditlog.AuditedWrite[UpdateConnectionSettings]
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "The connection settings"), auditlog.WriteMeta{Action: "update.connection_changed", EntityType: "update_connection", EntityID: updStrp("connection")}, func(ctx context.Context) (out, error) {
		input, err := datactx.Object(body, "Connection settings", []string{"mode", "proxy"})
		if err != nil {
			return out{}, err
		}
		if len(input) == 0 {
			return out{}, dataerr.Invalid("Connection settings: nothing to change.")
		}
		mode, hasMode, err := datactx.OptEnum(input, "mode", updateModes)
		if err != nil {
			return out{}, err
		}
		var p datactx.Obj
		if datactx.Has(input, "proxy") {
			if p, err = datactx.Object(input["proxy"], "Proxy", []string{"enabled", "address", "username", "password", "ca_certificate_pem"}); err != nil {
				return out{}, err
			}
			if len(p) == 0 {
				return out{}, dataerr.Invalid("Proxy: nothing to change.")
			}
		}
		enabled, hasEnabled, err := datactx.OptBool(p, "enabled")
		if err != nil {
			return out{}, err
		}
		address, err := datactx.NullableString(p, "address", datactx.StrOpts{Max: 300, HasMax: true})
		if err != nil {
			return out{}, err
		}
		username, err := datactx.NullableString(p, "username", datactx.StrOpts{Max: 120, HasMax: true})
		if err != nil {
			return out{}, err
		}
		password, hasPassword, err := datactx.OptString(p, "password", datactx.StrOpts{Max: 512, HasMax: true})
		if err != nil {
			return out{}, err
		}
		ca, hasCA, err := datactx.OptString(p, "ca_certificate_pem", datactx.StrOpts{Max: 20000, HasMax: true})
		if err != nil {
			return out{}, err
		}
		var before map[string]any
		state, err := patchUpdates(ctx, rc, func(s *updatesState) error {
			before = map[string]any{"mode": s.ConnectionMode, "proxy_enabled": s.Proxy.Enabled}
			if hasMode {
				s.ConnectionMode = mode
			}
			if hasEnabled {
				s.Proxy.Enabled = enabled
			}
			if datactx.Has(p, "address") {
				s.Proxy.Address = blankToNil(address)
			}
			if datactx.Has(p, "username") {
				s.Proxy.Username = blankToNil(username)
			}
			if hasPassword {
				s.Proxy.HasPassword = password != ""
			}
			if hasCA {
				s.Proxy.HasCACertificate = ca != ""
			}
			return checkProxy(s.Proxy)
		})
		if err != nil {
			return out{}, err
		}
		proxySuffix := ""
		if state.Proxy.Enabled {
			proxySuffix = " through a proxy"
		}
		var fields []string
		if hasMode {
			fields = append(fields, "mode")
		}
		for _, k := range sortedKeys(p) {
			fields = append(fields, "proxy."+k)
		}
		return out{
			Result: connectionViewOf(state), SummaryEn: fmt.Sprintf("Connection changed to %s%s (%s).", state.ConnectionMode, proxySuffix, updatesStub),
			Detail: map[string]any{"from": before, "to": map[string]any{"mode": state.ConnectionMode, "proxy_enabled": state.Proxy.Enabled}, "fields": fields, "stub": true},
		}, nil
	})
}

// PatchUpdateChangePolicy mirrors the PATCH.
func PatchUpdateChangePolicy(rc reqctx.RequestContext, body any) (UpdateChangePolicy, error) {
	type out = auditlog.AuditedWrite[UpdateChangePolicy]
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "The change policy"), auditlog.WriteMeta{Action: "update.policy_changed", EntityType: "update_change_policy", EntityID: updStrp("change_policy")}, func(ctx context.Context) (out, error) {
		input, err := datactx.Object(body, "Change policy", []string{"approver_user_ids", "second_approver_required", "emergency_override_enabled", "emergency_reason_min_length"})
		if err != nil {
			return out{}, err
		}
		if len(input) == 0 {
			return out{}, dataerr.Invalid("Change policy: nothing to change.")
		}
		hasIDs := datactx.Has(input, "approver_user_ids")
		var ids []string
		if hasIDs {
			if ids, err = datactx.UUIDList(input, "approver_user_ids", false); err != nil {
				return out{}, err
			}
			if err := requireChangeApprovers(ctx, rc, ids); err != nil {
				return out{}, err
			}
		}
		second, hasSecond, err := datactx.OptBool(input, "second_approver_required")
		if err != nil {
			return out{}, err
		}
		override, hasOverride, err := datactx.OptBool(input, "emergency_override_enabled")
		if err != nil {
			return out{}, err
		}
		minLength, hasMin, err := datactx.OptInt(input, "emergency_reason_min_length", datactx.NumOpts{Min: 20, Max: 1000, HasMin: true, HasMax: true})
		if err != nil {
			return out{}, err
		}
		var before UpdateChangePolicy
		state, err := patchUpdates(ctx, rc, func(s *updatesState) error {
			before = s.Policy
			before.ApproverUserIDs = cloneStrSlice(s.Policy.ApproverUserIDs)
			if hasIDs {
				s.Policy.ApproverUserIDs = ids
			}
			if hasSecond {
				s.Policy.SecondApproverRequired = second
			}
			if hasOverride {
				s.Policy.EmergencyOverrideEnabled = override
			}
			if hasMin {
				s.Policy.EmergencyReasonMinLength = minLength
			}
			return checkPolicy(s.Policy)
		})
		if err != nil {
			return out{}, err
		}
		result := state.Policy
		result.ApproverUserIDs = cloneStrSlice(state.Policy.ApproverUserIDs)
		if result.ApproverUserIDs == nil {
			result.ApproverUserIDs = []string{}
		}
		return out{
			Result: result, SummaryEn: fmt.Sprintf("Change policy changed (%s).", updatesStub),
			Detail: map[string]any{"from": before, "to": result, "fields": sortedKeys(input), "stub": true},
		}, nil
	})
}

type recurringPatch struct {
	id, label         *string
	days              []int
	start, end        *string
	hasDays, hasLabel bool
}

func readRecurringPatch(raw any) (recurringPatch, error) {
	var rp recurringPatch
	o, err := datactx.Object(raw, "Recurring window", []string{"id", "label", "days_of_week", "start_time", "end_time"})
	if err != nil {
		return rp, err
	}
	if datactx.Has(o, "id") {
		id, err := datactx.UUID(o, "id")
		if err != nil {
			return rp, err
		}
		rp.id = &id
	}
	if datactx.Has(o, "label") {
		label, err := datactx.String(o, "label", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
		if err != nil {
			return rp, err
		}
		rp.label, rp.hasLabel = &label, true
	}
	if datactx.Has(o, "days_of_week") {
		if rp.days, err = readDaysOfWeek(o); err != nil {
			return rp, err
		}
		rp.hasDays = true
	}
	for _, f := range []struct {
		key string
		to  **string
	}{{"start_time", &rp.start}, {"end_time", &rp.end}} {
		if datactx.Has(o, f.key) {
			v, err := datactx.Time(o, f.key)
			if err != nil {
				return rp, err
			}
			*f.to = &v
		}
	}
	if rp.id == nil && (!rp.hasDays || rp.start == nil || rp.end == nil) {
		return rp, dataerr.Invalid("Recurring window: a new window needs days_of_week, start_time and end_time.")
	}
	return rp, nil
}

// Applies one recurring window change to s.
func applyRecurringPatch(s *updatesState, rp recurringPatch) error {
	if rp.id == nil {
		w := RecurringWindow{DaysOfWeek: uniqueSortedInts(rp.days), StartTime: *rp.start, EndTime: *rp.end}
		w.Label = recurringWindowLabel(w.DaysOfWeek, w.StartTime, w.EndTime)
		if rp.hasLabel {
			w.Label = *rp.label
		}
		w.ID = recurringWindowID(w.Label, w.DaysOfWeek, w.StartTime, w.EndTime)
		for _, r := range s.Recurring {
			if r.ID == w.ID {
				return dataerr.Conflict("That recurring window already exists.")
			}
		}
		s.Recurring = append(s.Recurring, w)
		return nil
	}
	for i := range s.Recurring {
		w := &s.Recurring[i]
		if w.ID != *rp.id {
			continue
		}
		if rp.hasDays {
			w.DaysOfWeek = uniqueSortedInts(rp.days)
		}
		if rp.start != nil {
			w.StartTime = *rp.start
		}
		if rp.end != nil {
			w.EndTime = *rp.end
		}
		if rp.hasLabel {
			w.Label = *rp.label
		} else if rp.hasDays || rp.start != nil || rp.end != nil {
			w.Label = recurringWindowLabel(w.DaysOfWeek, w.StartTime, w.EndTime)
		}
		return nil
	}
	return dataerr.NotFound(fmt.Sprintf("Recurring window %s not found. It may have been changed by someone else.", *rp.id))
}

// PatchUpdateChangeWindows mirrors the PATCH.
func PatchUpdateChangeWindows(rc reqctx.RequestContext, body any) (UpdateChangeWindows, error) {
	type out = auditlog.AuditedWrite[UpdateChangeWindows]
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "The change windows"), auditlog.WriteMeta{Action: "update.windows_changed", EntityType: "update_change_windows", EntityID: updStrp("change_windows")}, func(ctx context.Context) (out, error) {
		input, err := datactx.Object(body, "Change windows", []string{"recurring_window", "add_blackouts", "remove_blackout_ids"})
		if err != nil {
			return out{}, err
		}
		if len(input) == 0 {
			return out{}, dataerr.Invalid("Change windows: nothing to change.")
		}
		var rp *recurringPatch
		if datactx.Has(input, "recurring_window") {
			read, err := readRecurringPatch(input["recurring_window"])
			if err != nil {
				return out{}, err
			}
			rp = &read
		}
		var added []Blackout
		if datactx.Has(input, "add_blackouts") {
			raw, ok := input["add_blackouts"].([]any)
			if !ok || len(raw) > 200 {
				return out{}, dataerr.Invalid("Change windows: add_blackouts must be a list of at most 200.")
			}
			months := allHijriMonths()
			for _, item := range raw {
				b, err := readBlackout(item, months)
				if err != nil {
					return out{}, err
				}
				added = append(added, b)
			}
		}
		var removed []string
		if datactx.Has(input, "remove_blackout_ids") {
			if removed, err = datactx.UUIDList(input, "remove_blackout_ids", false); err != nil {
				return out{}, err
			}
			if len(removed) > 200 {
				return out{}, dataerr.Invalid("Change windows: remove_blackout_ids must be a list of at most 200.")
			}
		}
		state, err := patchUpdates(ctx, rc, func(s *updatesState) error {
			if rp != nil {
				if err := applyRecurringPatch(s, *rp); err != nil {
					return err
				}
			}
			gone := map[string]bool{}
			for _, id := range removed {
				gone[id] = true
			}
			kept := make([]Blackout, 0, len(s.Blackouts)+len(added))
			for _, b := range s.Blackouts {
				if !gone[b.ID] {
					kept = append(kept, b)
				}
			}
			for _, b := range added {
				dup := false
				for _, k := range kept {
					dup = dup || k.ID == b.ID
				}
				if !dup {
					kept = append(kept, b)
				}
			}
			s.Blackouts = kept
			if len(s.Recurring) > 50 || len(s.Blackouts) > 200 {
				return dataerr.Invalid("Change windows: too many entries.")
			}
			return nil
		})
		if err != nil {
			return out{}, err
		}
		return out{
			Result:    changeWindowsViewOf(state, updatesToday(ctx, rc.CustomerID)),
			SummaryEn: fmt.Sprintf("Change windows changed: %d recurring, %d blackout period(s) (%s).", len(state.Recurring), len(state.Blackouts), updatesStub),
			Detail:    map[string]any{"recurring": len(state.Recurring), "blackouts": len(state.Blackouts), "fields": sortedKeys(input), "stub": true},
		}, nil
	})
}
