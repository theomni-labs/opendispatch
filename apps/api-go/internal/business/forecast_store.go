// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// forecastRunBackend keeps forecast runs.
type forecastRunBackend interface {
	all(ctx context.Context, tenant string, withFixtures bool) ([]ForecastRun, error)
	save(ctx context.Context, tenant string, r ForecastRun) error
}

// forecastValueBackend reads the stored forecast values.
type forecastValueBackend interface {
	open(tenant string) (valueReader, error)
}

type valueReader interface {
	dates(ctx context.Context) (map[string][]string, error)
	rows(ctx context.Context, runID, zoneID, date string) ([]ForecastValue, error)
}

var (
	forecastRunBackendInUse   forecastRunBackend   = memoryForecastRuns{}
	forecastValueBackendInUse forecastValueBackend = memoryForecastValues{}
)

// UsePostgresForecast keeps runs and values in Postgres.
func UsePostgresForecast(conn *tenancy.Connection) {
	forecastRunBackendInUse = pgForecastRuns{conn: conn}
	forecastValueBackendInUse = pgForecastValues{conn: conn}
}

// UseMemoryForecast puts the in-memory stores back (tests).
func UseMemoryForecast() {
	forecastRunBackendInUse = memoryForecastRuns{}
	forecastValueBackendInUse = memoryForecastValues{}
}

func forecastInPostgres() bool {
	_, pg := forecastRunBackendInUse.(pgForecastRuns)
	return pg
}

type memoryForecastRuns struct{}

func (memoryForecastRuns) all(_ context.Context, _ string, withFixtures bool) ([]ForecastRun, error) {
	if withFixtures {
		return forecastRunRows(), nil
	}
	return allForecastRunRows(), nil
}

func (memoryForecastRuns) save(_ context.Context, _ string, r ForecastRun) error {
	upsertForecastRunRow(r)
	return nil
}

type pgForecastRuns struct{ conn *tenancy.Connection }

const forecastRunColumns = `id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, model_version, engine_version, rule_set_version, status,
	to_char(horizon_start_date, 'YYYY-MM-DD'), horizon_days, range_coverage, illustrative, input_data_sources, started_at, finished_at, error_message, dataset_snapshot_id`

func (p pgForecastRuns) all(ctx context.Context, tenant string, _ bool) ([]ForecastRun, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]ForecastRun, error) {
		rows, err := tx.Query(ctx, `SELECT `+forecastRunColumns+` FROM forecast_runs`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []ForecastRun
		for rows.Next() {
			var r ForecastRun
			var created, updated time.Time
			var started, finished *time.Time
			var coverage *float64
			if err := rows.Scan(&r.ID, &r.TenantID, &r.DataSource, &created, &updated, &r.CreatedBy, &r.ModelVersion, &r.EngineVersion, &r.RuleSetVersion, &r.Status,
				&r.HorizonStartDate, &r.HorizonDays, &coverage, &r.Illustrative, &r.InputDataSources, &started, &finished, &r.ErrorMessage, &r.DatasetSnapshotID); err != nil {
				return nil, err
			}
			r.CreatedAt, r.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			if coverage != nil {
				r.RangeCoverage = *coverage
			}
			r.StartedAt, r.FinishedAt = nullableTimeToISO(started), nullableTimeToISO(finished)
			if r.InputDataSources == nil {
				r.InputDataSources = []string{}
			}
			out = append(out, r)
		}
		return out, rows.Err()
	})
}

