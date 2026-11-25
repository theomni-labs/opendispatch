// SPDX-License-Identifier: AGPL-3.0-only

// The Events tab of Leave Policy and Calendar.
package business

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

// CalendarEventScope: no cities, no region is everywhere.
type CalendarEventScope struct {
	Cities []string `json:"cities"`
	Region *string  `json:"region"`
}

// CalendarEvent mirrors the contract.
type CalendarEvent struct {
	ID        string             `json:"id"`
	Kind      string             `json:"kind"`
	EventType *string            `json:"event_type"`
	Name      string             `json:"name"`
	StartDate string             `json:"start_date"`
	EndDate   string             `json:"end_date"`
	Source    string             `json:"source"`
	Scope     CalendarEventScope `json:"scope"`
	Editable  bool               `json:"editable"`
	// NameAr and Notice: notice events only
	NameAr *string                `json:"name_ar,omitempty"`
	Notice *CalendarNoticeDetails `json:"notice,omitempty"`
}

// CalendarEvents mirrors the contract.
type CalendarEvents struct {
	DateFrom  string          `json:"date_from"`
	DateTo    string          `json:"date_to"`
	PaydayDay int             `json:"payday_day"`
	Items     []CalendarEvent `json:"items"`
}

// PaydayDayUpdate mirrors the contract.
type PaydayDayUpdate struct {
	PaydayDay int `json:"payday_day"`
}

const (
	maxEventWindowDays = 400
	maxCalendarItems   = 1000
)

var calendarKinds = []string{"school", "season", "umrah"}

// calendarKeyOf: a settable kind's setting key.
func calendarKeyOf(kind string) string {
	switch kind {
	case "school":
		return forecastcal.KeySchoolTerms
	case "season":
		return forecastcal.KeySeasonEvents
	case "umrah":
		return forecastcal.KeyUmrahWindows
	}
	return ""
}

// calendarEventID follows the range's content.
func calendarEventID(kind string, r forecastcal.Range) string {
	return datactx.DeterministicUUID("calendar_event|" + kind + "|" + r.Start + "|" + r.End + "|" + r.Name)
}

func everywhere() CalendarEventScope { return CalendarEventScope{Cities: []string{}} }

func setEvent(kind string, r forecastcal.Range) CalendarEvent {
	return CalendarEvent{ID: calendarEventID(kind, r), Kind: kind, Name: r.Name, StartDate: r.Start, EndDate: r.End, Source: "setting", Scope: everywhere(), Editable: true}
}

func storedRanges(ctx context.Context, tenant, kind string) []forecastcal.Range {
	return readSetting[[]forecastcal.Range](ctx, tenant, calendarKeyOf(kind), nil)
}

func riyadhToday() string { return time.Now().In(riyadhZone).Format("2006-01-02") }

// eventWindow: from..to, default today and a year.
func eventWindow(from, to string) (string, string, error) {
	if from == "" {
		from = riyadhToday()
	}
	start, err := localDate(from, "from")
	if err != nil {
		return "", "", err
	}
	if to == "" {
		to = start.AddDate(0, 0, 365).Format("2006-01-02")
	}
	end, err := localDate(to, "to")
	if err != nil {
		return "", "", err
	}
	if end.Before(start) || end.Sub(start) > maxEventWindowDays*24*time.Hour {
		return "", "", dataerr.Invalid(fmt.Sprintf("to must be on or after from, at most %d days later.", maxEventWindowDays))
	}
	return from, to, nil
}

