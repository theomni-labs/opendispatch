// SPDX-License-Identifier: AGPL-3.0-only

// Experiments and data snapshots.
package business

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"log"
	"sort"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// Experiment kinds and triggers.
const (
	ExperimentBacktest   = "backtest"
	ExperimentChallenger = "challenger"
	ExperimentRetrain    = "retrain"

	TriggerManual      = "manual"
	TriggerSchedule    = "schedule"
	TriggerDegradation = "degradation"

	// maxExperimentsListed: the newest kept are listed.
	maxExperimentsListed = 200
)

// ExperimentParams: what the run was asked.
type ExperimentParams struct {
	HorizonDays     *int     `json:"horizon_days,omitempty"`
	HeldOutDays     *int     `json:"held_out_days,omitempty"`
	HistoryDays     *int     `json:"history_days,omitempty"`
	GateBaseline    *string  `json:"gate_baseline,omitempty"`
	DegradedZones   *int     `json:"degraded_zones,omitempty"`
	DegradationWAPE *float64 `json:"degradation_limit,omitempty"`
}

// ExperimentMetrics: what the run measured.
type ExperimentMetrics struct {
	WAPE           *float64 `json:"wape,omitempty"`
	MAPE           *float64 `json:"mape,omitempty"`
	BaselineWAPE   *float64 `json:"baseline_wape,omitempty"`
	Improvement    *float64 `json:"improvement,omitempty"`
	GateResult     *string  `json:"gate_result,omitempty"`
	ChallengerWAPE *float64 `json:"challenger_wape,omitempty"`
	WAPELift       *float64 `json:"wape_lift,omitempty"`
	WorstZoneWAPE  *float64 `json:"worst_zone_wape,omitempty"`
}

// ForecastExperiment: one tracked model run.
type ForecastExperiment struct {
	datactx.BaseRecord
	Kind              string            `json:"kind"`
	Trigger           string            `json:"trigger"`
	Status            string            `json:"status"`
	ModelVersion      string            `json:"model_version"`
	ChallengerModel   *string           `json:"challenger_model"`
	DatasetSnapshotID *string           `json:"dataset_snapshot_id"`
	ForecastRunID     *string           `json:"forecast_run_id"`
	Params            ExperimentParams  `json:"params"`
	Metrics           ExperimentMetrics `json:"metrics"`
	Illustrative      bool              `json:"illustrative"`
	StartedAt         *string           `json:"started_at"`
	FinishedAt        *string           `json:"finished_at"`
	ErrorClass        *string           `json:"error_class"`
}

// snapshotSum: an order-free digest of rows.
type snapshotSum struct {
	sum, xor uint64
	n        int
}

func (s *snapshotSum) add(sub string, start time.Time, minutes, total, field int) {
	h := fnv.New64a()
	var b [8]byte
	_, _ = h.Write([]byte(sub))
	binary.LittleEndian.PutUint64(b[:], uint64(start.Unix()))
	_, _ = h.Write(b[:])
	binary.LittleEndian.PutUint64(b[:], uint64(minutes)<<48|uint64(total)<<24|uint64(field))
	_, _ = h.Write(b[:])
	v := h.Sum64()
	s.sum += v
	s.xor ^= v*0x9E3779B97F4A7C15 + 1
	s.n++
}

func (s snapshotSum) id() string {
	if s.n == 0 {
		return ""
	}
	return fmt.Sprintf("ds-%016x", s.sum^(s.xor<<1)^uint64(s.n))
}

// datasetSnapshotID: same rows, same id.
func datasetSnapshotID(src forecasterSource) string {
	var s snapshotSum
	for _, r := range src.History {
		s.add(r.SubZoneID, r.IntervalStart, 15, r.Total, r.Field)
	}
	for _, r := range src.Aggregated {
		s.add(r.SubZoneID, r.IntervalStart, r.Minutes, r.Total, r.Field)
	}
	return s.id()
}

// backtestSnapshotID: the backtest's case counts.
func backtestSnapshotID(ds *backtest.Dataset) string {
	var s snapshotSum
	if ds != nil {
		for _, r := range ds.Intervals {
			s.add(r.SubZoneID, r.Start, 15, r.Total, r.Field)
		}
	}
	return s.id()
}

// experimentBackend keeps experiments.
type experimentBackend interface {
	list(ctx context.Context, tenant string, limit int) ([]ForecastExperiment, error)
	save(ctx context.Context, tenant string, e ForecastExperiment) error
}

