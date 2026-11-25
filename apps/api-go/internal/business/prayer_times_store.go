// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// prayerBackend keeps recomputed prayer times.
type prayerBackend interface {
	list(ctx context.Context, tenant, cityID string) ([]PrayerTime, error)
	saveMany(ctx context.Context, tenant string, rows []PrayerTime) error
}

var prayerStoreBackend prayerBackend = memoryPrayers{}

// UsePostgresPrayerTimes keeps them in Postgres.
func UsePostgresPrayerTimes(conn *tenancy.Connection) { prayerStoreBackend = pgPrayers{conn: conn} }

// UseMemoryPrayerTimes puts the memory store back.
func UseMemoryPrayerTimes() { prayerStoreBackend = memoryPrayers{} }

type memoryPrayers struct{}

func (memoryPrayers) list(_ context.Context, _, cityID string) ([]PrayerTime, error) {
	calendarMu.Lock()
	defer calendarMu.Unlock()
	seedCalendarLocked()
	out := make([]PrayerTime, 0, len(prayerTimeRows))
	for _, p := range prayerTimeRows {
		if cityID == "" || p.CityID == cityID {
			out = append(out, p)
		}
	}
	return out, nil
}

func (memoryPrayers) saveMany(_ context.Context, _ string, rows []PrayerTime) error {
	calendarMu.Lock()
	defer calendarMu.Unlock()
	seedCalendarLocked()
	for _, row := range rows {
		replaced := false
		for i, existing := range prayerTimeRows {
			if existing.CityID == row.CityID && existing.PrayerDate == row.PrayerDate {
				prayerTimeRows[i] = row
				replaced = true
				break
			}
		}
		if !replaced {
			prayerTimeRows = append(prayerTimeRows, row)
		}
	}
	return nil
}

type pgPrayers struct{ conn *tenancy.Connection }

func (p pgPrayers) list(ctx context.Context, tenant, cityID string) ([]PrayerTime, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]PrayerTime, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, city_id::text, prayer_date::text, fajr, sunrise, dhuhr, asr, maghrib, isha, calculation_method
			FROM prayer_times WHERE ($1 = '' OR city_id = $1::uuid) ORDER BY prayer_date, city_id`, cityID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := []PrayerTime{}
		for rows.Next() {
			var t PrayerTime
			var created, updated time.Time
			if err := rows.Scan(&t.ID, &t.TenantID, &t.DataSource, &created, &updated, &t.CreatedBy, &t.CityID, &t.PrayerDate, &t.Fajr, &t.Sunrise, &t.Dhuhr, &t.Asr, &t.Maghrib, &t.Isha, &t.CalculationMethod); err != nil {
				return nil, err
			}
			t.CreatedAt, t.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			out = append(out, t)
		}
		return out, rows.Err()
	})
}

func insertPrayerTimes(ctx context.Context, tx pgx.Tx, rows []PrayerTime) error {
	for _, t := range rows {
		_, err := tx.Exec(ctx, `INSERT INTO prayer_times (tenant_id, id, data_source, created_by, city_id, prayer_date, fajr, sunrise, dhuhr, asr, maghrib, isha, calculation_method)
			VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3::uuid, $4::uuid, $5::date, $6, $7, $8, $9, $10, $11, $12)
			ON CONFLICT (tenant_id, city_id, prayer_date) DO UPDATE SET fajr = EXCLUDED.fajr, sunrise = EXCLUDED.sunrise, dhuhr = EXCLUDED.dhuhr, asr = EXCLUDED.asr,
				maghrib = EXCLUDED.maghrib, isha = EXCLUDED.isha, calculation_method = EXCLUDED.calculation_method, updated_at = now()`,
			t.ID, t.DataSource, t.CreatedBy, t.CityID, t.PrayerDate, t.Fajr, t.Sunrise, t.Dhuhr, t.Asr, t.Maghrib, t.Isha, t.CalculationMethod)
		if err != nil {
			return err
		}
	}
	return nil
}

func (p pgPrayers) saveMany(ctx context.Context, tenant string, rows []PrayerTime) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, insertPrayerTimes(ctx, tx, rows)
	})
	return err
}

func loadPrayerTimes(ctx context.Context, tenant, cityID string) ([]PrayerTime, error) {
	return prayerStoreBackend.list(ctx, tenant, cityID)
}

func savePrayerTimes(ctx context.Context, tenant string, rows []PrayerTime) error {
	return prayerStoreBackend.saveMany(ctx, tenant, rows)
}

// ReseedLeaveCalendarForTest puts prayer times back to the fixtures.
func ReseedLeaveCalendarForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, isPg := prayerStoreBackend.(pgPrayers); !isPg {
		return nil
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM prayer_times`); err != nil {
		return err
	}
	rows, err := fixtures.Records[PrayerTime]("PrayerTime")
	if err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, owner.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, insertPrayerTimes(ctx, tx, rows)
	})
	return err
}
