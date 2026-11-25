// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// backtestEngine is the store name; it is not an engine.
const backtestEngine engines.Name = "backtest"

const (
	defaultBacktestHeldOutDays = 28
	defaultBacktestLoadDays    = 400
)

// ErrBacktestNeedsEngine: only a real engine can be backtested.
var ErrBacktestNeedsEngine = errors.New("backtest: the forecaster engine is not in use (OPENDISPATCH_ENGINE_MODE is not engine)")

// BacktestOptions: zero values mean the defaults.
type BacktestOptions struct {
	// EndDate is the day after the last day to score.
	EndDate      string
	HeldOutDays  int
	HorizonDays  int
	WeakestN     int
	HistoryLoad  int
	EngineCaller backtest.Caller
	// Trigger: manual (default) or degradation.
	Trigger string
}

// BacktestRecord is what is kept per customer.
type BacktestRecord struct {
	SchemaVersion string                   `json:"schema_version"`
	Kind          string                   `json:"kind"`
	GeneratedAt   string                   `json:"generated_at"`
	Scope         string                   `json:"scope"`
	DataSource    string                   `json:"data_source"`
	Illustrative  bool                     `json:"illustrative"`
	Notice        string                   `json:"notice"`
	ModelVersion  string                   `json:"model_version"`
	ModelInfo     *backtest.ModelInfo      `json:"model_info,omitempty"`
	HeldOutFrom   string                   `json:"held_out_from"`
	HeldOutTo     string                   `json:"held_out_to"`
	GateResult    string                   `json:"gate_result"`
	Report        *backtest.ForecastReport `json:"report"`
	// Comparison: champion against challenger
	Comparison *ModelComparison `json:"comparison,omitempty"`
}

func gateOptions(ctx context.Context, tenant string) backtest.GateOptions {
	return backtest.GateOptions{
		MinImprovement:    readSetting(ctx, tenant, forecastcal.KeyGateMinImprove, defaultGateMinImprovement),
		MaxWorseZoneShare: readSetting(ctx, tenant, forecastcal.KeyGateWorseZones, defaultGateWorseZones),
	}
}

// gateBaseline: naive or segment (the default).
func gateBaseline(ctx context.Context, tenant string) string {
	v := readSetting(ctx, tenant, forecastcal.KeyGateBaseline, forecastcal.DefaultGateBaseline)
	if v != backtest.GateBaselineNaive && v != backtest.GateBaselineSegment {
		return forecastcal.DefaultGateBaseline
	}
	return v
}

// backtestDataset reads the customer's case counts before the end date.
func backtestDataset(ctx context.Context, conn *tenancy.Connection, tenant, end string, loadDays int) (*backtest.Dataset, error) {
	zones, err := allZones(ctx, conn, tenant)
	if err != nil {
		return nil, err
	}
	subs, err := allSubZones(ctx, conn, tenant)
	if err != nil {
		return nil, err
	}
	var zoneIDs []string
	zoneOf := map[string]string{}
	for _, z := range zones {
		if z.IsActive {
			zoneIDs = append(zoneIDs, z.ID)
		}
	}
	ds := &backtest.Dataset{ZoneSubs: map[string][]string{}, Agents: map[string]backtest.Agent{}, Standby: map[string]backtest.Point{}}
	active := map[string]bool{}
	for _, z := range zoneIDs {
		active[z] = true
	}
	for _, sz := range subs {
		if sz.IsActive && active[sz.ZoneID] {
			ds.ZoneSubs[sz.ZoneID] = append(ds.ZoneSubs[sz.ZoneID], sz.ID)
			zoneOf[sz.ID] = sz.ZoneID
		}
	}
	to, err := riyadhMidnight(end)
	if err != nil {
		return nil, inputErr("end date is not a date")
	}
	rows, sources, err := loadForecastHistory(ctx, conn, tenant, zoneIDs, to.AddDate(0, 0, -loadDays), to)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if zoneOf[r.SubZoneID] == "" || r.Total < 0 || r.Field < 0 || r.Field > r.Total {
			continue
		}
		ds.Intervals = append(ds.Intervals, backtest.HistoryRecord{SubZoneID: r.SubZoneID, Start: r.IntervalStart, Total: r.Total, Field: r.Field})
	}
	if len(ds.Intervals) == 0 {
		return nil, inputErr("no case history before %s", end)
	}
	_, distinct, err := sourcesOf(sources)
	if err != nil {
		return nil, err
	}
	ds.DataSource, ds.RealOnly = backtest.SourceMixed, true
	for _, s := range distinct {
		ds.RealOnly = ds.RealOnly && s != "SYNTHETIC"
	}
	if len(distinct) == 1 {
		ds.DataSource = distinct[0]
	}
	return ds, nil
}

