// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors the localization part of system.ts.
package business

import (
	"context"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

var (
	localeValues       = []string{"ar", "en"}
	digitSystemValues  = []string{"western", "arabic_indic"}
	calendarValues     = []string{"gregorian", "hijri"}
	timeZoneValues     = []string{"Asia/Riyadh"}
	firstDayWeekValues = []string{"saturday", "sunday", "monday"}
)

// LocalizationSettings mirrors the contract type.
type LocalizationSettings struct {
	DefaultLocale         string `json:"default_locale"`
	DigitSystem           string `json:"digit_system"`
	PrimaryCalendar       string `json:"primary_calendar"`
	ShowSecondaryCalendar bool   `json:"show_secondary_calendar"`
	TimeZone              string `json:"time_zone"`
	FirstDayOfWeek        string `json:"first_day_of_week"`
}

var defaultLocalization = LocalizationSettings{
	DefaultLocale: "en", DigitSystem: "western", PrimaryCalendar: "gregorian",
	ShowSecondaryCalendar: true, TimeZone: "Asia/Riyadh", FirstDayOfWeek: "sunday",
}

func getLocalization(ctx context.Context, tenant string) LocalizationSettings {
	return readSetting(ctx, tenant, "localization", defaultLocalization)
}

// GetLocalizationSettings: read-only, view access.
func GetLocalizationSettings(ctx reqctx.RequestContext) (LocalizationSettings, error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleAdminLocalization, access.AccessView); err != nil {
		return LocalizationSettings{}, err
	}
	return getLocalization(context.Background(), ctx.CustomerID), nil
}

func enumField(input datactx.Obj, key string, allowed []string) (string, error) {
	return datactx.EnumOf(input, key, allowed)
}

// UpdateLocalizationSettings mirrors the TS write.
func UpdateLocalizationSettings(ctx reqctx.RequestContext, body any) (LocalizationSettings, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: access.ModuleAdminLocalization}, auditlog.WriteMeta{Action: "localization.updated", EntityType: "setting", EntityID: strPtr("localization")}, func(uctx context.Context) (auditlog.AuditedWrite[LocalizationSettings], error) {
		input, err := datactx.Object(body, "Localization", []string{"default_locale", "digit_system", "primary_calendar", "show_secondary_calendar", "time_zone", "first_day_of_week"})
		if err != nil {
			return auditlog.AuditedWrite[LocalizationSettings]{}, err
		}
		defaultLocale, err := enumField(input, "default_locale", localeValues)
		if err != nil {
			return auditlog.AuditedWrite[LocalizationSettings]{}, err
		}
		digitSystem, err := enumField(input, "digit_system", digitSystemValues)
		if err != nil {
			return auditlog.AuditedWrite[LocalizationSettings]{}, err
		}
		primaryCalendar, err := enumField(input, "primary_calendar", calendarValues)
		if err != nil {
			return auditlog.AuditedWrite[LocalizationSettings]{}, err
		}
		showSecondary, err := datactx.Bool(input, "show_secondary_calendar")
		if err != nil {
			return auditlog.AuditedWrite[LocalizationSettings]{}, err
		}
		timeZone, err := enumField(input, "time_zone", timeZoneValues)
		if err != nil {
			return auditlog.AuditedWrite[LocalizationSettings]{}, err
		}
		firstDay, err := enumField(input, "first_day_of_week", firstDayWeekValues)
		if err != nil {
			return auditlog.AuditedWrite[LocalizationSettings]{}, err
		}
		next := LocalizationSettings{
			DefaultLocale: defaultLocale, DigitSystem: digitSystem, PrimaryCalendar: primaryCalendar,
			ShowSecondaryCalendar: showSecondary, TimeZone: timeZone, FirstDayOfWeek: firstDay,
		}
		before := getLocalization(uctx, ctx.CustomerID)
		if err := settingsstore.Put(uctx, ctx.CustomerID, "localization", next); err != nil {
			return auditlog.AuditedWrite[LocalizationSettings]{}, err
		}
		return auditlog.AuditedWrite[LocalizationSettings]{Result: next, SummaryEn: "Localisation settings updated.", Detail: map[string]any{"from": before, "to": next}}, nil
	})
}
