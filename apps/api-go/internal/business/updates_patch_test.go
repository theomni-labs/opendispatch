// SPDX-License-Identifier: AGPL-3.0-only

// The PATCH writes of the Updates screen.
package business

import (
	"context"
	"sync"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

func addApprover(t *testing.T, tenant, key string) string {
	t.Helper()
	now := datactx.NowISO()
	id := datactx.DeterministicUUID("test:updates:" + key)
	upsertUserRow(User{
		BaseRecord:   datactx.BaseRecord{ID: id, TenantID: tenant, CreatedAt: now, UpdatedAt: now, DataSource: "SYNTHETIC"},
		Email:        key + "@demo.example",
		DisplayName:  "Approver " + key,
		AssignedRole: access.RoleChangeApprover,
		Status:       "active",
	})
	return id
}

func auditActions(t *testing.T, rc reqctx.RequestContext, action string) (ok, denied int) {
	t.Helper()
	events, err := auditlog.EventsOf(context.Background(), rc.CustomerID)
	checkOK(t, err, "EventsOf")
	for _, e := range events {
		if e.Action != action {
			continue
		}
		if e.Outcome == "denied" {
			denied++
		} else {
			ok++
		}
	}
	return ok, denied
}

func TestRecurringWindowLabel_PortsTheScreenRule(t *testing.T) {
	cases := []struct {
		days       []int
		start, end string
		want       string
	}{
		{[]int{0, 1, 2, 3, 4}, "03:00", "05:00", defaultWindowLabel},
		{[]int{4, 3, 2}, "01:00", "02:00", "Tuesday to Thursday, 01:00 to 02:00"},
		{[]int{5, 6}, "01:00", "02:00", "Friday, Saturday, 01:00 to 02:00"},
		{[]int{0, 2, 4, 2}, "22:00", "23:30", "Sunday, Tuesday, Thursday, 22:00 to 23:30"},
		{[]int{6}, "00:00", "01:00", "Saturday, 00:00 to 01:00"},
	}
	for _, c := range cases {
		if got := recurringWindowLabel(c.days, c.start, c.end); got != c.want {
			t.Errorf("%v: got %q want %q", c.days, got, c.want)
		}
	}
}

func TestPatchPolicy_EachFieldAloneKeepsTheRest(t *testing.T) {
	admin, _, first := resetUpdatesTest(t)
	second := addApprover(t, admin.CustomerID, "approver2")
	p, err := PatchUpdateChangePolicy(admin, map[string]any{"approver_user_ids": []any{first, second}})
	checkOK(t, err, "approvers")
	if len(p.ApproverUserIDs) != 2 || !p.EmergencyOverrideEnabled || p.EmergencyReasonMinLength != 20 {
		t.Fatalf("after approvers: %+v", p)
	}
	p, err = PatchUpdateChangePolicy(admin, map[string]any{"second_approver_required": true})
	checkOK(t, err, "second")
	if !p.SecondApproverRequired || len(p.ApproverUserIDs) != 2 {
		t.Fatalf("after second: %+v", p)
	}
	p, err = PatchUpdateChangePolicy(admin, map[string]any{"emergency_override_enabled": false})
	checkOK(t, err, "override")
	if p.EmergencyOverrideEnabled || !p.SecondApproverRequired {
		t.Fatalf("after override: %+v", p)
	}
	p, err = PatchUpdateChangePolicy(admin, map[string]any{"emergency_reason_min_length": 40.0})
	checkOK(t, err, "min length")
	if p.EmergencyReasonMinLength != 40 || p.EmergencyOverrideEnabled {
		t.Fatalf("after min length: %+v", p)
	}
	stored, err := GetUpdateChangePolicy(admin)
	checkOK(t, err, "get")
	if stored.EmergencyReasonMinLength != 40 || !stored.SecondApproverRequired || len(stored.ApproverUserIDs) != 2 {
		t.Fatalf("stored %+v", stored)
	}
	if ok, _ := auditActions(t, admin, "update.policy_changed"); ok != 4 {
		t.Fatalf("policy audit events %d, want 4", ok)
	}
}

func TestPatchPolicy_Validation(t *testing.T) {
	admin, _, _ := resetUpdatesTest(t)
	bad := []map[string]any{
		{},
		{"nope": true},
		{"second_approver_required": "yes"},
		{"emergency_reason_min_length": 19.0},
		{"emergency_reason_min_length": 1001.0},
		{"approver_user_ids": []any{"not-a-uuid"}},
		{"approver_user_ids": []any{datactx.DeterministicUUID("nobody")}},
		{"second_approver_required": true},
	}
	for i, body := range bad {
		_, err := PatchUpdateChangePolicy(admin, body)
		wantCode(t, err, dataerr.CodeInvalid, "bad policy body")
		_ = i
	}
	if ok, _ := auditActions(t, admin, "update.policy_changed"); ok != 0 {
		t.Fatalf("a refused patch wrote %d audit events", ok)
	}
}

func TestPatchConnection_FieldsAloneAndProxyRules(t *testing.T) {
	admin, _, _ := resetUpdatesTest(t)
	c, err := PatchUpdateConnection(admin, map[string]any{"proxy": map[string]any{"address": " proxy.local:3128 ", "username": "svc"}})
	checkOK(t, err, "address")
	if c.Mode != "connected" || c.Proxy.Enabled || c.Proxy.Address == nil || *c.Proxy.Address != "proxy.local:3128" {
		t.Fatalf("after address: %+v", c)
	}
	c, err = PatchUpdateConnection(admin, map[string]any{"proxy": map[string]any{"enabled": true, "password": "pw-test-only"}})
	checkOK(t, err, "enable")
	if !c.Proxy.Enabled || !c.Proxy.HasPassword || c.Proxy.Username == nil || *c.Proxy.Username != "svc" {
		t.Fatalf("after enable: %+v", c)
	}
	c, err = PatchUpdateConnection(admin, map[string]any{"mode": "offline"})
	checkOK(t, err, "mode")
	if c.Mode != "offline" || !c.Proxy.Enabled || !c.Proxy.HasPassword {
		t.Fatalf("mode alone changed the proxy: %+v", c)
	}
	_, err = PatchUpdateConnection(admin, map[string]any{"proxy": map[string]any{"address": "  "}})
	wantCode(t, err, dataerr.CodeInvalid, "blank address while enabled")
	c, err = PatchUpdateConnection(admin, map[string]any{"proxy": map[string]any{"enabled": false, "address": "", "username": nil, "password": ""}})
	checkOK(t, err, "clear")
	if c.Proxy.Enabled || c.Proxy.Address != nil || c.Proxy.Username != nil || c.Proxy.HasPassword {
		t.Fatalf("after clear: %+v", c)
	}
	for _, body := range []map[string]any{{}, {"mode": "satellite"}, {"proxy": map[string]any{}}, {"proxy": map[string]any{"port": 1.0}}, {"proxy": map[string]any{"enabled": "on"}}} {
		_, err = PatchUpdateConnection(admin, body)
		wantCode(t, err, dataerr.CodeInvalid, "bad connection body")
	}
	if ok, _ := auditActions(t, admin, "update.connection_changed"); ok != 4 {
		t.Fatalf("connection audit events %d, want 4", ok)
	}
}

func TestPatchWindows_RecurringBlackoutsAndLabel(t *testing.T) {
	admin, _, _ := resetUpdatesTest(t)
	before, err := GetUpdateChangeWindows(admin)
	checkOK(t, err, "get")
	id := before.Recurring[0].ID
	w, err := PatchUpdateChangeWindows(admin, map[string]any{"recurring_window": map[string]any{"id": id, "start_time": "02:00"}})
	checkOK(t, err, "start alone")
	if r := w.Recurring[0]; r.ID != id || r.StartTime != "02:00" || r.EndTime != "05:00" || len(r.DaysOfWeek) != 5 || r.Label != "Sunday to Thursday, 02:00 to 05:00" {
		t.Fatalf("after start: %+v", r)
	}
	w, err = PatchUpdateChangeWindows(admin, map[string]any{"recurring_window": map[string]any{"id": id, "days_of_week": []any{5.0, 6.0}}})
	checkOK(t, err, "days alone")
	if r := w.Recurring[0]; r.Label != "Friday, Saturday, 02:00 to 05:00" || r.StartTime != "02:00" {
		t.Fatalf("after days: %+v", r)
	}
	w, err = PatchUpdateChangeWindows(admin, map[string]any{"recurring_window": map[string]any{"id": id, "label": "Weekend"}})
	checkOK(t, err, "label alone")
	if w.Recurring[0].Label != "Weekend" {
		t.Fatalf("label: %+v", w.Recurring[0])
	}
	blackouts := len(w.Blackouts)
	add := map[string]any{"label": "Eid", "entered_as": "gregorian", "start_gregorian": "2027-03-09", "end_gregorian": "2027-03-12"}
	w, err = PatchUpdateChangeWindows(admin, map[string]any{"add_blackouts": []any{add}})
	checkOK(t, err, "add")
	if len(w.Blackouts) != blackouts+1 || len(w.Recurring) != 1 {
		t.Fatalf("after add: %d blackouts", len(w.Blackouts))
	}
	added := w.Blackouts[len(w.Blackouts)-1].ID
	w, err = PatchUpdateChangeWindows(admin, map[string]any{"add_blackouts": []any{add}})
	checkOK(t, err, "add again")
	if len(w.Blackouts) != blackouts+1 {
		t.Fatal("adding the same blackout twice stored it twice")
	}
	w, err = PatchUpdateChangeWindows(admin, map[string]any{"remove_blackout_ids": []any{added}})
	checkOK(t, err, "remove")
	if len(w.Blackouts) != blackouts {
		t.Fatalf("after remove: %d", len(w.Blackouts))
	}
	_, err = PatchUpdateChangeWindows(admin, map[string]any{"remove_blackout_ids": []any{added}})
	checkOK(t, err, "remove an id no longer stored")
	if ok, _ := auditActions(t, admin, "update.windows_changed"); ok != 7 {
		t.Fatalf("windows audit events %d, want 7", ok)
	}
}

func TestPatchWindows_AddsAWindowWhenNoneIsNamed(t *testing.T) {
	admin, _, _ := resetUpdatesTest(t)
	_, err := UpdateUpdateChangeWindows(admin, map[string]any{"recurring": []any{}, "blackouts": []any{}})
	checkOK(t, err, "empty")
	w, err := PatchUpdateChangeWindows(admin, map[string]any{"recurring_window": map[string]any{"days_of_week": []any{1.0, 2.0, 3.0}, "start_time": "04:00", "end_time": "06:00"}})
	checkOK(t, err, "add window")
	if len(w.Recurring) != 1 || w.Recurring[0].Label != "Monday to Wednesday, 04:00 to 06:00" {
		t.Fatalf("added %+v", w.Recurring)
	}
}

func TestPatchWindows_Validation(t *testing.T) {
	admin, _, _ := resetUpdatesTest(t)
	unknown := datactx.DeterministicUUID("no-such-window")
	invalid := []map[string]any{
		{},
		{"recurring": []any{}},
		{"recurring_window": map[string]any{"start_time": "01:00"}},
		{"recurring_window": map[string]any{"id": "x", "start_time": "01:00"}},
		{"recurring_window": map[string]any{"id": unknown, "days_of_week": []any{}}},
		{"recurring_window": map[string]any{"id": unknown, "days_of_week": []any{7.0}}},
		{"recurring_window": map[string]any{"id": unknown, "start_time": "25:00"}},
		{"recurring_window": map[string]any{"id": unknown, "label": ""}},
		{"add_blackouts": []any{map[string]any{"label": "x", "entered_as": "gregorian", "start_gregorian": "2027-03-12", "end_gregorian": "2027-03-09"}}},
		{"add_blackouts": []any{map[string]any{"label": "x", "entered_as": "hijri"}}},
		{"add_blackouts": "Eid"},
		{"remove_blackout_ids": []any{"x"}},
	}
	for _, body := range invalid {
		_, err := PatchUpdateChangeWindows(admin, body)
		wantCode(t, err, dataerr.CodeInvalid, "bad windows body")
	}
	_, err := PatchUpdateChangeWindows(admin, map[string]any{"recurring_window": map[string]any{"id": unknown, "start_time": "01:00"}})
	wantCode(t, err, dataerr.CodeNotFound, "unknown window")
}

func TestPatch_ViewerAndApproverAreRefusedAndAudited(t *testing.T) {
	admin, approver, _ := resetUpdatesTest(t)
	viewer := roleCtx(admin.CustomerID, "viewer-user", access.RoleViewerAuditor)
	for _, rc := range []reqctx.RequestContext{viewer, approver} {
		_, err := PatchUpdateChangePolicy(rc, map[string]any{"second_approver_required": false})
		wantCode(t, err, dataerr.CodeForbidden, "policy")
		_, err = PatchUpdateConnection(rc, map[string]any{"mode": "offline"})
		wantCode(t, err, dataerr.CodeForbidden, "connection")
		_, err = PatchUpdateChangeWindows(rc, map[string]any{"remove_blackout_ids": []any{}})
		wantCode(t, err, dataerr.CodeForbidden, "windows")
	}
	shared := admin
	shared.InstallMode = access.InstallShared
	_, err := PatchUpdateChangePolicy(shared, map[string]any{"second_approver_required": false})
	wantCode(t, err, dataerr.CodeForbidden, "shared install")
	for action, want := range map[string]int{"update.policy_changed": 3, "update.connection_changed": 2, "update.windows_changed": 2} {
		if ok, denied := auditActions(t, admin, action); ok != 0 || denied != want {
			t.Errorf("%s: ok %d denied %d, want 0 and %d", action, ok, denied, want)
		}
	}
	c, _ := GetUpdateConnection(admin)
	if c.Mode != "connected" {
		t.Fatal("a refused patch changed the mode")
	}
}

func TestPatch_ConcurrentSavesOfDifferentFieldsKeepBoth(t *testing.T) {
	admin, _, first := resetUpdatesTest(t)
	second := addApprover(t, admin.CustomerID, "approver2")
	_, err := PatchUpdateChangePolicy(admin, map[string]any{"approver_user_ids": []any{first, second}})
	checkOK(t, err, "approvers")
	var wg sync.WaitGroup
	errs := make([]error, 4)
	run := []func() error{
		func() error {
			_, err := PatchUpdateChangePolicy(admin, map[string]any{"second_approver_required": true})
			return err
		},
		func() error {
			_, err := PatchUpdateChangePolicy(admin, map[string]any{"emergency_reason_min_length": 50.0})
			return err
		},
		func() error {
			_, err := PatchUpdateConnection(admin, map[string]any{"mode": "offline"})
			return err
		},
		func() error {
			_, err := PatchUpdateChangeWindows(admin, map[string]any{"add_blackouts": []any{map[string]any{"label": "Eid", "entered_as": "gregorian", "start_gregorian": "2027-03-09", "end_gregorian": "2027-03-12"}}})
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
	for i, err := range errs {
		checkOK(t, err, "concurrent patch")
		_ = i
	}
	p, _ := GetUpdateChangePolicy(admin)
	c, _ := GetUpdateConnection(admin)
	w, _ := GetUpdateChangeWindows(admin)
	if !p.SecondApproverRequired || p.EmergencyReasonMinLength != 50 || c.Mode != "offline" || len(w.Blackouts) == 0 {
		t.Fatalf("a concurrent change was lost: policy %+v mode %s blackouts %d", p, c.Mode, len(w.Blackouts))
	}
}

// checkInterleavedSave: another save lands between
// the read and the write of a patch; both survive.
func checkInterleavedSave(t *testing.T, admin reqctx.RequestContext) {
	t.Helper()
	calls := 0
	_, err := patchUpdates(context.Background(), admin, func(s *updatesState) error {
		calls++
		if calls == 1 {
			_, err := PatchUpdateConnection(admin, map[string]any{"mode": "offline"})
			checkOK(t, err, "the other save")
		}
		s.Policy.EmergencyReasonMinLength = 77
		return nil
	})
	checkOK(t, err, "patch")
	if calls != 2 {
		t.Fatalf("the patch ran %d times, want 2 (one retry)", calls)
	}
	c, _ := GetUpdateConnection(admin)
	p, _ := GetUpdateChangePolicy(admin)
	if c.Mode != "offline" || p.EmergencyReasonMinLength != 77 {
		t.Fatalf("a change was lost: mode %s min length %d", c.Mode, p.EmergencyReasonMinLength)
	}
}

func TestPatch_AnInterleavedSaveIsNotLost(t *testing.T) {
	admin, _, _ := resetUpdatesTest(t)
	checkInterleavedSave(t, admin)
}

func TestPatch_AlwaysBeatenGivesConflict(t *testing.T) {
	admin, _, _ := resetUpdatesTest(t)
	n := 20
	_, err := patchUpdates(context.Background(), admin, func(s *updatesState) error {
		n++
		_, err := PatchUpdateChangePolicy(admin, map[string]any{"emergency_reason_min_length": float64(n)})
		checkOK(t, err, "the other save")
		s.ConnectionMode = "offline"
		return nil
	})
	wantCode(t, err, dataerr.CodeConflict, "always beaten")
}
