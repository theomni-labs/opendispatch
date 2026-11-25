// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors time.ts: holiday/Hijri/prayer/leave parts.
// Holiday: Postgres. Others: in-memory.
package business

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	calc "github.com/MSA-Software-LLC/adhan-go/pkg/calc"
	adhandata "github.com/MSA-Software-LLC/adhan-go/pkg/data"
	adhanutil "github.com/MSA-Software-LLC/adhan-go/pkg/util"
	"github.com/hablullah/go-hijri"
	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const moduleLeavePolicyCalendar = access.ModuleAdminLeavePolicyCalendar

// HijriDate mirrors the contract's HijriDate.
type HijriDate struct {
	Year  int `json:"year"`
	Month int `json:"month"`
	Day   int `json:"day"`
}

// ToHijriDate mirrors toHijriDate (pure).
func ToHijriDate(date string) (HijriDate, error) {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return HijriDate{}, dataerr.Invalid("Not a date: " + date)
	}
	uq, err := hijri.CreateUmmAlQuraDate(t)
	if err != nil {
		return HijriDate{}, dataerr.Invalid("Not a date: " + date)
	}
	return HijriDate{Year: int(uq.Year), Month: int(uq.Month), Day: int(uq.Day)}, nil
}

// HolidayKind mirrors Holiday's kind enum.
type HolidayKind string

const (
	HolidayPublic     HolidayKind = "public"
	HolidayReligious  HolidayKind = "religious"
	HolidayObservance HolidayKind = "observance"
)

var holidayKinds = []HolidayKind{HolidayPublic, HolidayReligious, HolidayObservance}

// Holiday mirrors the contract's Holiday.
type Holiday struct {
	datactx.BaseRecord
	NameEn     string      `json:"name_en"`
	NameAr     *string     `json:"name_ar"`
	StartDate  string      `json:"start_date"`
	EndDate    string      `json:"end_date"`
	Kind       HolidayKind `json:"kind"`
	HijriStart HijriDate   `json:"hijri_start"`
	HijriEnd   HijriDate   `json:"hijri_end"`
}

// Reads

func allHolidays(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]Holiday, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]Holiday, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, name_en, name_ar, start_date, end_date, kind, hijri_start, hijri_end FROM holidays ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Holiday
		for rows.Next() {
			var h Holiday
			var createdAt, updatedAt, startDate, endDate time.Time
			var hijriStart, hijriEnd *HijriDate
			if err := rows.Scan(&h.ID, &h.TenantID, &createdAt, &updatedAt, &h.CreatedBy, &h.DataSource, &h.NameEn, &h.NameAr, &startDate, &endDate, &h.Kind, &hijriStart, &hijriEnd); err != nil {
				return nil, err
			}
			h.CreatedAt, h.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			h.StartDate, h.EndDate = startDate.Format("2006-01-02"), endDate.Format("2006-01-02")
			if hijriStart != nil {
				h.HijriStart = *hijriStart
			}
			if hijriEnd != nil {
				h.HijriEnd = *hijriEnd
			}
			out = append(out, h)
		}
		return out, rows.Err()
	})
}

func oneHoliday(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*Holiday, error) {
	rows, err := allHolidays(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	for _, h := range rows {
		if h.ID == id {
			return &h, nil
		}
	}
	return nil, nil
}

// HolidayQuery mirrors listHolidays' query.
type HolidayQuery struct {
	Limit    int
	Cursor   string
	DateFrom string
	DateTo   string
}

// ListHolidays mirrors listHolidays.
func ListHolidays(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query HolidayQuery) (datactx.PageResult[Holiday], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[Holiday]{}, err
	}
	rows, err := allHolidays(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[Holiday]{}, err
	}
	var filtered []Holiday
	for _, h := range rows {
		if query.DateFrom != "" && h.EndDate < query.DateFrom {
			continue
		}
		if query.DateTo != "" && h.StartDate > query.DateTo {
			continue
		}
		filtered = append(filtered, h)
	}
	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].StartDate != filtered[j].StartDate {
			return filtered[i].StartDate < filtered[j].StartDate
		}
		return filtered[i].ID < filtered[j].ID
	})
	return datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

var holidayKeys = []string{"name_en", "name_ar", "start_date", "end_date", "kind"}

