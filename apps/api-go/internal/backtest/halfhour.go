// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"fmt"
	"math"
	"time"
)

const (
	halfWindows   = 48
	windowStartHM = 6 * 60
)

// HalfHourNote: how the grain is built
const HalfHourNote = "half-hour cell = zone x 30-minute window, the sum of two 15-minute cells; windows run 06:00 to 05:30 the next day (Asia/Riyadh); bias = forecast minus actual, per cell"

// StaffingHalfHourNote: the all-zone table
const StaffingHalfHourNote = "needed staff = ceil of the all-zone cases per 30-minute window of the day, for each day scored; the zone table above (also half-hour) and the 15-minute cells stay"

// HalfHourMetrics: one 30-minute window
type HalfHourMetrics struct {
	Window      string   `json:"window"`
	Cells       int      `json:"cells"`
	MAE         float64  `json:"mae"`
	RMSE        float64  `json:"rmse"`
	WAPE        *float64 `json:"wape"`
	Bias        float64  `json:"bias"`
	ActualTotal float64  `json:"actual_total"`
}

// GrainMetrics scores one grain over all cells.
type GrainMetrics struct {
	Cells       int      `json:"cells"`
	MAE         float64  `json:"mae"`
	RMSE        float64  `json:"rmse"`
	WAPE        *float64 `json:"wape"`
	Bias        float64  `json:"bias"`
	ActualTotal float64  `json:"actual_total"`
}

// Grains: 15-minute next to half-hour
type Grains struct {
	Quarter  GrainMetrics `json:"quarter_hour"`
	HalfHour GrainMetrics `json:"half_hour"`
}

type gacc struct {
	n                  int
	abs, sq, act, bias float64
}

func (g *gacc) add(forecast, actual float64) {
	g.n++
	g.abs += math.Abs(forecast - actual)
	g.sq += (forecast - actual) * (forecast - actual)
	g.act += actual
	g.bias += forecast - actual
}

func (g *gacc) grain() GrainMetrics {
	m := GrainMetrics{Cells: g.n, ActualTotal: round(g.act, 2)}
	if g.n == 0 {
		return m
	}
	m.MAE = round(g.abs/float64(g.n), 4)
	m.RMSE = round(math.Sqrt(g.sq/float64(g.n)), 4)
	m.Bias = round(g.bias/float64(g.n), 4)
	if g.act > 0 {
		w := round(g.abs/g.act, 4)
		m.WAPE = &w
	}
	return m
}

// halfWindow: index 0..47, 06:00 first
func halfWindow(t time.Time) int {
	lt := t.In(loc)
	m := lt.Hour()*60 + lt.Minute()
	return ((m - windowStartHM + 1440) % 1440) / 30
}

// halfLabel is the HH:MM start of a window.
func halfLabel(w int) string {
	m := (windowStartHM + 30*w) % 1440
	return fmt.Sprintf("%02d:%02d", m/60, m%60)
}

type grainAcc struct {
	quarter, half gacc
	byWindow      [halfWindows]gacc
}

func (g *grainAcc) addQuarter(forecast, actual float64) { g.quarter.add(forecast, actual) }

func (g *grainAcc) addHalf(t time.Time, forecast, actual float64) {
	g.half.add(forecast, actual)
	g.byWindow[halfWindow(t)].add(forecast, actual)
}

func (g *grainAcc) grains() *Grains {
	return &Grains{Quarter: g.quarter.grain(), HalfHour: g.half.grain()}
}

func (g *grainAcc) windows() []HalfHourMetrics {
	out := make([]HalfHourMetrics, 0, halfWindows)
	for w := 0; w < halfWindows; w++ {
		m := g.byWindow[w].grain()
		out = append(out, HalfHourMetrics{Window: halfLabel(w), Cells: m.Cells, MAE: m.MAE, RMSE: m.RMSE, WAPE: m.WAPE, Bias: m.Bias, ActualTotal: m.ActualTotal})
	}
	return out
}

// sumAt sums expected values per cell
func sumAt(vs []ForecastValue, from, to time.Time, step time.Duration) map[halfCell]float64 {
	m := map[halfCell]float64{}
	for _, v := range vs {
		if !v.Start.Before(from) && v.Start.Before(to) {
			m[halfCell{v.ZoneID, v.Start.Truncate(step).Unix()}] += v.Expected
		}
	}
	return m
}

type halfCell struct {
	zone string
	t    int64
}