var experimentData experimentBackend = &memoryExperiments{}

// UsePostgresExperiments: Postgres store.
func UsePostgresExperiments(conn *tenancy.Connection) { experimentData = pgExperiments{conn: conn} }

// UseMemoryExperiments: memory store (tests).
func UseMemoryExperiments() { experimentData = &memoryExperiments{} }

type memoryExperiments struct {
	mu   sync.Mutex
	rows []ForecastExperiment
}

func (m *memoryExperiments) list(_ context.Context, tenant string, limit int) ([]ForecastExperiment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []ForecastExperiment
	for _, e := range m.rows {
		if e.TenantID == tenant {
			out = append(out, e)
		}
	}
	sortExperiments(out)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *memoryExperiments) save(_ context.Context, _ string, e ForecastExperiment) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, x := range m.rows {
		if x.ID == e.ID {
			m.rows[i] = e
			return nil
		}
	}
	m.rows = append(m.rows, e)
	return nil
}

func sortExperiments(rows []ForecastExperiment) {
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].CreatedAt != rows[j].CreatedAt {
			return rows[i].CreatedAt > rows[j].CreatedAt
		}
		return rows[i].ID > rows[j].ID
	})
}

type pgExperiments struct{ conn *tenancy.Connection }

func (p pgExperiments) list(ctx context.Context, tenant string, limit int) ([]ForecastExperiment, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]ForecastExperiment, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, kind, trigger, status,
			model_version, challenger_model, dataset_snapshot_id, forecast_run_id::text, params, metrics, illustrative, started_at, finished_at, error_class
			FROM forecast_experiments ORDER BY created_at DESC, id DESC LIMIT $1`, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []ForecastExperiment
		for rows.Next() {
			var e ForecastExperiment
			var created, updated time.Time
			var started, finished *time.Time
			var params, metrics []byte
			if err := rows.Scan(&e.ID, &e.TenantID, &e.DataSource, &created, &updated, &e.CreatedBy, &e.Kind, &e.Trigger, &e.Status,
				&e.ModelVersion, &e.ChallengerModel, &e.DatasetSnapshotID, &e.ForecastRunID, &params, &metrics, &e.Illustrative, &started, &finished, &e.ErrorClass); err != nil {
				return nil, err
			}
			e.CreatedAt, e.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			e.StartedAt, e.FinishedAt = nullableTimeToISO(started), nullableTimeToISO(finished)
			if json.Unmarshal(params, &e.Params) != nil || json.Unmarshal(metrics, &e.Metrics) != nil {
				return nil, fmt.Errorf("forecast experiment %s: unreadable params or metrics", e.ID)
			}
			out = append(out, e)
		}
		return out, rows.Err()
	})
}

func (p pgExperiments) save(ctx context.Context, tenant string, e ForecastExperiment) error {
	created, err := parseTime(e.CreatedAt)
	if err != nil {
		return err
	}
	updated, err := parseTime(e.UpdatedAt)
	if err != nil {
		return err
	}
	started, err := optTime(e.StartedAt)
	if err != nil {
		return err
	}
	finished, err := optTime(e.FinishedAt)
	if err != nil {
		return err
	}
	params, _ := json.Marshal(e.Params)
	metrics, _ := json.Marshal(e.Metrics)
	_, err = tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO forecast_experiments (tenant_id, id, data_source, created_at, updated_at, created_by, kind, trigger, status,
				model_version, challenger_model, dataset_snapshot_id, forecast_run_id, params, metrics, illustrative, started_at, finished_at, error_class)
			VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11, $12::uuid, $13, $14, $15, $16, $17, $18)
			ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, status = EXCLUDED.status,
				dataset_snapshot_id = EXCLUDED.dataset_snapshot_id, forecast_run_id = EXCLUDED.forecast_run_id, metrics = EXCLUDED.metrics,
				illustrative = EXCLUDED.illustrative, data_source = EXCLUDED.data_source, finished_at = EXCLUDED.finished_at, error_class = EXCLUDED.error_class`,
			e.ID, e.DataSource, created, updated, e.CreatedBy, e.Kind, e.Trigger, e.Status, e.ModelVersion, e.ChallengerModel, e.DatasetSnapshotID,
			e.ForecastRunID, params, metrics, e.Illustrative, started, finished, e.ErrorClass)
		return struct{}{}, err
	})
	return err
}

