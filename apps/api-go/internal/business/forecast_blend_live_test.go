// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"math"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestBlendWithSegmentKeepsTotalsAndMeetsCustomersShape(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "BL", "name_en": "Blend"})
	check(t, err)
	type zs struct{ zone, a, b string }
	mk := func(name string) zs {
		z, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": name})
		check(t, err)
		a, err := CreateSubZone(ctx, conn, rc, map[string]any{"zone_id": z.ID, "name_en": name + " A", "latitude": 24.7, "longitude": 46.7})
		check(t, err)
		b, err := CreateSubZone(ctx, conn, rc, map[string]any{"zone_id": z.ID, "name_en": name + " B", "latitude": 24.7, "longitude": 46.71})
		check(t, err)
		return zs{z.ID, a.ID, b.ID}
	}
	busy, quiet := mk("Busy"), mk("Quiet")
	// 120 days before 1 Jun 2026, every case at 09:00: 60 a day, and 1 a day
	seed := func(z zs, perDay int) {
		_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			_, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, id, data_source, case_number, registered_at, zone_id, sub_zone_id, handling)
				SELECT $1, gen_random_uuid(), 'SYNTHETIC', $2 || g, TIMESTAMPTZ '2026-02-01 09:05:00+03' + (g / $3) * interval '1 day', $4, $5, 'field'
				FROM generate_series(0, 120 * $3 - 1) g`, tenantID, fmt.Sprintf("BL%d-", perDay), perDay, z.zone, z.a)
			return struct{}{}, err
		})
		check(t, err)
	}
	seed(busy, 60)
	seed(quiet, 1)
	var doc ForecasterEngineOutput
	doc.Horizon.StartDate, doc.Horizon.Days = "2026-06-01", 1
	for _, z := range []zs{busy, quiet} {
		for i := 0; i < 96; i++ {
			for _, s := range []string{z.a, z.b} {
				doc.Values = append(doc.Values, EngineValue{ZoneID: z.zone, SubZoneID: s, IntervalStart: intervalStartOf("2026-06-01", i), IntervalIndex: i,
					Low: 0, Expected: 0.5, High: 1, FieldExpected: 0.25, RemoteInferredExpected: 0.25})
			}
		}
	}
	doc.Explanations = []EngineExplanation{{ZoneID: quiet.zone, Date: "2026-06-01", Base: 50, Expected: 96,
		Drivers: []ExplanationDriver{{Driver: "weekday", Multiplier: 1}, {Driver: "model_other", Multiplier: 1.92}}}}
	check(t, blendWithSegment(ctx, conn, tenantID, &doc))
	sum := func(zone string, slot int) (day, at float64) {
		for _, v := range doc.Values {
			if v.ZoneID != zone {
				continue
			}
			day += v.Expected
			if v.IntervalIndex == slot {
				at += v.Expected
			}
			if v.Low > v.Expected || v.Expected > v.High || math.Abs(v.FieldExpected+v.RemoteInferredExpected-v.Expected) > 0.01 {
				t.Fatalf("value out of order %+v", v)
			}
		}
		return day, at
	}
	// busy: the day total stays, half of it at 09:00
	day, at9 := sum(busy.zone, 36)
	// values are rounded to 3 decimals: 192 a zone-day
	if math.Abs(day-96) > 0.1 || math.Abs(at9-48.5) > 0.01 {
		t.Fatalf("busy day %v at 09:00 %v", day, at9)
	}
	// quiet: the day total is the average with the customer's 1
	day, at9 = sum(quiet.zone, 36)
	if math.Abs(day-48.5) > 0.1 || math.Abs(at9-48.5*(0.5/96+0.5)) > 0.01 {
		t.Fatalf("quiet day %v at 09:00 %v", day, at9)
	}
	// the explanation follows the stored values
	x := doc.Explanations[0]
	if math.Abs(x.Expected-day) > 0.01 || math.Abs(x.Drivers[1].Multiplier-1.92*day/96) > 1e-3 {
		t.Fatalf("explanation %+v", x)
	}
}