// ListCalendarEvents: setting, notice and derived events.
func ListCalendarEvents(rc reqctx.RequestContext, from, to string) (CalendarEvents, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminLeavePolicyCalendar, access.AccessView); err != nil {
		return CalendarEvents{}, err
	}
	from, to, err := eventWindow(from, to)
	if err != nil {
		return CalendarEvents{}, err
	}
	payday := readSetting(context.Background(), rc.CustomerID, forecastcal.KeyPaydayDay, forecastcal.DefaultPaydayDay)
	if payday < 0 || payday > 31 {
		payday = 0
	}
	out := CalendarEvents{DateFrom: from, DateTo: to, PaydayDay: payday, Items: []CalendarEvent{}}
	for _, kind := range calendarKinds {
		for _, r := range forecastcal.Valid(storedRanges(context.Background(), rc.CustomerID, kind)) {
			out.Items = append(out.Items, setEvent(kind, r))
		}
	}
	for _, n := range forecastcal.ValidNotices(storedNotices(context.Background(), rc.CustomerID)) {
		if n.End >= from && n.Start <= to {
			out.Items = append(out.Items, noticeEvent(n))
		}
	}
	for _, d := range forecastcal.DerivedRanges(from, to) {
		source := "fixed"
		if d.Hijri {
			source = "hijri"
		}
		out.Items = append(out.Items, CalendarEvent{
			ID: datactx.DeterministicUUID("calendar_event|derived|" + d.Type + "|" + d.Name + "|" + d.Start), Kind: "derived", EventType: strPtr(d.Type),
			Name: d.Name, StartDate: d.Start, EndDate: d.End, Source: source, Scope: everywhere(),
		})
	}
	if len(out.Items) > maxCalendarItems {
		out.Items = out.Items[:maxCalendarItems]
	}
	return out, nil
}

// calendarWrite reads and checks the body.
func calendarWrite(body any) (string, forecastcal.Range, datactx.Obj, error) {
	kind, r, input, err := calendarWriteParts(body)
	if err == nil && kind != noticeKind && (datactx.Has(input, "notice") || datactx.Has(input, "name_ar")) {
		err = dataerr.Invalid("Calendar event: notice and name_ar go only with kind notice.")
	}
	if err == nil && kind == noticeKind && !datactx.Has(input, "notice") {
		err = dataerr.Invalid("Calendar event: kind notice needs notice.")
	}
	return kind, r, input, err
}

func calendarWriteParts(body any) (string, forecastcal.Range, datactx.Obj, error) {
	input, err := datactx.Object(body, "Calendar event", []string{"kind", "name", "start_date", "end_date", "name_ar", "notice"})
	if err != nil {
		return "", forecastcal.Range{}, nil, err
	}
	kind, err := datactx.EnumOf(input, "kind", append(append([]string{}, calendarKinds...), noticeKind))
	if err != nil {
		return "", forecastcal.Range{}, nil, err
	}
	name, err := datactx.String(input, "name", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
	if err != nil {
		return "", forecastcal.Range{}, nil, err
	}
	if strings.TrimSpace(name) == "" {
		return "", forecastcal.Range{}, nil, dataerr.Invalid("Calendar event: name is required.")
	}
	start, err := datactx.String(input, "start_date", datactx.StrOpts{})
	if err != nil {
		return "", forecastcal.Range{}, nil, err
	}
	end, err := datactx.String(input, "end_date", datactx.StrOpts{})
	if err != nil {
		return "", forecastcal.Range{}, nil, err
	}
	s, err := localDate(start, "start_date")
	if err != nil {
		return "", forecastcal.Range{}, nil, err
	}
	e, err := localDate(end, "end_date")
	if err != nil {
		return "", forecastcal.Range{}, nil, err
	}
	if e.Before(s) {
		return "", forecastcal.Range{}, nil, dataerr.Invalid("Calendar event: end_date is before start_date.")
	}
	return kind, forecastcal.Range{Start: start, End: end, Name: strings.TrimSpace(name)}, input, nil
}

// findSetEvent: the kind and index of an id.
func findSetEvent(ctx context.Context, tenant, id string) (string, []forecastcal.Range, int) {
	for _, kind := range calendarKinds {
		ranges := storedRanges(ctx, tenant, kind)
		for i, r := range ranges {
			if calendarEventID(kind, r) == id {
				return kind, ranges, i
			}
		}
	}
	return "", nil, -1
}

// putRanges checks overlaps, sorts and stores.
func putRanges(ctx context.Context, tenant, kind string, ranges []forecastcal.Range, changed int) error {
	r := ranges[changed]
	for i, other := range ranges {
		if i != changed && r.Start <= other.End && r.End >= other.Start {
			return dataerr.Conflict(fmt.Sprintf("Calendar event: overlaps %s (%s to %s).", other.Name, other.Start, other.End))
		}
	}
	sort.SliceStable(ranges, func(i, j int) bool { return ranges[i].Start < ranges[j].Start })
	if err := forecastcal.ValidateSetting(calendarKeyOf(kind), ranges); err != nil {
		return dataerr.Invalid(err.Error())
	}
	return settingsstore.Put(ctx, tenant, calendarKeyOf(kind), ranges)
}

func calendarSummary(r forecastcal.Range, kind string) map[string]any {
	return map[string]any{"name": r.Name, "kind": kind, "start": r.Start, "end": r.End}
}

// CreateCalendarEvent adds a range set here.
func CreateCalendarEvent(rc reqctx.RequestContext, body any) (CalendarEvent, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminLeavePolicyCalendar}, auditlog.WriteMeta{Action: "calendar_event.created", EntityType: "calendar_event"}, func(ctx context.Context) (auditlog.AuditedWrite[CalendarEvent], error) {
		var zero auditlog.AuditedWrite[CalendarEvent]
		kind, r, input, err := calendarWrite(body)
		if err != nil {
			return zero, err
		}
		if kind == noticeKind {
			n, err := noticeFrom(ctx, rc, input, r)
			if err != nil {
				return zero, err
			}
			list := append(append([]forecastcal.NoticeRange{}, storedNotices(ctx, rc.CustomerID)...), n)
			if err := putNotices(ctx, rc.CustomerID, list, len(list)-1); err != nil {
				return zero, err
			}
			ev := noticeEvent(n)
			return auditlog.AuditedWrite[CalendarEvent]{Result: ev, EntityID: &ev.ID, SummaryEn: fmt.Sprintf("Calendar notice event %s added (%s to %s).", n.Name, n.Start, n.End), Detail: sumDetail(map[string]any{"setting": forecastcal.KeyNoticeEvents, "zone_ids": n.ZoneIDs, "impact": n.Impact, "assisted": n.Assisted}, noticeSummary(n))}, nil
		}
		ranges := append(append([]forecastcal.Range{}, storedRanges(ctx, rc.CustomerID, kind)...), r)
		if err := putRanges(ctx, rc.CustomerID, kind, ranges, len(ranges)-1); err != nil {
			return zero, err
		}
		ev := setEvent(kind, r)
		return auditlog.AuditedWrite[CalendarEvent]{Result: ev, EntityID: &ev.ID, SummaryEn: fmt.Sprintf("Calendar %s %s added (%s to %s).", kind, r.Name, r.Start, r.End), Detail: sumDetail(map[string]any{"setting": calendarKeyOf(kind)}, calendarSummary(r, kind))}, nil
	})
}

