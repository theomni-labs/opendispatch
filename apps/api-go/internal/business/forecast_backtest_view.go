// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// backtestTimeout bounds one run.
var backtestTimeout = backtestTimeoutFrom(os.Getenv("OPENDISPATCH_BACKTEST_TIMEOUT_MINUTES"))

// backtestTimeoutFrom: 5 to 600 minutes, else 20.
func backtestTimeoutFrom(v string) time.Duration {
	if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n >= 5 && n <= 600 {
		return time.Duration(n) * time.Minute
	}
	return 20 * time.Minute
}

// BacktestMetrics: one arm, as fractions.
type BacktestMetrics struct {
	WAPE          *float64 `json:"wape"`
	MAPE          *float64 `json:"mape"`
	MAE           *float64 `json:"mae"`
	RMSE          *float64 `json:"rmse"`
	RangeCoverage *float64 `json:"range_coverage"`
}

// BacktestDayType: event or ordinary days.
type BacktestDayType struct {
	Days         int      `json:"days"`
	WAPE         *float64 `json:"wape"`
	BaselineWAPE *float64 `json:"baseline_wape"`
}

// BacktestHour: one hour of a weak zone.
type BacktestHour struct {
	Hour         int      `json:"hour"`
	WAPE         *float64 `json:"wape"`
	BaselineWAPE *float64 `json:"baseline_wape"`
}

// BacktestZone: one of the weakest zones.
type BacktestZone struct {
	ZoneID       string         `json:"zone_id"`
	WAPE         *float64       `json:"wape"`
	BaselineWAPE *float64       `json:"baseline_wape"`
	ActualTotal  float64        `json:"actual_total"`
	Hours        []BacktestHour `json:"hours"`
}

// BacktestChallenger: the challenger's lift.
type BacktestChallenger struct {
	Champion       string   `json:"champion"`
	Challenger     string   `json:"challenger"`
	ChallengerRan  *string  `json:"challenger_ran"`
	GateResult     *string  `json:"gate_result"`
	ChampionWAPE   *float64 `json:"champion_wape"`
	ChallengerWAPE *float64 `json:"challenger_wape"`
	WAPELift       *float64 `json:"wape_lift"`
	ChampionMAPE   *float64 `json:"champion_mape"`
	ChallengerMAPE *float64 `json:"challenger_mape"`
	MAPELift       *float64 `json:"mape_lift"`
	Error          *string  `json:"error"`
}

// BacktestGate: the verdict against one baseline.
type BacktestGate struct {
	Result         string   `json:"result"`
	Baseline       string   `json:"baseline"`
	MinImprovement float64  `json:"min_improvement"`
	Improvement    *float64 `json:"improvement"`
	WorseZones     int      `json:"worse_zones"`
	ComparedZones  int      `json:"compared_zones"`
}

// BacktestSpan: a date range, either end unknown.
type BacktestSpan struct {
	From *string `json:"from"`
	To   *string `json:"to"`
}

// BacktestHeldOut: the scored days.
type BacktestHeldOut struct {
	BacktestSpan
	Days int `json:"days"`
}

// BacktestTraining: the model's window.
type BacktestTraining struct {
	BacktestSpan
	Features *int `json:"features"`
}

// BacktestView is the contract's ForecastBacktest.
type BacktestView struct {
	GeneratedAt  string              `json:"generated_at"`
	DataSource   string              `json:"data_source"`
	MixedSources bool                `json:"mixed_sources"`
	Illustrative bool                `json:"illustrative"`
	ModelVersion string              `json:"model_version"`
	HeldOut      BacktestHeldOut     `json:"held_out"`
	Training     BacktestTraining    `json:"training"`
	Gate         BacktestGate        `json:"gate"`
	Engine       BacktestMetrics     `json:"engine"`
	Naive        BacktestMetrics     `json:"naive"`
	Segment      *BacktestMetrics    `json:"segment"`
	EventDays    BacktestDayType     `json:"event_days"`
	OrdinaryDays BacktestDayType     `json:"ordinary_days"`
	WeakestZones []BacktestZone      `json:"weakest_zones"`
	Challenger   *BacktestChallenger `json:"challenger"`
}

// BacktestRun: the run on this server.
type BacktestRun struct {
	State      string  `json:"state"`
	StartedAt  *string `json:"started_at"`
	FinishedAt *string `json:"finished_at"`
	ErrorClass *string `json:"error_class"`
	done       chan struct{}
}

// BacktestState is the contract's ForecastBacktestState.
type BacktestState struct {
	Latest      *BacktestView `json:"latest"`
	Run         BacktestRun   `json:"run"`
	ActiveModel string        `json:"active_model"`
}

var backtestRuns = struct {
	sync.Mutex
	m map[string]*BacktestRun
}{m: map[string]*BacktestRun{}}

func backtestRunOf(tenant string) BacktestRun {
	backtestRuns.Lock()
	defer backtestRuns.Unlock()
	if r := backtestRuns.m[tenant]; r != nil {
		return *r
	}
	return BacktestRun{State: "idle"}
}

func optStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func numPtr(v float64) *float64 { return &v }

// datePart: YYYY-MM-DD or nil.
func datePart(s string) *string {
	if len(s) < 10 || validateDateString(s[:10]) != nil {
		return nil
	}
	return optStr(s[:10])
}

func armMetrics(a *backtest.ForecastArm, withRange bool) BacktestMetrics {
	var m BacktestMetrics
	if a == nil {
		return m
	}
	m.WAPE = a.Overall.WAPE
	if a.Overall.Cells > 0 {
		m.MAE, m.RMSE = numPtr(a.Overall.MAE), numPtr(a.Overall.RMSE)
		if withRange {
			m.RangeCoverage = numPtr(a.Overall.Coverage)
		}
	}
	if a.MAPE != nil {
		m.MAPE = a.MAPE.ZoneDay.MAPE
	}
	return m
}

func zoneHours(a *backtest.ForecastArm, zone string) map[int]*float64 {
	out := map[int]*float64{}
	if a == nil {
		return out
	}
	for _, zh := range a.ByZoneHour {
		if zh.ZoneID == zone && zh.Cells > 0 {
			out[zh.Hour] = zh.WAPE
		}
	}
	return out
}

// sourceOfRecord: an enum value, and whether mixed.
func sourceOfRecord(source string, illustrative bool) (string, bool) {
	if _, ok := sourceRank[source]; ok {
		return source, false
	}
	if illustrative {
		return "SYNTHETIC", true
	}
	return "IMPORTED", true
}

// backtestView projects a kept record for the card.
func backtestView(ctx context.Context, tenant string, rec BacktestRecord) BacktestView {
	v := BacktestView{GeneratedAt: rec.GeneratedAt, Illustrative: rec.Illustrative, ModelVersion: rec.ModelVersion, WeakestZones: []BacktestZone{}}
	v.DataSource, v.MixedSources = sourceOfRecord(rec.DataSource, rec.Illustrative)
	v.HeldOut.From, v.HeldOut.To = datePart(rec.HeldOutFrom), datePart(rec.HeldOutTo)
	if rec.ModelInfo != nil {
		v.Training.From, v.Training.To = datePart(rec.ModelInfo.TrainingStart), datePart(rec.ModelInfo.TrainingEnd)
		n := len(rec.ModelInfo.FeatureSet)
		v.Training.Features = &n
	}
	v.Gate = BacktestGate{Result: rec.GateResult, Baseline: backtest.GateBaselineNaive, MinImprovement: gateOptions(ctx, tenant).MinImprovement}
	if v.Gate.Result == "" {
		v.Gate.Result = backtest.GateNotEnoughHistory
	}
	rep := rec.Report
	if rep == nil {
		return v
	}
	v.HeldOut.Days = rep.HeldOut.Days
	scored := rep.GateArm()
	v.Engine = armMetrics(scored, true)
	// MAPE sums hours to days: expected values
	v.Engine.MAPE = armMetrics(rep.Candidate, true).MAPE
	v.Naive = armMetrics(&rep.Baseline, false)
	gateArm := &rep.Baseline
	if rep.SegmentBaseline != nil {
		s := armMetrics(rep.SegmentBaseline, false)
		v.Segment = &s
	}
	if g := rep.Gate; g != nil {
		v.Gate.Result, v.Gate.MinImprovement, v.Gate.Improvement = g.Result, g.MinImprovement, g.Improvement
		v.Gate.WorseZones, v.Gate.ComparedZones = g.WorseZones, g.ComparedZones
		if g.BaselineName == backtest.SegmentBaselineName && rep.SegmentBaseline != nil {
			v.Gate.Baseline, gateArm = backtest.GateBaselineSegment, rep.SegmentBaseline
		}
	}
	ordinary := rep.HeldOut.Days - rep.HeldOut.EventDays
	if ordinary < 0 {
		ordinary = 0
	}
	v.EventDays = BacktestDayType{Days: rep.HeldOut.EventDays, BaselineWAPE: gateArm.EventDays.WAPE}
	v.OrdinaryDays = BacktestDayType{Days: ordinary, BaselineWAPE: gateArm.OrdinaryDays.WAPE}
	if scored != nil {
		v.EventDays.WAPE, v.OrdinaryDays.WAPE = scored.EventDays.WAPE, scored.OrdinaryDays.WAPE
	}
	if rep.Weakest != nil {
		for _, z := range rep.Weakest.Zones {
			cand, base := zoneHours(scored, z.ZoneID), zoneHours(gateArm, z.ZoneID)
			hours := []BacktestHour{}
			for h := 0; h < 24; h++ {
				if w, ok := cand[h]; ok {
					hours = append(hours, BacktestHour{Hour: h, WAPE: w, BaselineWAPE: base[h]})
				}
			}
			v.WeakestZones = append(v.WeakestZones, BacktestZone{ZoneID: z.ZoneID, WAPE: z.WAPE, BaselineWAPE: z.BaselineWAPE, ActualTotal: z.ActualTotal, Hours: hours})
		}
	}
	if c := rec.Comparison; c != nil {
		v.Challenger = &BacktestChallenger{Champion: c.Champion, Challenger: c.Challenger, ChallengerRan: optStr(c.ChallengerRan), GateResult: optStr(c.ChallengerGate),
			ChampionWAPE: c.Overall.ChampionWAPE, ChallengerWAPE: c.Overall.ChallengerWAPE, WAPELift: c.Overall.WAPELift,
			ChampionMAPE: c.Overall.ChampionMAPE, ChallengerMAPE: c.Overall.ChallengerMAPE, MAPELift: c.Overall.MAPELift, Error: optStr(c.Error)}
	}
	return v
}

