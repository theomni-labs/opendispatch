// SPDX-License-Identifier: AGPL-3.0-only

package feeds

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	FeedCase       = "case"
	FeedAgentState = "agent_status"
	MaxBatch       = 500
)

// Store keeps the inbound queue and applies it.
type Store struct {
	Conn *tenancy.Connection
	Now  func() time.Time
	// Classifiers: the rules for a tenant, per drain.
	Classifiers func(ctx context.Context, tenantID string) (Classifier, error)
	// OnClassified audits a new or changed one.
	OnClassified func(ctx context.Context, tenantID string, e Classified) error
}

func (s *Store) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// Event is one inbound event, before it is stored.
type Event struct {
	IdempotencyKey string          `json:"idempotency_key"`
	OccurredAt     time.Time       `json:"occurred_at"`
	Raw            json.RawMessage `json:"-"`
}

// Rejection names an event that was refused and why.
type Rejection struct {
	Index  int    `json:"index"`
	Reason string `json:"reason"`
}

// Result answers one request.
type Result struct {
	Accepted   int         `json:"accepted"`
	Duplicates int         `json:"duplicates"`
	Rejected   []Rejection `json:"rejected"`
}

// CaseEvent is the body of a case event.
type CaseEvent struct {
	Event
	Case CasePayload `json:"case"`
}

