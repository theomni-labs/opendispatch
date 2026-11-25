// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"strconv"
	"sync"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// Decoded outputs kept per tenant, newest first.
const forecasterCacheKeep = 2

// forecasterOutput: one decoded output, indexed.
type forecasterOutput struct {
	identity string
	once     sync.Once
	doc      *ForecasterEngineOutput
	index    map[string][]EngineValue
	err      error
}

var (
	forecasterCacheMu sync.Mutex
	forecasterCache   = map[string][]*forecasterOutput{}
)

// forgetForecasterOutputs drops one tenant's entries.
func forgetForecasterOutputs(tenant string) {
	forecasterCacheMu.Lock()
	delete(forecasterCache, tenant)
	forecasterCacheMu.Unlock()
}

// forgetAllForecasterOutputs: store or mode changed.
func forgetAllForecasterOutputs() {
	forecasterCacheMu.Lock()
	forecasterCache = map[string][]*forecasterOutput{}
	forecasterCacheMu.Unlock()
}

// forecasterEntry: the tenant's entry for identity.
func forecasterEntry(tenant, identity string) *forecasterOutput {
	forecasterCacheMu.Lock()
	defer forecasterCacheMu.Unlock()
	list := forecasterCache[tenant]
	for i, e := range list {
		if e.identity == identity {
			if i > 0 {
				list = append(append([]*forecasterOutput{e}, list[:i]...), list[i+1:]...)
				forecasterCache[tenant] = list
			}
			return e
		}
	}
	e := &forecasterOutput{identity: identity}
	list = append([]*forecasterOutput{e}, list...)
	if len(list) > forecasterCacheKeep {
		list = list[:forecasterCacheKeep]
	}
	forecasterCache[tenant] = list
	return e
}

// dropForecasterEntry removes a failed entry.
func dropForecasterEntry(tenant string, e *forecasterOutput) {
	forecasterCacheMu.Lock()
	defer forecasterCacheMu.Unlock()
	list := forecasterCache[tenant]
	for i, x := range list {
		if x == e {
			forecasterCache[tenant] = append(list[:i:i], list[i+1:]...)
			return
		}
	}
}

// keptForecasterIdentity: the kept answer's id, "" if none.
func keptForecasterIdentity(ctx context.Context, tenant string) (string, error) {
	switch b := engineAnswerData.(type) {
	case pgEngineAnswers:
		return tenancy.WithTenant(ctx, b.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (string, error) {
			var id string
			err := tx.QueryRow(ctx, `SELECT id::text || '|' || updated_at::text FROM engine_answers
				WHERE engine = $1 AND left(scope_key, 9) <> 'scenario:' ORDER BY updated_at DESC, id LIMIT 1`, string(engines.Forecaster)).Scan(&id)
			if err == pgx.ErrNoRows {
				return "", nil
			}
			return id, err
		})
	case *memoryEngineAnswers:
		b.mu.Lock()
		defer b.mu.Unlock()
		best := 0
		for _, r := range b.rows {
			if r.tenant == tenant && r.engine == string(engines.Forecaster) && !isScenarioScope(r.scope) && r.seq > best {
				best = r.seq
			}
		}
		if best == 0 {
			return "", nil
		}
		return strconv.Itoa(best), nil
	}
	return "", nil
}

// fixtureForecasterIdentity: the fixture file's stamp.
func fixtureForecasterIdentity() (string, error) {
	stamp, err := fixtures.ObjectStamp("forecaster.output")
	return "fixture|" + stamp, err
}

// cachedForecasterOutput: readForecasterOutput, kept.
func cachedForecasterOutput(ctx context.Context, tenant string) (*forecasterOutput, error) {
	identity := ""
	if engineMode() == engines.ModeEngine {
		kept, err := keptForecasterIdentity(ctx, tenant)
		if err != nil {
			return nil, err
		}
		if kept != "" {
			identity = "kept|" + kept
		}
	}
	if identity == "" {
		stamp, err := fixtureForecasterIdentity()
		if err != nil {
			return nil, err
		}
		identity = stamp
	}
	e := forecasterEntry(tenant, identity)
	e.once.Do(func() {
		e.doc, e.err = readForecasterOutput(ctx, tenant)
		if e.doc != nil {
			e.index = engineIndex(e.doc)
		}
	})
	if e.err != nil {
		dropForecasterEntry(tenant, e)
		return nil, e.err
	}
	return e, nil
}