func backtestState(ctx context.Context, tenant string) (BacktestState, error) {
	st := BacktestState{Run: backtestRunOf(tenant), ActiveModel: championModel(ctx, tenant)}
	rec, err := LatestForecastBacktest(tenant)
	if err != nil {
		return st, err
	}
	if rec != nil {
		v := backtestView(ctx, tenant, *rec)
		st.Latest = &v
	}
	return st, nil
}

// GetForecastBacktest mirrors getForecastBacktest.
func GetForecastBacktest(rc reqctx.RequestContext) (BacktestState, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminForecastModel, access.AccessView); err != nil {
		return BacktestState{}, err
	}
	return backtestState(context.Background(), rc.CustomerID)
}

// StartForecastBacktest mirrors runForecastBacktest.
func StartForecastBacktest(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) (BacktestState, error) {
	return startBacktest(ctx, conn, rc, BacktestOptions{})
}

func backtestFailureClass(err error) string {
	switch {
	case errors.Is(err, ErrBacktestNeedsEngine):
		return "engine_off"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, ErrEngineInput):
		return "no_history"
	}
	return engineErrorClass(err)
}

func startBacktest(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, o BacktestOptions) (BacktestState, error) {
	meta := auditlog.WriteMeta{Action: "forecast.backtest_run", EntityType: "forecast_backtest"}
	if err := auditlog.GuardWithAudit(rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, meta); err != nil {
		return BacktestState{}, err
	}
	if o.EngineCaller == nil && engineMode() != engines.ModeEngine {
		return BacktestState{}, dataerr.Conflict("The forecaster engine is not in use: a backtest needs it.")
	}
	tenant := rc.CustomerID
	started := datactx.NowISO()
	run := &BacktestRun{State: "running", StartedAt: &started, done: make(chan struct{})}
	backtestRuns.Lock()
	if cur := backtestRuns.m[tenant]; cur != nil && cur.State == "running" {
		backtestRuns.Unlock()
		return BacktestState{}, dataerr.Conflict("A backtest is already running.")
	}
	backtestRuns.m[tenant] = run
	backtestRuns.Unlock()
	backtestAudit(rc, "forecast.backtest_started", "success", fmt.Sprintf("Forecast backtest started (model %s).", championModel(ctx, tenant)), map[string]any{"model_version": championModel(ctx, tenant)})
	bg, cancel := context.WithTimeout(context.WithoutCancel(tenancy.Detach(ctx)), backtestTimeout)
	go func() {
		defer cancel()
		_, err := RunForecastBacktest(bg, conn, rc, o)
		finished := datactx.NowISO()
		backtestRuns.Lock()
		run.FinishedAt = &finished
		if err != nil {
			class := backtestFailureClass(err)
			run.State, run.ErrorClass = "failed", &class
			log.Printf("forecast: backtest failed (%s): %v", class, err)
		} else {
			run.State = "succeeded"
		}
		backtestRuns.Unlock()
		if err != nil {
			backtestAudit(rc, "forecast.backtest_run", "failure", fmt.Sprintf("Forecast backtest failed (%s).", *run.ErrorClass), map[string]any{"error_class": *run.ErrorClass})
			e := newExperiment(rc, ExperimentBacktest, o.Trigger, championModel(bg, tenant))
			if e.Trigger == "" {
				e.Trigger = TriggerManual
			}
			e.StartedAt = &started
			finishExperiment(&e, err)
			saveExperiment(bg, tenant, e)
		}
		close(run.done)
	}()
	return backtestState(ctx, tenant)
}

func backtestAudit(rc reqctx.RequestContext, action, outcome, summary string, detail map[string]any) {
	if _, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: action, EntityType: "forecast_backtest", Outcome: outcome, SummaryEn: summary, Detail: detail}, "", ""); err != nil {
		log.Printf("forecast: audit %s failed: %v", action, err)
	}
}

// waitBacktest: tests wait for the background run.
func waitBacktest(tenant string) {
	backtestRuns.Lock()
	r := backtestRuns.m[tenant]
	backtestRuns.Unlock()
	if r != nil && r.done != nil {
		<-r.done
	}
}
