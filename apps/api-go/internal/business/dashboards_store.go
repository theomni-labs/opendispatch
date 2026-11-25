// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// rollupBackend reads the dashboard and productivity roll-ups.
type rollupBackend interface {
	dashboards(ctx context.Context, tenant, from, to string) ([]DashboardRollup, error)
	productivity(ctx context.Context, tenant, groupBy, from, to string) ([]ProductivityRollup, error)
}

var rollupBackendInUse rollupBackend = memoryRollups{}

// UsePostgresRollups keeps the roll-ups in Postgres.
func UsePostgresRollups(conn *tenancy.Connection) { rollupBackendInUse = pgRollups{conn: conn} }

// UseMemoryRollups puts the in-memory store back (tests).
func UseMemoryRollups() { rollupBackendInUse = memoryRollups{} }

type memoryRollups struct{}

func (memoryRollups) dashboards(_ context.Context, _, from, to string) ([]DashboardRollup, error) {
	var out []DashboardRollup
	for _, r := range allDashboardRollups() {
		if (from != "" && r.PeriodStart < from) || (to != "" && r.PeriodEnd > to) {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}

func (memoryRollups) productivity(_ context.Context, _, groupBy, from, to string) ([]ProductivityRollup, error) {
	var out []ProductivityRollup
	for _, r := range allProductivityRollups() {
		if r.GroupBy != groupBy || (from != "" && r.PeriodStart < from) || (to != "" && r.PeriodEnd > to) {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}

type pgRollups struct{ conn *tenancy.Connection }

const riyadhDay = `'YYYY-MM-DD'`

func intFromFloat(f *float64) *int {
	if f == nil {
		return nil
	}
	v := int(math.Round(*f))
	return &v
}

func floatFromInt(v *int) *float64 {
	if v == nil {
		return nil
	}
	f := float64(*v)
	return &f
}

func readingOf(raw []byte) (ServiceLevelReading, error) {
	var r ServiceLevelReading
	if len(raw) == 0 {
		return r, nil
	}
	var probe any
	if err := json.Unmarshal(raw, &probe); err != nil {
		return r, err
	}
	if m, ok := probe.(map[string]any); !ok || len(m) == 0 {
		return r, nil
	}
	return r, json.Unmarshal(raw, &r)
}

func optIntOf(raw []byte) *int {
	var f float64
	if len(raw) == 0 || json.Unmarshal(raw, &f) != nil {
		return nil
	}
	v := int(math.Round(f))
	return &v
}

func optIntJSON(v *int) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(*v)
}

func (p pgRollups) dashboards(ctx context.Context, tenant, from, to string) ([]DashboardRollup, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]DashboardRollup, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, level, scope_id::text,
				to_char(period_start AT TIME ZONE 'Asia/Riyadh', `+riyadhDay+`), to_char(period_end AT TIME ZONE 'Asia/Riyadh', `+riyadhDay+`),
				cases_total, cases_field, cases_remote_inferred, forecast_expected_total, from_registration, from_assignment, primary_clock_start,
				agents_on_duty, gap_intervals, surplus_intervals, illustrative
			FROM dashboard_rollups
			WHERE ($1 = '' OR to_char(period_start AT TIME ZONE 'Asia/Riyadh', `+riyadhDay+`) >= $1)
				AND ($2 = '' OR to_char(period_end AT TIME ZONE 'Asia/Riyadh', `+riyadhDay+`) <= $2)
			ORDER BY created_at, id`, from, to)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []DashboardRollup
		for rows.Next() {
			var r DashboardRollup
			var created, updated time.Time
			var total, field, remote, duty *int
			var expected *float64
			var fromReg, fromAssign, gaps, surplus []byte
			var clock *string
			if err := rows.Scan(&r.ID, &r.TenantID, &r.DataSource, &created, &updated, &r.CreatedBy, &r.Level, &r.ScopeID, &r.PeriodStart, &r.PeriodEnd,
				&total, &field, &remote, &expected, &fromReg, &fromAssign, &clock, &duty, &gaps, &surplus, &r.Illustrative); err != nil {
				return nil, err
			}
			r.CreatedAt, r.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			if total != nil {
				r.CasesTotal = *total
			}
			if field != nil {
				r.CasesField = *field
			}
			if remote != nil {
				r.CasesRemoteInferred = *remote
			}
			if clock != nil {
				r.PrimaryClockStart = *clock
			}
			r.ForecastExpectedTotal, r.AgentsOnDuty = intFromFloat(expected), duty
			r.GapIntervals, r.SurplusIntervals = optIntOf(gaps), optIntOf(surplus)
			if r.FromRegistration, err = readingOf(fromReg); err != nil {
				return nil, err
			}
			if r.FromAssignment, err = readingOf(fromAssign); err != nil {
				return nil, err
			}
			out = append(out, r)
		}
		return out, rows.Err()
	})
}

func (p pgRollups) productivity(ctx context.Context, tenant, groupBy, from, to string) ([]ProductivityRollup, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]ProductivityRollup, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, group_by, zone_id::text, agent_id::text,
				to_char(period_start AT TIME ZONE 'Asia/Riyadh', `+riyadhDay+`), to_char(period_end AT TIME ZONE 'Asia/Riyadh', `+riyadhDay+`),
				cases_handled, median_assigned_to_arrived_seconds, median_registered_to_arrived_seconds, median_time_on_scene_seconds, utilisation, illustrative
			FROM productivity_rollups
			WHERE group_by = $1
				AND ($2 = '' OR to_char(period_start AT TIME ZONE 'Asia/Riyadh', `+riyadhDay+`) >= $2)
				AND ($3 = '' OR to_char(period_end AT TIME ZONE 'Asia/Riyadh', `+riyadhDay+`) <= $3)
			ORDER BY created_at, id`, groupBy, from, to)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []ProductivityRollup
		for rows.Next() {
			var r ProductivityRollup
			var created, updated time.Time
			var handled *int
			if err := rows.Scan(&r.ID, &r.TenantID, &r.DataSource, &created, &updated, &r.CreatedBy, &r.GroupBy, &r.ZoneID, &r.AgentID, &r.PeriodStart, &r.PeriodEnd,
				&handled, &r.MedianAssignedToArrivedSeconds, &r.MedianRegisteredToArrivedSeconds, &r.MedianTimeOnSceneSeconds, &r.Utilisation, &r.Illustrative); err != nil {
				return nil, err
			}
			r.CreatedAt, r.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			if handled != nil {
				r.CasesHandled = *handled
			}
			out = append(out, r)
		}
		return out, rows.Err()
	})
}

