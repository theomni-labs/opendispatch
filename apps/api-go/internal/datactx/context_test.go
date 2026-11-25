// SPDX-License-Identifier: AGPL-3.0-only

package datactx

import (
	"errors"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

func ctxFor(role access.Role, installMode access.InstallMode) reqctx.RequestContext {
	return reqctx.RequestContext{
		CustomerID:  "00000000-0000-4000-8000-000000000001",
		UserID:      "00000000-0000-4000-8000-000000000002",
		Role:        role,
		ZoneScope:   access.ZoneScope{Kind: access.ScopeWholeInstall},
		InstallMode: installMode,
	}
}

func mustDataErr(t *testing.T, err error, wantCode dataerr.Code) {
	t.Helper()
	var de *dataerr.DataError
	if !errors.As(err, &de) {
		t.Fatalf("got error %v, want a *dataerr.DataError", err)
	}
	if de.Code != wantCode {
		t.Fatalf("got code %s, want %s", de.Code, wantCode)
	}
}

func TestRequirePlatform(t *testing.T) {
	err := RequirePlatform(ctxFor(access.RoleChangeApprover, access.InstallPrivate), PlatformRecords)
	mustDataErr(t, err, dataerr.CodeForbidden)

	if err := RequirePlatform(ctxFor(access.RoleChangeApprover, access.InstallPrivate), PlatformSession); err != nil {
		t.Fatalf("change_approver / platform.session / private: got %v, want nil", err)
	}

	err = RequirePlatform(ctxFor(access.RoleChangeApprover, access.InstallShared), PlatformSession)
	mustDataErr(t, err, dataerr.CodeForbidden)

	if err := RequirePlatform(ctxFor(access.RoleViewerAuditor, access.InstallPrivate), PlatformRecords); err != nil {
		t.Fatalf("viewer_auditor / platform.records / private: got %v, want nil", err)
	}
}

func TestPaginateOpaqueCursor(t *testing.T) {
	rows := []int{0, 1, 2, 3, 4}
	first, err := Paginate(rows, PageQuery{Limit: 2})
	if err != nil {
		t.Fatalf("first page: %v", err)
	}
	if len(first.Items) != 2 || first.Items[0] != 0 || first.Items[1] != 1 {
		t.Fatalf("first.Items = %v, want [0 1]", first.Items)
	}
	if !first.Page.HasMore || first.Page.Total != 5 {
		t.Fatalf("first.Page = %+v, want has_more=true total=5", first.Page)
	}

	second, err := Paginate(rows, PageQuery{Limit: 2, Cursor: *first.Page.NextCursor})
	if err != nil {
		t.Fatalf("second page: %v", err)
	}
	if len(second.Items) != 2 || second.Items[0] != 2 || second.Items[1] != 3 {
		t.Fatalf("second.Items = %v, want [2 3]", second.Items)
	}

	last, err := Paginate(rows, PageQuery{Limit: 2, Cursor: *second.Page.NextCursor})
	if err != nil {
		t.Fatalf("last page: %v", err)
	}
	if len(last.Items) != 1 || last.Items[0] != 4 {
		t.Fatalf("last.Items = %v, want [4]", last.Items)
	}
	if last.Page.HasMore || last.Page.NextCursor != nil {
		t.Fatalf("last.Page = %+v, want has_more=false next_cursor=nil", last.Page)
	}

	if _, err := Paginate(rows, PageQuery{Limit: 0, Cursor: ""}); err != nil {
		t.Fatalf("limit 0 defaults to DefaultLimit, got error %v", err)
	}
	if _, err := Paginate(rows, PageQuery{Limit: -1}); err == nil {
		mustDataErr(t, err, dataerr.CodeInvalid)
	}
	if _, err := Paginate(rows, PageQuery{Cursor: "nonsense"}); err == nil {
		t.Fatal("want an error for a nonsense cursor")
	} else {
		mustDataErr(t, err, dataerr.CodeInvalid)
	}
}

func TestNewRecordBaseFields(t *testing.T) {
	ctx := ctxFor(access.RoleAdministrator, access.InstallPrivate)
	record := NewRecord(ctx, "", "")
	if record.TenantID != ctx.CustomerID {
		t.Errorf("TenantID = %q, want %q", record.TenantID, ctx.CustomerID)
	}
	if record.DataSource != "SYNTHETIC" {
		t.Errorf("DataSource = %q, want SYNTHETIC", record.DataSource)
	}
	if !strings.HasSuffix(record.CreatedAt, "+03:00") {
		t.Errorf("CreatedAt = %q, want a +03:00 suffix", record.CreatedAt)
	}
	if record.CreatedBy == nil || *record.CreatedBy != ctx.UserID {
		t.Errorf("CreatedBy = %v, want %q", record.CreatedBy, ctx.UserID)
	}
}

func TestSystemRecordHasNoCreator(t *testing.T) {
	ctx := ctxFor(access.RoleAdministrator, access.InstallPrivate)
	record := SystemRecord(ctx, "key", NowISO())
	if record.CreatedBy != nil {
		t.Errorf("CreatedBy = %v, want nil", record.CreatedBy)
	}
	if record.ID != DeterministicUUID("key") {
		t.Errorf("ID = %q, want the deterministic uuid of %q", record.ID, "key")
	}
}

func TestDeterministicUUIDIsStable(t *testing.T) {
	a := DeterministicUUID("zone:RD-C")
	b := DeterministicUUID("zone:RD-C")
	if a != b {
		t.Fatalf("DeterministicUUID is not stable: %q != %q", a, b)
	}
	if a == DeterministicUUID("zone:RD-N") {
		t.Fatal("different names produced the same uuid")
	}
	if !uuidPattern.MatchString(a) {
		t.Fatalf("%q does not look like a UUID", a)
	}
}

func TestObjectClosedBody(t *testing.T) {
	_, err := Object(map[string]any{"a": 1.0, "b": 2.0}, "Body", []string{"a"})
	mustDataErr(t, err, dataerr.CodeInvalid)

	o, err := Object(map[string]any{"a": 1.0}, "Body", []string{"a", "b"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !Has(o, "a") || Has(o, "b") {
		t.Fatalf("Has: got a=%v b=%v", Has(o, "a"), Has(o, "b"))
	}
}

func TestString(t *testing.T) {
	_, err := String(Obj{"name": ""}, "name", StrOpts{Min: 1, HasMin: true})
	mustDataErr(t, err, dataerr.CodeInvalid)

	v, err := String(Obj{"name": "Riyadh Central"}, "name", StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
	if err != nil || v != "Riyadh Central" {
		t.Fatalf("got (%q, %v), want (Riyadh Central, nil)", v, err)
	}
}

func TestNullableString(t *testing.T) {
	v, err := NullableString(Obj{}, "name_ar", StrOpts{})
	if err != nil || v != nil {
		t.Fatalf("missing key: got (%v, %v), want (nil, nil)", v, err)
	}
	v, err = NullableString(Obj{"name_ar": nil}, "name_ar", StrOpts{})
	if err != nil || v != nil {
		t.Fatalf("null key: got (%v, %v), want (nil, nil)", v, err)
	}
	v, err = NullableString(Obj{"name_ar": "مركز"}, "name_ar", StrOpts{})
	if err != nil || v == nil || *v != "مركز" {
		t.Fatalf("got (%v, %v), want (مركز, nil)", v, err)
	}
}

func TestEnumOf(t *testing.T) {
	_, err := EnumOf(Obj{"k": "x"}, "k", []string{"a", "b"})
	mustDataErr(t, err, dataerr.CodeInvalid)

	got, err := EnumOf(Obj{"k": "b"}, "k", []string{"a", "b"})
	if err != nil || got != "b" {
		t.Fatalf("got (%q, %v), want (b, nil)", got, err)
	}
}

func TestInt(t *testing.T) {
	got, err := Int(Obj{"n": 3.0}, "n", NumOpts{Min: 1, Max: 5, HasMin: true, HasMax: true})
	if err != nil || got != 3 {
		t.Fatalf("got (%d, %v), want (3, nil)", got, err)
	}
	_, err = Int(Obj{"n": 3.5}, "n", NumOpts{})
	mustDataErr(t, err, dataerr.CodeInvalid)
	_, err = Int(Obj{"n": 10.0}, "n", NumOpts{Max: 5, HasMax: true})
	mustDataErr(t, err, dataerr.CodeInvalid)
}

func TestUUID(t *testing.T) {
	_, err := UUID(Obj{"id": "not-a-uuid"}, "id")
	mustDataErr(t, err, dataerr.CodeInvalid)
	got, err := UUID(Obj{"id": "091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a"}, "id")
	if err != nil || got != "091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a" {
		t.Fatalf("got (%q, %v)", got, err)
	}
}

func TestNullableUUID(t *testing.T) {
	v, err := NullableUUID(Obj{"sub_zone_id": nil}, "sub_zone_id")
	if err != nil || v != nil {
		t.Fatalf("got (%v, %v), want (nil, nil)", v, err)
	}
	_, err = NullableUUID(Obj{"sub_zone_id": "nope"}, "sub_zone_id")
	mustDataErr(t, err, dataerr.CodeInvalid)
}

func TestDate(t *testing.T) {
	_, err := Date(Obj{"d": "2026-13-40"}, "d")
	mustDataErr(t, err, dataerr.CodeInvalid)
	got, err := Date(Obj{"d": "2026-09-14"}, "d")
	if err != nil || got != "2026-09-14" {
		t.Fatalf("got (%q, %v)", got, err)
	}
}

func TestMatchesText(t *testing.T) {
	if !MatchesText("Riyadh Central", "") {
		t.Error("empty query should match everything")
	}
	if !MatchesText("Riyadh Central", "central") {
		t.Error("case-insensitive contains should match")
	}
	if MatchesText("Riyadh Central", "jeddah") {
		t.Error("non-matching query matched")
	}
}
