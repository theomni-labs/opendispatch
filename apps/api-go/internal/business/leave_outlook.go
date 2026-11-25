// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/leaveoutlook"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// Leave outlook settings; shares of normal.
const (
	KeyOutlookGrantBelow    = "leave.outlook_grant_below"
	KeyOutlookRestrictAbove = "leave.outlook_restrict_above"
	defaultGrantBelow       = 0.05
	defaultRestrictAbove    = 0.10
)

// ValidateOutlookSetting checks an outlook value.
func ValidateOutlookSetting(key string, value any) error {
	if key != KeyOutlookGrantBelow && key != KeyOutlookRestrictAbove {
		return nil
	}
	n, ok := value.(float64)
	if !ok || n < 0 || n > 1 {
		return fmt.Errorf("%s must be a number from 0 to 1", key)
	}
	return nil
}

func outlookShare(ctx context.Context, tenant, key string, fallback float64) float64 {
	v := readSetting(ctx, tenant, key, fallback)
	if v < 0 || v > 1 || math.IsNaN(v) {
		return fallback
	}
	return v
}

// OutlookReason: one reason of a week.
type OutlookReason struct {
	Code   string   `json:"code"`
	Effect *float64 `json:"effect"`
	Label  string   `json:"label,omitempty"`
}

// OutlookWeek mirrors LeaveOutlookWeek.
type OutlookWeek struct {
	StartDate          string          `json:"start_date"`
	EndDate            string          `json:"end_date"`
	ExpectedFieldCases float64         `json:"expected_field_cases"`
	NormalFieldCases   float64         `json:"normal_field_cases"`
	DemandChange       float64         `json:"demand_change"`
	ApprovedLeaveDays  int             `json:"approved_leave_days"`
	ExpectedSick       float64         `json:"expected_sick_absence"`
	LeaveRoom          int             `json:"leave_room"`
	Status             string          `json:"status"`
	Reasons            []OutlookReason `json:"reasons"`
	ReasonEn           string          `json:"reason_en"`
}

// OutlookZone mirrors LeaveOutlookZone.
type OutlookZone struct {
	ZoneID       string        `json:"zone_id"`
	FieldAgents  int           `json:"field_agents"`
	LeaveLimit   int           `json:"leave_limit"`
	HistoryStart *string       `json:"history_start"`
	HistoryEnd   *string       `json:"history_end"`
	SickSource   string        `json:"sick_source"`
	Weeks        []OutlookWeek `json:"weeks"`
}

// LeaveOutlook mirrors the contract type.
type LeaveOutlook struct {
	StartDate     string        `json:"start_date"`
	Weeks         int           `json:"weeks"`
	GrantBelow    float64       `json:"grant_below"`
	RestrictAbove float64       `json:"restrict_above"`
	MaxLeaveShare float64       `json:"max_concurrent_leave_share"`
	Zones         []OutlookZone `json:"zones"`
	Illustrative  bool          `json:"illustrative"`
	DataSource    string        `json:"data_source"`
	DataSources   []string      `json:"data_sources"`
}

// LeaveOutlookQuery: getLeaveOutlook's query.
type LeaveOutlookQuery struct {
	ZoneID string
	Weeks  string
}

var outlookDriverNames = map[string]string{
	"ramadan": "Ramadan", "eid_fitr": "Eid al-Fitr", "eid_adha": "Eid al-Adha", "hajj": "Hajj",
	"national_day": "National Day", "founding_day": "Founding Day", "payday": "Payday",
	"school_break": "School break", "season_event": "Season event", "umrah": "Umrah",
}

// outlookTags: a day's drivers, unscoped events.
func outlookTags(cal forecastcal.Config) leaveoutlook.Tags {
	memo := map[string][]string{}
	return func(date string) []string {
		if tags, ok := memo[date]; ok {
			return tags
		}
		f := cal.For(date)
		var tags []string
		if f.IsRamadan {
			tags = append(tags, "ramadan")
		}
		if f.IsPayday != nil && *f.IsPayday {
			tags = append(tags, "payday")
		}
		breakDay := f.SchoolInSession != nil && !*f.SchoolInSession
		if strings.HasPrefix(f.SchoolPeriod, "vacation_") {
			breakDay = true
		}
		if breakDay {
			tags = append(tags, "school_break")
		}
		for _, ev := range f.Events {
			if len(ev.Cities) > 0 || len(ev.ZoneIDs) > 0 {
				continue
			}
			code := ""
			switch ev.Type {
			case "eid":
				code = "eid_fitr"
				if ev.Name == "Eid al-Adha" {
					code = "eid_adha"
				}
			case "hajj", "season_event", "umrah":
				code = ev.Type
			case "national_day":
				code = "national_day"
				if ev.Name == "Founding Day" {
					code = "founding_day"
				}
			}
			if code != "" && !containsStr(tags, code) {
				tags = append(tags, code)
			}
		}
		memo[date] = tags
		return tags
	}
}