func (p pgForecastRuns) save(ctx context.Context, tenant string, r ForecastRun) error {
	created, err := parseTime(r.CreatedAt)
	if err != nil {
		return err
	}
	updated, err := parseTime(r.UpdatedAt)
	if err != nil {
		return err
	}
	started, err := optTime(r.StartedAt)
	if err != nil {
		return err
	}
	finished, err := optTime(r.FinishedAt)
	if err != nil {
		return err
	}
	sources := r.InputDataSources
	if sources == nil {
		sources = []string{}
	}
	_, err = tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO forecast_runs (tenant_id, id, data_source, created_at, updated_at, created_by, model_version, engine_version, rule_set_version, status,
				horizon_start_date, horizon_days, range_coverage, illustrative, input_data_sources, started_at, finished_at, error_message, dataset_snapshot_id)
			VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10::date, $11, $12, $13, $14, $15, $16, $17, $18)
			ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, status = EXCLUDED.status, range_coverage = EXCLUDED.range_coverage,
				started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at, error_message = EXCLUDED.error_message`,
			r.ID, r.DataSource, created, updated, r.CreatedBy, r.ModelVersion, r.EngineVersion, r.RuleSetVersion, r.Status,
			r.HorizonStartDate, r.HorizonDays, r.RangeCoverage, r.Illustrative, sources, started, finished, r.ErrorMessage, r.DatasetSnapshotID)
		return struct{}{}, err
	})
	return err
}

// loadForecastRuns: newest first (created_at, id desc).
func loadForecastRuns(ctx context.Context, tenant string, withFixtures bool) ([]ForecastRun, error) {
	rows, err := forecastRunBackendInUse.all(ctx, tenant, withFixtures)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].CreatedAt != rows[j].CreatedAt {
			return rows[i].CreatedAt > rows[j].CreatedAt
		}
		return rows[i].ID > rows[j].ID
	})
	return rows, nil
}

func loadForecastRun(ctx context.Context, tenant, id string, withFixtures bool) (*ForecastRun, error) {
	rows, err := forecastRunBackendInUse.all(ctx, tenant, withFixtures)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.ID == id {
			row := r
			return &row, nil
		}
	}
	return nil, nil
}

// loadLatestForecastRun: the newest succeeded run.
func loadLatestForecastRun(ctx context.Context, tenant string, withFixtures bool) (*ForecastRun, error) {
	rows, err := loadForecastRuns(ctx, tenant, withFixtures)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.Status == "succeeded" {
			row := r
			return &row, nil
		}
	}
	return nil, nil
}

type memoryForecastValues struct{}

type memoryValueReader struct {
	byKey map[string][]ForecastValue
	byRun map[string][]string
}

func (memoryForecastValues) open(string) (valueReader, error) {
	byKey := map[string][]ForecastValue{}
	sets := map[string]map[string]bool{}
	for _, row := range allForecastValueRows() {
		date := dateOnly(row.IntervalStart)
		key := row.ForecastRunID + "|" + row.ZoneID + "|" + date
		byKey[key] = append(byKey[key], row)
		if sets[row.ForecastRunID] == nil {
			sets[row.ForecastRunID] = map[string]bool{}
		}
		sets[row.ForecastRunID][date] = true
	}
	byRun := map[string][]string{}
	for run, set := range sets {
		for d := range set {
			byRun[run] = append(byRun[run], d)
		}
		sort.Strings(byRun[run])
	}
	return memoryValueReader{byKey: byKey, byRun: byRun}, nil
}

func (m memoryValueReader) dates(_ context.Context) (map[string][]string, error) { return m.byRun, nil }

func (m memoryValueReader) rows(_ context.Context, runID, zoneID, date string) ([]ForecastValue, error) {
	return m.byKey[runID+"|"+zoneID+"|"+date], nil
}

type pgForecastValues struct{ conn *tenancy.Connection }

type pgValueReader struct {
	conn   *tenancy.Connection
	tenant string
}

func (p pgForecastValues) open(tenant string) (valueReader, error) {
	return pgValueReader{conn: p.conn, tenant: tenant}, nil
}

func (r pgValueReader) dates(ctx context.Context) (map[string][]string, error) {
	return tenancy.WithTenant(ctx, r.conn.Pool, r.tenant, func(ctx context.Context, tx pgx.Tx) (map[string][]string, error) {
		rows, err := tx.Query(ctx, `SELECT forecast_run_id::text, to_char(interval_start AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') AS d
			FROM forecast_values GROUP BY 1, 2 ORDER BY 1, 2`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := map[string][]string{}
		for rows.Next() {
			var run, d string
			if err := rows.Scan(&run, &d); err != nil {
				return nil, err
			}
			out[run] = append(out[run], d)
		}
		return out, rows.Err()
	})
}

func (r pgValueReader) rows(ctx context.Context, runID, zoneID, date string) ([]ForecastValue, error) {
	from, err := time.Parse(time.RFC3339, date+"T00:00:00+03:00")
	if err != nil {
		return nil, err
	}
	return tenancy.WithTenant(ctx, r.conn.Pool, r.tenant, func(ctx context.Context, tx pgx.Tx) ([]ForecastValue, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, forecast_run_id::text, zone_id::text,
				sub_zone_id::text, interval_start, interval_index, low, expected, high, field_expected, remote_inferred_expected
			FROM forecast_values WHERE forecast_run_id = $1::uuid AND zone_id = $2::uuid AND interval_start >= $3 AND interval_start < $4
			ORDER BY sub_zone_id, interval_index`, runID, zoneID, from, from.Add(24*time.Hour))
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []ForecastValue
		for rows.Next() {
			var v ForecastValue
			var created, updated, start time.Time
			var sub *string
			var low *int
			var expected, high, field, remote *float64
			if err := rows.Scan(&v.ID, &v.TenantID, &v.DataSource, &created, &updated, &v.CreatedBy, &v.ForecastRunID, &v.ZoneID, &sub, &start, &v.IntervalIndex,
				&low, &expected, &high, &field, &remote); err != nil {
				return nil, err
			}
			v.CreatedAt, v.UpdatedAt, v.IntervalStart = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated), datactx.ToRiyadhISO(start)
			if sub != nil {
				v.SubZoneID = *sub
			}
			if low != nil {
				v.Low = float64(*low)
			}
			v.Expected, v.High, v.FieldExpected, v.RemoteInferredExpected = derefFloat(expected), derefFloat(high), derefFloat(field), derefFloat(remote)
			out = append(out, v)
		}
		return out, rows.Err()
	})
}