// RunForecastBacktest scores the forecaster for a customer and keeps the result.
func RunForecastBacktest(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, o BacktestOptions) (BacktestRecord, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, auditlog.WriteMeta{Action: "forecast.backtest_run", EntityType: "forecast_backtest"}, func(ctx context.Context) (auditlog.AuditedWrite[BacktestRecord], error) {
		rec, err := runForecastBacktest(ctx, conn, rc, o)
		if err != nil {
			return auditlog.AuditedWrite[BacktestRecord]{}, err
		}
		detail := map[string]any{"scope": rec.Scope, "gate_result": rec.GateResult, "model_version": rec.ModelVersion, "illustrative": rec.Illustrative}
		if rec.Report != nil && rec.Report.Gate != nil {
			detail["gate_baseline"] = rec.Report.Gate.BaselineName
		}
		if rec.Comparison != nil {
			detail["comparison"] = rec.Comparison.auditDetail()
		}
		return auditlog.AuditedWrite[BacktestRecord]{
			Result:    rec,
			SummaryEn: fmt.Sprintf("Forecast backtest on %s to %s finished: %s (model %s, %s).", rec.HeldOutFrom, rec.HeldOutTo, rec.GateResult, rec.ModelVersion, rec.DataSource) + rec.Comparison.summary(),
			Detail:    detail,
		}, nil
	})
}

func runForecastBacktest(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, o BacktestOptions) (BacktestRecord, error) {
	var rec BacktestRecord
	started := datactx.NowISO()
	caller := o.EngineCaller
	if caller == nil {
		if engineMode() != engines.ModeEngine {
			return rec, ErrBacktestNeedsEngine
		}
		g, err := engineGuard(rc.CustomerID, engines.Forecaster)
		if err != nil {
			return rec, err
		}
		caller = g
	}
	tenant := rc.CustomerID
	if o.EndDate == "" {
		o.EndDate = scoredEnd(ctx, tenant)
	}
	if o.HeldOutDays < 1 {
		o.HeldOutDays = defaultBacktestHeldOutDays
	}
	if o.HorizonDays < 1 {
		o.HorizonDays = 1
	}
	if o.HistoryLoad < 1 {
		o.HistoryLoad = defaultBacktestLoadDays
	}
	ds, err := backtestDataset(ctx, conn, tenant, o.EndDate, o.HistoryLoad)
	if err != nil {
		return rec, err
	}
	holidays, err := allHolidays(ctx, conn, tenant)
	if err != nil {
		return rec, err
	}
	cal := forecastCalendarConfig(ctx, tenant)
	gate := gateOptions(ctx, tenant)
	champion := championModel(ctx, tenant)
	hs := forecastHistorySettings(ctx, tenant)
	opts := backtest.EngineOptions{ModelVersion: champion, Source: ds.SendSource(), Calendar: cal, HistoryDays: hs.DetailDays(), Long: &hs,
		Holiday: func(date string) (bool, string) {
			for _, h := range holidays {
				if datactx.InDateRange(date, h.StartDate, h.EndDate) {
					return true, h.NameEn
				}
			}
			return false, ""
		}}
	cfg := backtest.ForecastConfig{Horizon: o.HorizonDays, MinHistoryDays: 7, Coverage: engineRangeCover, HeldOutDays: o.HeldOutDays, WeakestN: o.WeakestN, Calendar: cal, Gate: &gate,
		Segmenter: backtest.SegmentFromCalendar(cal), GateBaseline: gateBaseline(ctx, tenant), Blend: forecastBlend(ctx, tenant)}
	rep, err := backtest.RunEngine(ctx, ds, caller, opts, cfg)
	if err != nil {
		return rec, err
	}
	report := backtest.NewReport(ds)
	scopeDay := rep.HeldOut.To
	if scopeDay == "" {
		scopeDay = shiftDateBy(o.EndDate, -1)
	}
	rec = BacktestRecord{
		SchemaVersion: "1.0", Kind: "forecast_backtest", GeneratedAt: datactx.NowISO(), Scope: "backtest:" + scopeDay,
		DataSource: ds.DataSource, Illustrative: ds.Illustrative(), Notice: report.Notice, ModelVersion: rep.ModelVersion, ModelInfo: rep.ModelInfo,
		HeldOutFrom: rep.HeldOut.From, HeldOutTo: rep.HeldOut.To, GateResult: rep.Gate.Result, Report: rep,
	}
	if rec.ModelVersion == "" {
		rec.ModelVersion = champion
	}
	if rec.Comparison, err = compareChallenger(ctx, tenant, ds, caller, opts, cfg, rec.ModelVersion, rep); err != nil {
		return rec, err
	}
	body, err := json.Marshal(rec)
	if err != nil {
		return rec, err
	}
	if err := keepAnswer(ctx, tenant, backtestEngine, rec.Scope, body, nil); err != nil {
		return rec, err
	}
	saveExperiment(ctx, tenant, backtestExperiment(ctx, rc, o, rec, backtestSnapshotID(ds), started))
	return rec, nil
}

// LatestForecastBacktest is the newest kept backtest, nil when none.
func LatestForecastBacktest(tenant string) (*BacktestRecord, error) {
	body, err := engineAnswerData.latest(context.Background(), tenant, backtestEngine)
	if err != nil || body == nil {
		return nil, err
	}
	var rec BacktestRecord
	if err := json.Unmarshal(body, &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}
