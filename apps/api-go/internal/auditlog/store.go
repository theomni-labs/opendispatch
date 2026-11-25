// SPDX-License-Identifier: AGPL-3.0-only

package auditlog

import (
	"context"
	"sync"
)

// Store keeps audit events. Append only: no update, no delete.
type Store interface {
	Insert(ctx context.Context, event AuditEvent) error
	// List: one tenant's events, oldest appended first.
	List(ctx context.Context, tenantID string) ([]AuditEvent, error)
}

type memoryStore struct {
	mu     sync.Mutex
	events []AuditEvent
}

func (m *memoryStore) Insert(_ context.Context, event AuditEvent) error {
	m.mu.Lock()
	m.events = append(m.events, event)
	m.mu.Unlock()
	return nil
}

func (m *memoryStore) List(_ context.Context, tenantID string) ([]AuditEvent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []AuditEvent
	for _, e := range m.events {
		if e.TenantID == tenantID {
			out = append(out, e)
		}
	}
	return out, nil
}

func (m *memoryStore) all() []AuditEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]AuditEvent, len(m.events))
	copy(out, m.events)
	return out
}

func (m *memoryStore) reset() {
	m.mu.Lock()
	m.events = nil
	m.mu.Unlock()
}

var (
	memory       = &memoryStore{}
	storeMu      sync.RWMutex
	currentStore Store = memory
)

// UseStore switches where events go (the api uses Postgres).
func UseStore(s Store) {
	storeMu.Lock()
	currentStore = s
	storeMu.Unlock()
}

func activeStore() Store {
	storeMu.RLock()
	defer storeMu.RUnlock()
	return currentStore
}

// EventsOf: a tenant's events, oldest appended first.
func EventsOf(ctx context.Context, tenantID string) ([]AuditEvent, error) {
	return activeStore().List(ctx, tenantID)
}

var testTruncate func(ctx context.Context) error

// SetTestTruncate wires the owner-level clear that only test routes call.
func SetTestTruncate(fn func(ctx context.Context) error) { testTruncate = fn }

// TruncateForTest clears the stored events (tests only; the api never calls it).
func TruncateForTest(ctx context.Context) error {
	memory.reset()
	if testTruncate == nil {
		return nil
	}
	return testTruncate(ctx)
}

// MemoryStore is the default store (tests put it back with UseStore).
func MemoryStore() Store { return memory }
