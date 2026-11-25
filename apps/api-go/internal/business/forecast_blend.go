// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// forecastBlend: nil when the engine's forecast is kept whole.
func forecastBlend(ctx context.Context, tenant string) *backtest.ShapeBlend {
	b := backtest.ShapeBlend{
		Share:     readSetting(ctx, tenant, forecastcal.KeyShapeShare, backtest.DefaultShapeShare),
		SmallZone: readSetting(ctx, tenant, forecastcal.KeySmallZone, backtest.DefaultSmallZone),
		DayTypes:  readSetting(ctx, tenant, forecastcal.KeyDayTypes, true),
	}
	if b.Share < 0 || b.Share > 1 {
		b.Share = backtest.DefaultShapeShare
	}
	if b.Share >= 1 && b.SmallZone <= 0 && !b.DayTypes {
		return nil
	}
	return &b
}

// segmentProfile sums cases by zone, the customer segment and slot.
func segmentProfile(ctx context.Context, conn *tenancy.Connection, tenant string, zoneIDs []string, from, origin time.Time, seg backtest.Segmenter) (backtest.SegmentProfile, map[string]float64, error) {
	p := backtest.SegmentProfile{Sums: map[string]map[string]*[96]float64{}}
	var dates, labels []string
	for d := from; d.Before(origin); d = d.AddDate(0, 0, 1) {
		ds := d.Format("2006-01-02")
		dates, labels = append(dates, ds), append(labels, seg(ds))
	}
	vol := map[string]float64{}
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		var first *time.Time
		if err := tx.QueryRow(ctx, `SELECT min(registered_at) FROM cases
			WHERE zone_id = ANY($1::uuid[]) AND sub_zone_id IS NOT NULL AND registered_at >= $2 AND registered_at < $3`,
			zoneIDs, from, origin).Scan(&first); err != nil || first == nil {
			return struct{}{}, err
		}
		day := first.In(origin.Location())
		p.First = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, origin.Location())
		rows, err := tx.Query(ctx, `WITH lab AS (SELECT t.d::date AS d, t.l FROM unnest($4::text[], $5::text[]) AS t(d, l)),
			c AS (SELECT zone_id, registered_at AT TIME ZONE 'Asia/Riyadh' AS lt FROM cases
				WHERE zone_id = ANY($1::uuid[]) AND sub_zone_id IS NOT NULL AND registered_at >= $2 AND registered_at < $3)
			SELECT c.zone_id::text, lab.l, (extract(hour FROM c.lt) * 4 + floor(extract(minute FROM c.lt) / 15))::int, count(*)
			FROM c JOIN lab ON lab.d = c.lt::date GROUP BY 1, 2, 3`, zoneIDs, from, origin, dates, labels)
		if err != nil {
			return struct{}{}, err
		}
		defer rows.Close()
		for rows.Next() {
			var z, l string
			var slot int
			var n float64
			if err := rows.Scan(&z, &l, &slot, &n); err != nil {
				return struct{}{}, err
			}
			if slot < 0 || slot >= 96 {
				continue
			}
			if p.Sums[z] == nil {
				p.Sums[z] = map[string]*[96]float64{}
			}
			if p.Sums[z][l] == nil {
				p.Sums[z][l] = &[96]float64{}
			}
			p.Sums[z][l][slot] += n
		}
		if err := rows.Err(); err != nil {
			return struct{}{}, err
		}
		rows.Close()
		// zone volume over the last 84 days
		since := origin.AddDate(0, 0, -backtest.SmallZoneDays)
		if p.First.After(since) {
			since = p.First
		}
		days := origin.Sub(since).Hours() / 24
		if days < 1 {
			return struct{}{}, nil
		}
		vr, err := tx.Query(ctx, `SELECT zone_id::text, count(*) FROM cases
			WHERE zone_id = ANY($1::uuid[]) AND sub_zone_id IS NOT NULL AND registered_at >= $2 AND registered_at < $3 GROUP BY 1`,
			zoneIDs, since, origin)
		if err != nil {
			return struct{}{}, err
		}
		defer vr.Close()
		for vr.Next() {
			var z string
			var n float64
			if err := vr.Scan(&z, &n); err != nil {
				return struct{}{}, err
			}
			vol[z] = n / days
		}
		return struct{}{}, vr.Err()
	})
	return p, vol, err
}

// blendWithSegment: the engine meets the customer's segment shape.
func blendWithSegment(ctx context.Context, conn *tenancy.Connection, tenant string, doc *ForecasterEngineOutput) error {
	o := forecastBlend(ctx, tenant)
	if o == nil || conn == nil || len(doc.Values) == 0 {
		return nil
	}
	origin, err := riyadhMidnight(doc.Horizon.StartDate)
	if err != nil {
		return fmt.Errorf("horizon start: %w", err)
	}
	ev := make([]backtest.ForecastValue, len(doc.Values))
	zoneSet := map[string]bool{}
	for i, v := range doc.Values {
		t, err := time.Parse(time.RFC3339, v.IntervalStart)
		if err != nil {
			return fmt.Errorf("interval start: %w", err)
		}
		ev[i] = backtest.ForecastValue{ZoneID: v.ZoneID, SubZoneID: v.SubZoneID, Start: t, Low: v.Low, Expected: v.Expected, High: v.High, Field: v.FieldExpected, HasField: true}
		zoneSet[v.ZoneID] = true
	}
	zones := make([]string, 0, len(zoneSet))
	for z := range zoneSet {
		zones = append(zones, z)
	}
	sort.Strings(zones)
	cal := forecastCalendarConfig(ctx, tenant)
	seg := backtest.SegmentFromCalendar(cal)
	if o.DayTypes {
		seg = backtest.DayTypes(seg, cal)
	}
	years := max(forecastHistorySettings(ctx, tenant).Years, 1)
	p, vol, err := segmentProfile(ctx, conn, tenant, zones, origin.AddDate(-years, 0, 0), origin, seg)
	if err != nil {
		return fmt.Errorf("segment profile: %w", err)
	}
	if p.First.IsZero() {
		return nil
	}
	small := map[string]bool{}
	for _, z := range zones {
		small[z] = o.SmallZone > 0 && vol[z] < o.SmallZone
	}
	type zd struct{ zone, date string }
	before, after := map[zd]float64{}, map[zd]float64{}
	out := backtest.BlendDays(ev, p.Days(origin, doc.Horizon.Days, zones, seg), small, o.Shares(cal, seg, origin))
	for i, v := range out {
		d := &doc.Values[i]
		k := zd{d.ZoneID, d.IntervalStart[:10]}
		before[k] += d.Expected
		e := round3(v.Expected)
		f := math.Min(round3(v.Field), e)
		d.Expected, d.Low, d.High = e, math.Min(round3(v.Low), e), math.Max(round3(v.High), e)
		d.FieldExpected, d.RemoteInferredExpected = f, round3(e-f)
		after[k] += e
	}
	// a small zone's new total goes into model_other
	for i := range doc.Explanations {
		x := &doc.Explanations[i]
		k := zd{x.ZoneID, x.Date}
		if b, a := before[k], after[k]; b > 0 && math.Abs(a-b) > 1e-6 {
			for j := range x.Drivers {
				if x.Drivers[j].Driver == "model_other" {
					x.Drivers[j].Multiplier = round4(x.Drivers[j].Multiplier * a / b)
				}
			}
			x.Expected = round3(x.Expected * a / b)
		}
	}
	return nil
}
