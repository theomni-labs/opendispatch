// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// ExplanationDriver: one multiplier.
type ExplanationDriver struct {
	Driver     string  `json:"driver"`
	Multiplier float64 `json:"multiplier"`
	Unknown    bool    `json:"unknown,omitempty"`
}

// EngineExplanation: one zone and day.
type EngineExplanation struct {
	ZoneID   string              `json:"zone_id"`
	Date     string              `json:"date"`
	Base     float64             `json:"base"`
	Expected float64             `json:"expected"`
	Drivers  []ExplanationDriver `json:"drivers"`
}

// ForecastExplanationQuery: zone, day, run.
type ForecastExplanationQuery struct {
	ZoneID string
	Date   string
	RunID  string
}

// ForecastExplanation: getForecastExplanation.
type ForecastExplanation struct {
	ForecastRunID string              `json:"forecast_run_id"`
	ZoneID        string              `json:"zone_id"`
	Date          string              `json:"date"`
	ModelVersion  string              `json:"model_version"`
	EngineVersion string              `json:"engine_version"`
	TrainingStart string              `json:"training_start,omitempty"`
	TrainingEnd   string              `json:"training_end,omitempty"`
	HistoryDays   *int                `json:"history_days,omitempty"`
	Base          float64             `json:"base"`
	Expected      float64             `json:"expected"`
	Drivers       []ExplanationDriver `json:"drivers"`
	Illustrative  bool                `json:"illustrative"`
	DataSource    string              `json:"data_source"`
}

type explainedModelInfo struct {
	TrainingStart string `json:"training_start"`
	TrainingEnd   string `json:"training_end"`
	HistoryDays   *int   `json:"history_days"`
}

const noExplanation = "No explanation for this forecast run."

// within: t in [from - 1s, to] when both are set.
func within(t string, from, to *string) bool {
	at, err := time.Parse(time.RFC3339, t)
	if err != nil || from == nil || to == nil {
		return false
	}
	a, errA := time.Parse(time.RFC3339, *from)
	b, errB := time.Parse(time.RFC3339, *to)
	return errA == nil && errB == nil && !at.Before(a.Add(-time.Second)) && !at.After(b)
}

// answerOf: the kept answer came from this run.
func answerOf(doc *ForecasterEngineOutput, run ForecastRun) bool {
	if doc == nil || run.EngineVersion == nil || doc.ModelVersion != run.ModelVersion || doc.Engine.Version != *run.EngineVersion {
		return false
	}
	if doc.Horizon.StartDate != run.HorizonStartDate || doc.Horizon.Days != run.HorizonDays {
		return false
	}
	return isOutputOf(doc, run) || within(doc.GeneratedAt, run.StartedAt, run.FinishedAt)
}

// explanationFrom: the doc's entry, or not found.
func explanationFrom(doc *ForecasterEngineOutput, run ForecastRun, zoneID, date string) (ForecastExplanation, error) {
	if !answerOf(doc, run) {
		return ForecastExplanation{}, dataerr.NotFound(noExplanation)
	}
	for _, e := range doc.Explanations {
		if e.ZoneID != zoneID || e.Date != date {
			continue
		}
		out := ForecastExplanation{ForecastRunID: run.ID, ZoneID: zoneID, Date: date, ModelVersion: doc.ModelVersion, EngineVersion: doc.Engine.Version,
			Base: e.Base, Expected: e.Expected, Drivers: e.Drivers, Illustrative: run.Illustrative, DataSource: run.DataSource}
		if out.Drivers == nil {
			out.Drivers = []ExplanationDriver{}
		}
		var info explainedModelInfo
		if len(doc.ModelInfo) > 0 && json.Unmarshal(doc.ModelInfo, &info) == nil {
			out.TrainingStart, out.TrainingEnd, out.HistoryDays = info.TrainingStart, info.TrainingEnd, info.HistoryDays
		}
		return out, nil
	}
	return ForecastExplanation{}, dataerr.NotFound(noExplanation)
}

// readKeptWithoutValues: the answer, values dropped.
func readKeptWithoutValues(ctx context.Context, tenant, scope string) ([]byte, error) {
	if b, ok := engineAnswerData.(pgEngineAnswers); ok {
		return tenancy.WithTenant(context.Background(), b.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]byte, error) {
			var body []byte
			err := tx.QueryRow(ctx, `SELECT (body::jsonb - 'values')::text FROM engine_answers WHERE engine = $1 AND scope_key = $2`,
				string(engines.Forecaster), scope).Scan(&body)
			if err == pgx.ErrNoRows {
				return nil, nil
			}
			return body, err
		})
	}
	return readKeptScope(ctx, tenant, engines.Forecaster, scope)
}

// GetForecastExplanation: why a zone-day.
func GetForecastExplanation(rc reqctx.RequestContext, q ForecastExplanationQuery) (ForecastExplanation, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsForecastExplorer, access.AccessView); err != nil {
		return ForecastExplanation{}, err
	}
	if q.ZoneID == "" {
		return ForecastExplanation{}, dataerr.Invalid("zone_id is required.")
	}
	if _, err := importutil.RequireID(q.ZoneID, "Zone"); err != nil {
		return ForecastExplanation{}, err
	}
	if err := validateDateString(q.Date); err != nil {
		return ForecastExplanation{}, err
	}
	zone := q.ZoneID
	if !reqctx.CanReadZone(rc, &zone) {
		return ForecastExplanation{}, dataerr.NotFound("Zone not found.")
	}
	run, err := requireRun(context.Background(), rc.CustomerID, q.RunID)
	if err != nil {
		return ForecastExplanation{}, err
	}
	body, err := readKeptWithoutValues(context.Background(), rc.CustomerID, run.HorizonStartDate)
	if err != nil {
		return ForecastExplanation{}, err
	}
	var doc ForecasterEngineOutput
	if body == nil || json.Unmarshal(body, &doc) != nil {
		return ForecastExplanation{}, dataerr.NotFound(noExplanation)
	}
	return explanationFrom(&doc, run, q.ZoneID, q.Date)
}