type zoneHistory struct {
	counts      map[string]float64
	first, last string
}

// loadOutlookHistory: daily field cases per zone.
func loadOutlookHistory(ctx context.Context, conn *tenancy.Connection, tenant string, from, to time.Time) (map[string]*zoneHistory, string, []string, error) {
	type result struct {
		zones   map[string]*zoneHistory
		last    string
		sources []string
	}
	res, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (result, error) {
		out := result{zones: map[string]*zoneHistory{}}
		rows, err := tx.Query(ctx, `SELECT zone_id::text, date_bin('1 day', registered_at, TIMESTAMPTZ '2000-01-01 00:00:00+03'),
				count(*) FILTER (WHERE handling = 'field')
			FROM cases WHERE zone_id IS NOT NULL AND registered_at >= $1 AND registered_at < $2
			GROUP BY 1, 2`, from, to)
		if err != nil {
			return out, err
		}
		defer rows.Close()
		for rows.Next() {
			var zone string
			var at time.Time
			var n int64
			if err := rows.Scan(&zone, &at, &n); err != nil {
				return out, err
			}
			date := at.In(riyadhZone).Format("2006-01-02")
			z := out.zones[zone]
			if z == nil {
				z = &zoneHistory{counts: map[string]float64{}, first: date, last: date}
				out.zones[zone] = z
			}
			z.counts[date] += float64(n)
			z.first, z.last = min(z.first, date), max(z.last, date)
			out.last = max(out.last, date)
		}
		if err := rows.Err(); err != nil {
			return out, err
		}
		rows.Close()
		src, err := tx.Query(ctx, `SELECT DISTINCT data_source FROM cases WHERE zone_id IS NOT NULL AND registered_at >= $1 AND registered_at < $2 ORDER BY 1`, from, to)
		if err != nil {
			return out, err
		}
		defer src.Close()
		for src.Next() {
			var s string
			if err := src.Scan(&s); err != nil {
				return out, err
			}
			out.sources = append(out.sources, s)
		}
		return out, src.Err()
	})
	return res.zones, res.last, res.sources, err
}

// outlookStart: the Sunday on or before today.
func outlookStart(today string) string {
	t, err := time.Parse("2006-01-02", today)
	if err != nil {
		return today
	}
	return t.AddDate(0, 0, -int(t.Weekday())).Format("2006-01-02")
}

func overlapDays(aStart, aEnd, bStart, bEnd string) int {
	s, e := max(aStart, bStart), min(aEnd, bEnd)
	if e < s {
		return 0
	}
	ts, _ := time.Parse("2006-01-02", s)
	te, _ := time.Parse("2006-01-02", e)
	return int(te.Sub(ts).Hours()/24) + 1
}

func pct(v float64) string {
	p := int(math.Round(v * 100))
	if p > 0 {
		return fmt.Sprintf("+%d%%", p)
	}
	return fmt.Sprintf("%d%%", p)
}

