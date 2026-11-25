// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

const (
	marker      = `{"demo_history": true}`
	termsUntil  = "2026-12-16"
	termName    = "ASSUMPTION (demo): illustrative school term"
	breakPrefix = "ASSUMPTION (demo): "
)

var riyadh = time.FixedZone("Asia/Riyadh", 3*3600)

var columns = []string{"tenant_id", "data_source", "case_number", "registered_at", "closed_at", "city_id", "zone_id", "sub_zone_id", "handling", "channel", "extra"}

// copyColumns: every column COPY writes, in order.
func copyColumns() []string {
	out := append(append([]string(nil), columns...), caseFieldColumns...)
	return append(out, placeColumns...)
}

// demoBreaks are made up (ASSUMPTION).
func demoBreaks() []forecastcal.Range {
	bs := backtest.DefaultSchoolBreaks()
	for i := range bs {
		bs[i].Name = breakPrefix + bs[i].Name
	}
	return bs
}

// rowSource streams case rows to COPY.
type rowSource struct {
	ivs            []backtest.HistoryRecord
	tenant         string
	zoneOf, cityOf map[string]string
	r              *rand.Rand
	counter        map[string]int
	fields         *backtest.CaseMix
	i, k, n        int
	row            []any
}

func newRowSource(res *backtest.LongResult, tenant string, zoneOf, cityOf map[string]string, fields *backtest.CaseMix, seed int64) *rowSource {
	return &rowSource{ivs: res.Dataset.Intervals, tenant: tenant, zoneOf: zoneOf, cityOf: cityOf, fields: fields, r: rand.New(rand.NewSource(seed)), counter: map[string]int{}}
}

// Next makes the next case row.
func (s *rowSource) Next() bool {
	for s.i < len(s.ivs) {
		iv := s.ivs[s.i]
		if s.k >= iv.Total {
			s.i, s.k = s.i+1, 0
			continue
		}
		zone := s.zoneOf[iv.SubZoneID]
		var city any
		if c := s.cityOf[zone]; c != "" {
			city = c
		}
		at := iv.Start.Add(time.Duration(s.r.Intn(900)) * time.Second)
		day := at.In(riyadh).Format("060102")
		s.counter[day]++
		handling := "remote_inferred"
		if s.k < iv.Field {
			handling = "field"
		}
		channel := "app"
		switch x := s.r.Float64(); {
		case x >= 0.85:
			channel = "whatsapp"
		case x >= 0.50:
			channel = "phone"
		}
		number := fmt.Sprintf("HS-%s-%05d", day, s.counter[day])
		s.row = []any{s.tenant, "SYNTHETIC", number, at, at.Add(45 * time.Minute),
			city, zone, iv.SubZoneID, handling, channel, marker,
			"SYN-" + number, s.fields.Type(handling == "field", s.r), backtest.Parties(s.r)}
		s.k++
		s.n++
		return true
	}
	return false
}

func (s *rowSource) Values() ([]any, error) { return s.row, nil }

func (s *rowSource) Err() error { return nil }

// buildRows expands counts to case rows.
func buildRows(res *backtest.LongResult, tenant string, zoneOf, cityOf map[string]string, fields *backtest.CaseMix, seed int64) [][]any {
	src := newRowSource(res, tenant, zoneOf, cityOf, fields, seed)
	var rows [][]any
	for src.Next() {
		rows = append(rows, src.row)
	}
	return rows
}

func oneTenant(ctx context.Context, conn *pgx.Conn) (string, error) {
	rows, err := conn.Query(ctx, `SELECT DISTINCT tenant_id::text FROM zones`)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var tenants []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return "", err
		}
		tenants = append(tenants, t)
	}
	if len(tenants) != 1 {
		return "", fmt.Errorf("expected one customer in the demo database, found %d", len(tenants))
	}
	return tenants[0], rows.Err()
}

// loadBase reads the fixture cases.
func loadBase(ctx context.Context, conn *pgx.Conn, cutoff time.Time) (*backtest.Dataset, map[string]string, map[string]string, error) {
	base := &backtest.Dataset{ZoneSubs: map[string][]string{}, ZoneCity: map[string]string{}, DataSource: backtest.SourceSynthetic}
	cs, err := conn.Query(ctx, `SELECT id::text, registered_at, zone_id::text, sub_zone_id::text, handling FROM cases
		WHERE data_source = 'SYNTHETIC' AND zone_id IS NOT NULL AND sub_zone_id IS NOT NULL AND registered_at < $1 ORDER BY registered_at`, cutoff)
	if err != nil {
		return nil, nil, nil, err
	}
	for cs.Next() {
		var c backtest.Case
		if err := cs.Scan(&c.ID, &c.RegisteredAt, &c.ZoneID, &c.SubZoneID, &c.Handling); err != nil {
			cs.Close()
			return nil, nil, nil, err
		}
		c.DataSource = backtest.SourceSynthetic
		base.Cases = append(base.Cases, c)
	}
	cs.Close()
	if len(base.Cases) == 0 {
		return nil, nil, nil, errors.New("no fixture cases to calibrate from: load the fixtures first")
	}
	zoneOf, cityOf := map[string]string{}, map[string]string{}
	zr, err := conn.Query(ctx, `SELECT s.id::text, s.zone_id::text, coalesce(z.city_id::text, ''), coalesce(c.name_en, '') FROM sub_zones s
		JOIN zones z ON z.tenant_id = s.tenant_id AND z.id = s.zone_id
		LEFT JOIN cities c ON c.tenant_id = z.tenant_id AND c.id = z.city_id ORDER BY s.id`)
	if err != nil {
		return nil, nil, nil, err
	}
	defer zr.Close()
	for zr.Next() {
		var sub, zone, city, cityName string
		if err := zr.Scan(&sub, &zone, &city, &cityName); err != nil {
			return nil, nil, nil, err
		}
		zoneOf[sub] = zone
		if cityName != "" {
			base.ZoneCity[zone] = cityName
		}
		if city != "" {
			cityOf[zone] = city
		}
		base.ZoneSubs[zone] = append(base.ZoneSubs[zone], sub)
	}
	return base, zoneOf, cityOf, zr.Err()
}

