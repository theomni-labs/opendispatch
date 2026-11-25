// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func TestAddSkill_AppendsToVocabulary_CaseInsensitiveUnique(t *testing.T) {
	settingsstore.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	got, err := AddSkill(admin, map[string]any{"code": "welding", "name_en": "Welding", "name_ar": nil})
	if err != nil {
		t.Fatal(err)
	}
	if got.Code != "welding" || got.NameEn != "Welding" || got.NameAr != nil {
		t.Fatalf("got %+v", got)
	}
	vocabulary, _ := settingsstore.Get(context.Background(), "", "skills.vocabulary", []SkillInfo{})
	if len(vocabulary) != 1 {
		t.Fatalf("got %d entries, want 1", len(vocabulary))
	}

	if _, err := AddSkill(admin, map[string]any{"code": "welding", "name_en": "Welding again", "name_ar": nil}); err == nil {
		t.Fatal("want a conflict for a duplicate code")
	} else if de, ok := err.(*dataerr.DataError); !ok || de.Code != dataerr.CodeConflict {
		t.Fatalf("got %v, want a conflict", err)
	}

	if _, err := AddSkill(admin, map[string]any{"code": "Bad Code", "name_en": "X", "name_ar": nil}); err == nil {
		t.Fatal("want invalid for a code that fails the pattern")
	} else if de, ok := err.(*dataerr.DataError); !ok || de.Code != dataerr.CodeInvalid {
		t.Fatalf("got %v, want invalid", err)
	}
}

func TestUpdateSkill_RenamesKeepingTheCode(t *testing.T) {
	settingsstore.ResetForTest()
	auditlog.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	if _, err := AddSkill(admin, map[string]any{"code": "welding", "name_en": "Welding", "name_ar": nil}); err != nil {
		t.Fatal(err)
	}
	got, err := UpdateSkill(admin, "welding", map[string]any{"name_ar": " لحام "})
	check(t, err)
	if got.Code != "welding" || got.NameEn != "Welding" || got.NameAr == nil || *got.NameAr != "لحام" {
		t.Fatalf("got %+v", got)
	}
	got, err = UpdateSkill(admin, "welding", map[string]any{"name_en": "Arc welding", "name_ar": ""})
	check(t, err)
	if got.NameEn != "Arc welding" || got.NameAr != nil {
		t.Fatalf("got %+v", got)
	}
	vocabulary, _ := settingsstore.Get(context.Background(), "t1", "skills.vocabulary", []SkillInfo{})
	if len(vocabulary) != 1 || vocabulary[0].NameEn != "Arc welding" {
		t.Fatalf("stored %+v", vocabulary)
	}
	events := auditlog.AllEvents()
	if last := events[len(events)-1]; last.Action != "skill.updated" || last.EntityID == nil || *last.EntityID != "welding" {
		t.Fatalf("audit %+v", last)
	}
	for name, c := range map[string]struct {
		code string
		body any
		want dataerr.Code
	}{
		"unknown":  {"plumbing", map[string]any{"name_en": "X"}, dataerr.CodeNotFound},
		"bad code": {"Bad Code", map[string]any{"name_en": "X"}, dataerr.CodeInvalid},
		"empty":    {"welding", map[string]any{}, dataerr.CodeInvalid},
		"blank en": {"welding", map[string]any{"name_en": "  "}, dataerr.CodeInvalid},
		"extra":    {"welding", map[string]any{"code": "x"}, dataerr.CodeInvalid},
	} {
		if _, err := UpdateSkill(admin, c.code, c.body); errCode(err) != c.want {
			t.Fatalf("%s: got %v, want %s", name, err, c.want)
		}
	}
}

func TestSkillWrites_DeniedAndAudited(t *testing.T) {
	expectDenied(t, []deniedWrite{
		{"skill.updated", "skill", func() error { _, err := UpdateSkill(viewer(), "welding", map[string]any{"name_en": "X"}); return err }},
		{"skill.removed", "skill", func() error { return RemoveSkill(context.Background(), nil, viewer(), "welding") }},
	})
}

func TestAddSkill_RefusesOtherRoles(t *testing.T) {
	settingsstore.ResetForTest()
	planner := roleCtx("t1", "u1", access.RolePlanner)
	if _, err := AddSkill(planner, map[string]any{"code": "welding", "name_en": "Welding", "name_ar": nil}); err == nil {
		t.Fatal("want forbidden")
	} else if de, ok := err.(*dataerr.DataError); !ok || de.Code != dataerr.CodeForbidden {
		t.Fatalf("got %v, want forbidden", err)
	}
}
