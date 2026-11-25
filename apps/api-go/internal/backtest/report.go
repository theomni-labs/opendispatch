// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Report holds aggregates only, never case rows.
type Report struct {
	DataSource   string `json:"data_source"`
	Illustrative bool   `json:"illustrative"`
	Notice       string `json:"notice"`
	// PerfectWeather: held-out days' weather was sent
	PerfectWeather bool            `json:"perfect_forecast_weather,omitempty"`
	CasesInData    int             `json:"cases_in_data"`
	Forecast       *ForecastReport `json:"forecast,omitempty"`
	Replay         *ReplayReport   `json:"assignment_replay,omitempty"`
}

func NewReport(ds *Dataset) *Report {
	r := &Report{DataSource: ds.DataSource, Illustrative: ds.Illustrative(), CasesInData: len(ds.Cases)}
	if len(ds.Cases) == 0 {
		for _, h := range ds.Intervals {
			r.CasesInData += h.Total
		}
	}
	switch {
	case ds.DataSource == SourceSynthetic:
		r.Notice = SyntheticNotice
	case ds.DataSource == SourceMixed && ds.RealOnly:
		r.Notice = "Measured on a mix of Imported sample and live data."
	case ds.DataSource == SourceMixed:
		r.Notice = "Mixed sources including synthetic cases. " + SyntheticNotice
	case ds.DataSource == SourceImported:
		r.Notice = "Measured on an Imported sample, not on live operations."
	default:
		r.Notice = "Measured on live data."
	}
	return r
}

func (r *Report) JSON() ([]byte, error) { return json.MarshalIndent(r, "", "  ") }

func pct(v float64) string { return fmt.Sprintf("%.1f%%", v*100) }

func wape(m Metrics) string {
	if m.WAPE == nil {
		return "n/a"
	}
	return pct(*m.WAPE)
}

func wapeP(v *float64) string {
	if v == nil {
		return "n/a"
	}
	return pct(*v)
}

