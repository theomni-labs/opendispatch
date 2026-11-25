// SPDX-License-Identifier: AGPL-3.0-only

package oidc

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// allowedAlgs: public-key signatures only. `none` and the shared-secret family are refused when the token is parsed, so a token
// that claims HS256 and is signed with the public key as the secret can never reach the check.
var allowedAlgs = []jose.SignatureAlgorithm{jose.RS256, jose.ES256}

// Claims are what a verified ID token says about the person.
type Claims struct {
	Issuer            string
	Subject           string
	Audience          []string
	Expiry            time.Time
	IssuedAt          time.Time
	Nonce             string
	Email             string
	EmailVerified     bool
	Name              string
	PreferredUsername string
	Groups            []string
	ACR               string
	AMR               []string
	Organizations     []Organization
}

// Verifier checks ID tokens against the issuer's published keys.
type Verifier struct {
	Registry Registry
	// Keys finds an issuer's key source; the api builds one RemoteKeys per tenant.
	Keys func(Tenant) KeySource
	Now  func() time.Time
	Skew time.Duration
}

func (v *Verifier) now() time.Time {
	if v.Now != nil {
		return v.Now()
	}
	return time.Now()
}

// Verify checks a token and, when nonce is not empty, that it carries that nonce. On success it returns the claims and the
// customer its issuer and organisation belong to. Every failure is one of the Err values in errors.go.
func (v *Verifier) Verify(ctx context.Context, raw, nonce string) (*Claims, Tenant, error) {
	// The header is read first so a forbidden algorithm (none, HS256) is refused as that, whatever else is wrong with the token.
	alg, err := headerAlg(raw)
	if err != nil {
		return nil, Tenant{}, ErrMalformed
	}
	if !algAllowed(alg) {
		return nil, Tenant{}, ErrAlgorithm
	}
	tok, err := jwt.ParseSigned(raw, allowedAlgs)
	if err != nil {
		var unexpected *jose.ErrUnexpectedSignatureAlgorithm
		if errors.As(err, &unexpected) {
			return nil, Tenant{}, ErrAlgorithm
		}
		return nil, Tenant{}, ErrMalformed
	}
	if len(tok.Headers) != 1 {
		return nil, Tenant{}, ErrMalformed
	}
	keyID := tok.Headers[0].KeyID
	if keyID == "" {
		return nil, Tenant{}, ErrNoKeyID
	}
	// Which issuer the token claims is read before it is trusted, only to choose whose keys to check it with; the signature
	// and the issuer claim are then checked against that customer's entry.
	var unverified struct {
		Issuer string `json:"iss"`
	}
	if err := tok.UnsafeClaimsWithoutVerification(&unverified); err != nil {
		return nil, Tenant{}, ErrMalformed
	}
	entries := v.Registry.IssuerTenants(unverified.Issuer)
	if len(entries) == 0 {
		return nil, Tenant{}, ErrUnknownIssuer
	}
	key, err := v.Keys(entries[0]).Key(ctx, keyID)
	if err != nil {
		return nil, Tenant{}, err
	}
	var std jwt.Claims
	var extra map[string]any
	if err := tok.Claims(key, &std, &extra); err != nil {
		return nil, Tenant{}, ErrSignature
	}
	// Customer from issuer and org, once signed.
	orgs := OrganizationsOf(extra[OrganizationClaim])
	tenant, err := ResolveTenant(entries, orgs)
	if err != nil {
		return nil, Tenant{}, err
	}
	if std.Expiry == nil {
		return nil, Tenant{}, ErrMissingExpiry
	}
	if std.Subject == "" {
		return nil, Tenant{}, ErrMissingSubject
	}
	if err := std.ValidateWithLeeway(jwt.Expected{Issuer: tenant.Issuer, AnyAudience: jwt.Audience{tenant.Audience}, Time: v.now()}, v.Skew); err != nil {
		switch {
		case errors.Is(err, jwt.ErrExpired):
			return nil, Tenant{}, ErrExpired
		case errors.Is(err, jwt.ErrNotValidYet):
			return nil, Tenant{}, ErrNotYetValid
		case errors.Is(err, jwt.ErrInvalidIssuer):
			return nil, Tenant{}, ErrIssuer
		case errors.Is(err, jwt.ErrInvalidAudience):
			return nil, Tenant{}, ErrAudience
		}
		return nil, Tenant{}, fmt.Errorf("oidc: %w", err)
	}
	if nonce != "" {
		got, _ := extra["nonce"].(string)
		if subtle.ConstantTimeCompare([]byte(got), []byte(nonce)) != 1 {
			return nil, Tenant{}, ErrNonce
		}
	}
	claims := &Claims{Issuer: std.Issuer, Subject: std.Subject, Audience: std.Audience, Expiry: std.Expiry.Time()}
	if std.IssuedAt != nil {
		claims.IssuedAt = std.IssuedAt.Time()
	}
	claims.Nonce, _ = extra["nonce"].(string)
	claims.Email, _ = extra["email"].(string)
	claims.EmailVerified, _ = extra["email_verified"].(bool)
	claims.Name, _ = extra["name"].(string)
	claims.PreferredUsername, _ = extra["preferred_username"].(string)
	claims.ACR, _ = extra["acr"].(string)
	claims.AMR = stringsOf(extra["amr"])
	claims.Groups = stringsOf(extra[tenant.GroupsClaim])
	claims.Organizations = orgs
	return claims, tenant, nil
}

func algAllowed(alg string) bool {
	for _, a := range allowedAlgs {
		if string(a) == alg {
			return true
		}
	}
	return false
}

// headerAlg reads the `alg` of a compact JWT's first segment, without trusting anything else in it.
func headerAlg(raw string) (string, error) {
	first, _, found := strings.Cut(raw, ".")
	if !found {
		return "", ErrMalformed
	}
	decoded, err := base64.RawURLEncoding.DecodeString(first)
	if err != nil {
		return "", ErrMalformed
	}
	var header struct {
		Alg string `json:"alg"`
	}
	if err := json.Unmarshal(decoded, &header); err != nil {
		return "", ErrMalformed
	}
	return header.Alg, nil
}

// stringsOf reads a claim that is a list of strings or one string.
func stringsOf(v any) []string {
	switch x := v.(type) {
	case string:
		if x == "" {
			return nil
		}
		return []string{x}
	case []any:
		out := make([]string, 0, len(x))
		for _, item := range x {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}