// CasePayload is a case as the feed describes it.
type CasePayload struct {
	ExternalID         string     `json:"external_id"`
	CaseNumber         string     `json:"case_number"`
	RegisteredAt       time.Time  `json:"registered_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	ZoneExternalID     string     `json:"zone_external_id"`
	CaseTypeExternalID string     `json:"case_type_external_id"`
	Latitude           *float64   `json:"latitude"`
	Longitude          *float64   `json:"longitude"`
	PartiesInvolved    *int       `json:"parties_involved"`
	AssignedAt         *time.Time `json:"assigned_at"`
	ArrivedAt          *time.Time `json:"arrived_at"`
	ClosedAt           *time.Time `json:"closed_at"`
	AgentCode          *string    `json:"agent_code"`
	Severity           *string    `json:"severity"`
	InjuryPresent      *bool      `json:"injury_present"`
	// Handling: "" means the rules decide.
	Handling           string   `json:"handling,omitempty"`
	EstimatedDamageSar *float64 `json:"estimated_damage_sar,omitempty"`
	ClaimValueSar      *float64 `json:"claim_value_sar,omitempty"`
	DamageAssessment   *string  `json:"damage_assessment_method,omitempty"`
	LocationType       *string  `json:"location_type,omitempty"`
	CustomerPreference *string  `json:"customer_preference,omitempty"`
	PedestrianInvolved *bool    `json:"pedestrian_involved,omitempty"`
	HighwayOrOutside   *bool    `json:"highway_or_outside_city_limits,omitempty"`
}

// criteriaValues: the allowed values of each enum.
var criteriaValues = map[string][]string{
	"damage_assessment_method": {"photo", "video", "in_person"},
	"location_type":            {"dense_urban", "urban", "suburban", "highway", "rural"},
	"customer_preference":      {"none", "remote", "field"},
}

func oneOf(v *string, field string) bool {
	if v == nil {
		return true
	}
	for _, ok := range criteriaValues[field] {
		if *v == ok {
			return true
		}
	}
	return false
}

// CriteriaExtra: the optional rule criteria, for extra.
func (c CasePayload) CriteriaExtra() map[string]any {
	out := map[string]any{}
	put := func(k string, v any, ok bool) {
		if ok {
			out[k] = v
		}
	}
	put("claim_value_sar", deref(c.ClaimValueSar), c.ClaimValueSar != nil)
	put("damage_assessment_method", derefS(c.DamageAssessment), c.DamageAssessment != nil)
	put("location_type", derefS(c.LocationType), c.LocationType != nil)
	put("customer_preference", derefS(c.CustomerPreference), c.CustomerPreference != nil)
	put("pedestrian_involved", c.PedestrianInvolved != nil && *c.PedestrianInvolved, c.PedestrianInvolved != nil)
	put("highway_or_outside_city_limits", c.HighwayOrOutside != nil && *c.HighwayOrOutside, c.HighwayOrOutside != nil)
	return out
}

func deref(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}

func derefS(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// Classification is the rules' answer for one case.
type Classification struct {
	Handling, Outcome, RuleCode string
	// Record is kept as extra.classification.
	Record map[string]any
}

// Classifier classifies one case payload.
type Classifier func(c CasePayload, caseTypeName string, now time.Time) Classification

// Classified is a new or changed classification.
type Classified struct {
	CaseID, CaseNumber, Handling, Outcome, RuleCode string
	Previous                                        *string
	Record                                          map[string]any
}

// StatusEvent is the body of an agent status event.
type StatusEvent struct {
	Event
	AgentCode string   `json:"agent_code"`
	Status    string   `json:"status"`
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
}

var statuses = map[string]bool{"available": true, "en_route": true, "on_scene": true, "on_break": true, "offline": true}

// Validate checks a case event's shape.
func (e *CaseEvent) Validate() string {
	c := e.Case
	switch {
	case e.IdempotencyKey == "" || len(e.IdempotencyKey) > 200:
		return "idempotency_key is required (at most 200 characters)"
	case e.OccurredAt.IsZero():
		return "occurred_at is required"
	case c.ExternalID == "" || c.CaseNumber == "":
		return "case.external_id and case.case_number are required"
	case c.RegisteredAt.IsZero() || c.UpdatedAt.IsZero():
		return "case.registered_at and case.updated_at are required"
	case c.Handling != "" && c.Handling != "field" && c.Handling != "remote_inferred":
		return "case.handling must be field or remote_inferred, or left out"
	case (c.Latitude == nil) != (c.Longitude == nil):
		return "case.latitude and case.longitude go together"
	case !oneOf(c.DamageAssessment, "damage_assessment_method"):
		return "case.damage_assessment_method must be one of " + strings.Join(criteriaValues["damage_assessment_method"], ", ")
	case !oneOf(c.LocationType, "location_type"):
		return "case.location_type must be one of " + strings.Join(criteriaValues["location_type"], ", ")
	case !oneOf(c.CustomerPreference, "customer_preference"):
		return "case.customer_preference must be one of " + strings.Join(criteriaValues["customer_preference"], ", ")
	case (c.EstimatedDamageSar != nil && *c.EstimatedDamageSar < 0) || (c.ClaimValueSar != nil && *c.ClaimValueSar < 0):
		return "case.estimated_damage_sar and case.claim_value_sar cannot be negative"
	}
	return ""
}

// Validate checks a status event's shape.
func (e *StatusEvent) Validate() string {
	switch {
	case e.IdempotencyKey == "" || len(e.IdempotencyKey) > 200:
		return "idempotency_key is required (at most 200 characters)"
	case e.OccurredAt.IsZero():
		return "occurred_at is required"
	case e.AgentCode == "":
		return "agent_code is required"
	case !statuses[e.Status]:
		return "status must be one of " + strings.Join([]string{"available", "en_route", "on_scene", "on_break", "offline"}, ", ")
	case (e.Latitude == nil) != (e.Longitude == nil):
		return "latitude and longitude go together"
	}
	return ""
}

// Enqueue stores valid events once each and returns the tally.
func (s *Store) Enqueue(ctx context.Context, tenantID, keyID, feed string, events []Event, problems map[int]string) (Result, error) {
	res := Result{Rejected: []Rejection{}}
	for i, reason := range problems {
		res.Rejected = append(res.Rejected, Rejection{Index: i, Reason: reason})
	}
	_, err := tenancy.WithTenant(ctx, s.Conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for i, e := range events {
			if _, bad := problems[i]; bad {
				continue
			}
			tag, err := tx.Exec(ctx, `INSERT INTO feed_events (tenant_id, feed, idempotency_key, key_id, occurred_at, received_at, payload)
				VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id, feed, idempotency_key) DO NOTHING`,
				tenantID, feed, e.IdempotencyKey, keyID, e.OccurredAt, s.now(), []byte(e.Raw))
			if err != nil {
				return struct{}{}, err
			}
			if tag.RowsAffected() == 0 {
				res.Duplicates++
			} else {
				res.Accepted++
			}
		}
		return struct{}{}, nil
	})
	return res, err
}

// Tally is what a drain did.
type Tally struct{ Applied, Stale, Rejected int }

// ref: aux is a zone's city, a case type's name.
type ref struct{ id, aux string }

// Drain applies up to limit queued events, oldest event time first.
func (s *Store) Drain(ctx context.Context, tenantID, dataSource string, limit int) (Tally, error) {
	var classify Classifier
	if s.Classifiers != nil {
		var err error
		if classify, err = s.Classifiers(ctx, tenantID); err != nil {
			return Tally{}, err
		}
	}
	if s.OnClassified == nil {
		return s.drain(ctx, tenantID, dataSource, limit, classify)
	}
	// One unit: the cases and their audit.
	uctx, unit, owned := tenancy.BeginUnit(ctx)
	t, err := s.drain(uctx, tenantID, dataSource, limit, classify)
	if !owned {
		return t, err
	}
	if err != nil {
		unit.Rollback(ctx)
		return t, err
	}
	return t, unit.Commit(ctx)
}

func (s *Store) drain(ctx context.Context, tenantID, dataSource string, limit int, classify Classifier) (Tally, error) {
	return tenancy.WithTenant(ctx, s.Conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (Tally, error) {
		var t Tally
		rows, err := tx.Query(ctx, `SELECT id::text, feed, payload FROM feed_events WHERE status = 'queued'
			ORDER BY occurred_at, seq LIMIT $1 FOR UPDATE SKIP LOCKED`, limit)
		if err != nil {
			return t, err
		}
		type queued struct {
			id, feed string
			payload  []byte
		}
		var batch []queued
		for rows.Next() {
			var q queued
			if err := rows.Scan(&q.id, &q.feed, &q.payload); err != nil {
				return t, err
			}
			batch = append(batch, q)
		}
		rows.Close()
		if err := rows.Err(); err != nil || len(batch) == 0 {
			return t, err
		}
		look, err := loadRefs(ctx, tx)
		if err != nil {
			return t, err
		}
		for _, q := range batch {
			if _, err := tx.Exec(ctx, `SAVEPOINT feed_event`); err != nil {
				return t, err
			}
			status, reason, err := s.apply(ctx, tx, look, dataSource, q.feed, q.payload, tenantID, classify)
			if err != nil {
				// A value the database refuses (class 22 or 23) makes this event rejected, not the whole feed stuck.
				detail, refused := refusedValue(err)
				if !refused {
					return t, fmt.Errorf("event %s: %w", q.id, err)
				}
				if _, rerr := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT feed_event`); rerr != nil {
					return t, rerr
				}
				status, reason = "rejected", "the database refused a value: "+detail
			}
			if _, err := tx.Exec(ctx, `RELEASE SAVEPOINT feed_event`); err != nil {
				return t, err
			}
			switch status {
			case "applied":
				t.Applied++
			case "stale":
				t.Stale++
			default:
				t.Rejected++
			}
			if _, err := tx.Exec(ctx, `UPDATE feed_events SET status = $2, applied_at = $3, reject_reason = NULLIF($4, '') WHERE id = $1::uuid`, q.id, status, s.now(), reason); err != nil {
				return t, err
			}
		}
		return t, nil
	})
}

