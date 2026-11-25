// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func TestLocalization_DefaultThenUpdate(t *testing.T) {
	settingsstore.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	before, err := GetLocalizationSettings(admin)
	check(t, err)
	if before.DefaultLocale != "en" || before.TimeZone != "Asia/Riyadh" {
		t.Fatalf("got %+v, want defaults", before)
	}

	updated, err := UpdateLocalizationSettings(admin, map[string]any{
		"default_locale": "ar", "digit_system": "arabic_indic", "primary_calendar": "hijri",
		"show_secondary_calendar": true, "time_zone": "Asia/Riyadh", "first_day_of_week": "saturday",
	})
	check(t, err)
	if updated.DefaultLocale != "ar" || updated.FirstDayOfWeek != "saturday" {
		t.Fatalf("got %+v, want ar/saturday", updated)
	}

	after, err := GetLocalizationSettings(admin)
	check(t, err)
	if after != updated {
		t.Fatalf("get after update = %+v, want %+v", after, updated)
	}
}

func TestLocalization_RefusesBadEnumAndNonAdmin(t *testing.T) {
	settingsstore.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	_, err := UpdateLocalizationSettings(admin, map[string]any{
		"default_locale": "fr", "digit_system": "western", "primary_calendar": "gregorian",
		"show_secondary_calendar": true, "time_zone": "Asia/Riyadh", "first_day_of_week": "sunday",
	})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad locale: got %v, want Invalid", err)
	}

	viewer := roleCtx("t1", "u2", access.RoleViewerAuditor)
	_, err = UpdateLocalizationSettings(viewer, map[string]any{
		"default_locale": "en", "digit_system": "western", "primary_calendar": "gregorian",
		"show_secondary_calendar": true, "time_zone": "Asia/Riyadh", "first_day_of_week": "sunday",
	})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("viewer write: got %v, want Forbidden", err)
	}

	_, err = GetLocalizationSettings(reqctx.RequestContext{CustomerID: "t1", UserID: "u3", Role: access.RoleChangeApprover, ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}, InstallMode: access.InstallPrivate})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("change_approver read: got %v, want Forbidden", err)
	}
}
