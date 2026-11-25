// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"slices"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// forecastHorizonDays: the planning horizon setting.
func forecastHorizonDays(ctx context.Context, tenant string) int {
	return settingIn(ctx, tenant, forecastcal.KeyHorizonDays, forecastcal.DefaultHorizonDays, forecastcal.MinHorizonDays, forecastcal.MaxHorizonDays)
}

// forecastChunkDays: days per forecaster call.
func forecastChunkDays(ctx context.Context, tenant string) int {
	return settingIn(ctx, tenant, forecastcal.KeyHorizonChunkDays, forecastcal.DefaultHorizonChunkDays, 1, forecastcal.MaxHorizonChunkDays)
}

// settingIn: a whole-number setting, else the default.
func settingIn(ctx context.Context, tenant, key string, fallback, lo, hi int) int {
	n := readSetting(ctx, tenant, key, fallback)
	if n < lo || n > hi {
		return fallback
	}
	return n
}

// forecastChunks splits days into pieces of size.
func forecastChunks(days, size int) []int {
	if size < 1 {
		size = forecastcal.DefaultHorizonChunkDays
	}
	var out []int
	for left := days; left > 0; left -= size {
		out = append(out, min(left, size))
	}
	return out
}

// chunkSource: the whole history, the chunk's horizon.
func chunkSource(src forecasterSource, offset, days int) forecasterSource {
	s := src
	s.StartDate, s.Days = shiftDateBy(src.StartDate, offset), days
	end := shiftDateBy(s.StartDate, days)
	s.Calendar = nil
	for _, d := range src.Calendar {
		if d.Date < end {
			s.Calendar = append(s.Calendar, d)
		}
	}
	return s
}

// askForecasterChunk asks for one chunk and checks it.
func askForecasterChunk(ctx context.Context, rc reqctx.RequestContext, src forecasterSource) (ForecasterEngineOutput, error) {
	var doc ForecasterEngineOutput
	request, err := buildForecasterRequest(src)
	asked := time.Now()
	body, err := askEngine(ctx, rc, engines.Forecaster, request, err)
	if err != nil {
		return doc, err
	}
	log.Printf("engines: forecaster answered in %.1fs", time.Since(asked).Seconds())
	err = checkAnswerHeader(engines.Forecaster, body)
	if err == nil && (json.Unmarshal(body, &doc) != nil || !forecastHorizonOK(doc, src.StartDate, src.Days)) {
		err = fmt.Errorf("%w: horizon or values", ErrEngineAnswer)
	}
	if err == nil {
		at, perr := parseTime(doc.GeneratedAt)
		if perr != nil {
			err = fmt.Errorf("%w: generated_at", ErrEngineAnswer)
		} else {
			doc.GeneratedAt = datactx.ToRiyadhISO(at)
		}
	}
	if err != nil {
		auditEngineFailure(rc, engines.Forecaster, err)
	}
	return doc, err
}

// askForecasterChunks: every chunk, one answer.
func askForecasterChunks(ctx context.Context, rc reqctx.RequestContext, src forecasterSource, chunkDays int) (ForecasterEngineOutput, error) {
	var doc ForecasterEngineOutput
	ids := map[string]string{}
	offset := 0
	for _, n := range forecastChunks(src.Days, chunkDays) {
		part, err := askForecasterChunk(ctx, rc, chunkSource(src, offset, n))
		if err == nil {
			internValueIDs(part.Values, ids)
			err = mergeForecastChunk(&doc, part, offset == 0)
			if err != nil {
				auditEngineFailure(rc, engines.Forecaster, err)
			}
		}
		if err != nil {
			return ForecasterEngineOutput{}, err
		}
		// room for the whole horizon after the first
		if offset == 0 && n < src.Days {
			doc.Values = slices.Grow(doc.Values, len(doc.Values)*(src.Days-n)/n)
		}
		offset += n
	}
	doc.Horizon.StartDate, doc.Horizon.Days = src.StartDate, src.Days
	return doc, nil
}

// internValueIDs: one copy of each zone id string.
func internValueIDs(values []EngineValue, ids map[string]string) {
	for i := range values {
		v := &values[i]
		if s, ok := ids[v.ZoneID]; ok {
			v.ZoneID = s
		} else {
			ids[v.ZoneID] = v.ZoneID
		}
		if s, ok := ids[v.SubZoneID]; ok {
			v.SubZoneID = s
		} else {
			ids[v.SubZoneID] = v.SubZoneID
		}
	}
}

// mergeForecastChunk adds a chunk; the first sets the rest.
func mergeForecastChunk(doc *ForecasterEngineOutput, part ForecasterEngineOutput, first bool) error {
	if first {
		*doc = part
		doc.Warnings = nil
	} else if part.ModelVersion != doc.ModelVersion || part.Engine.Version != doc.Engine.Version || part.RuleSetVersion != doc.RuleSetVersion {
		return fmt.Errorf("%w: chunks from different models", ErrEngineAnswer)
	} else {
		doc.Values = append(doc.Values, part.Values...)
		doc.Explanations = append(doc.Explanations, part.Explanations...)
	}
	seen := map[EngineWarning]bool{}
	for _, w := range doc.Warnings {
		seen[w] = true
	}
	for _, w := range part.Warnings {
		if !seen[w] {
			seen[w] = true
			doc.Warnings = append(doc.Warnings, w)
		}
	}
	return nil
}
