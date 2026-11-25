// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"math/rand"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
)

var placeColumns = []string{"latitude", "longitude"}

// loadPlaces: made-up spots around each sub-zone.
func loadPlaces(ctx context.Context, conn *pgx.Conn) (*backtest.Places, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, latitude, longitude FROM sub_zones WHERE latitude IS NOT NULL AND longitude IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	centres := map[string][2]float64{}
	for rows.Next() {
		var id string
		var lat, lon float64
		if err := rows.Scan(&id, &lat, &lon); err != nil {
			return nil, err
		}
		if lat != 0 || lon != 0 {
			centres[id] = [2]float64{lat, lon}
		}
	}
	return backtest.NewPlaces(centres), rows.Err()
}

// placeRows adds a SYNTHETIC position.
func placeRows(rows [][]any, places *backtest.Places, seed int64) [][]any {
	r := rand.New(rand.NewSource(seed + 1))
	for i, row := range rows {
		var lat, lon any
		at, _ := row[3].(time.Time)
		sub, _ := row[7].(string)
		if la, lo, ok := places.Point(sub, at, r); ok {
			lat, lon = la, lo
		}
		rows[i] = append(row, lat, lon)
	}
	return rows
}

// placedSource streams rows with a position.
type placedSource struct {
	*rowSource
	places *backtest.Places
	r      *rand.Rand
}

func newPlacedSource(src *rowSource, places *backtest.Places, seed int64) *placedSource {
	return &placedSource{rowSource: src, places: places, r: rand.New(rand.NewSource(seed + 1))}
}

// Values adds the SYNTHETIC position.
func (p *placedSource) Values() ([]any, error) {
	row := p.row
	var lat, lon any
	at, _ := row[3].(time.Time)
	sub, _ := row[7].(string)
	if la, lo, ok := p.places.Point(sub, at, p.r); ok {
		lat, lon = la, lo
	}
	return append(row[:len(row):len(row)], lat, lon), nil
}
