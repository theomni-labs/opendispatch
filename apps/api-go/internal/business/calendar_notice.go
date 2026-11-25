// SPDX-License-Identifier: AGPL-3.0-only

// Notice events on the Events tab (kind notice).
package business

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const noticeKind = "notice"

// CalendarNoticeDetails mirrors the contract.
type CalendarNoticeDetails struct {
	NoticeType        string   `json:"notice_type"`
	ForecastEventType string   `json:"forecast_event_type"`
	ZoneIDs           []string `json:"zone_ids"`
	StartTime         *string  `json:"start_time"`
	EndTime           *string  `json:"end_time"`
	Impact            string   `json:"impact"`
	ImpactReason      *string  `json:"impact_reason"`
	Quote             *string  `json:"quote"`
	Assisted          bool     `json:"assisted"`
}

// noticeZone: a zone a notice may name.
type noticeZone struct {
	ID, Code, NameEn, City string
}

var noticeZoneConn *tenancy.Connection

// UseCalendarZones: the connection notice checks use.
func UseCalendarZones(conn *tenancy.Connection) { noticeZoneConn = conn }

// noticeZones: active readable zones; tests swap it.
var noticeZones = func(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) ([]noticeZone, error) {
	if conn == nil {
		return nil, dataerr.Invalid("Calendar event: zones are not available.")
	}
	zones, err := readableZones(ctx, conn, rc)
	if err != nil {
		return nil, err
	}
	cities, err := allCities(ctx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	cityName := map[string]string{}
	for _, c := range cities {
		if c.IsActive {
			cityName[c.ID] = c.NameEn
		}
	}
	var out []noticeZone
	for _, z := range zones {
		city, ok := cityName[z.CityID]
		if !z.IsActive || !ok {
			continue
		}
		code, _ := z.Extra["code"].(string)
		if code == "" {
			code = z.NameEn
		}
		out = append(out, noticeZone{ID: z.ID, Code: code, NameEn: z.NameEn, City: city})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
	return out, nil
}

func noticeEventID(n forecastcal.NoticeRange) string {
	return datactx.DeterministicUUID("calendar_event|notice|" + n.Start + "|" + n.End + "|" + n.Name + "|" + n.Type + "|" + strings.Join(n.ZoneIDs, ","))
}

func noticeOpt(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func noticeEvent(n forecastcal.NoticeRange) CalendarEvent {
	cities := append([]string{}, n.Cities...)
	ev := CalendarEvent{
		ID: noticeEventID(n), Kind: noticeKind, EventType: strPtr(forecastcal.NoticeEventType(n.Type)), Name: n.Name,
		StartDate: n.Start, EndDate: n.End, Source: "setting", Scope: CalendarEventScope{Cities: cities}, Editable: true,
		NameAr: noticeOpt(n.NameAr),
		Notice: &CalendarNoticeDetails{
			NoticeType: n.Type, ForecastEventType: forecastcal.NoticeEventType(n.Type), ZoneIDs: append([]string{}, n.ZoneIDs...),
			StartTime: noticeOpt(n.StartTime), EndTime: noticeOpt(n.EndTime), Impact: n.Impact,
			ImpactReason: noticeOpt(n.ImpactReason), Quote: noticeOpt(n.Quote), Assisted: n.Assisted,
		},
	}
	return ev
}

func storedNotices(ctx context.Context, tenant string) []forecastcal.NoticeRange {
	return readSetting[[]forecastcal.NoticeRange](ctx, tenant, forecastcal.KeyNoticeEvents, nil)
}

var hhmmPattern = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

func noticeTime(o datactx.Obj, key string) (string, error) {
	v, has := o[key]
	if !has || v == nil {
		return "", nil
	}
	s, ok := v.(string)
	if !ok || !hhmmPattern.MatchString(s) {
		return "", dataerr.Invalid("Calendar event: " + key + " must be HH:MM.")
	}
	return s, nil
}

func optLongText(o datactx.Obj, key string) (string, error) {
	v, has := o[key]
	if !has || v == nil {
		return "", nil
	}
	s, ok := v.(string)
	if !ok || len([]rune(s)) > 300 {
		return "", dataerr.Invalid("Calendar event: " + key + " must be text of at most 300 characters.")
	}
	return strings.TrimSpace(s), nil
}

// noticeFrom: the write body's notice, checked.
func noticeFrom(ctx context.Context, rc reqctx.RequestContext, input datactx.Obj, r forecastcal.Range) (forecastcal.NoticeRange, error) {
	var zero forecastcal.NoticeRange
	o, err := datactx.Object(input["notice"], "Calendar event notice", []string{"notice_type", "zone_ids", "start_time", "end_time", "impact", "impact_reason", "quote", "assisted"})
	if err != nil {
		return zero, err
	}
	typ, err := datactx.EnumOf(o, "notice_type", forecastcal.NoticeTypes)
	if err != nil {
		return zero, err
	}
	impact, err := datactx.EnumOf(o, "impact", forecastcal.Impacts)
	if err != nil {
		return zero, err
	}
	ids, err := datactx.UUIDList(o, "zone_ids", false)
	if err != nil {
		return zero, err
	}
	n := forecastcal.NoticeRange{Start: r.Start, End: r.End, Name: r.Name, Type: typ, Impact: impact, ZoneIDs: ids}
	if n.StartTime, err = noticeTime(o, "start_time"); err != nil {
		return zero, err
	}
	if n.EndTime, err = noticeTime(o, "end_time"); err != nil {
		return zero, err
	}
	if n.ImpactReason, err = optLongText(o, "impact_reason"); err != nil {
		return zero, err
	}
	if n.Quote, err = optLongText(o, "quote"); err != nil {
		return zero, err
	}
	if v, has := o["assisted"]; has {
		b, ok := v.(bool)
		if !ok {
			return zero, dataerr.Invalid("Calendar event: assisted must be true or false.")
		}
		n.Assisted = b
	}
	if s, ok := input["name_ar"].(string); ok {
		n.NameAr = strings.TrimSpace(s)
	} else if v, has := input["name_ar"]; has && v != nil {
		return zero, dataerr.Invalid("Calendar event: name_ar must be text.")
	}
	if len(ids) > 0 {
		zones, err := noticeZones(ctx, noticeZoneConn, rc)
		if err != nil {
			return zero, err
		}
		byID := map[string]noticeZone{}
		for _, z := range zones {
			byID[z.ID] = z
		}
		seen := map[string]bool{}
		for _, id := range ids {
			z, ok := byID[id]
			if !ok {
				return zero, dataerr.Invalid("Calendar event: a zone that does not exist, is inactive or is outside your zones.")
			}
			if !seen[z.City] {
				seen[z.City] = true
				n.Cities = append(n.Cities, z.City)
			}
		}
		sort.Strings(n.ZoneIDs)
		sort.Strings(n.Cities)
	}
	if err := n.Check(); err != nil {
		return zero, dataerr.Invalid("Calendar event: " + err.Error() + ".")
	}
	return n, nil
}

// findNotice: the index of a notice event id.
func findNotice(ctx context.Context, tenant, id string) ([]forecastcal.NoticeRange, int) {
	list := storedNotices(ctx, tenant)
	for i, n := range list {
		if noticeEventID(n) == id {
			return list, i
		}
	}
	return list, -1
}

// putNotices checks duplicates, sorts and stores.
func putNotices(ctx context.Context, tenant string, list []forecastcal.NoticeRange, changed int) error {
	id := noticeEventID(list[changed])
	for i, n := range list {
		if i != changed && noticeEventID(n) == id {
			return dataerr.Conflict(fmt.Sprintf("Calendar event: %s is already saved.", n.Name))
		}
	}
	if len(list) > forecastcal.MaxNoticeEvents {
		return dataerr.Conflict(fmt.Sprintf("Calendar event: at most %d events from notices.", forecastcal.MaxNoticeEvents))
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].Start < list[j].Start })
	if err := forecastcal.ValidateSetting(forecastcal.KeyNoticeEvents, list); err != nil {
		return dataerr.Invalid(err.Error())
	}
	return settingsstore.Put(ctx, tenant, forecastcal.KeyNoticeEvents, list)
}

func noticeSummary(n forecastcal.NoticeRange) map[string]any {
	return map[string]any{"name": n.Name, "kind": noticeKind, "start": n.Start, "end": n.End, "type": n.Type, "zones": len(n.ZoneIDs), "impact": n.Impact, "assisted": n.Assisted}
}
