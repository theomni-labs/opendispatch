// SPDX-License-Identifier: AGPL-3.0-only

// Package fixtures ports fixtures.ts.
package fixtures

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// ManifestEntry mirrors ManifestEntry.
type ManifestEntry struct {
	Path   string `json:"path"`
	Schema string `json:"schema"`
	Kind   string `json:"kind"`
	Count  int    `json:"count"`
}

var (
	repoRootOnce sync.Once
	repoRootVal  string
	repoRootErr  error
)

// RepoRoot: the nearest pnpm-workspace.yaml parent.
func RepoRoot() (string, error) {
	repoRootOnce.Do(func() {
		dir, err := os.Getwd()
		if err != nil {
			repoRootErr = err
			return
		}
		for depth := 0; depth < 8; depth++ {
			if _, statErr := os.Stat(filepath.Join(dir, "pnpm-workspace.yaml")); statErr == nil {
				repoRootVal = dir
				return
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
		repoRootErr = fmt.Errorf("cannot find the repository root (pnpm-workspace.yaml)")
	})
	return repoRootVal, repoRootErr
}

// Dir: fixtures dir; OPENDISPATCH_FIXTURES_DIR overrides.
func Dir() (string, error) {
	if override := os.Getenv("OPENDISPATCH_FIXTURES_DIR"); override != "" {
		return filepath.Abs(override)
	}
	root, err := RepoRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "fixtures"), nil
}

var (
	mu           sync.Mutex
	manifestDir  string
	manifestRows []ManifestEntry
)

// parseManifest: a bare array or {"files": [...]}.
func parseManifest(raw []byte) ([]ManifestEntry, error) {
	var entries []ManifestEntry
	if err := json.Unmarshal(raw, &entries); err == nil {
		return entries, nil
	}
	var wrapped struct {
		Files []ManifestEntry `json:"files"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("manifest.json must be an array or {files: [...]}: %w", err)
	}
	return wrapped.Files, nil
}

var (
	recordsMu    sync.Mutex
	recordsDir   string
	recordsCache = map[string]any{}
)

// ClearCacheForTest forgets everything read so far.
func ClearCacheForTest() {
	mu.Lock()
	manifestDir, manifestRows = "", nil
	mu.Unlock()
	recordsMu.Lock()
	recordsDir, recordsCache = "", map[string]any{}
	recordsMu.Unlock()
}

// Manifest mirrors readManifest.
func Manifest() ([]ManifestEntry, error) {
	dir, err := Dir()
	if err != nil {
		return nil, err
	}
	mu.Lock()
	if manifestDir == dir && manifestRows != nil {
		rows := manifestRows
		mu.Unlock()
		return rows, nil
	}
	mu.Unlock()
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return nil, err
	}
	entries, err := parseManifest(raw)
	if err != nil {
		return nil, err
	}
	mu.Lock()
	manifestDir, manifestRows = dir, entries
	mu.Unlock()
	return entries, nil
}

// Object mirrors fixtureObject.
func Object(schema string, out any) (bool, error) {
	entries, err := Manifest()
	if err != nil {
		return false, err
	}
	var path string
	for _, e := range entries {
		if e.Schema == schema && e.Kind == "object" {
			path = e.Path
			break
		}
	}
	if path == "" {
		return false, nil
	}
	dir, err := Dir()
	if err != nil {
		return false, err
	}
	raw, err := os.ReadFile(filepath.Join(dir, path))
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return false, fmt.Errorf("%s: %w", path, err)
	}
	return true, nil
}

// ObjectStamp: an object fixture's path, size, mtime.
func ObjectStamp(schema string) (string, error) {
	entries, err := Manifest()
	if err != nil {
		return "", err
	}
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		if e.Schema == schema && e.Kind == "object" {
			path := filepath.Join(dir, e.Path)
			info, err := os.Stat(path)
			if err != nil {
				return path, nil
			}
			return fmt.Sprintf("%s|%d|%d", path, info.Size(), info.ModTime().UnixNano()), nil
		}
	}
	return dir, nil
}

// Records mirrors fixtureRecords: every record of a
// schema, from all its array fixtures, in order.
func Records[T any](schema string) ([]T, error) {
	dir, err := Dir()
	if err != nil {
		return nil, err
	}
	cacheKey := schema + "|" + fmt.Sprintf("%T", []T(nil))
	recordsMu.Lock()
	if recordsDir == dir {
		if hit, ok := recordsCache[cacheKey]; ok {
			recordsMu.Unlock()
			return append([]T(nil), hit.([]T)...), nil
		}
	}
	recordsMu.Unlock()
	entries, err := Manifest()
	if err != nil {
		return nil, err
	}
	var out []T
	for _, e := range entries {
		if e.Schema != schema || e.Kind != "array" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Path))
		if err != nil {
			return nil, err
		}
		var rows []T
		if err := json.Unmarshal(raw, &rows); err != nil {
			return nil, fmt.Errorf("%s: %w", e.Path, err)
		}
		out = append(out, rows...)
	}
	recordsMu.Lock()
	if recordsDir != dir {
		recordsDir, recordsCache = dir, map[string]any{}
	}
	recordsCache[cacheKey] = out
	recordsMu.Unlock()
	return append([]T(nil), out...), nil
}

// Seed: manifest.json's top-level generator seed.
func Seed() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return "", err
	}
	var doc struct {
		Seed string `json:"seed"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return "", err
	}
	if doc.Seed == "" {
		return "", fmt.Errorf("fixtures/manifest.json has no seed")
	}
	return doc.Seed, nil
}

// TenantID mirrors fixtureTenantId.
func TenantID() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return "", err
	}
	var doc struct {
		TenantID string `json:"tenant_id"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return "", err
	}
	if doc.TenantID == "" {
		return "", fmt.Errorf("fixtures/manifest.json has no tenant_id")
	}
	return doc.TenantID, nil
}
