// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// assignmentBackend keeps decisions, their events and the shadow comparisons.
type assignmentBackend interface {
	assignments(ctx context.Context, tenant string) ([]Assignment, error)
	// saveDecision writes assignments and events together: all or none.
	saveDecision(ctx context.Context, tenant string, rows []Assignment, events []AssignmentEvent) error
	// activeFor is the active assignment of each named case.
	activeFor(ctx context.Context, tenant string, caseIDs []string) (map[string]Assignment, error)
	events(ctx context.Context, tenant string) ([]AssignmentEvent, error)
	comparisons(ctx context.Context, tenant string) ([]AssignmentComparison, error)
}

var assignmentStoreBackend assignmentBackend = memoryAssignments{}

// UsePostgresAssignments keeps decisions in Postgres.
func UsePostgresAssignments(conn *tenancy.Connection) {
	assignmentStoreBackend = pgAssignments{conn: conn}
}

// UseMemoryAssignments puts the in-memory store back (the demo replay, tests).
func UseMemoryAssignments() { assignmentStoreBackend = memoryAssignments{} }

type memoryAssignments struct{}

func (memoryAssignments) assignments(context.Context, string) ([]Assignment, error) {
	return allAssignmentsMemory(), nil
}

func (memoryAssignments) saveDecision(_ context.Context, _ string, rows []Assignment, events []AssignmentEvent) error {
	for _, a := range rows {
		upsertAssignmentMemory(a)
	}
	appendAssignmentEventsMemory(events)
	return nil
}

func (memoryAssignments) activeFor(_ context.Context, _ string, caseIDs []string) (map[string]Assignment, error) {
	want := make(map[string]bool, len(caseIDs))
	for _, id := range caseIDs {
		want[id] = true
	}
	out := map[string]Assignment{}
	for _, a := range allAssignmentsMemory() {
		if want[a.CaseID] && a.State == "assigned" {
			out[a.CaseID] = a
		}
	}
	return out, nil
}

func (memoryAssignments) events(context.Context, string) ([]AssignmentEvent, error) {
	return allAssignmentEventsMemory(), nil
}

func (memoryAssignments) comparisons(context.Context, string) ([]AssignmentComparison, error) {
	return allAssignmentComparisonsMemory(), nil
}

type pgAssignments struct{ conn *tenancy.Connection }

const assignmentColumns = `id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, case_id::text, agent_id::text, decided_at,
	source, stage, state, reason_code, reason_note, estimated_arrival_at, estimated_travel_seconds, decided_by_user_id::text, model_version, extra`

func (p pgAssignments) assignments(ctx context.Context, tenant string) ([]Assignment, error) {
	return p.query(ctx, tenant, "")
}

func (p pgAssignments) query(ctx context.Context, tenant, where string, args ...any) ([]Assignment, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]Assignment, error) {
		rows, err := tx.Query(ctx, `SELECT `+assignmentColumns+` FROM assignments `+where+` ORDER BY decided_at, created_at, id`, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Assignment
		for rows.Next() {
			var a Assignment
			var created, updated, decided time.Time
			var arrival *time.Time
			var agent *string
			var extra []byte
			if err := rows.Scan(&a.ID, &a.TenantID, &a.DataSource, &created, &updated, &a.CreatedBy, &a.CaseID, &agent, &decided, &a.Source, &a.Stage, &a.State,
				&a.ReasonCode, &a.ReasonNote, &arrival, &a.EstimatedTravelSeconds, &a.DecidedByUserID, &a.ModelVersion, &extra); err != nil {
				return nil, err
			}
			a.CreatedAt, a.UpdatedAt, a.DecidedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated), datactx.ToRiyadhISO(decided)
			a.EstimatedArrivalAt = nullableTimeToISO(arrival)
			if agent != nil {
				a.AgentID = *agent
			}
			if a.Extra, err = scanExtra(extra); err != nil {
				return nil, err
			}
			out = append(out, a)
		}
		return out, rows.Err()
	})
}

func nullableUUID(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func parseTime(s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, dataerr.Invalid("Not a date-time: " + s)
	}
	return t, nil
}

func optTime(s *string) (*time.Time, error) {
	if s == nil {
		return nil, nil
	}
	t, err := parseTime(*s)
	return &t, err
}