// newExperiment: a running experiment, now.
func newExperiment(rc reqctx.RequestContext, kind, trigger, model string) ForecastExperiment {
	at := datactx.NowISO()
	return ForecastExperiment{BaseRecord: datactx.NewRecord(rc, "", at), Kind: kind, Trigger: trigger, Status: "running",
		ModelVersion: model, Illustrative: true, StartedAt: &at}
}

// finishExperiment: done, or failed with a class.
func finishExperiment(e *ForecastExperiment, err error) {
	at := datactx.NowISO()
	e.FinishedAt, e.UpdatedAt = &at, at
	e.Status = "succeeded"
	if err != nil {
		class := backtestFailureClass(err)
		e.Status, e.ErrorClass = "failed", &class
	}
}

// saveExperiment is best effort: it only logs.
func saveExperiment(ctx context.Context, tenant string, e ForecastExperiment) {
	if e.DataSource == "" {
		e.DataSource = "SYNTHETIC"
	}
	if err := experimentData.save(tenancy.Detach(ctx), tenant, e); err != nil {
		log.Printf("forecast: experiment %s (%s) not kept: %v", e.ID, e.Kind, err)
	}
}

// ListForecastExperiments: newest first.
func ListForecastExperiments(rc reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[ForecastExperiment], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminForecastModel, access.AccessView); err != nil {
		return datactx.PageResult[ForecastExperiment]{}, err
	}
	rows, err := experimentData.list(context.Background(), rc.CustomerID, maxExperimentsListed)
	if err != nil {
		return datactx.PageResult[ForecastExperiment]{}, err
	}
	return datactx.Paginate(rows, query)
}

func intPtr(n int) *int { return &n }

// backtestExperiment: one kept backtest, scored.
func backtestExperiment(ctx context.Context, rc reqctx.RequestContext, o BacktestOptions, rec BacktestRecord, snapshot string, started string) ForecastExperiment {
	e := newExperiment(rc, ExperimentBacktest, o.Trigger, rec.ModelVersion)
	if e.Trigger == "" {
		e.Trigger = TriggerManual
	}
	e.StartedAt = &started
	e.Illustrative, e.DataSource = rec.Illustrative, rec.DataSource
	if _, ok := sourceRank[e.DataSource]; !ok {
		e.DataSource, _ = sourceOfRecord(rec.DataSource, rec.Illustrative)
	}
	e.DatasetSnapshotID = optStr(snapshot)
	base := gateBaseline(ctx, rc.CustomerID)
	e.Params = ExperimentParams{HorizonDays: intPtr(max(o.HorizonDays, 1)), HeldOutDays: intPtr(o.HeldOutDays), HistoryDays: intPtr(o.HistoryLoad), GateBaseline: &base}
	v := backtestView(ctx, rc.CustomerID, rec)
	gate := v.Gate.Result
	e.Metrics = ExperimentMetrics{WAPE: v.Engine.WAPE, MAPE: v.Engine.MAPE, Improvement: v.Gate.Improvement, GateResult: &gate}
	e.Metrics.BaselineWAPE = v.Naive.WAPE
	if v.Gate.Baseline == backtest.GateBaselineSegment && v.Segment != nil {
		e.Metrics.BaselineWAPE = v.Segment.WAPE
	}
	if c := v.Challenger; c != nil {
		e.ChallengerModel = &c.Challenger
		e.Metrics.ChallengerWAPE, e.Metrics.WAPELift = c.ChallengerWAPE, c.WAPELift
	}
	finishExperiment(&e, nil)
	return e
}

// challengerExperiment: a challenger forecast run.
func challengerExperiment(rc reqctx.RequestContext, champion, run ForecastRun, started string) ForecastExperiment {
	e := newExperiment(rc, ExperimentChallenger, TriggerSchedule, champion.ModelVersion)
	e.StartedAt = &started
	e.ChallengerModel = &run.ModelVersion
	e.ForecastRunID = &run.ID
	e.DatasetSnapshotID = run.DatasetSnapshotID
	e.Illustrative, e.DataSource = run.Illustrative, run.DataSource
	e.Params = ExperimentParams{HorizonDays: intPtr(run.HorizonDays)}
	finishExperiment(&e, nil)
	return e
}
