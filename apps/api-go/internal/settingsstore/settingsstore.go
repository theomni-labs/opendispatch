// SPDX-License-Identifier: AGPL-3.0-only

// Package settingsstore keeps per-customer settings: in memory (seeded from fixtures, for unit tests) or in Postgres.
package settingsstore

import (
	"context"
	"encoding/json"
	"strings"
	"sync"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
)

// Entry is one stored setting, as the Setting record.
type Entry struct {
	ID         string
	TenantID   string
	CreatedAt  string
	UpdatedAt  string
	CreatedBy  *string
	DataSource string
	Key        string
	Value      any
}

var (
	mu     sync.Mutex
	rows   = map[string]*Entry{}
	order  []string
	seeded bool
)

type fixtureSetting struct {
	ID         string          `json:"id"`
	TenantID   string          `json:"tenant_id"`
	CreatedAt  string          `json:"created_at"`
	UpdatedAt  string          `json:"updated_at"`
	CreatedBy  *string         `json:"created_by"`
	DataSource string          `json:"data_source"`
	Key        string          `json:"key"`
	Value      json.RawMessage `json:"value"`
}

func seedLocked() {
	if seeded {
		return
	}
	seeded = true
	recs, err := fixtures.Records[fixtureSetting]("Setting")
	if err != nil {
		return
	}
	for _, r := range recs {
		var v any
		if json.Unmarshal(r.Value, &v) != nil {
			continue
		}
		rows[r.Key] = &Entry{ID: r.ID, TenantID: r.TenantID, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, CreatedBy: r.CreatedBy, DataSource: r.DataSource, Key: r.Key, Value: v}
		order = append(order, r.Key)
	}
}

// Convert: v as a T (JSON round trip when needed).
func Convert[T any](v any) (T, bool) {
	if typed, ok := v.(T); ok {
		return typed, true
	}
	var out T
	raw, err := json.Marshal(v)
	if err != nil {
		return out, false
	}
	if json.Unmarshal(raw, &out) != nil {
		return out, false
	}
	return out, true
}

// Backend is where settings live. The memory backend ignores the customer (one set, as in the demo); Postgres keeps one per customer.
type Backend interface {
	get(ctx context.Context, tenant, key string) (Entry, bool, error)
	put(ctx context.Context, tenant, key string, value any) error
	putMany(ctx context.Context, tenant string, kvs []KV) error
	incr(ctx context.Context, tenant, key string, delta int) (int, error)
	list(ctx context.Context, tenant string) ([]Entry, error)
	deletePrefix(ctx context.Context, tenant, prefix string) error
	getRaw(ctx context.Context, tenant, key string) (string, bool, error)
	swap(ctx context.Context, tenant, key, stamp string, value any) (bool, error)
}

// GetStamped reads a setting with a stamp of the stored value ("" when the key is unset), for Swap.
func GetStamped[T any](ctx context.Context, tenant, key string, fallback T) (T, string, error) {
	raw, ok, err := backend.getRaw(ctx, tenant, key)
	if err != nil || !ok {
		return fallback, "", err
	}
	var typed T
	if json.Unmarshal([]byte(raw), &typed) != nil {
		return fallback, raw, nil
	}
	return typed, raw, nil
}

// Swap stores value only while the stored value still has stamp; false when another write came first.
func Swap(ctx context.Context, tenant, key, stamp string, value any) (bool, error) {
	return backend.swap(ctx, tenant, key, stamp, value)
}

var backend Backend = memoryBackend{}

// UseMemory puts the in-memory backend back (tests).
func UseMemory() { backend = memoryBackend{} }

// Get reads a setting; an unset key or a value of another type gives the fallback.
func Get[T any](ctx context.Context, tenant, key string, fallback T) (T, error) {
	e, ok, err := backend.get(ctx, tenant, key)
	if err != nil {
		return fallback, err
	}
	if !ok {
		return fallback, nil
	}
	typed, ok := Convert[T](e.Value)
	if !ok {
		return fallback, nil
	}
	return typed, nil
}

// Has reports whether the key is stored.
func Has(ctx context.Context, tenant, key string) (bool, error) {
	_, ok, err := backend.get(ctx, tenant, key)
	return ok, err
}

// KV is one key and value of a PutMany.
type KV struct {
	Key   string
	Value any
}

// PutMany stores several settings together: all or none.
func PutMany(ctx context.Context, tenant string, kvs ...KV) error {
	return backend.putMany(ctx, tenant, kvs)
}

// Incr adds one to a whole-number setting (unset counts as zero) and returns the new value, in one step.
func Incr(ctx context.Context, tenant, key string) (int, error) {
	return backend.incr(ctx, tenant, key, 1)
}

