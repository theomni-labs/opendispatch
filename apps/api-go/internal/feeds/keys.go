// SPDX-License-Identifier: AGPL-3.0-only

// Package feeds takes signed inbound feeds (cases, agent status).
package feeds

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

var (
	ErrUnknownKey = errors.New("feeds: unknown or revoked key")
	ErrSignature  = errors.New("feeds: bad signature")
	ErrTimestamp  = errors.New("feeds: timestamp outside the allowed window")
)

// Key is one signing key; a key names its customer.
type Key struct {
	ID         string    `json:"key_id"`
	TenantID   string    `json:"tenant_id"`
	SecretEnv  string    `json:"secret_env"`
	Status     string    `json:"status"`
	NotAfter   time.Time `json:"not_after"`
	DataSource string    `json:"data_source"`
	secret     []byte
}

// Keys is the set of keys, read once at start.
type Keys struct{ byID map[string]Key }

// NewKeys checks every entry; a bad one stops the start.
func NewKeys(list []Key) (*Keys, error) {
	k := &Keys{byID: map[string]Key{}}
	for _, key := range list {
		if key.ID == "" || key.TenantID == "" {
			return nil, errors.New("feeds: a key needs key_id and tenant_id")
		}
		if key.Status != "active" && key.Status != "retiring" && key.Status != "revoked" {
			return nil, fmt.Errorf("feeds: key %s: status must be active, retiring or revoked", key.ID)
		}
		if key.Status == "retiring" && key.NotAfter.IsZero() {
			return nil, fmt.Errorf("feeds: key %s: a retiring key needs not_after", key.ID)
		}
		if key.DataSource != "SYNTHETIC" && key.DataSource != "IMPORTED" && key.DataSource != "LIVE" {
			return nil, fmt.Errorf("feeds: key %s: data_source must be SYNTHETIC, IMPORTED or LIVE", key.ID)
		}
		if key.SecretEnv != "" {
			key.secret = []byte(os.Getenv(key.SecretEnv))
		}
		if len(key.secret) < 32 {
			return nil, fmt.Errorf("feeds: key %s: the secret must be at least 32 bytes", key.ID)
		}
		if _, dup := k.byID[key.ID]; dup {
			return nil, fmt.Errorf("feeds: key %s is listed twice", key.ID)
		}
		k.byID[key.ID] = key
	}
	return k, nil
}

// LoadKeysFile reads a JSON array of keys.
func LoadKeysFile(path string) (*Keys, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var list []Key
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("feeds keys file %s: %w", path, err)
	}
	return NewKeys(list)
}

// Lookup returns a key that may sign right now.
func (k *Keys) Lookup(id string, now time.Time) (Key, error) {
	key, ok := k.byID[id]
	if !ok || key.Status == "revoked" || (key.Status == "retiring" && now.After(key.NotAfter)) {
		return Key{}, ErrUnknownKey
	}
	return key, nil
}

// Sign is hex(HMAC-SHA256(secret, ts + "." + body)).
func Sign(secret []byte, ts string, body []byte) string {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(ts))
	m.Write([]byte("."))
	m.Write(body)
	return hex.EncodeToString(m.Sum(nil))
}

// SignWith signs for a key (simulators and tests).
func SignWith(key Key, ts time.Time, body []byte) (string, string) {
	stamp := strconv.FormatInt(ts.Unix(), 10)
	return stamp, Sign(key.secret, stamp, body)
}

// Check verifies a request's timestamp and signature.
func (k Key) Check(ts, sig string, body []byte, now time.Time, skew time.Duration) error {
	sec, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return ErrTimestamp
	}
	if d := now.Sub(time.Unix(sec, 0)); d > skew || d < -skew {
		return ErrTimestamp
	}
	want := Sign(k.secret, ts, body)
	if !hmac.Equal([]byte(want), []byte(sig)) {
		return ErrSignature
	}
	return nil
}

// Tenants lists one key per customer (for the processor).
func (k *Keys) Tenants() []Key {
	seen := map[string]bool{}
	var out []Key
	for _, key := range k.byID {
		if key.Status != "revoked" && !seen[key.TenantID] {
			seen[key.TenantID] = true
			out = append(out, key)
		}
	}
	return out
}