func derefFloat(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

// ReseedForecastForTest puts runs and values back to the fixtures (owner connection).
func ReseedForecastForTest(ctx context.Context, owner *tenancy.Connection) error {
	if !forecastInPostgres() {
		return nil
	}
	runs, err := fixtures.Records[ForecastRun]("ForecastRun")
	if err != nil {
		return err
	}
	values, err := fixtures.Records[ForecastValue]("ForecastValue")
	if err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM forecast_values`); err != nil {
		return err
	}
	ids := make([]string, len(runs))
	for i, r := range runs {
		ids[i] = r.ID
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM forecast_runs f WHERE NOT (f.id::text = ANY($1))
		AND NOT EXISTS (SELECT 1 FROM rosters r WHERE r.tenant_id = f.tenant_id AND r.forecast_run_id = f.id)`, ids); err != nil {
		return err
	}
	seed := pgForecastRuns{conn: owner}
	for _, r := range runs {
		if err := seed.save(ctx, tenant, r); err != nil {
			return err
		}
	}
	return insertForecastValues(ctx, owner, tenant, values)
}

// forecastValueChunk is how many rows one INSERT carries.
const forecastValueChunk = 4000

// insertForecastValues inserts with unnest: COPY is refused under row-level security.
func insertForecastValues(ctx context.Context, conn *tenancy.Connection, tenant string, values []ForecastValue) error {
	return insertForecastValuesOf(ctx, conn, tenant, len(values), func(i int) ForecastValue { return values[i] })
}

// insertForecastValuesOf: n rows made one at a time.
func insertForecastValuesOf(ctx context.Context, conn *tenancy.Connection, tenant string, total int, valueAt func(int) ForecastValue) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		chunk := make([]ForecastValue, 0, forecastValueChunk)
		for from := 0; from < total; from += forecastValueChunk {
			chunk = chunk[:0]
			for i := from; i < min(total, from+forecastValueChunk); i++ {
				chunk = append(chunk, valueAt(i))
			}
			n := len(chunk)
			ids, sources, created, updated := make([]string, n), make([]string, n), make([]time.Time, n), make([]time.Time, n)
			by, runs, zones, subs := make([]*string, n), make([]string, n), make([]string, n), make([]*string, n)
			starts, idx, low := make([]time.Time, n), make([]int32, n), make([]int32, n)
			exp, high, field, remote := make([]float64, n), make([]float64, n), make([]float64, n), make([]float64, n)
			for i, v := range chunk {
				var err error
				if created[i], err = parseTime(v.CreatedAt); err != nil {
					return struct{}{}, err
				}
				if updated[i], err = parseTime(v.UpdatedAt); err != nil {
					return struct{}{}, err
				}
				if starts[i], err = parseTime(v.IntervalStart); err != nil {
					return struct{}{}, err
				}
				ids[i], sources[i], by[i], runs[i], zones[i], subs[i] = v.ID, v.DataSource, v.CreatedBy, v.ForecastRunID, v.ZoneID, nullableUUID(v.SubZoneID)
				idx[i], low[i], exp[i], high[i], field[i], remote[i] = int32(v.IntervalIndex), int32(v.Low), v.Expected, v.High, v.FieldExpected, v.RemoteInferredExpected
			}
			if _, err := tx.Exec(ctx, `INSERT INTO forecast_values (tenant_id, id, data_source, created_at, updated_at, created_by, forecast_run_id, zone_id, sub_zone_id,
					interval_start, interval_index, low, expected, high, field_expected, remote_inferred_expected)
				SELECT $1::uuid, * FROM unnest($2::uuid[], $3::text[], $4::timestamptz[], $5::timestamptz[], $6::uuid[], $7::uuid[], $8::uuid[], $9::uuid[],
					$10::timestamptz[], $11::int[], $12::int[], $13::float8[], $14::float8[], $15::float8[], $16::float8[])`,
				tenant, ids, sources, created, updated, by, runs, zones, subs, starts, idx, low, exp, high, field, remote); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}
