// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// Degradation settings and their defaults.
const (
	KeyDegradationWAPE     = "forecast.degradation_wape"
	KeyDegradationCooldown = "forecast.degradation_cooldown_days"
	KeyDegradationWindow   = "forecast.degradation_window_days"
	keyDegradationAlerted  = "forecast.degradation_alerted"
	degradationEvent       = "model_degraded"
	defaultDegradationWAPE = 0.4
	defaultDegradeCooldown = 3
	defaultDegradeWindow   = 7
	maxDegradeWindow       = 28
)

// ZoneError: one zone's error over the window.
type ZoneError struct {
	ZoneID   string  `json:"zone_id"`
	ZoneName string  `json:"zone_name"`
	WAPE     float64 `json:"wape"`
	Actual   float64 `json:"actual"`
	Forecast float64 `json:"forecast"`
	Days     int     `json:"days"`
}

// DegradationResult: what one check found.
type DegradationResult struct {
	Date         string      `json:"date"`
	From         string      `json:"from"`
	WindowDays   int         `json:"window_days"`
	RunID        string      `json:"run_id"`
	Model        string      `json:"model"`
	Limit        float64     `json:"limit"`
	Zones        []ZoneError `json:"zones"`
	Over         []ZoneError `json:"over"`
	Alerted      []ZoneError `json:"alerted"`
	Suppressed   int         `json:"suppressed_by_cooldown"`
	DataSource   string      `json:"data_source"`
	Illustrative bool        `json:"illustrative"`
}

// championRunFor: newest champion with values.
func championRunFor(ctx context.Context, tenant, date string, index *StoredIndex, zoneIDs []string) (*ForecastRun, error) {
	runs, err := loadForecastRuns(ctx, tenant, false)
	if err != nil {
		return nil, err
	}
	for _, r := range runs {
		if r.Status != "succeeded" || isChallengerRun(ctx, tenant, r) {
			continue
		}
		if date < r.HorizonStartDate || date > shiftDateBy(r.HorizonStartDate, r.HorizonDays-1) {
			continue
		}
		for _, z := range zoneIDs {
			rows, err := index.Rows(r.ID, z, date)
			if err != nil {
				return nil, err
			}
			if len(rows) > 0 {
				row := r
				return &row, nil
			}
		}
	}
	return nil, nil
}

// zoneDay: one zone's 24 hours, forecast and actual.
type zoneDay struct{ f, a [24]float64 }

// windowWAPE: one WAPE over every zone hour.
func windowWAPE(days []zoneDay) (wape, actual, forecast float64, ok bool) {
	var abs float64
	for _, d := range days {
		for h := 0; h < 24; h++ {
			abs += math.Abs(d.f[h] - d.a[h])
			actual += d.a[h]
			forecast += d.f[h]
		}
	}
	if actual <= 0 {
		return 0, actual, forecast, false
	}
	return math.Round(abs/actual*10000) / 10000, actual, forecast, true
}

// degradationWindow: the setting, 1 to 28 days.
func degradationWindow(ctx context.Context, tenant string) int {
	n := readSetting(ctx, tenant, KeyDegradationWindow, defaultDegradeWindow)
	return min(max(n, 1), maxDegradeWindow)
}

