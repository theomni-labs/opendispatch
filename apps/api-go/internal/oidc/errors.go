// SPDX-License-Identifier: AGPL-3.0-only

// Package oidc verifies OpenID Connect tokens and runs the authorization code flow. It knows nothing of roles or users.
package oidc

import "errors"

// The reasons a token is refused. A caller shows none of them to the person; all of them are logged.
var (
	ErrMalformed      = errors.New("oidc: the token is not a signed JWT")
	ErrAlgorithm      = errors.New("oidc: the signing algorithm is not allowed")
	ErrNoKeyID        = errors.New("oidc: the token names no key id")
	ErrUnknownKey     = errors.New("oidc: no key with that id at the issuer")
	ErrUnknownIssuer  = errors.New("oidc: the issuer is not a known customer")
	ErrSignature      = errors.New("oidc: the signature does not verify")
	ErrIssuer         = errors.New("oidc: the issuer is not the expected one")
	ErrAudience       = errors.New("oidc: the audience is not this application")
	ErrExpired        = errors.New("oidc: the token has expired")
	ErrNotYetValid    = errors.New("oidc: the token is not valid yet")
	ErrNonce          = errors.New("oidc: the nonce does not match")
	ErrMissingSubject = errors.New("oidc: the token has no subject")
	ErrMissingExpiry  = errors.New("oidc: the token has no expiry")
	// Shared tier: one issuer, an org per customer.
	ErrNoOrganization        = errors.New("oidc: the token names no organization")
	ErrUnknownOrganization   = errors.New("oidc: the organization is not a known customer")
	ErrAmbiguousOrganization = errors.New("oidc: the token's organizations map to more than one customer")
)
