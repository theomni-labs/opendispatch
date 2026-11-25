// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// engineAnswerKeep is how many scopes stay per customer and engine.
const engineAnswerKeep = 7

const scenarioScopePrefix = "scenario:"

func isScenarioScope(scope string) bool { return strings.HasPrefix(scope, scenarioScopePrefix) }

// mergeFn puts the new answer over the one kept in the same scope.
type mergeFn func(prev, next []byte) []byte

// engineAnswerBackend keeps the last good answers of the batch engines.
type engineAnswerBackend interface {
	keep(ctx context.Context, tenant string, name engines.Name, scope string, body []byte, merge mergeFn) error
	latest(ctx context.Context, tenant string, name engines.Name) ([]byte, error)
}

var engineAnswerData engineAnswerBackend = &memoryEngineAnswers{rows: map[string]memoryEngineAnswer{}}

// UsePostgresEngineAnswers: Postgres store.
func UsePostgresEngineAnswers(conn *tenancy.Connection) {
	engineAnswerData = pgEngineAnswers{conn: conn}
	forgetAllForecasterOutputs()
}

// UseMemoryEngineAnswers: memory store (tests).
func UseMemoryEngineAnswers() {
	engineAnswerData = &memoryEngineAnswers{rows: map[string]memoryEngineAnswer{}}
	forgetAllForecasterOutputs()
}

type memoryEngineAnswer struct {
	tenant, engine, scope string
	body                  []byte
	at                    time.Time
	seq                   int
}

type memoryEngineAnswers struct {
	mu   sync.Mutex
	rows map[string]memoryEngineAnswer
	seq  int
}

func (m *memoryEngineAnswers) reset() {
	m.mu.Lock()
	m.rows, m.seq = map[string]memoryEngineAnswer{}, 0
	m.mu.Unlock()
}

func (m *memoryEngineAnswers) keep(_ context.Context, tenant string, name engines.Name, scope string, body []byte, merge mergeFn) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := tenant + "|" + string(name) + "|" + scope
	if prev, ok := m.rows[key]; ok && merge != nil {
		body = merge(prev.body, body)
	}
	m.seq++
	m.rows[key] = memoryEngineAnswer{tenant: tenant, engine: string(name), scope: scope, body: append([]byte(nil), body...), at: time.Now(), seq: m.seq}
	var mine []string
	for k, r := range m.rows {
		if r.tenant == tenant && r.engine == string(name) && isScenarioScope(r.scope) == isScenarioScope(scope) {
			mine = append(mine, k)
		}
	}
	sort.Slice(mine, func(i, j int) bool { return m.rows[mine[i]].seq > m.rows[mine[j]].seq })
	for _, k := range mine[min(len(mine), engineAnswerKeep):] {
		delete(m.rows, k)
	}
	return nil
}

func (m *memoryEngineAnswers) latest(_ context.Context, tenant string, name engines.Name) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var best *memoryEngineAnswer
	for _, r := range m.rows {
		if r.tenant == tenant && r.engine == string(name) && !isScenarioScope(r.scope) && (best == nil || r.seq > best.seq) {
			r := r
			best = &r
		}
	}
	if best == nil {
		return nil, nil
	}
	return append([]byte(nil), best.body...), nil
}

type pgEngineAnswers struct{ conn *tenancy.Connection }

// answerSource reads the data_source an answer carries.
func answerSource(body []byte) string {
	var h struct {
		DataSource string `json:"data_source"`
	}
	if json.Unmarshal(body, &h) != nil || h.DataSource == "" {
		return "SYNTHETIC"
	}
	return h.DataSource
}

func (p pgEngineAnswers) keep(ctx context.Context, tenant string, name engines.Name, scope string, body []byte, merge mergeFn) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, tenant+"|"+string(name)+"|"+scope); err != nil {
			return struct{}{}, err
		}
		var prev []byte
		err := tx.QueryRow(ctx, `SELECT body::text FROM engine_answers WHERE engine = $1 AND scope_key = $2`, string(name), scope).Scan(&prev)
		if err != nil && err != pgx.ErrNoRows {
			return struct{}{}, err
		}
		if err == nil && merge != nil {
			body = merge(prev, body)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO engine_answers (tenant_id, id, data_source, created_at, updated_at, engine, scope_key, body)
			VALUES (current_setting('app.tenant_id')::uuid, gen_random_uuid(), $1, clock_timestamp(), clock_timestamp(), $2, $3, $4::jsonb)
			ON CONFLICT (tenant_id, engine, scope_key) DO UPDATE SET body = EXCLUDED.body, data_source = EXCLUDED.data_source, updated_at = clock_timestamp()`,
			answerSource(body), string(name), scope, string(body)); err != nil {
			return struct{}{}, err
		}
		_, err = tx.Exec(ctx, `DELETE FROM engine_answers WHERE engine = $1 AND (left(scope_key, 9) = 'scenario:') = $3 AND id NOT IN (
			SELECT id FROM engine_answers WHERE engine = $1 AND (left(scope_key, 9) = 'scenario:') = $3 ORDER BY updated_at DESC, id LIMIT $2)`,
			string(name), engineAnswerKeep, isScenarioScope(scope))
		return struct{}{}, err
	})
	return err
}

func (p pgEngineAnswers) latest(ctx context.Context, tenant string, name engines.Name) ([]byte, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]byte, error) {
		var body []byte
		err := tx.QueryRow(ctx, `SELECT body::text FROM engine_answers WHERE engine = $1 AND left(scope_key, 9) <> 'scenario:' ORDER BY updated_at DESC, id LIMIT 1`, string(name)).Scan(&body)
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return body, err
	})
}

// ReseedEngineAnswersForTest: empties the fixture tenant (owner).
func ReseedEngineAnswersForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, isPg := engineAnswerData.(pgEngineAnswers); !isPg {
		return nil
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	_, err = owner.Pool.Exec(ctx, `DELETE FROM engine_answers WHERE tenant_id = $1::uuid`, tenant)
	return err
}