// MeasureForecastError: champion, days to date.
func MeasureForecastError(ctx context.Context, conn *tenancy.Connection, tenant, date string) (*DegradationResult, error) {
	zones, err := allZones(ctx, conn, tenant)
	if err != nil {
		return nil, err
	}
	subs, err := allSubZones(ctx, conn, tenant)
	if err != nil {
		return nil, err
	}
	var zoneIDs []string
	name := map[string]string{}
	for _, z := range zones {
		if z.IsActive {
			zoneIDs = append(zoneIDs, z.ID)
			name[z.ID] = z.NameEn
		}
	}
	zoneOf := map[string]string{}
	for _, s := range subs {
		zoneOf[s.ID] = s.ZoneID
	}
	index, err := indexStored(ctx, tenant)
	if err != nil {
		return nil, err
	}
	window := degradationWindow(ctx, tenant)
	first := shiftDateBy(date, 1-window)
	runs := make([]*ForecastRun, window)
	var latest *ForecastRun
	for d := range window {
		run, err := championRunFor(ctx, tenant, shiftDateBy(first, d), index, zoneIDs)
		if err != nil {
			return nil, err
		}
		runs[d] = run
		if run != nil {
			latest = run
		}
	}
	if latest == nil {
		return nil, nil
	}
	from, err := riyadhMidnight(first)
	if err != nil {
		return nil, inputErr("date is not a date")
	}
	rows, srcs, err := loadForecastHistory(ctx, conn, tenant, zoneIDs, from, from.AddDate(0, 0, window))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	actual := map[string][]zoneDay{}
	for _, r := range rows {
		z := zoneOf[r.SubZoneID]
		if z == "" {
			continue
		}
		if actual[z] == nil {
			actual[z] = make([]zoneDay, window)
		}
		hours := int(r.IntervalStart.Sub(from).Hours())
		if d := hours / 24; d >= 0 && d < window {
			actual[z][d].a[hours%24] += float64(r.Total)
		}
	}
	_, distinct, err := sourcesOf(srcs)
	if err != nil {
		return nil, err
	}
	res := &DegradationResult{Date: date, From: first, WindowDays: window, RunID: latest.ID, Model: latest.ModelVersion, Limit: readSetting(ctx, tenant, KeyDegradationWAPE, defaultDegradationWAPE), Zones: []ZoneError{}, Over: []ZoneError{}, Alerted: []ZoneError{}}
	res.Illustrative, res.DataSource = inputProvenance(distinct)
	for _, z := range zoneIDs {
		if actual[z] == nil {
			continue
		}
		var scored []zoneDay
		for d, run := range runs {
			if run == nil {
				continue
			}
			values, err := index.Rows(run.ID, z, shiftDateBy(first, d))
			if err != nil {
				return nil, err
			}
			if len(values) == 0 {
				continue
			}
			day := actual[z][d]
			for _, v := range values {
				day.f[(v.IntervalIndex/4)%24] += v.Expected
			}
			scored = append(scored, day)
		}
		// half the window at least: one day never decides
		if len(scored) < (window+1)/2 {
			continue
		}
		wape, a, fc, ok := windowWAPE(scored)
		if !ok {
			continue
		}
		ze := ZoneError{ZoneID: z, ZoneName: name[z], WAPE: wape, Actual: a, Forecast: math.Round(fc*10) / 10, Days: len(scored)}
		res.Zones = append(res.Zones, ze)
		if wape > res.Limit {
			res.Over = append(res.Over, ze)
		}
	}
	return res, nil
}

// cooledDown: false inside the cooldown.
func cooledDown(last, date string, days int) bool {
	return last == "" || last > date || date >= shiftDateBy(last, days)
}

// checkForecastDegradation: yesterday's error.
func checkForecastDegradation(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, report *WorkerCycleReport) {
	res, err := RunDegradationCheck(ctx, conn, rc, shiftDateBy(todayIn(ctx, rc.CustomerID), -1))
	if err != nil {
		log.Printf("forecast: degradation check failed: %v", err)
		return
	}
	if res != nil {
		for _, z := range res.Alerted {
			report.DegradedZones = append(report.DegradedZones, z.ZoneName)
		}
	}
	report.Retrained = retrainAfterDegradation(ctx, conn, rc, res)
}