// UpdateCalendarEvent changes a range; kind stays.
func UpdateCalendarEvent(rc reqctx.RequestContext, id string, body any) (CalendarEvent, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminLeavePolicyCalendar}, auditlog.WriteMeta{Action: "calendar_event.updated", EntityType: "calendar_event", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[CalendarEvent], error) {
		var zero auditlog.AuditedWrite[CalendarEvent]
		if _, err := importutil.RequireID(id, "Calendar event"); err != nil {
			return zero, err
		}
		kind, r, input, err := calendarWrite(body)
		if err != nil {
			return zero, err
		}
		if notices, ni := findNotice(ctx, rc.CustomerID, id); ni >= 0 {
			if kind != noticeKind {
				return zero, dataerr.Invalid("Calendar event: the kind cannot change.")
			}
			n, err := noticeFrom(ctx, rc, input, r)
			if err != nil {
				return zero, err
			}
			before := notices[ni]
			next := append([]forecastcal.NoticeRange{}, notices...)
			next[ni] = n
			if err := putNotices(ctx, rc.CustomerID, next, ni); err != nil {
				return zero, err
			}
			ev := noticeEvent(n)
			return auditlog.AuditedWrite[CalendarEvent]{Result: ev, SummaryEn: fmt.Sprintf("Calendar notice event %s changed (%s to %s).", n.Name, n.Start, n.End), Detail: sumDetail(map[string]any{"setting": forecastcal.KeyNoticeEvents, "before": noticeSummary(before), "new_id": ev.ID, "zone_ids": n.ZoneIDs}, noticeSummary(n))}, nil
		}
		stored, ranges, i := findSetEvent(ctx, rc.CustomerID, id)
		if i < 0 {
			return zero, dataerr.NotFound("Calendar event not found, or not one set here.")
		}
		if stored != kind {
			return zero, dataerr.Invalid("Calendar event: the kind cannot change.")
		}
		before := ranges[i]
		next := append([]forecastcal.Range{}, ranges...)
		next[i] = r
		if err := putRanges(ctx, rc.CustomerID, kind, next, i); err != nil {
			return zero, err
		}
		ev := setEvent(kind, r)
		return auditlog.AuditedWrite[CalendarEvent]{Result: ev, SummaryEn: fmt.Sprintf("Calendar %s %s changed (%s to %s).", kind, r.Name, r.Start, r.End), Detail: sumDetail(map[string]any{"setting": calendarKeyOf(kind), "before": before, "new_id": ev.ID}, calendarSummary(r, kind))}, nil
	})
}