func (p pgAssignments) saveDecision(ctx context.Context, tenant string, rows []Assignment, events []AssignmentEvent) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, a := range rows {
			decided, err := parseTime(a.DecidedAt)
			if err != nil {
				return struct{}{}, err
			}
			arrival, err := optTime(a.EstimatedArrivalAt)
			if err != nil {
				return struct{}{}, err
			}
			extra, err := json.Marshal(a.Extra)
			if err != nil {
				return struct{}{}, err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO assignments (tenant_id, id, data_source, created_at, updated_at, created_by, case_id, agent_id, decided_at, source, stage, state,
					reason_code, reason_note, estimated_arrival_at, estimated_travel_seconds, decided_by_user_id, model_version, extra)
				VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, now(), now(), $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid, $15, $16::jsonb)
				ON CONFLICT (tenant_id, id) DO UPDATE SET agent_id = EXCLUDED.agent_id, decided_at = EXCLUDED.decided_at, source = EXCLUDED.source, stage = EXCLUDED.stage,
					state = EXCLUDED.state, reason_code = EXCLUDED.reason_code, reason_note = EXCLUDED.reason_note, estimated_arrival_at = EXCLUDED.estimated_arrival_at,
					estimated_travel_seconds = EXCLUDED.estimated_travel_seconds, decided_by_user_id = EXCLUDED.decided_by_user_id, model_version = EXCLUDED.model_version,
					extra = EXCLUDED.extra, updated_at = now()`,
				a.ID, a.DataSource, a.CreatedBy, a.CaseID, nullableUUID(a.AgentID), decided, a.Source, a.Stage, a.State, a.ReasonCode, a.ReasonNote, arrival,
				a.EstimatedTravelSeconds, a.DecidedByUserID, a.ModelVersion, string(extra)); err != nil {
				var pg *pgconn.PgError
				if errors.As(err, &pg) && pg.Code == "23505" {
					return struct{}{}, dataerr.Conflict("ALREADY_ASSIGNED: the case already has an assignment.")
				}
				return struct{}{}, err
			}
		}
		for _, e := range events {
			occurred, err := parseTime(e.OccurredAt)
			if err != nil {
				return struct{}{}, err
			}
			detail, err := json.Marshal(e.Detail)
			if err != nil {
				return struct{}{}, err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO assignment_events (tenant_id, id, data_source, created_at, updated_at, created_by, assignment_id, case_id, event_type, occurred_at, source,
					actor_user_id, reason_code, note, detail)
				VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, now(), now(), $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9::uuid, $10, $11, $12::jsonb)
				ON CONFLICT (tenant_id, id) DO UPDATE SET event_type = EXCLUDED.event_type, occurred_at = EXCLUDED.occurred_at, note = EXCLUDED.note, detail = EXCLUDED.detail,
					reason_code = EXCLUDED.reason_code, updated_at = now()`,
				e.ID, e.DataSource, e.CreatedBy, e.AssignmentID, e.CaseID, e.EventType, occurred, e.Source, e.ActorUserID, e.ReasonCode, e.Note, string(detail)); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}

func (p pgAssignments) activeFor(ctx context.Context, tenant string, caseIDs []string) (map[string]Assignment, error) {
	out := map[string]Assignment{}
	if len(caseIDs) == 0 {
		return out, nil
	}
	all, err := p.query(ctx, tenant, `WHERE state = 'assigned' AND case_id = ANY($1::uuid[])`, caseIDs)
	if err != nil {
		return nil, err
	}
	for _, a := range all {
		out[a.CaseID] = a
	}
	return out, nil
}

func (p pgAssignments) events(ctx context.Context, tenant string) ([]AssignmentEvent, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]AssignmentEvent, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, assignment_id::text, case_id::text, event_type, occurred_at,
			source, actor_user_id::text, reason_code, note, detail FROM assignment_events ORDER BY occurred_at, created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []AssignmentEvent
		for rows.Next() {
			var e AssignmentEvent
			var created, updated, occurred time.Time
			var detail []byte
			if err := rows.Scan(&e.ID, &e.TenantID, &e.DataSource, &created, &updated, &e.CreatedBy, &e.AssignmentID, &e.CaseID, &e.EventType, &occurred, &e.Source,
				&e.ActorUserID, &e.ReasonCode, &e.Note, &detail); err != nil {
				return nil, err
			}
			e.CreatedAt, e.UpdatedAt, e.OccurredAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated), datactx.ToRiyadhISO(occurred)
			if e.Detail, err = scanExtra(detail); err != nil {
				return nil, err
			}
			out = append(out, e)
		}
		return out, rows.Err()
	})
}

