// SPDX-License-Identifier: AGPL-3.0-only

package demosession

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

// sign makes a token as signDemoMode does.
func sign(payload, secret string) string {
	body := base64.RawURLEncoding.EncodeToString([]byte(payload))
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(body))
	return body + "." + base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func TestVerifyMode_ReadsTheTSFormat(t *testing.T) {
	secret := "test-only-cross-check-" + "secret-never-real-0000"
	const now int64 = 1790000000
	token := sign(`{"v":1,"t":"mode","exp":1792592000,"mode":"shared"}`, secret)

	if got := VerifyMode(token, secret, now); got != "shared" {
		t.Fatalf("got %s, want shared", got)
	}
	if got := VerifyMode(token, secret, 1792592000); got != "private" {
		t.Fatalf("expiry at the boundary: got %s", got)
	}
	if got := VerifyMode(token, "a-different-wrong-secret-entirely-here", now); got != "private" {
		t.Fatalf("wrong secret: got %s", got)
	}
	if got := VerifyMode(token[:len(token)-1]+"x", secret, now); got != "private" {
		t.Fatalf("tampered: got %s", got)
	}
	session := sign(`{"v":1,"exp":1792592000,"role":"administrator","installMode":"shared","zoneIds":[]}`, secret)
	if got := VerifyMode(session, secret, now); got != "private" {
		t.Fatalf("a session token is no mode: got %s", got)
	}
	if got := VerifyMode("", secret, now); got != "private" {
		t.Fatalf("absent: got %s", got)
	}
}
