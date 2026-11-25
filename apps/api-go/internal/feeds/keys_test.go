// SPDX-License-Identifier: AGPL-3.0-only

package feeds

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"testing"
	"time"
)

func testKeys(t *testing.T) (*Keys, time.Time) {
	t.Helper()
	t.Setenv("FEED_S1", randomSecret(t))
	t.Setenv("FEED_S2", randomSecret(t))
	now := time.Now()
	k, err := NewKeys([]Key{
		{ID: "a", TenantID: "t", SecretEnv: "FEED_S1", Status: "active", DataSource: "SYNTHETIC"},
		{ID: "old", TenantID: "t", SecretEnv: "FEED_S2", Status: "retiring", NotAfter: now.Add(time.Hour), DataSource: "SYNTHETIC"},
		{ID: "gone", TenantID: "t", SecretEnv: "FEED_S2", Status: "revoked", DataSource: "SYNTHETIC"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return k, now
}

func TestSignatureRoundTripAndTamper(t *testing.T) {
	k, now := testKeys(t)
	key, _ := k.Lookup("a", now)
	body := []byte(`{"events":[]}`)
	ts, sig := SignWith(key, now, body)
	if err := key.Check(ts, sig, body, now, time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := key.Check(ts, sig, []byte(`{"events":[1]}`), now, time.Minute); !errors.Is(err, ErrSignature) {
		t.Fatalf("a changed body must fail: %v", err)
	}
	if err := key.Check(ts, sig, body, now.Add(time.Hour), time.Minute); !errors.Is(err, ErrTimestamp) {
		t.Fatalf("an old request must fail: %v", err)
	}
	if err := key.Check("x", sig, body, now, time.Minute); !errors.Is(err, ErrTimestamp) {
		t.Fatalf("a bad timestamp must fail: %v", err)
	}
}

func TestKeyRotation(t *testing.T) {
	k, now := testKeys(t)
	if _, err := k.Lookup("old", now); err != nil {
		t.Fatalf("a retiring key still works before not_after: %v", err)
	}
	if _, err := k.Lookup("old", now.Add(2*time.Hour)); !errors.Is(err, ErrUnknownKey) {
		t.Fatal("a retiring key stops at not_after")
	}
	if _, err := k.Lookup("gone", now); !errors.Is(err, ErrUnknownKey) {
		t.Fatal("a revoked key never works")
	}
	if _, err := k.Lookup("nope", now); !errors.Is(err, ErrUnknownKey) {
		t.Fatal("an unknown key never works")
	}
	a, _ := k.Lookup("a", now)
	o, _ := k.Lookup("old", now)
	body := []byte("x")
	ts, sig := SignWith(o, now, body)
	if err := a.Check(ts, sig, body, now, time.Minute); !errors.Is(err, ErrSignature) {
		t.Fatal("one key's signature must not pass as another's")
	}
}

func TestShortSecretIsRefused(t *testing.T) {
	t.Setenv("FEED_SHORT", "tiny")
	if _, err := NewKeys([]Key{{ID: "a", TenantID: "t", SecretEnv: "FEED_SHORT", Status: "active", DataSource: "SYNTHETIC"}}); err == nil {
		t.Fatal("a short secret must stop the start")
	}
}

func randomSecret(t *testing.T) string {
	t.Helper()
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b[:])
}
