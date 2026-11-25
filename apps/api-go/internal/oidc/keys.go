// SPDX-License-Identifier: AGPL-3.0-only

package oidc

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
)

// KeySource finds the public key a token was signed with.
type KeySource interface {
	Key(ctx context.Context, keyID string) (*jose.JSONWebKey, error)
}

// maxBody caps what a discovery or key-set answer may weigh.
const maxBody = 1 << 20

// RemoteKeys serves an issuer's published key set: cached for TTL, fetched again at once when a token names a key id that is not
// cached (the issuer rotated), but never more often than MinRefresh, so an attacker's random key ids cannot make us fetch at will.
type RemoteKeys struct {
	URL        string
	Client     *http.Client
	TTL        time.Duration
	MinRefresh time.Duration
	Now        func() time.Time

	mu        sync.Mutex
	keys      map[string]jose.JSONWebKey
	fetchedAt time.Time
}

func (r *RemoteKeys) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func (r *RemoteKeys) Key(ctx context.Context, keyID string) (*jose.JSONWebKey, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ttl, minRefresh := r.TTL, r.MinRefresh
	if ttl == 0 {
		ttl = 10 * time.Minute
	}
	if minRefresh == 0 {
		minRefresh = 30 * time.Second
	}
	age := r.now().Sub(r.fetchedAt)
	if r.keys == nil || age >= ttl {
		if err := r.fetch(ctx); err != nil {
			return nil, err
		}
	}
	if key, ok := r.keys[keyID]; ok {
		return &key, nil
	}
	// Not cached: a rotation. Fetch again, at most once per MinRefresh.
	if r.now().Sub(r.fetchedAt) >= minRefresh {
		if err := r.fetch(ctx); err != nil {
			return nil, err
		}
		if key, ok := r.keys[keyID]; ok {
			return &key, nil
		}
	}
	return nil, ErrUnknownKey
}

func (r *RemoteKeys) fetch(ctx context.Context) error {
	client := r.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.URL, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("oidc: fetching the key set: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("oidc: the key set answered %d", resp.StatusCode)
	}
	var set jose.JSONWebKeySet
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBody)).Decode(&set); err != nil {
		return fmt.Errorf("oidc: reading the key set: %w", err)
	}
	keys := make(map[string]jose.JSONWebKey, len(set.Keys))
	for _, k := range set.Keys {
		if k.KeyID == "" || !k.IsPublic() || (k.Use != "" && k.Use != "sig") {
			continue
		}
		keys[k.KeyID] = k
	}
	r.keys, r.fetchedAt = keys, r.now()
	return nil
}

// StaticKeys is a fixed key set (tests, and a customer that pins its keys).
type StaticKeys struct{ Set jose.JSONWebKeySet }

func (s StaticKeys) Key(_ context.Context, keyID string) (*jose.JSONWebKey, error) {
	for _, k := range s.Set.Key(keyID) {
		key := k
		return &key, nil
	}
	return nil, ErrUnknownKey
}

// NewKeyResolver gives each customer one key source, found through discovery the first time a token needs it.
func NewKeyResolver(client *http.Client) func(Tenant) KeySource {
	var mu sync.Mutex
	sources := map[string]KeySource{}
	return func(t Tenant) KeySource {
		mu.Lock()
		defer mu.Unlock()
		if s, ok := sources[t.Issuer]; ok {
			return s
		}
		s := &lazyKeys{tenant: t, client: client}
		sources[t.Issuer] = s
		return s
	}
}

type lazyKeys struct {
	tenant Tenant
	client *http.Client
	mu     sync.Mutex
	remote *RemoteKeys
}

func (l *lazyKeys) Key(ctx context.Context, keyID string) (*jose.JSONWebKey, error) {
	l.mu.Lock()
	if l.remote == nil {
		e, err := Discover(ctx, l.client, l.tenant.Issuer, l.tenant.AllowInsecureHTTP)
		if err != nil {
			l.mu.Unlock()
			return nil, err
		}
		l.remote = &RemoteKeys{URL: e.JWKSURI, Client: l.client}
	}
	remote := l.remote
	l.mu.Unlock()
	return remote.Key(ctx, keyID)
}