func holidayFrom(input datactx.Obj, existing *Holiday, at string) (Holiday, error) {
	var zero Holiday
	start, err := datactx.Date(input, "start_date")
	if err != nil {
		return zero, err
	}
	end, err := datactx.Date(input, "end_date")
	if err != nil {
		return zero, err
	}
	if end < start {
		return zero, dataerr.Invalid("Holiday: end_date is before start_date.")
	}
	nameEn, err := datactx.String(input, "name_en", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	nameAr, err := datactx.NullableString(input, "name_ar", datactx.StrOpts{Max: 120, HasMax: true})
	if err != nil {
		return zero, err
	}
	kind, err := datactx.EnumOf(input, "kind", holidayKinds)
	if err != nil {
		return zero, err
	}
	hijriStart, err := ToHijriDate(start)
	if err != nil {
		return zero, err
	}
	hijriEnd, err := ToHijriDate(end)
	if err != nil {
		return zero, err
	}
	h := Holiday{NameEn: nameEn, NameAr: nameAr, StartDate: start, EndDate: end, Kind: kind, HijriStart: hijriStart, HijriEnd: hijriEnd}
	if existing == nil {
		h.BaseRecord = datactx.NewRecord(reqctx.RequestContext{}, "", at)
	} else {
		h.BaseRecord = existing.BaseRecord
		h.UpdatedAt = at
	}
	return h, nil
}

func upsertHoliday(ctx context.Context, conn *tenancy.Connection, tenantID string, h Holiday) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO holidays (tenant_id, id, data_source, created_at, updated_at, created_by, name_en, name_ar, start_date, end_date, kind, hijri_start, hijri_end)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
			ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, name_en=$7, name_ar=$8, start_date=$9, end_date=$10, kind=$11, hijri_start=$12, hijri_end=$13`,
			h.TenantID, h.ID, h.DataSource, h.CreatedAt, h.UpdatedAt, h.CreatedBy, h.NameEn, h.NameAr, h.StartDate, h.EndDate, h.Kind, h.HijriStart, h.HijriEnd)
		return struct{}{}, err
	})
	return err
}

// CreateHoliday mirrors createHoliday.
func CreateHoliday(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (Holiday, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: moduleLeavePolicyCalendar}, auditlog.WriteMeta{Action: "holiday.created", EntityType: "holiday"}, func(ctx context.Context) (auditlog.AuditedWrite[Holiday], error) {
		input, err := datactx.Object(body, "Holiday", holidayKeys)
		if err != nil {
			return auditlog.AuditedWrite[Holiday]{}, err
		}
		h, err := holidayFrom(input, nil, datactx.NowISO())
		if err != nil {
			return auditlog.AuditedWrite[Holiday]{}, err
		}
		h.TenantID, h.CreatedBy = rc.CustomerID, &rc.UserID
		if err := upsertHoliday(ctx, conn, rc.CustomerID, h); err != nil {
			return auditlog.AuditedWrite[Holiday]{}, err
		}
		id := h.ID
		return auditlog.AuditedWrite[Holiday]{Result: h, EntityID: &id, SummaryEn: "Holiday " + h.NameEn + " created.", Detail: sumDetail(nil, map[string]any{"name": h.NameEn})}, nil
	})
}

// UpdateHoliday mirrors updateHoliday.
func UpdateHoliday(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (Holiday, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: moduleLeavePolicyCalendar}, auditlog.WriteMeta{Action: "holiday.updated", EntityType: "holiday", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[Holiday], error) {
		if _, err := importutil.RequireID(id, "Holiday"); err != nil {
			return auditlog.AuditedWrite[Holiday]{}, err
		}
		existing, err := oneHoliday(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[Holiday]{}, err
		}
		if _, err := datactx.RequireFound(existing, "Holiday"); err != nil {
			return auditlog.AuditedWrite[Holiday]{}, err
		}
		input, err := datactx.Object(body, "Holiday", holidayKeys)
		if err != nil {
			return auditlog.AuditedWrite[Holiday]{}, err
		}
		h, err := holidayFrom(input, existing, datactx.NowISO())
		if err != nil {
			return auditlog.AuditedWrite[Holiday]{}, err
		}
		if err := upsertHoliday(ctx, conn, rc.CustomerID, h); err != nil {
			return auditlog.AuditedWrite[Holiday]{}, err
		}
		return auditlog.AuditedWrite[Holiday]{Result: h, SummaryEn: "Holiday " + h.NameEn + " updated.", Detail: sumDetail(nil, map[string]any{"name": h.NameEn})}, nil
	})
}

// DeleteHoliday mirrors deleteHoliday.
func DeleteHoliday(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) error {
	_, err := auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: moduleLeavePolicyCalendar}, auditlog.WriteMeta{Action: "holiday.deleted", EntityType: "holiday", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[struct{}], error) {
		if _, err := importutil.RequireID(id, "Holiday"); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		existing, err := oneHoliday(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		if _, err := datactx.RequireFound(existing, "Holiday"); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		if _, err := tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			_, err := tx.Exec(ctx, `DELETE FROM holidays WHERE tenant_id = $1 AND id = $2`, rc.CustomerID, id)
			return struct{}{}, err
		}); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		return auditlog.AuditedWrite[struct{}]{SummaryEn: "Holiday " + existing.NameEn + " deleted.", Detail: sumDetail(nil, map[string]any{"name": existing.NameEn})}, nil
	})
	return err
}

// HijriMonth: in-memory, seeded lazily from fixtures.

// HijriMonth mirrors the contract's HijriMonth.
type HijriMonth struct {
	datactx.BaseRecord
	HijriYear      int    `json:"hijri_year"`
	Month          int    `json:"hijri_month"`
	NameEn         string `json:"name_en"`
	NameAr         string `json:"name_ar"`
	GregorianStart string `json:"gregorian_start"`
	GregorianEnd   string `json:"gregorian_end"`
	IsRamadan      bool   `json:"is_ramadan"`
}

var (
	calendarMu     sync.Mutex
	hijriMonthRows []HijriMonth
	prayerTimeRows []PrayerTime
	calendarSeeded bool
)

// seedCalendarLocked loads the fixture rows once.
func seedCalendarLocked() {
	if calendarSeeded {
		return
	}
	calendarSeeded = true
	if rows, err := fixtures.Records[HijriMonth]("HijriMonth"); err == nil {
		hijriMonthRows = rows
	}
	if rows, err := fixtures.Records[PrayerTime]("PrayerTime"); err == nil {
		prayerTimeRows = rows
	}
}

// HijriMonthQuery mirrors listHijriMonths' query.
type HijriMonthQuery struct {
	Limit    int
	Cursor   string
	DateFrom string
	DateTo   string
}

// ListHijriMonths mirrors listHijriMonths; unseeded.
func ListHijriMonths(rc reqctx.RequestContext, query HijriMonthQuery) (datactx.PageResult[HijriMonth], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[HijriMonth]{}, err
	}
	rows := allHijriMonths()
	filtered := []HijriMonth{}
	for _, m := range rows {
		if query.DateFrom != "" && m.GregorianEnd < query.DateFrom {
			continue
		}
		if query.DateTo != "" && m.GregorianStart > query.DateTo {
			continue
		}
		filtered = append(filtered, m)
	}
	sort.Slice(filtered, func(i, j int) bool { return filtered[i].GregorianStart < filtered[j].GregorianStart })
	return datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// allHijriMonths: unfiltered, for updates.go's
// Hijri<->Gregorian conversion.
func allHijriMonths() []HijriMonth {
	calendarMu.Lock()
	defer calendarMu.Unlock()
	seedCalendarLocked()
	return append([]HijriMonth(nil), hijriMonthRows...)
}

// Prayer times: in-memory, matches TS.

// PrayerTime mirrors the contract's PrayerTime.
type PrayerTime struct {
	datactx.BaseRecord
	CityID            string `json:"city_id"`
	PrayerDate        string `json:"prayer_date"`
	Fajr              string `json:"fajr"`
	Sunrise           string `json:"sunrise"`
	Dhuhr             string `json:"dhuhr"`
	Asr               string `json:"asr"`
	Maghrib           string `json:"maghrib"`
	Isha              string `json:"isha"`
	CalculationMethod string `json:"calculation_method"`
}

// cityPointFor mirrors cityPoint: mean zone coords.
func cityPointFor(ctx context.Context, conn *tenancy.Connection, tenantID, cityID string) (*float64, *float64, error) {
	zones, err := allZones(ctx, conn, tenantID)
	if err != nil {
		return nil, nil, err
	}
	lat, lng := cityPointIn(zones, cityID)
	return lat, lng, nil
}

// cityPointIn: the mean zone point of a city.
func cityPointIn(zones []Zone, cityID string) (*float64, *float64) {
	var sumLat, sumLng float64
	n := 0
	for _, z := range zones {
		if z.CityID != cityID || z.Latitude == nil || z.Longitude == nil {
			continue
		}
		sumLat += *z.Latitude
		sumLng += *z.Longitude
		n++
	}
	if n == 0 {
		return nil, nil
	}
	lat, lng := sumLat/float64(n), sumLng/float64(n)
	return &lat, &lng
}

// eachDateInRange mirrors eachDate.
func eachDateInRange(from, to string) []string {
	f, err1 := time.Parse("2006-01-02", from)
	t, err2 := time.Parse("2006-01-02", to)
	if err1 != nil || err2 != nil {
		return nil
	}
	var out []string
	for d := f; !d.After(t); d = d.AddDate(0, 0, 1) {
		out = append(out, d.Format("2006-01-02"))
	}
	return out
}

// computePrayerTimeFor mirrors computePrayerTime.
func computePrayerTimeFor(cityID string, lat, lng float64, date string) (PrayerTime, error) {
	d, err := time.Parse("2006-01-02", date)
	if err != nil {
		return PrayerTime{}, dataerr.Invalid("Not a date: " + date)
	}
	dc := adhandata.NewDateComponents(time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC))
	params := calc.GetMethodParameters(calc.UMM_AL_QURA)
	coords, err := adhanutil.NewCoordinates(lat, lng)
	if err != nil {
		return PrayerTime{}, err
	}
	pt, err := calc.NewPrayerTimes(coords, dc, params)
	if err != nil {
		return PrayerTime{}, err
	}
	if err := pt.SetTimeZone("Asia/Riyadh"); err != nil {
		return PrayerTime{}, err
	}
	at := date + "T00:00:00+03:00"
	return PrayerTime{
		BaseRecord: datactx.BaseRecord{
			ID:        datactx.DeterministicUUID(fmt.Sprintf("prayer|%s|%s", cityID, date)),
			CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC",
		},
		CityID: cityID, PrayerDate: date,
		Fajr: pt.Fajr.Format("15:04"), Sunrise: pt.Sunrise.Format("15:04"),
		Dhuhr: pt.Dhuhr.Format("15:04"), Asr: pt.Asr.Format("15:04"),
		Maghrib: pt.Maghrib.Format("15:04"), Isha: pt.Isha.Format("15:04"),
		CalculationMethod: "umm_al_qura",
	}, nil
}

const maxRecomputeDays = 400

// PrayerTimeQuery mirrors listPrayerTimes' query.
type PrayerTimeQuery struct {
	Limit    int
	Cursor   string
	CityID   string
	DateFrom string
	DateTo   string
}

// ListPrayerTimes mirrors listPrayerTimes.
func ListPrayerTimes(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query PrayerTimeQuery) (datactx.PageResult[PrayerTime], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[PrayerTime]{}, err
	}
	stored, err := loadPrayerTimes(ctx, rc.CustomerID, query.CityID)
	if err != nil {
		return datactx.PageResult[PrayerTime]{}, err
	}
	if query.DateFrom == "" && query.DateTo == "" {
		sort.Slice(stored, func(i, j int) bool {
			if stored[i].PrayerDate != stored[j].PrayerDate {
				return stored[i].PrayerDate < stored[j].PrayerDate
			}
			return stored[i].CityID < stored[j].CityID
		})
		return datactx.Paginate(stored, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
	}
	from, to := query.DateFrom, query.DateTo
	if from == "" {
		from = to
	}
	if to == "" {
		to = from
	}
	dates := eachDateInRange(from, to)
	if to < from || len(dates) > maxRecomputeDays {
		return datactx.PageResult[PrayerTime]{}, dataerr.Invalid(fmt.Sprintf("Prayer times: choose a range of at most %d days.", maxRecomputeDays))
	}
	known := map[string]PrayerTime{}
	for _, p := range stored {
		known[p.CityID+"|"+p.PrayerDate] = p
	}
	cities, err := allCities(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[PrayerTime]{}, err
	}
	rows := []PrayerTime{}
	for _, date := range dates {
		for _, city := range cities {
			if query.CityID != "" && city.ID != query.CityID {
				continue
			}
			if hit, ok := known[city.ID+"|"+date]; ok {
				rows = append(rows, hit)
				continue
			}
			lat, lng, err := cityPointFor(ctx, conn, rc.CustomerID, city.ID)
			if err != nil {
				return datactx.PageResult[PrayerTime]{}, err
			}
			if lat == nil {
				continue
			}
			pt, err := computePrayerTimeFor(city.ID, *lat, *lng, date)
			if err != nil {
				return datactx.PageResult[PrayerTime]{}, err
			}
			pt.TenantID = rc.CustomerID
			rows = append(rows, pt)
		}
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// RecomputePrayerTimes mirrors recomputePrayerTimes.
func RecomputePrayerTimes(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (datactx.PageResult[PrayerTime], error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: moduleLeavePolicyCalendar}, auditlog.WriteMeta{Action: "prayer_times.recomputed", EntityType: "prayer_time"}, func(ctx context.Context) (auditlog.AuditedWrite[datactx.PageResult[PrayerTime]], error) {
		input, err := datactx.Object(body, "Prayer time recompute", []string{"city_id", "date_from", "date_to"})
		if err != nil {
			return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{}, err
		}
		from, err := datactx.Date(input, "date_from")
		if err != nil {
			return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{}, err
		}
		to, err := datactx.Date(input, "date_to")
		if err != nil {
			return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{}, err
		}
		dates := eachDateInRange(from, to)
		if to < from || len(dates) > maxRecomputeDays {
			return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{}, dataerr.Invalid(fmt.Sprintf("Prayer times: choose a range of at most %d days, ending on or after the first day.", maxRecomputeDays))
		}
		cityID, err := datactx.NullableUUID(input, "city_id")
		if err != nil {
			return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{}, err
		}
		cities, err := allCities(ctx, conn, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{}, err
		}
		if cityID != nil {
			found := false
			for _, c := range cities {
				if c.ID == *cityID {
					found = true
					break
				}
			}
			if !found {
				return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{}, dataerr.NotFound("City not found.")
			}
		}
		prior, err := loadPrayerTimes(ctx, rc.CustomerID, "")
		if err != nil {
			return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{}, err
		}
		existing := map[string]PrayerTime{}
		for _, p := range prior {
			existing[p.CityID+"|"+p.PrayerDate] = p
		}
		at := datactx.NowISO()
		rows := []PrayerTime{}
		for _, city := range cities {
			if cityID != nil && city.ID != *cityID {
				continue
			}
			lat, lng, err := cityPointFor(ctx, conn, rc.CustomerID, city.ID)
			if err != nil {
				return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{}, err
			}
			if lat == nil {
				if cityID != nil {
					return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{}, dataerr.Invalid("Prayer times: the city has no zone with coordinates.")
				}
				continue
			}
			for _, date := range dates {
				computed, err := computePrayerTimeFor(city.ID, *lat, *lng, date)
				if err != nil {
					return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{}, err
				}
				computed.TenantID = rc.CustomerID
				if prior, ok := existing[city.ID+"|"+date]; ok {
					computed.ID, computed.CreatedAt, computed.CreatedBy, computed.UpdatedAt = prior.ID, prior.CreatedAt, prior.CreatedBy, at
				}
				rows = append(rows, computed)
			}
		}
		if err := savePrayerTimes(ctx, rc.CustomerID, rows); err != nil {
			return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{}, err
		}
		result := datactx.PageResult[PrayerTime]{Items: rows, Page: datactx.PageInfo{HasMore: false, Total: len(rows)}}
		cityIDStr := "null"
		if cityID != nil {
			cityIDStr = *cityID
		}
		return auditlog.AuditedWrite[datactx.PageResult[PrayerTime]]{
			Result:    result,
			SummaryEn: fmt.Sprintf("Prayer times recomputed for %s to %s (%d records).", from, to, len(rows)),
			Detail:    map[string]any{"date_from": from, "date_to": to, "city_id": cityIDStr, "records": len(rows)},
		}, nil
	})
}

// Leave policy: kept in the settings store.

const leavePolicyKey = "leave.policy"

// BlackoutPeriod: one LeavePolicy blackout window.
type BlackoutPeriod struct {
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
	LabelEn   string `json:"label_en"`
}

// LeavePolicy mirrors the contract's LeavePolicy.
type LeavePolicy struct {
	MinNoticeDays           int              `json:"min_notice_days"`
	MaxConcurrentLeaveShare float64          `json:"max_concurrent_leave_share"`
	BlackoutPeriods         []BlackoutPeriod `json:"blackout_periods"`
}

// defaultLeavePolicy mirrors DEFAULT_LEAVE_POLICY.
func defaultLeavePolicy() LeavePolicy {
	return LeavePolicy{MinNoticeDays: 7, MaxConcurrentLeaveShare: 0.15, BlackoutPeriods: []BlackoutPeriod{}}
}

// GetLeavePolicy mirrors getLeavePolicy.
func GetLeavePolicy(rc reqctx.RequestContext) (LeavePolicy, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return LeavePolicy{}, err
	}
	return readSettingStrict(context.Background(), rc.CustomerID, leavePolicyKey, defaultLeavePolicy())
}

// UpdateLeavePolicy mirrors updateLeavePolicy.
func UpdateLeavePolicy(rc reqctx.RequestContext, body any) (LeavePolicy, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: moduleLeavePolicyCalendar}, auditlog.WriteMeta{Action: "leave_policy.updated", EntityType: "setting", EntityID: strPtr("leave.policy")}, func(ctx context.Context) (auditlog.AuditedWrite[LeavePolicy], error) {
		input, err := datactx.Object(body, "Leave policy", []string{"min_notice_days", "max_concurrent_leave_share", "blackout_periods"})
		if err != nil {
			return auditlog.AuditedWrite[LeavePolicy]{}, err
		}
		rawPeriods, ok := input["blackout_periods"].([]any)
		if !ok {
			return auditlog.AuditedWrite[LeavePolicy]{}, dataerr.Invalid("Leave policy: blackout_periods must be a list.")
		}
		periods := make([]BlackoutPeriod, 0, len(rawPeriods))
		for i, raw := range rawPeriods {
			p, err := datactx.Object(raw, fmt.Sprintf("Leave policy blackout period %d", i+1), []string{"start_date", "end_date", "label_en"})
			if err != nil {
				return auditlog.AuditedWrite[LeavePolicy]{}, err
			}
			start, err := datactx.Date(p, "start_date")
			if err != nil {
				return auditlog.AuditedWrite[LeavePolicy]{}, err
			}
			end, err := datactx.Date(p, "end_date")
			if err != nil {
				return auditlog.AuditedWrite[LeavePolicy]{}, err
			}
			if end < start {
				return auditlog.AuditedWrite[LeavePolicy]{}, dataerr.Invalid(fmt.Sprintf("Leave policy blackout period %d: end_date is before start_date.", i+1))
			}
			label, err := datactx.String(p, "label_en", datactx.StrOpts{Max: 120, HasMax: true})
			if err != nil {
				return auditlog.AuditedWrite[LeavePolicy]{}, err
			}
			periods = append(periods, BlackoutPeriod{StartDate: start, EndDate: end, LabelEn: label})
		}
		minNotice, err := datactx.Int(input, "min_notice_days", datactx.NumOpts{Min: 0, Max: 365, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[LeavePolicy]{}, err
		}
		maxShare, err := datactx.Number(input, "max_concurrent_leave_share", datactx.NumOpts{Min: 0, Max: 1, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[LeavePolicy]{}, err
		}
		policy := LeavePolicy{MinNoticeDays: minNotice, MaxConcurrentLeaveShare: maxShare, BlackoutPeriods: periods}
		if err := settingsstore.Put(ctx, rc.CustomerID, leavePolicyKey, policy); err != nil {
			return auditlog.AuditedWrite[LeavePolicy]{}, err
		}
		return auditlog.AuditedWrite[LeavePolicy]{Result: policy, SummaryEn: "Leave policy updated.", Detail: map[string]any{"min_notice_days": policy.MinNoticeDays, "max_concurrent_leave_share": policy.MaxConcurrentLeaveShare}}, nil
	})
}

func strPtr(s string) *string { return &s }

// ResetLeaveCalendarForTest clears in-memory state.
func ResetLeaveCalendarForTest() {
	calendarMu.Lock()
	hijriMonthRows, prayerTimeRows, calendarSeeded = nil, nil, true
	calendarMu.Unlock()
	_ = settingsstore.DeletePrefix(context.Background(), ambientTenant(), "leave.")
}

// ReloadLeaveCalendarForTest restores the fixture rows.
func ReloadLeaveCalendarForTest() {
	calendarMu.Lock()
	hijriMonthRows, prayerTimeRows, calendarSeeded = nil, nil, false
	calendarMu.Unlock()
	_ = settingsstore.DeletePrefix(context.Background(), ambientTenant(), "leave.")
}