func putSetting(ctx context.Context, conn *pgx.Conn, tenant, key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	var plain any
	if err := json.Unmarshal(b, &plain); err != nil {
		return err
	}
	if err := forecastcal.ValidateSetting(key, plain); err != nil {
		return err
	}
	_, err = conn.Exec(ctx, `INSERT INTO settings (tenant_id, data_source, key, value) VALUES ($1::uuid, 'SYNTHETIC', $2, $3)
		ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, tenant, key, string(b))
	return err
}

// Run loads the history and settings.
func Run(ctx context.Context, conn *pgx.Conn, weeks int, seed int64) (int, string, string, error) {
	tenant, err := oneTenant(ctx, conn)
	if err != nil {
		return 0, "", "", err
	}
	today := "2026-09-13"
	var raw string
	if conn.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'demo.today'`).Scan(&raw) == nil {
		_ = json.Unmarshal([]byte(raw), &today)
	}
	cutoff, err := time.ParseInLocation("2006-01-02", today, riyadh)
	if err != nil {
		return 0, "", "", err
	}
	if _, err := conn.Exec(ctx, `DELETE FROM cases WHERE extra @> $1::jsonb`, marker); err != nil {
		return 0, "", "", err
	}
	base, zoneOf, cityOf, err := loadBase(ctx, conn, cutoff)
	if err != nil {
		return 0, "", "", err
	}
	first := base.Cases[0].RegisteredAt.In(riyadh)
	end := time.Date(first.Year(), first.Month(), first.Day()-1, 0, 0, 0, 0, riyadh)
	eff := backtest.DefaultEffects()
	vol := 1 / (1 + eff.TrendPerYear*float64(weeks*7-1)/364)
	breaks := demoBreaks()
	res, err := backtest.GenerateLong(base, backtest.LongOptions{Weeks: weeks, Seed: seed, End: end.Format("2006-01-02"),
		Volume: vol, Effects: &eff, SchoolBreaks: breaks, PaydayDay: forecastcal.DefaultPaydayDay,
		Weather: true, Traffic: true})
	if err != nil {
		return 0, "", "", err
	}
	places, err := loadPlaces(ctx, conn)
	if err != nil {
		return 0, "", "", err
	}
	typeIDs, err := loadCaseTypes(ctx, conn)
	if err != nil {
		return 0, "", "", err
	}
	fields, err := backtest.NewCaseMix(typeIDs)
	if err != nil {
		return 0, "", "", err
	}
	src := newPlacedSource(newRowSource(res, tenant, zoneOf, cityOf, fields, seed), places, seed)
	if _, err := conn.CopyFrom(ctx, pgx.Identifier{"cases"}, copyColumns(), src); err != nil {
		return 0, "", "", err
	}
	if err := checkRequired(ctx, conn); err != nil {
		return 0, "", "", err
	}
	historyStart, err := time.ParseInLocation("2006-01-02", res.First, riyadh)
	if err != nil {
		return 0, "", "", err
	}
	caseWeek := time.Date(first.Year(), first.Month(), first.Day(), 0, 0, 0, 0, riyadh)
	wf, err := loadWorkforce(ctx, conn, tenant, cutoff, historyStart, caseWeek, seed)
	if err != nil {
		return 0, "", "", fmt.Errorf("workforce history: %w", err)
	}
	fmt.Printf("Workforce history: %d zone-months of sick days, %d attendance spans, %d history field cases given an agent and times (SYNTHETIC)\n", wf.SickMonths, wf.Spans, wf.TimedCases)
	terms := backtest.SchoolTerms(res.First, termsUntil, breaks)
	for i := range terms {
		terms[i].Name = termName
	}
	if err := putSetting(ctx, conn, tenant, forecastcal.KeyPaydayDay, forecastcal.DefaultPaydayDay); err != nil {
		return 0, "", "", err
	}
	if err := putSetting(ctx, conn, tenant, forecastcal.KeySchoolTerms, terms); err != nil {
		return 0, "", "", err
	}
	return src.n, res.First, res.Last, nil
}