// outlookReasonEn: the reason in words, English.
func outlookReasonEn(change float64, reasons []OutlookReason) string {
	var parts []string
	var lead *OutlookReason
	for i := range reasons {
		if reasons[i].Effect != nil {
			lead = &reasons[i]
			break
		}
	}
	switch {
	case lead != nil:
		parts = append(parts, fmt.Sprintf("%s week, demand %s", outlookDriverNames[lead.Code], pct(change)))
	case math.Abs(change) >= 0.02:
		parts = append(parts, "Demand "+pct(change))
	}
	for _, r := range reasons {
		switch r.Code {
		case "blackout":
			parts = append(parts, "Blackout period: "+r.Label)
		case "leave_full":
			parts = append(parts, "Approved leave at the limit")
		}
	}
	if len(parts) == 0 {
		return "Demand as usual"
	}
	return strings.Join(parts, "; ")
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

// GetLeaveOutlook: weeks per zone.
func GetLeaveOutlook(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query LeaveOutlookQuery) (LeaveOutlook, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLeavePlanner, access.AccessView); err != nil {
		return LeaveOutlook{}, err
	}
	weeks := 13
	switch query.Weeks {
	case "", "13":
	case "52":
		weeks = 52
	default:
		return LeaveOutlook{}, dataerr.Invalid("weeks must be 13 or 52.")
	}
	tenant := rc.CustomerID
	zonesAll, err := allZones(ctx, conn, tenant)
	if err != nil {
		return LeaveOutlook{}, err
	}
	var zones []Zone
	for _, z := range zonesAll {
		zid := z.ID
		if !z.IsActive || !reqctx.CanReadZone(rc, &zid) || (query.ZoneID != "" && z.ID != query.ZoneID) {
			continue
		}
		zones = append(zones, z)
	}
	if query.ZoneID != "" && len(zones) == 0 {
		return LeaveOutlook{}, dataerr.NotFound("Zone not found.")
	}
	sort.SliceStable(zones, func(i, j int) bool { return zones[i].NameEn < zones[j].NameEn })

	start := outlookStart(demoToday(ctx, tenant))
	startAt, err := riyadhMidnight(start)
	if err != nil {
		return LeaveOutlook{}, err
	}
	years := max(forecastHistorySettings(ctx, tenant).Years, 1)
	history, _, sources, err := loadOutlookHistory(ctx, conn, tenant, startAt.AddDate(-years, 0, 0), startAt)
	if err != nil {
		return LeaveOutlook{}, err
	}
	agents, err := allAgents(ctx, conn, tenant)
	if err != nil {
		return LeaveOutlook{}, err
	}
	leave, err := allLeaveRequests(ctx, conn, tenant)
	if err != nil {
		return LeaveOutlook{}, err
	}
	policy := readSetting(ctx, tenant, leavePolicyKey, defaultLeavePolicy())
	share := math.Min(1, math.Max(0, policy.MaxConcurrentLeaveShare))
	th := leaveoutlook.Thresholds{
		GrantBelow:    outlookShare(ctx, tenant, KeyOutlookGrantBelow, defaultGrantBelow),
		RestrictAbove: outlookShare(ctx, tenant, KeyOutlookRestrictAbove, defaultRestrictAbove),
	}
	tags := outlookTags(forecastCalendarConfig(ctx, tenant))
	sick := loadSickModel(ctx, conn, tenant, getDemandSettings(ctx, tenant))

	out := LeaveOutlook{
		StartDate: start, Weeks: weeks, GrantBelow: th.GrantBelow, RestrictAbove: th.RestrictAbove, MaxLeaveShare: share,
		Zones: []OutlookZone{}, Illustrative: true, DataSource: "SYNTHETIC", DataSources: []string{},
	}
	if len(sources) > 0 {
		out.DataSource, out.DataSources = sources[0], sources
	}
	for _, zone := range zones {
		people := map[string]bool{}
		for _, s := range agents {
			if s.IsActive && s.Kind == "field" && s.HomeZoneID != nil && *s.HomeZoneID == zone.ID {
				people[s.ID] = true
			}
		}
		_, sickSource := sick.share(zone.ID, start)
		oz := OutlookZone{ZoneID: zone.ID, FieldAgents: len(people), LeaveLimit: int(math.Floor(float64(len(people))*share + 1e-9)), SickSource: sickSource, Weeks: []OutlookWeek{}}
		h := history[zone.ID]
		if h == nil {
			out.Zones = append(out.Zones, oz)
			continue
		}
		first, last := h.first, h.last
		oz.HistoryStart, oz.HistoryEnd = &first, &last
		fit, ok := leaveoutlook.FitZone(h.counts, first, last, tags)
		if !ok {
			out.Zones = append(out.Zones, oz)
			continue
		}
		for w := 0; w < weeks; w++ {
			ws, we := shiftDateBy(start, w*7), shiftDateBy(start, w*7+6)
			demand := fit.Week(ws, 7, tags)
			approved := 0
			for _, l := range leave {
				if l.Status == "approved" && people[l.AgentID] {
					approved += overlapDays(ws, we, l.StartDate, l.EndDate)
				}
			}
			var reasons []OutlookReason
			for _, d := range demand.Drivers {
				e := math.Round(d.Effect*1000) / 1000
				reasons = append(reasons, OutlookReason{Code: d.Code, Effect: &e})
			}
			blackout := false
			for _, b := range policy.BlackoutPeriods {
				if overlapDays(ws, we, b.StartDate, b.EndDate) > 0 {
					blackout = true
					label := b.LabelEn
					if r := []rune(label); len(r) > 120 {
						label = string(r[:120])
					}
					reasons = append(reasons, OutlookReason{Code: "blackout", Label: label})
					break
				}
			}
			sickShare, _ := sick.weekShare(zone.ID, ws, 7)
			expectedSick := float64(len(people)) * sickShare
			v := leaveoutlook.Classify(demand.Change, leaveoutlook.Capacity{
				Agents: len(people), Share: share, ApprovedDays: approved, Days: 7, Blackout: blackout, Sick: expectedSick,
			}, th)
			if v.LeaveFull {
				reasons = append(reasons, OutlookReason{Code: "leave_full"})
			}
			if reasons == nil {
				reasons = []OutlookReason{}
			}
			change := math.Round(demand.Change*1000) / 1000
			oz.Weeks = append(oz.Weeks, OutlookWeek{
				StartDate: ws, EndDate: we, ExpectedFieldCases: round1(demand.Expected), NormalFieldCases: round1(demand.Normal),
				DemandChange: change, ApprovedLeaveDays: approved, ExpectedSick: round1(expectedSick), LeaveRoom: v.Room, Status: v.Status,
				Reasons: reasons, ReasonEn: outlookReasonEn(change, reasons),
			})
		}
		out.Zones = append(out.Zones, oz)
	}
	return out, nil
}