func (r *Report) Text() string {
	var b strings.Builder
	w := func(f string, a ...any) { fmt.Fprintf(&b, f+"\n", a...) }
	w("OpenDispatch backtest report")
	w("data_source: %s", r.DataSource)
	w("illustrative: %t", r.Illustrative)
	w("%s", r.Notice)
	w("cases in data: %d", r.CasesInData)
	if f := r.Forecast; f != nil {
		w("")
		w("FORECAST, rolling origin, %s", f.Level)
		if r.Illustrative {
			w("ILLUSTRATIVE: these figures are not a measured accuracy.")
		}
		w("origins: %d (%s to %s), horizon %d day(s), min history %d day(s)", f.Origins, f.FirstOrigin, f.LastOrigin, f.HorizonDays, f.MinHistoryDays)
		w("range target: %s. %s", pct(f.RangeTarget), f.RangeNote)
		arms := []ForecastArm{f.Baseline}
		if f.Candidate != nil {
			arms = append([]ForecastArm{*f.Candidate}, arms...)
		}
		if f.CandidateMedian != nil {
			arms = append([]ForecastArm{arms[0], *f.CandidateMedian}, arms[1:]...)
		}
		if f.SegmentBaseline != nil {
			arms = append(arms, *f.SegmentBaseline)
		}
		for _, a := range arms {
			m := a.Overall
			w("  %-40s cells %d  MAE %.3f  RMSE %.3f  WAPE %s  range coverage %s", a.Name, m.Cells, m.MAE, m.RMSE, wape(m), pct(m.Coverage))
		}
		if b := f.Blend; b != nil {
			w("candidate blended with the customer's segment average: engine share of the shape %.2f, small zones under %.0f cases a day; %s", b.Share, b.SmallZone, f.BlendNote)
		}
		w("held out: %s to %s, %d day(s), %d event day(s); %d day(s) of history before the first origin, %d in all", f.HeldOut.From, f.HeldOut.To, f.HeldOut.Days, f.HeldOut.EventDays, f.HeldOut.TrainingDays, f.HeldOut.DataDays)
		if f.ModelVersion != "" {
			w("model version: %s", f.ModelVersion)
		}
		if f.MaxRequestBytes > 0 {
			w("largest request to the engine: %d bytes raw, %d bytes sent", f.MaxRequestBytes, f.MaxWireBytes)
		}
		if c := f.Calls; c != nil {
			w("engine calls: %d, mean %.1f ms and max %.1f ms; up to %d record(s) sent; %d trimmed to the cap; history asked up to %d day(s), sent from %d day(s)", c.Requests, c.MeanMs, c.MaxMs, c.MaxRecords, c.TrimmedRequests, c.HistoryDaysAsked, c.HistoryDaysSentMin)
			if c.MaxAggregated > 0 {
				w("older history as totals: up to %d aggregated record(s) sent", c.MaxAggregated)
			}
		}
		if mi := f.ModelInfo; mi != nil {
			w("model info: feature set [%s], training %s to %s, %d history day(s)", strings.Join(mi.FeatureSet, ", "), mi.TrainingStart, mi.TrainingEnd, mi.HistoryDays)
		}
		for _, a := range arms {
			w("  event days vs ordinary days, %s: WAPE %s (%d cells) vs %s (%d cells)", a.Name, wape(a.EventDays), a.EventDays.Cells, wape(a.OrdinaryDays), a.OrdinaryDays.Cells)
		}
		if g := f.Gate; g != nil {
			w("")
			w("GATE (candidate against baseline): %s", strings.ToUpper(g.Result))
			w("  needs WAPE at least %s lower than the baseline and worse in at most %s of zones", pct(g.MinImprovement), pct(g.MaxWorseZoneShare))
			for _, why := range g.Reasons {
				w("  %s", why)
			}
			if g.BaselineName != "" {
				w("  compared with: %s", g.BaselineName)
			}
			if g.Point == GatePointMedian {
				w("  candidate scored by its median per zone-hour (the point of least absolute error, %s)", MedianNote)
			}
			if g.ImprovementOverNaive != nil {
				w("  engine WAPE improvement over naive: %s", pct(*g.ImprovementOverNaive))
			}
			if g.ImprovementOverSegment != nil {
				w("  engine WAPE improvement over segment-average (the customer's method): %s", pct(*g.ImprovementOverSegment))
			}
		}
		if f.SpecCheck != nil || f.Baseline.MAPE != nil {
			mapeText(w, f, arms)
		}
		if len(f.Staffing) > 0 {
			w("")
			w("STAFFING CONSEQUENCE (each method's needed staff against the actual cases' needed staff)")
			w("  %s", f.StaffingNote)
			for _, s := range f.Staffing {
				w("  %-40s windows %d  under %s  over %s  exact %s  needed staff-windows: actual %d, method %d", s.Name, s.Windows, wapeP(s.UnderShare), wapeP(s.OverShare), wapeP(s.ExactShare), s.NeededActual, s.NeededMethod)
			}
		}
		if len(f.StaffingHalfHour) > 0 {
			w("STAFFING CONSEQUENCE AT THE HALF-HOUR GRAIN, all zones together")
			w("  %s", f.StaffingHalfHourNote)
			for _, s := range f.StaffingHalfHour {
				w("  %-40s windows %d  under %s  over %s  exact %s  needed staff-windows: actual %d, method %d", s.Name, s.Windows, wapeP(s.UnderShare), wapeP(s.OverShare), wapeP(s.ExactShare), s.NeededActual, s.NeededMethod)
			}
		}
		if f.Baseline.Grains != nil {
			w("")
			w("GRAIN, WAPE at 15 minutes against 30 minutes (zone cells); the gate above is judged at %s", f.Level)
			for _, a := range arms {
				if g := a.Grains; g != nil {
					w("  %-40s 15-minute WAPE %s (%d cells)  half-hour WAPE %s (%d cells)  half-hour bias %.3f", a.Name, wapeP(g.Quarter.WAPE), g.Quarter.Cells, wapeP(g.HalfHour.WAPE), g.HalfHour.Cells, g.HalfHour.Bias)
				}
			}
			w("BY HALF-HOUR WINDOW (06:00 to 05:30), window WAPE / MAE / RMSE / bias. %s", f.HalfHourNote)
			for _, a := range arms {
				w("  %s", a.Name)
				for _, h := range a.ByHalfHour {
					w("    %s  WAPE %s  MAE %.3f  RMSE %.3f  bias %+.3f", h.Window, wapeP(h.WAPE), h.MAE, h.RMSE, h.Bias)
				}
			}
		}
		if f.SplitNote != "" {
			w("")
			w("FIELD AND REMOTE SPLIT. %s", f.SplitNote)
			for _, a := range arms {
				sp := a.Split
				if sp == nil {
					continue
				}
				w("  %-40s field WAPE: 15-minute %s, half-hour %s | remote WAPE: 15-minute %s, half-hour %s", a.Name, wapeP(sp.Field.Quarter.WAPE), wapeP(sp.Field.HalfHour.WAPE), wapeP(sp.Remote.Quarter.WAPE), wapeP(sp.Remote.HalfHour.WAPE))
				o := sp.ShareOverall
				w("  %-40s field share overall: forecast %s, actual %s, MAE %.2f points, bias %+.2f points (%d zone-days)", "", wapeP(o.ForecastShare), wapeP(o.ActualShare), o.MAEPoints, o.BiasPoints, o.Days)
				for _, z := range sp.ShareByZone {
					w("    zone %s  forecast share %s  actual %s  MAE %.2f points  bias %+.2f points (%d zone-days)", z.ZoneID, wapeP(z.ForecastShare), wapeP(z.ActualShare), z.MAEPoints, z.BiasPoints, z.Days)
				}
			}
		}
		if wk := f.Weakest; wk != nil {
			w("")
			w("WEAKEST %d zones by WAPE (%s); baseline WAPE alongside", wk.N, wk.Arm)
			for _, l := range wk.Zones {
				w("  zone %s  WAPE %s  MAE %.3f  RMSE %.3f  actual %.0f  baseline %s", l.ZoneID, wapeP(l.WAPE), l.MAE, l.RMSE, l.ActualTotal, wapeP(l.BaselineWAPE))
			}
			w("WEAKEST %d zone-hours by WAPE (%s)", wk.N, wk.Arm)
			for _, l := range wk.ZoneHours {
				w("  zone %s hour %02d  WAPE %s  MAE %.3f  RMSE %.3f  actual %.0f  baseline %s", l.ZoneID, *l.Hour, wapeP(l.WAPE), l.MAE, l.RMSE, l.ActualTotal, wapeP(l.BaselineWAPE))
			}
			if wk.Unscored > 0 {
				w("  %d location(s) had no actual cases in the held-out period and have no WAPE", wk.Unscored)
			}
		}
		for _, a := range arms {
			w("BY HOUR OF DAY, %s (WAPE)", a.Name)
			var row []string
			for _, h := range a.ByHour {
				row = append(row, fmt.Sprintf("%02d:%s", h.Hour, wape(h.Metrics)))
			}
			w("  %s", strings.Join(row, " "))
		}
		for _, a := range arms {
			w("BY ZONE, %s", a.Name)
			for _, z := range a.ByZone {
				w("  zone %s  cells %d  MAE %.3f  RMSE %.3f  WAPE %s", z.ZoneID, z.Cells, z.MAE, z.RMSE, wape(z.Metrics))
			}
		}
		w("(the per zone and hour table is in the JSON report)")
		for _, warn := range f.Warnings {
			w("WARNING: %s", warn)
		}
	}
	if p := r.Replay; p != nil {
		w("")
		w("ASSIGNMENT REPLAY, %d case(s) over %d day(s) (%s to %s), %d skipped", p.CasesReplayed, p.Days, p.FirstDay, p.LastDay, p.CasesSkipped)
		w("straight line at %.0f km/h, duty window %.1f h. Primary 10-minute clock: %s. %s", p.SpeedKmh, p.DutyWindowHours, p.PrimaryClock, p.ClockNote)
		for _, a := range p.Arms {
			w("  %-28s %-9s from assignment: mean %.0fs, within 10 min %s | from registration: mean %.0fs, within 10 min %s",
				a.Name, a.Kind, a.FromAssignment.MeanSec, pct(a.FromAssignment.WithinTenMin), a.FromRegistration.MeanSec, pct(a.FromRegistration.WithinTenMin))
		}
		for _, a := range p.Agreement {
			w("  %-28s same agent as Customer %s, shorter travel %s, mean delta %.0fs", a.Name, pct(a.SameAsCustomer), pct(a.ShorterThanCustomer), a.MeanDeltaSec)
		}
		for _, d := range p.Decision {
			w("  %-28s decision ms: p50 %.3f p95 %.3f max %.3f; within %d ms %s; within operator fallback %d ms %s",
				d.Name, d.P50Ms, d.P95Ms, d.MaxMs, d.DeadlineMs, pct(d.WithinDeadline), d.FallbackMs, pct(d.WithinFallback))
		}
	}
	return b.String()
}

