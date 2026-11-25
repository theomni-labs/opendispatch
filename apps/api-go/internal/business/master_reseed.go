// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// masterTable is one table's fixture rows and how to write them.
type masterTable struct {
	table  string
	ids    []string
	upsert func(ctx context.Context, tx pgx.Tx) error
}

func masterOf[T any](schema, table string, idOf func(*T) *string, createdOf func(*T) *string, write func(context.Context, pgx.Tx, T) error) (masterTable, error) {
	rows, err := fixtures.Records[T](schema)
	if err != nil {
		return masterTable{}, err
	}
	ids := make([]string, len(rows))
	for i := range rows {
		ids[i] = *idOf(&rows[i])
		c := createdOf(&rows[i])
		*c = nudgedCreatedAt(*c, i)
	}
	return masterTable{table: table, ids: ids, upsert: func(ctx context.Context, tx pgx.Tx) error {
		for _, r := range rows {
			if err := write(ctx, tx, r); err != nil {
				return err
			}
		}
		return nil
	}}, nil
}

// reseedMaster upserts the fixture rows (parents first), then deletes the others (children first).
func reseedMaster(ctx context.Context, owner *tenancy.Connection, tables []masterTable) error {
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, owner.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, t := range tables {
			if err := t.upsert(ctx, tx); err != nil {
				return struct{}{}, err
			}
		}
		for i := len(tables) - 1; i >= 0; i-- {
			t := tables[i]
			if _, err := tx.Exec(ctx, `DELETE FROM `+pgx.Identifier{t.table}.Sanitize()+` WHERE tenant_id = $2::uuid AND NOT (id = ANY($1::uuid[]))`, t.ids, tenant); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}

func holidayTx(ctx context.Context, tx pgx.Tx, h Holiday) error {
	_, err := tx.Exec(ctx, `INSERT INTO holidays (tenant_id, id, data_source, created_at, updated_at, created_by, name_en, name_ar, start_date, end_date, kind, hijri_start, hijri_end)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (tenant_id, id) DO UPDATE SET created_at=$4, updated_at=$5, name_en=$7, name_ar=$8, start_date=$9, end_date=$10, kind=$11, hijri_start=$12, hijri_end=$13`,
		h.TenantID, h.ID, h.DataSource, h.CreatedAt, h.UpdatedAt, h.CreatedBy, h.NameEn, h.NameAr, h.StartDate, h.EndDate, h.Kind, h.HijriStart, h.HijriEnd)
	return err
}

func skillTx(ctx context.Context, tx pgx.Tx, k AgentSkill) error {
	_, err := tx.Exec(ctx, `INSERT INTO agent_skills (tenant_id, id, data_source, created_at, updated_at, created_by, agent_id, skill_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (tenant_id, id) DO UPDATE SET created_at=$4, updated_at=$5, agent_id=$7, skill_code=$8`,
		k.TenantID, k.ID, k.DataSource, k.CreatedAt, k.UpdatedAt, k.CreatedBy, k.AgentID, k.SkillCode)
	return err
}

// ReseedLocationsForTest puts cities, zones, sub-zones and standby points back to the fixtures.
func ReseedLocationsForTest(ctx context.Context, owner *tenancy.Connection) error {
	city, err := masterOf("City", "cities", func(c *City) *string { return &c.ID }, func(c *City) *string { return &c.CreatedAt }, upsertCityTx)
	if err != nil {
		return err
	}
	zone, err := masterOf("Zone", "zones", func(c *Zone) *string { return &c.ID }, func(c *Zone) *string { return &c.CreatedAt }, upsertZoneTx)
	if err != nil {
		return err
	}
	sub, err := masterOf("SubZone", "sub_zones", func(c *SubZone) *string { return &c.ID }, func(c *SubZone) *string { return &c.CreatedAt }, upsertSubZoneTx)
	if err != nil {
		return err
	}
	standby, err := masterOf("StandbyPoint", "standby_points", func(c *StandbyPoint) *string { return &c.ID }, func(c *StandbyPoint) *string { return &c.CreatedAt }, upsertStandbyPointTx)
	if err != nil {
		return err
	}
	return reseedMaster(ctx, owner, []masterTable{city, zone, sub, standby})
}

// ReseedPeopleForTest puts vehicles, agents, skills and leave back to the fixtures.
func ReseedPeopleForTest(ctx context.Context, owner *tenancy.Connection) error {
	vehicle, err := masterOf("Vehicle", "vehicles", func(c *Vehicle) *string { return &c.ID }, func(c *Vehicle) *string { return &c.CreatedAt }, upsertVehicleTx)
	if err != nil {
		return err
	}
	agent, err := masterOf("Agent", "agents", func(c *Agent) *string { return &c.ID }, func(c *Agent) *string { return &c.CreatedAt }, upsertAgentTx)
	if err != nil {
		return err
	}
	skill, err := masterOf("AgentSkill", "agent_skills", func(c *AgentSkill) *string { return &c.ID }, func(c *AgentSkill) *string { return &c.CreatedAt }, skillTx)
	if err != nil {
		return err
	}
	holiday, err := masterOf("Holiday", "holidays", func(c *Holiday) *string { return &c.ID }, func(c *Holiday) *string { return &c.CreatedAt }, holidayTx)
	if err != nil {
		return err
	}
	leave, err := masterOf("LeaveRequest", "leave_requests", func(c *LeaveRequest) *string { return &c.ID }, func(c *LeaveRequest) *string { return &c.CreatedAt }, upsertLeaveRequestTx)
	if err != nil {
		return err
	}
	return reseedMaster(ctx, owner, []masterTable{vehicle, agent, skill, holiday, leave})
}

// ReseedImportsForTest puts import jobs and their findings back to the fixtures.
func ReseedImportsForTest(ctx context.Context, owner *tenancy.Connection) error {
	job, err := masterOf("ImportJob", "import_jobs", func(c *ImportJob) *string { return &c.ID }, func(c *ImportJob) *string { return &c.CreatedAt }, upsertImportJobTx)
	if err != nil {
		return err
	}
	issue, err := masterOf("DataQualityIssue", "data_quality_issues", func(c *DataQualityIssue) *string { return &c.ID }, func(c *DataQualityIssue) *string { return &c.CreatedAt }, upsertDataQualityIssueTx)
	if err != nil {
		return err
	}
	// saved mapping versions: none in fixtures
	saved := masterTable{table: "import_mappings", ids: []string{}, upsert: func(context.Context, pgx.Tx) error { return nil }}
	return reseedMaster(ctx, owner, []masterTable{saved, job, issue})
}

// ReseedShiftBreakForTest puts break rules and shift patterns back to the fixtures.
func ReseedShiftBreakForTest(ctx context.Context, owner *tenancy.Connection) error {
	rule, err := masterOf("BreakRule", "break_rules", func(c *BreakRule) *string { return &c.ID }, func(c *BreakRule) *string { return &c.CreatedAt }, upsertBreakRuleTx)
	if err != nil {
		return err
	}
	pattern, err := masterOf("ShiftPattern", "shift_patterns", func(c *ShiftPattern) *string { return &c.ID }, func(c *ShiftPattern) *string { return &c.CreatedAt }, upsertShiftPatternTx)
	if err != nil {
		return err
	}
	return reseedMaster(ctx, owner, []masterTable{rule, pattern})
}