// RunDegradationCheck measures and alerts.
func RunDegradationCheck(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, date string) (*DegradationResult, error) {
	res, err := MeasureForecastError(ctx, conn, rc.CustomerID, date)
	if err != nil || res == nil || len(res.Over) == 0 {
		return res, err
	}
	cooldown := readSetting(ctx, rc.CustomerID, KeyDegradationCooldown, defaultDegradeCooldown)
	alerted := readSetting(ctx, rc.CustomerID, keyDegradationAlerted, map[string]string{})
	next := map[string]string{}
	for k, v := range alerted {
		next[k] = v
	}
	for _, z := range res.Over {
		if !cooledDown(alerted[z.ZoneID], date, cooldown) {
			res.Suppressed++
			continue
		}
		res.Alerted = append(res.Alerted, z)
		next[z.ZoneID] = date
	}
	if len(res.Alerted) == 0 {
		return res, nil
	}
	if err := settingsstore.Put(ctx, rc.CustomerID, keyDegradationAlerted, next); err != nil {
		return res, err
	}
	return res, raiseDegradation(ctx, rc, res)
}

// degradationSummary: the audit line.
func degradationSummary(res *DegradationResult) string {
	return fmt.Sprintf("Forecast error above the limit in %d zone(s) over the %d day(s) to %s (model %s, limit %.0f%%).", len(res.Alerted), res.WindowDays, res.Date, res.Model, res.Limit*100)
}

func raiseDegradation(ctx context.Context, rc reqctx.RequestContext, res *DegradationResult) error {
	sort.Slice(res.Alerted, func(i, j int) bool { return res.Alerted[i].WAPE > res.Alerted[j].WAPE })
	parts := make([]string, 0, len(res.Alerted))
	zones := make([]map[string]any, 0, len(res.Alerted))
	for _, z := range res.Alerted {
		parts = append(parts, fmt.Sprintf("%s %.0f%%", z.ZoneName, z.WAPE*100))
		zones = append(zones, map[string]any{"zone_id": z.ZoneID, "wape": z.WAPE, "actual": z.Actual, "forecast": z.Forecast, "days": z.Days})
	}
	challengerAudit(rc, "forecast.degradation_detected", "success", degradationSummary(res),
		map[string]any{"date": res.Date, "from": res.From, "window_days": res.WindowDays, "run_id": res.RunID, "model_version": res.Model, "limit": res.Limit, "zones": zones, "illustrative": res.Illustrative, "data_source": res.DataSource})
	body := fmt.Sprintf("The forecast (%s) missed by more than %.0f%% over the last %d day(s) (WAPE, zone x hour): %s. Check the inputs or run a backtest.", res.Model, res.Limit*100, res.WindowDays, strings.Join(parts, ", "))
	if res.Illustrative {
		body += " Illustrative."
	}
	return raiseModelAlert(ctx, rc, degradationEvent, "warning", "Forecast error above the limit", "خطأ التوقعات فوق الحد", body, res.DataSource)
}

// raiseModelAlert: a model alert with Arabic.
func raiseModelAlert(ctx context.Context, rc reqctx.RequestContext, eventType, fallbackSeverity, titleEn, titleAr, bodyEn, source string) error {
	rule, err := notificationRuleFor(ctx, rc.CustomerID, eventType)
	if err != nil {
		return err
	}
	if rule != nil && (!rule.IsEnabled || !hasChannel(rule.Channels, "in_app")) {
		return nil
	}
	roles := []access.Role{access.RoleAdministrator, access.RolePlanner}
	severity := fallbackSeverity
	if rule != nil {
		roles, severity = rule.RecipientRoles, rule.Severity
	}
	at, body := datactx.NowISO(), truncateStr(bodyEn, 500)
	created := make([]Notification, 0, len(roles))
	for _, role := range roles {
		roleStr, userID, ar := string(role), rc.UserID, titleAr
		created = append(created, Notification{
			BaseRecord:    datactx.BaseRecord{ID: datactx.NewID(), TenantID: rc.CustomerID, CreatedAt: at, UpdatedAt: at, CreatedBy: &userID, DataSource: source},
			RecipientRole: &roleStr, Category: "model", Severity: severity, TitleEn: titleEn, TitleAr: &ar,
			BodyEn: &body, LinkPath: strPtr("/admin/forecast-model"),
		})
	}
	return saveNotifications(ctx, rc.CustomerID, created...)
}