func loadDashboardRollups(ctx context.Context, tenant, from, to string) ([]DashboardRollup, error) {
	return rollupBackendInUse.dashboards(ctx, tenant, from, to)
}

func loadProductivityRollups(ctx context.Context, tenant, groupBy, from, to string) ([]ProductivityRollup, error) {
	return rollupBackendInUse.productivity(ctx, tenant, groupBy, from, to)
}

// ReseedRollupsForTest puts both roll-up tables back to the fixtures (owner connection).
func ReseedRollupsForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, pg := rollupBackendInUse.(pgRollups); !pg {
		return nil
	}
	dash, err := fixtures.Records[DashboardRollup]("DashboardRollup")
	if err != nil {
		return err
	}
	prod, err := fixtures.Records[ProductivityRollup]("ProductivityRollup")
	if err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM dashboard_rollups`); err != nil {
		return err
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM productivity_rollups`); err != nil {
		return err
	}
	return insertRollups(ctx, owner, tenant, dash, prod)
}

func insertRollups(ctx context.Context, conn *tenancy.Connection, tenant string, dash []DashboardRollup, prod []ProductivityRollup) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for i, r := range dash {
			created, err := parseTime(r.CreatedAt)
			if err != nil {
				return struct{}{}, err
			}
			created = created.Add(time.Duration(i) * time.Millisecond)
			reg, err := json.Marshal(r.FromRegistration)
			if err != nil {
				return struct{}{}, err
			}
			assign, err := json.Marshal(r.FromAssignment)
			if err != nil {
				return struct{}{}, err
			}
			gaps, err := optIntJSON(r.GapIntervals)
			if err != nil {
				return struct{}{}, err
			}
			surplus, err := optIntJSON(r.SurplusIntervals)
			if err != nil {
				return struct{}{}, err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO dashboard_rollups (tenant_id, id, data_source, created_at, updated_at, created_by, level, scope_id, period_start, period_end,
					cases_total, cases_field, cases_remote_inferred, forecast_expected_total, from_registration, from_assignment, primary_clock_start, agents_on_duty,
					gap_intervals, surplus_intervals, illustrative)
				VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $3, $4::uuid, $5, $6::uuid, ($7::date)::timestamp AT TIME ZONE 'Asia/Riyadh',
					($8::date)::timestamp AT TIME ZONE 'Asia/Riyadh', $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, $16, $17::jsonb, $18::jsonb, $19)`,
				r.ID, r.DataSource, created, r.CreatedBy, r.Level, r.ScopeID, r.PeriodStart, r.PeriodEnd, r.CasesTotal, r.CasesField, r.CasesRemoteInferred,
				floatFromInt(r.ForecastExpectedTotal), string(reg), string(assign), r.PrimaryClockStart, r.AgentsOnDuty, gaps, surplus, r.Illustrative); err != nil {
				return struct{}{}, err
			}
		}
		for i, r := range prod {
			created, err := parseTime(r.CreatedAt)
			if err != nil {
				return struct{}{}, err
			}
			created = created.Add(time.Duration(i) * time.Millisecond)
			if _, err := tx.Exec(ctx, `INSERT INTO productivity_rollups (tenant_id, id, data_source, created_at, updated_at, created_by, group_by, zone_id, agent_id, period_start, period_end,
					cases_handled, median_assigned_to_arrived_seconds, median_registered_to_arrived_seconds, median_time_on_scene_seconds, utilisation, illustrative)
				VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $3, $4::uuid, $5, $6::uuid, $7::uuid, ($8::date)::timestamp AT TIME ZONE 'Asia/Riyadh',
					($9::date)::timestamp AT TIME ZONE 'Asia/Riyadh', $10, $11, $12, $13, $14, $15)`,
				r.ID, r.DataSource, created, r.CreatedBy, r.GroupBy, r.ZoneID, r.AgentID, r.PeriodStart, r.PeriodEnd, r.CasesHandled,
				r.MedianAssignedToArrivedSeconds, r.MedianRegisteredToArrivedSeconds, r.MedianTimeOnSceneSeconds, r.Utilisation, r.Illustrative); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}
