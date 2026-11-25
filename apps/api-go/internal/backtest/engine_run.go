// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"
)

// tooShort is the report when no origin can be scored.
func tooShort(ds *Dataset, cfg ForecastConfig) *ForecastReport {
	hist := ds.Intervals
	if hist == nil {
		hist = buildHistory(ds.Cases)
	}
	days := map[int64]time.Time{}
	for _, h := range hist {
		d := localDay(h.Start)
		days[d.Unix()] = d
	}
	var list []time.Time
	for _, d := range days {
		list = append(list, d)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Before(list[j]) })
	empty := func(name string) ForecastArm {
		return ForecastArm{Name: name, ByZone: []ZoneMetrics{}, ByHour: []HourMetrics{}, ByZoneHour: []ZoneHourMetrics{}}
	}
	rep := &ForecastReport{Level: "zone x hour", HorizonDays: cfg.Horizon, MinHistoryDays: cfg.MinHistoryDays, RangeTarget: cfg.Coverage,
		Baseline: empty("seasonal-naive-same-hour-last-week"), Candidate: &ForecastArm{}, Warnings: []string{}}
	*rep.Candidate = empty(cfg.CandidateName)
	n := len(list)
	if n > 0 {
		rep.HeldOut.DataDays = dayCount(list[0], list[n-1])
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("Only %d day(s) of history, under 52 weeks: Ramadan, Eid and other yearly effects cannot be judged.", rep.HeldOut.DataDays))
	}
	rep.Gate = &Gate{Result: GateNotEnoughHistory, Reasons: []string{fmt.Sprintf("%d day(s) of case history; at least %d (8 weeks) before the held-out days are needed", n, MinTrainingDays)}}
	if cfg.Gate != nil {
		rep.Gate.MinImprovement, rep.Gate.MaxWorseZoneShare = cfg.Gate.MinImprovement, cfg.Gate.MaxWorseZoneShare
	}
	rep.Warnings = append(rep.Warnings, "Not enough history for a verdict: "+rep.Gate.Reasons[0]+".")
	return rep
}

// RunEngine scores a forecaster engine against the baseline.
func RunEngine(ctx context.Context, ds *Dataset, e Caller, o EngineOptions, cfg ForecastConfig) (*ForecastReport, error) {
	if o.ZoneCity == nil {
		o.ZoneCity = ds.ZoneCity
	}
	cand := NewEngineCandidate(e, o)
	cfg.Candidate = cand.Forecast
	if cfg.CandidateName == "" {
		cfg.CandidateName = "forecaster-engine"
	}
	rep, err := RunForecast(ctx, ds, cfg)
	if errors.Is(err, ErrNoOrigin) {
		return tooShort(ds, cfg), nil
	}
	if err != nil {
		return nil, err
	}
	m := cand.Meta()
	if m.Requests > 0 {
		ms := func(d time.Duration) float64 { return round(float64(d)/float64(time.Millisecond), 1) }
		rep.Calls = &EngineCalls{Requests: m.Requests, MeanMs: ms(m.CallTotal / time.Duration(m.Requests)), MaxMs: ms(m.CallMax),
			MaxRecords: m.MaxRecords, MaxAggregated: m.MaxAggregated, TrimmedRequests: m.TrimmedRequests, HistoryDaysAsked: m.MaxSpanDays, HistoryDaysSentMin: m.MinSpanSent}
	}
	rep.ModelVersion, rep.ModelInfo, rep.MaxRequestBytes = m.ModelVersion, m.ModelInfo, m.MaxRequestBytes
	rep.MaxWireBytes = m.MaxWireBytes
	if m.ModelVersion != "" {
		rep.Candidate.Name = cfg.CandidateName + " " + m.ModelVersion
		if rep.Weakest != nil && rep.Weakest.Arm == cfg.CandidateName {
			rep.Weakest.Arm = rep.Candidate.Name
		}
		if c := rep.CandidateMedian; c != nil {
			if rep.Weakest != nil && rep.Weakest.Arm == c.Name {
				rep.Weakest.Arm = rep.Candidate.Name + " (median)"
			}
			c.Name = rep.Candidate.Name + " (median)"
		}
		if rep.SpecCheck != nil {
			rep.SpecCheck.Arm = rep.Candidate.Name
		}
	}
	return rep, nil
}
