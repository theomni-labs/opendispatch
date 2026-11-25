// SPDX-License-Identifier: AGPL-3.0-only

// Package backtest scores engine outputs.
package backtest

import (
	"math"
	"time"
)

var loc = time.FixedZone("Asia/Riyadh", 3*3600)

const (
	SourceSynthetic = "SYNTHETIC"
	SourceImported  = "IMPORTED"
	SourceLive      = "LIVE"
	SourceMixed     = "MIXED"

	SyntheticNotice = "Synthetic data: these figures say nothing about accuracy on real cases."
)

type Case struct {
	ID           string     `json:"id"`
	DataSource   string     `json:"data_source"`
	RegisteredAt time.Time  `json:"registered_at"`
	AssignedAt   *time.Time `json:"assigned_at"`
	ArrivedAt    *time.Time `json:"arrived_at"`
	ClosedAt     *time.Time `json:"closed_at"`
	ZoneID       string     `json:"zone_id"`
	SubZoneID    string     `json:"sub_zone_id"`
	Latitude     float64    `json:"latitude"`
	Longitude    float64    `json:"longitude"`
	Handling     string     `json:"handling"`
	AgentID      string     `json:"agent_id"`
}

type Agent struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	IsActive bool   `json:"is_active"`
	Extra    struct {
		StandbyPointID string `json:"standby_point_id"`
	} `json:"extra"`
}

type Point struct{ Lat, Lon float64 }

type Dataset struct {
	Cases    []Case
	Agents   map[string]Agent
	Standby  map[string]Point
	ZoneSubs map[string][]string
	// ZoneCity: city name by zone, when known.
	ZoneCity   map[string]string
	DataSource string
	// Intervals replace Cases for the forecast when set.
	Intervals []HistoryRecord
	// RealOnly: every case is LIVE or IMPORTED.
	RealOnly bool
}

// Illustrative is true unless all data is real.
func (d *Dataset) Illustrative() bool {
	if d.RealOnly {
		return false
	}
	return d.DataSource == SourceSynthetic || d.DataSource == SourceMixed
}

func (c Case) subZone() string {
	if c.SubZoneID != "" {
		return c.SubZoneID
	}
	return c.ZoneID
}

func localDay(t time.Time) time.Time {
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, loc)
}

func addDays(t time.Time, n int) time.Time {
	t = t.In(loc)
	y, m, d := t.Date()
	return time.Date(y, m, d+n, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), loc)
}

func haversineKm(a, b Point) float64 {
	const r = 6371.0088
	rad := math.Pi / 180
	dLat := (b.Lat - a.Lat) * rad
	dLon := (b.Lon - a.Lon) * rad
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(a.Lat*rad)*math.Cos(b.Lat*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * r * math.Asin(math.Min(1, math.Sqrt(h)))
}

func travelSeconds(a, b Point, speedKmh float64) float64 {
	return haversineKm(a, b) / speedKmh * 3600
}

func round(v float64, places int) float64 {
	p := math.Pow(10, float64(places))
	return math.Round(v*p) / p
}

// SendSource is the data_source an engine request carries.
func (d *Dataset) SendSource() string {
	if d.DataSource == SourceMixed {
		if d.RealOnly {
			return SourceImported
		}
		return SourceSynthetic
	}
	return d.DataSource
}