// DeleteCalendarEvent removes a range set here.
func DeleteCalendarEvent(rc reqctx.RequestContext, id string) error {
	_, err := auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminLeavePolicyCalendar}, auditlog.WriteMeta{Action: "calendar_event.deleted", EntityType: "calendar_event", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[struct{}], error) {
		var zero auditlog.AuditedWrite[struct{}]
		if _, err := importutil.RequireID(id, "Calendar event"); err != nil {
			return zero, err
		}
		if notices, ni := findNotice(ctx, rc.CustomerID, id); ni >= 0 {
			gone := notices[ni]
			next := append(append([]forecastcal.NoticeRange{}, notices[:ni]...), notices[ni+1:]...)
			if err := settingsstore.Put(ctx, rc.CustomerID, forecastcal.KeyNoticeEvents, next); err != nil {
				return zero, err
			}
			return auditlog.AuditedWrite[struct{}]{SummaryEn: fmt.Sprintf("Calendar notice event %s removed.", gone.Name), Detail: sumDetail(map[string]any{"setting": forecastcal.KeyNoticeEvents, "removed": noticeSummary(gone)}, noticeSummary(gone))}, nil
		}
		kind, ranges, i := findSetEvent(ctx, rc.CustomerID, id)
		if i < 0 {
			return zero, dataerr.NotFound("Calendar event not found, or not one set here.")
		}
		gone := ranges[i]
		next := append(append([]forecastcal.Range{}, ranges[:i]...), ranges[i+1:]...)
		if err := settingsstore.Put(ctx, rc.CustomerID, calendarKeyOf(kind), next); err != nil {
			return zero, err
		}
		return auditlog.AuditedWrite[struct{}]{SummaryEn: fmt.Sprintf("Calendar %s %s removed.", kind, gone.Name), Detail: sumDetail(map[string]any{"setting": calendarKeyOf(kind), "removed": gone}, calendarSummary(gone, kind))}, nil
	})
	return err
}

// UpdatePaydayDay sets forecast.payday_day; 0 is off.
func UpdatePaydayDay(rc reqctx.RequestContext, body any) (PaydayDayUpdate, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminLeavePolicyCalendar}, auditlog.WriteMeta{Action: "settings.payday_day_changed", EntityType: "setting", EntityID: strPtr(forecastcal.KeyPaydayDay)}, func(ctx context.Context) (auditlog.AuditedWrite[PaydayDayUpdate], error) {
		var zero auditlog.AuditedWrite[PaydayDayUpdate]
		input, err := datactx.Object(body, "Payday day", []string{"payday_day"})
		if err != nil {
			return zero, err
		}
		n, err := datactx.Number(input, "payday_day", datactx.NumOpts{Min: 0, Max: 31, HasMin: true, HasMax: true})
		if err != nil {
			return zero, err
		}
		if n != float64(int(n)) {
			return zero, dataerr.Invalid("Input: payday_day must be a whole number.")
		}
		before := readSetting(ctx, rc.CustomerID, forecastcal.KeyPaydayDay, forecastcal.DefaultPaydayDay)
		day := int(n)
		if err := settingsstore.Put(ctx, rc.CustomerID, forecastcal.KeyPaydayDay, day); err != nil {
			return zero, err
		}
		return auditlog.AuditedWrite[PaydayDayUpdate]{Result: PaydayDayUpdate{PaydayDay: day}, SummaryEn: fmt.Sprintf("Payday day changed from %d to %d (0 is off).", before, day), Detail: sumDetail(map[string]any{"from": before, "to": day}, map[string]any{"from": before, "to": day})}, nil
	})
}
