// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors verifyDemoMode in demo-session.ts.
package demosession

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
)

// ModeCookieName holds the signed install mode.
const ModeCookieName = "opendispatch_demo_mode"

type modePayload struct {
	V    int    `json:"v"`
	T    string `json:"t"`
	Exp  int64  `json:"exp"`
	Mode string `json:"mode"`
}

// VerifyMode: private unless the cookie is valid.
func VerifyMode(token string, secret string, nowSeconds int64) access.InstallMode {
	if token == "" || secret == "" {
		return access.InstallPrivate
	}
	body, signature, found := strings.Cut(token, ".")
	if !found || strings.Contains(signature, ".") {
		return access.InstallPrivate
	}
	given, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil {
		return access.InstallPrivate
	}
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(body))
	if subtle.ConstantTimeCompare(given, h.Sum(nil)) != 1 {
		return access.InstallPrivate
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return access.InstallPrivate
	}
	var p modePayload
	if json.Unmarshal(raw, &p) != nil || p.V != 1 || p.T != "mode" || p.Exp <= nowSeconds || !access.IsInstallMode(p.Mode) {
		return access.InstallPrivate
	}
	return access.InstallMode(p.Mode)
}