type refs struct{ zones, caseTypes, agents map[string]ref }

func loadRefs(ctx context.Context, tx pgx.Tx) (refs, error) {
	r := refs{map[string]ref{}, map[string]ref{}, map[string]ref{}}
	for _, q := range []struct {
		into map[string]ref
		sql  string
	}{
		{r.zones, `SELECT external_id, id::text, city_id::text FROM zones WHERE external_id IS NOT NULL`},
		{r.caseTypes, `SELECT external_id, id::text, name_en FROM case_types WHERE external_id IS NOT NULL`},
		{r.agents, `SELECT code, id::text, '' FROM agents`},
	} {
		rows, err := tx.Query(ctx, q.sql)
		if err != nil {
			return r, err
		}
		for rows.Next() {
			var k string
			var v ref
			if err := rows.Scan(&k, &v.id, &v.aux); err != nil {
				return r, err
			}
			q.into[k] = v
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return r, err
		}
	}
	return r, nil
}

func (s *Store) apply(ctx context.Context, tx pgx.Tx, look refs, dataSource, feed string, payload []byte, tenantID string, classify Classifier) (status, reason string, err error) {
	if feed == FeedAgentState {
		var e StatusEvent
		if err := json.Unmarshal(payload, &e); err != nil {
			return "rejected", "unreadable payload", nil
		}
		sv, ok := look.agents[e.AgentCode]
		if !ok {
			return "rejected", "unknown agent_code " + e.AgentCode, nil
		}
		if _, err := tx.Exec(ctx, `INSERT INTO agent_status_history (tenant_id, agent_id, status, latitude, longitude, occurred_at, received_at)
			VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $4, $5, $6)`, sv.id, e.Status, e.Latitude, e.Longitude, e.OccurredAt, s.now()); err != nil {
			return "", "", err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO agent_live_state (tenant_id, agent_id, status, latitude, longitude, occurred_at)
			VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $4, $5)
			ON CONFLICT (tenant_id, agent_id) DO UPDATE SET status = EXCLUDED.status, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
				occurred_at = EXCLUDED.occurred_at, updated_at = now() WHERE agent_live_state.occurred_at < EXCLUDED.occurred_at`,
			sv.id, e.Status, e.Latitude, e.Longitude, e.OccurredAt); err != nil {
			return "", "", err
		}
		return "applied", "", nil
	}
	var e CaseEvent
	if err := json.Unmarshal(payload, &e); err != nil {
		return "rejected", "unreadable payload", nil
	}
	c := e.Case
	zone, ok := look.zones[c.ZoneExternalID]
	if !ok {
		return "rejected", "unknown zone_external_id " + c.ZoneExternalID, nil
	}
	ct, ok := look.caseTypes[c.CaseTypeExternalID]
	if !ok {
		return "rejected", "unknown case_type_external_id " + c.CaseTypeExternalID, nil
	}
	var agent *string
	if c.AgentCode != nil {
		sv, ok := look.agents[*c.AgentCode]
		if !ok {
			return "rejected", "unknown agent_code " + *c.AgentCode, nil
		}
		agent = &sv.id
	}
	handling := c.Handling
	var cls *Classification
	if classify != nil {
		r := classify(c, ct.aux, s.now())
		cls, handling = &r, r.Handling
	}
	if handling == "" {
		return "rejected", "case.handling is required: no rules to classify it", nil
	}
	extra := c.CriteriaExtra()
	var before *prior
	if cls != nil {
		extra["classification"] = cls.Record
		if s.OnClassified != nil {
			if before, err = priorOf(ctx, tx, c.ExternalID); err != nil {
				return "", "", err
			}
		}
	}
	rawExtra, err := json.Marshal(extra)
	if err != nil {
		return "", "", err
	}
	// Only a newer updated_at changes a stored case.
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO cases (tenant_id, data_source, external_id, case_number, registered_at, updated_at, city_id, zone_id,
			latitude, longitude, case_type_id, parties_involved, assigned_at, arrived_at, closed_at, handling, agent_id, severity, injury_present,
			estimated_damage_sar, extra)
		VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6::uuid, $7::uuid, $8, $9, $10::uuid, $11, $12, $13, $14, $15, $16::uuid, $17, $18, $19, $20::jsonb)
		ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET case_number = EXCLUDED.case_number,
			registered_at = EXCLUDED.registered_at, updated_at = EXCLUDED.updated_at, city_id = EXCLUDED.city_id, zone_id = EXCLUDED.zone_id,
			latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, case_type_id = EXCLUDED.case_type_id, parties_involved = EXCLUDED.parties_involved,
			assigned_at = EXCLUDED.assigned_at, arrived_at = EXCLUDED.arrived_at, closed_at = EXCLUDED.closed_at, handling = EXCLUDED.handling,
			agent_id = EXCLUDED.agent_id, severity = EXCLUDED.severity, injury_present = EXCLUDED.injury_present,
			estimated_damage_sar = EXCLUDED.estimated_damage_sar, extra = cases.extra || EXCLUDED.extra
			WHERE cases.updated_at < EXCLUDED.updated_at
		RETURNING id::text`,
		dataSource, c.ExternalID, c.CaseNumber, c.RegisteredAt, c.UpdatedAt, zone.aux, zone.id, c.Latitude, c.Longitude, ct.id, c.PartiesInvolved,
		c.AssignedAt, c.ArrivedAt, c.ClosedAt, handling, agent, c.Severity, c.InjuryPresent, c.EstimatedDamageSar, string(rawExtra)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "stale", "", nil
	}
	if err != nil {
		return "", "", err
	}
	if cls != nil && s.OnClassified != nil && before.changed(handling, *cls) {
		e := Classified{CaseID: id, CaseNumber: c.CaseNumber, Handling: handling, Outcome: cls.Outcome, RuleCode: cls.RuleCode, Record: cls.Record}
		if before != nil {
			e.Previous = &before.handling
		}
		if err := s.OnClassified(ctx, tenantID, e); err != nil {
			return "", "", err
		}
	}
	return "applied", "", nil
}