func (p pgAssignments) comparisons(ctx context.Context, tenant string) ([]AssignmentComparison, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]AssignmentComparison, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, case_id::text, zone_id::text, compared_at, same_agent, opendispatch, customer
			FROM assignment_comparisons ORDER BY compared_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []AssignmentComparison
		for rows.Next() {
			var c AssignmentComparison
			var created, updated, compared time.Time
			var zone *string
			var opendispatch, customer []byte
			if err := rows.Scan(&c.ID, &c.TenantID, &c.DataSource, &created, &updated, &c.CreatedBy, &c.CaseID, &zone, &compared, &c.SameAgent, &opendispatch, &customer); err != nil {
				return nil, err
			}
			c.CreatedAt, c.UpdatedAt, c.ComparedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated), datactx.ToRiyadhISO(compared)
			if zone != nil {
				c.ZoneID = *zone
			}
			if err := json.Unmarshal(opendispatch, &c.OpenDispatch); err != nil {
				return nil, err
			}
			if err := json.Unmarshal(customer, &c.Customer); err != nil {
				return nil, err
			}
			out = append(out, c)
		}
		return out, rows.Err()
	})
}

func loadAssignments(ctx context.Context, tenant string) ([]Assignment, error) {
	return assignmentStoreBackend.assignments(ctx, tenant)
}

func loadAssignment(ctx context.Context, tenant, id string) (*Assignment, error) {
	all, err := assignmentStoreBackend.assignments(ctx, tenant)
	if err != nil {
		return nil, err
	}
	for _, a := range all {
		if a.ID == id {
			row := a
			return &row, nil
		}
	}
	return nil, nil
}

func loadAssignmentEvents(ctx context.Context, tenant string) ([]AssignmentEvent, error) {
	return assignmentStoreBackend.events(ctx, tenant)
}

func loadAssignmentComparisons(ctx context.Context, tenant string) ([]AssignmentComparison, error) {
	return assignmentStoreBackend.comparisons(ctx, tenant)
}

func saveDecision(ctx context.Context, tenant string, rows []Assignment, events []AssignmentEvent) error {
	return assignmentStoreBackend.saveDecision(ctx, tenant, rows, events)
}

// ReseedAssignmentsForTest puts the three tables back to the fixtures (owner connection: it bypasses row-level security).
func ReseedAssignmentsForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, pg := assignmentStoreBackend.(pgAssignments); !pg {
		return nil
	}
	for _, table := range []string{"assignment_events", "assignments", "assignment_comparisons"} {
		if _, err := owner.Pool.Exec(ctx, `DELETE FROM `+table); err != nil {
			return err
		}
	}
	rows, err := fixtures.Records[Assignment]("Assignment")
	if err != nil {
		return err
	}
	events, err := fixtures.Records[AssignmentEvent]("AssignmentEvent")
	if err != nil {
		return err
	}
	comparisons, err := fixtures.Records[AssignmentComparison]("AssignmentComparison")
	if err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	seed := pgAssignments{conn: owner}
	if err := seed.saveDecision(ctx, tenant, rows, events); err != nil {
		return err
	}
	for _, c := range comparisons {
		compared, err := parseTime(c.ComparedAt)
		if err != nil {
			return err
		}
		opendispatch, _ := json.Marshal(c.OpenDispatch)
		customer, _ := json.Marshal(c.Customer)
		if _, err := owner.Pool.Exec(ctx, `INSERT INTO assignment_comparisons (tenant_id, id, data_source, created_at, updated_at, case_id, zone_id, compared_at, same_agent, opendispatch, customer)
			VALUES ($1::uuid, $2::uuid, $3, now(), now(), $4::uuid, $5::uuid, $6, $7, $8::jsonb, $9::jsonb)`,
			tenant, c.ID, c.DataSource, c.CaseID, nullableUUID(c.ZoneID), compared, c.SameAgent, string(opendispatch), string(customer)); err != nil {
			return err
		}
	}
	return nil
}