// Add changes a whole-number setting by delta (never below zero) and returns the new value, in one step.
func Add(ctx context.Context, tenant, key string, delta int) (int, error) {
	return backend.incr(ctx, tenant, key, delta)
}

// Put stores a setting.
func Put(ctx context.Context, tenant, key string, value any) error {
	return backend.put(ctx, tenant, key, value)
}

// Entries lists every stored setting, oldest first.
func Entries(ctx context.Context, tenant string) ([]Entry, error) { return backend.list(ctx, tenant) }

// WithPrefix lists stored entries whose key starts with prefix.
func WithPrefix(ctx context.Context, tenant, prefix string) ([]Entry, error) {
	all, err := backend.list(ctx, tenant)
	if err != nil {
		return nil, err
	}
	var out []Entry
	for _, e := range all {
		if strings.HasPrefix(e.Key, prefix) {
			out = append(out, e)
		}
	}
	return out, nil
}

// DeletePrefix removes every entry whose key starts with prefix.
func DeletePrefix(ctx context.Context, tenant, prefix string) error {
	return backend.deletePrefix(ctx, tenant, prefix)
}

// ---- memory ----

type memoryBackend struct{}

func (memoryBackend) get(_ context.Context, _, key string) (Entry, bool, error) {
	mu.Lock()
	defer mu.Unlock()
	seedLocked()
	e, ok := rows[key]
	if !ok {
		return Entry{}, false, nil
	}
	return *e, true, nil
}

func (memoryBackend) put(_ context.Context, _, key string, value any) error {
	mu.Lock()
	defer mu.Unlock()
	seedLocked()
	now := datactx.NowISO()
	if e, ok := rows[key]; ok {
		e.Value, e.UpdatedAt = value, now
		return nil
	}
	rows[key] = &Entry{ID: datactx.NewID(), CreatedAt: now, UpdatedAt: now, DataSource: recordsource.Get(), Key: key, Value: value}
	order = append(order, key)
	return nil
}

func (m memoryBackend) incr(ctx context.Context, tenant, key string, delta int) (int, error) {
	mu.Lock()
	seedLocked()
	cur := 0
	if e, ok := rows[key]; ok {
		if v, ok := Convert[int](e.Value); ok {
			cur = v
		}
	}
	mu.Unlock()
	next := max(0, cur+delta)
	return next, m.put(ctx, tenant, key, next)
}

func (m memoryBackend) putMany(ctx context.Context, tenant string, kvs []KV) error {
	for _, kv := range kvs {
		if err := m.put(ctx, tenant, kv.Key, kv.Value); err != nil {
			return err
		}
	}
	return nil
}

func (memoryBackend) list(context.Context, string) ([]Entry, error) {
	mu.Lock()
	defer mu.Unlock()
	seedLocked()
	out := make([]Entry, 0, len(order))
	for _, k := range order {
		out = append(out, *rows[k])
	}
	return out, nil
}

func (memoryBackend) getRaw(_ context.Context, _, key string) (string, bool, error) {
	mu.Lock()
	defer mu.Unlock()
	seedLocked()
	e, ok := rows[key]
	if !ok {
		return "", false, nil
	}
	raw, err := json.Marshal(e.Value)
	return string(raw), true, err
}

func (memoryBackend) swap(_ context.Context, _, key, stamp string, value any) (bool, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return false, err
	}
	mu.Lock()
	defer mu.Unlock()
	seedLocked()
	e, ok := rows[key]
	if !ok {
		if stamp != "" {
			return false, nil
		}
		now := datactx.NowISO()
		rows[key] = &Entry{ID: datactx.NewID(), CreatedAt: now, UpdatedAt: now, DataSource: recordsource.Get(), Key: key, Value: json.RawMessage(raw)}
		order = append(order, key)
		return true, nil
	}
	current, err := json.Marshal(e.Value)
	if err != nil || string(current) != stamp {
		return false, err
	}
	e.Value, e.UpdatedAt = json.RawMessage(raw), datactx.NowISO()
	return true, nil
}

func (memoryBackend) deletePrefix(_ context.Context, _, prefix string) error {
	mu.Lock()
	defer mu.Unlock()
	seedLocked()
	kept := order[:0]
	for _, k := range order {
		if strings.HasPrefix(k, prefix) {
			delete(rows, k)
			continue
		}
		kept = append(kept, k)
	}
	order = kept
	return nil
}

// ResetForTest clears every stored setting (no fixtures).
func ResetForTest() {
	mu.Lock()
	rows, order, seeded = map[string]*Entry{}, nil, true
	mu.Unlock()
}

// ReloadForTest restores the fixture settings.
func ReloadForTest() {
	mu.Lock()
	rows, order, seeded = map[string]*Entry{}, nil, false
	mu.Unlock()
}