// prior is a stored case's classification.
type prior struct {
	handling, outcome, rule string
}

func priorOf(ctx context.Context, tx pgx.Tx, externalID string) (*prior, error) {
	var p prior
	err := tx.QueryRow(ctx, `SELECT handling, coalesce(extra->'classification'->>'outcome', ''), coalesce(extra->'classification'->>'rule_code', '')
		FROM cases WHERE external_id = $1`, externalID).Scan(&p.handling, &p.outcome, &p.rule)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

// changed: new, or another handling, outcome or rule.
func (p *prior) changed(handling string, c Classification) bool {
	return p == nil || p.handling != handling || p.outcome != c.Outcome || p.rule != c.RuleCode
}

// Purge deletes history and finished events older than a cut-off.
func (s *Store) Purge(ctx context.Context, tenantID string, before time.Time) (int64, error) {
	return tenancy.WithTenant(ctx, s.Conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (int64, error) {
		a, err := tx.Exec(ctx, `DELETE FROM agent_status_history WHERE occurred_at < $1`, before)
		if err != nil {
			return 0, err
		}
		b, err := tx.Exec(ctx, `DELETE FROM feed_events WHERE status <> 'queued' AND received_at < $1`, before)
		if err != nil {
			return 0, err
		}
		return a.RowsAffected() + b.RowsAffected(), nil
	})
}

// FeedHealth is one feed's state.
type FeedHealth struct {
	Feed         string     `json:"feed"`
	Queued       int        `json:"queued"`
	Applied      int        `json:"applied"`
	Stale        int        `json:"stale"`
	Rejected     int        `json:"rejected"`
	LastReceived *time.Time `json:"last_received_at"`
	LastApplied  *time.Time `json:"last_applied_at"`
	// RecentRejected counts refusals in the last hour.
	RecentRejected int        `json:"recent_rejected"`
	LastErrorAt    *time.Time `json:"last_error_at"`
	LastError      *string    `json:"last_error"`
}

// Health summarises both feeds.
func (s *Store) Health(ctx context.Context, tenantID string) ([]FeedHealth, error) {
	return tenancy.WithTenant(ctx, s.Conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]FeedHealth, error) {
		out := []FeedHealth{{Feed: FeedCase}, {Feed: FeedAgentState}}
		for i := range out {
			err := tx.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status = 'queued'), count(*) FILTER (WHERE status = 'applied'),
				count(*) FILTER (WHERE status = 'stale'), count(*) FILTER (WHERE status = 'rejected'), max(received_at),
				max(applied_at) FILTER (WHERE status = 'applied'), count(*) FILTER (WHERE status = 'rejected' AND applied_at > $2)
				FROM feed_events WHERE feed = $1`, out[i].Feed, s.now().Add(-time.Hour)).Scan(&out[i].Queued, &out[i].Applied, &out[i].Stale, &out[i].Rejected,
				&out[i].LastReceived, &out[i].LastApplied, &out[i].RecentRejected)
			if err != nil {
				return nil, err
			}
			err = tx.QueryRow(ctx, `SELECT applied_at, reject_reason FROM feed_events WHERE feed = $1 AND status = 'rejected' ORDER BY applied_at DESC LIMIT 1`,
				out[i].Feed).Scan(&out[i].LastErrorAt, &out[i].LastError)
			if err != nil && err != pgx.ErrNoRows {
				return nil, err
			}
		}
		return out, nil
	})
}

// refusedValue is true for an error about the event's own data: a value out of range or a broken constraint, not a lost connection.
func refusedValue(err error) (string, bool) {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return pg.Message, strings.HasPrefix(pg.Code, "22") || strings.HasPrefix(pg.Code, "23")
	}
	if strings.Contains(err.Error(), "unable to encode") {
		return "a number is out of range", true
	}
	return "", false
}