func mapeCell(m MAPEMetrics) string {
	return fmt.Sprintf("MAPE %s  WAPE %s  (cells %d, %d with actual 0 excluded)", wapeP(m.MAPE), wapeP(m.WAPE), m.Cells, m.Excluded)
}

// mapeText writes the spec check and MAPE tables.
func mapeText(w func(string, ...any), f *ForecastReport, arms []ForecastArm) {
	w("")
	if s := f.SpecCheck; s != nil {
		w("SPEC CHECK (informational, not the gate): %s", s.Line())
	}
	w("MAPE WITH WAPE BESIDE IT. %s", f.MAPENote)
	for _, a := range arms {
		if m := a.MAPE; m != nil {
			w("  %-40s zone x day: %s", a.Name, mapeCell(m.ZoneDay))
			w("  %-40s zone x hour: %s", "", mapeCell(m.ZoneHour))
		}
	}
	w("MAPE BY HOUR OF DAY (zone x hour cells, all zones and days)")
	for _, a := range arms {
		if m := a.MAPE; m != nil {
			w("  %s", a.Name)
			for _, r := range m.ByHour {
				w("    %02d  %s", *r.Hour, mapeCell(r.MAPEMetrics))
			}
		}
	}
	w("MAPE BY DAY OF WEEK (zone x day cells, all zones)")
	for _, a := range arms {
		if m := a.MAPE; m != nil {
			w("  %s", a.Name)
			for _, r := range m.ByDayOfWeek {
				w("    %s  %s", r.DayOfWeek, mapeCell(r.MAPEMetrics))
			}
		}
	}
	w("MAPE BY ZONE (dispatch center; zone x day cells)")
	for _, a := range arms {
		if m := a.MAPE; m != nil {
			w("  %s", a.Name)
			for _, r := range m.ByZone {
				w("    zone %s  %s", r.ZoneID, mapeCell(r.MAPEMetrics))
			}
		}
	}
	w("(MAPE per zone and hour of day, and per zone and day of week, is in the JSON report)")
}

// WriteFiles writes report.json and report.txt.
func (r *Report) WriteFiles(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	j, err := r.JSON()
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "report.json"), j, 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "report.txt"), []byte(r.Text()), 0o644)
}
