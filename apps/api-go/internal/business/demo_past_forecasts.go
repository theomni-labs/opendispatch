// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// PastForecast: one day's backfilled run.
type PastForecast struct {
	Date    string
	RunID   string
	Skipped bool
}

// BackfillPastForecasts runs the forecaster once per past day, as of that day.
func BackfillPastForecasts(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, days int, progress func(PastForecast)) ([]PastForecast, error) {
	if progress == nil {
		progress = func(PastForecast) {}
	}
	if engineMode() != engines.ModeEngine {
		return nil, ErrBacktestNeedsEngine
	}
	if days < 1 || days > accuracyLookback {
		return nil, fmt.Errorf("past forecasts: days %d out of 1..%d", days, accuracyLookback)
	}
	if getModelStoredState(ctx, rc.CustomerID).IsPaused {
		return nil, dataerr.Conflict("The forecast is paused.")
	}
	runs, err := loadForecastRuns(ctx, rc.CustomerID, false)
	if err != nil {
		return nil, err
	}
	have := map[string]bool{}
	for _, r := range runs {
		if r.Status == "succeeded" && !isChallengerRun(ctx, rc.CustomerID, r) {
			have[r.HorizonStartDate] = true
		}
	}
	today := todayIn(ctx, rc.CustomerID)
	var out []PastForecast
	for back := days; back >= 1; back-- {
		day := shiftDateBy(today, -back)
		if have[day] {
			out = append(out, PastForecast{Date: day, Skipped: true})
			progress(out[len(out)-1])
			continue
		}
		// history ends at the day's midnight
		started := datactx.NowISO()
		doc, sources, err := askForecaster(ctx, conn, rc, day, 1)
		if err != nil {
			return out, fmt.Errorf("past forecast %s: %w", day, err)
		}
		asOf, err := pastAsOf(day)
		if err != nil {
			return out, err
		}
		run, err := storeEngineForecastRunAsOf(ctx, conn, rc, doc, sources, started, asOf)
		if err != nil {
			return out, fmt.Errorf("past forecast %s: %w", day, err)
		}
		out = append(out, PastForecast{Date: day, RunID: run.ID})
		progress(out[len(out)-1])
	}
	return out, nil
}

// pastAsOf: just before the day's midnight.
func pastAsOf(day string) (string, error) {
	midnight, err := riyadhMidnight(day)
	if err != nil {
		return "", fmt.Errorf("past forecast %s: %w", day, err)
	}
	return datactx.ToRiyadhISO(midnight.Add(-time.Second)), nil
}
