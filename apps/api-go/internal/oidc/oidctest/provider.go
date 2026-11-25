// SPDX-License-Identifier: AGPL-3.0-only

// Package oidctest is a small OpenID Connect identity provider for tests, e2e and demos. It is not secure and never ships in an
// image: it signs with a key made at start, approves any request for a known user and has no sessions of its own.
package oidctest

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// User is a person the provider can sign in.
type User struct {
	Subject string
	Email   string
	Name    string
	Groups  []string
	// Organization: the Keycloak claim, as given.
	Organization any
}

type pending struct {
	user      User
	nonce     string
	challenge string
	redirect  string
	clientID  string
	expires   time.Time
}

// Provider is one running mock identity provider.
type Provider struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	Users        map[string]User
	// GroupsClaim is the claim that carries the groups (default "groups").
	GroupsClaim string
	// TokenIssuer, when set, is the issuer the ID tokens claim (a provider that lies, for the refusal tests).
	TokenIssuer string
	Now         func() time.Time

	server *httptest.Server
	mu     sync.Mutex
	key    *rsa.PrivateKey
	keyID  string
	codes  map[string]pending
	// Sessions counts /authorize approvals, for tests that check a sign-in really went through the provider.
	Approvals int
}

// New starts a provider on a free local port. Close it when done.
func New(clientID, clientSecret string, users map[string]User) *Provider {
	p := &Provider{ClientID: clientID, ClientSecret: clientSecret, Users: users, GroupsClaim: "groups", codes: map[string]pending{}}
	p.rotate()
	p.server = httptest.NewServer(http.HandlerFunc(p.serve))
	p.Issuer = p.server.URL
	return p
}

// Listen is New on a fixed address (the e2e mock).
func Listen(addr, issuer, clientID, clientSecret string, users map[string]User) (*Provider, *http.Server) {
	p := &Provider{ClientID: clientID, ClientSecret: clientSecret, Users: users, GroupsClaim: "groups", codes: map[string]pending{}, Issuer: issuer}
	p.rotate()
	return p, &http.Server{Addr: addr, Handler: http.HandlerFunc(p.serve), ReadHeaderTimeout: 10 * time.Second}
}

// Server is the test server behind a provider made with New.
func (p *Provider) Server() *httptest.Server { return p.server }

func (p *Provider) Close() {
	if p.server != nil {
		p.server.Close()
	}
}

func (p *Provider) now() time.Time {
	if p.Now != nil {
		return p.Now()
	}
	return time.Now()
}

func (p *Provider) rotate() {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(err)
	}
	p.mu.Lock()
	p.key = key
	var id [6]byte
	_, _ = rand.Read(id[:])
	p.keyID = "k-" + hex.EncodeToString(id[:])
	p.mu.Unlock()
}

// RotateKey makes a new signing key; the old one is no longer published.
func (p *Provider) RotateKey() { p.rotate() }

// Key returns the current private key and its id, for a test that signs its own token.
func (p *Provider) Key() (*rsa.PrivateKey, string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.key, p.keyID
}

// TokenOptions shape one ID token; the zero value is a good token for the client.
type TokenOptions struct {
	Nonce     string
	Issuer    string
	Audience  string
	Expiry    time.Time
	IssuedAt  time.Time
	NotBefore time.Time
	KeyID     string
	// SignWith signs with another key (a forged token).
	SignWith *rsa.PrivateKey
	// Alg is RS256 (default), "none" or "HS256" (signed with HMACKey).
	Alg     string
	HMACKey []byte
	Extra   map[string]any
	// OmitExpiry and OmitSubject build the incomplete tokens.
	OmitExpiry  bool
	OmitSubject bool
}

// IDToken mints an ID token for a user.
func (p *Provider) IDToken(u User, o TokenOptions) string {
	now := p.now()
	iss := o.Issuer
	if iss == "" {
		iss = p.Issuer
	}
	aud := o.Audience
	if aud == "" {
		aud = p.ClientID
	}
	exp, iat := o.Expiry, o.IssuedAt
	if exp.IsZero() {
		exp = now.Add(5 * time.Minute)
	}
	if iat.IsZero() {
		iat = now
	}
	claims := map[string]any{"iss": iss, "aud": aud, "iat": iat.Unix(), "email": u.Email, "name": u.Name, "preferred_username": u.Email}
	if !o.OmitExpiry {
		claims["exp"] = exp.Unix()
	}
	if !o.OmitSubject {
		claims["sub"] = u.Subject
	}
	if !o.NotBefore.IsZero() {
		claims["nbf"] = o.NotBefore.Unix()
	}
	if o.Nonce != "" {
		claims["nonce"] = o.Nonce
	}
	claims[p.GroupsClaim] = u.Groups
	if u.Organization != nil {
		claims["organization"] = u.Organization
	}
	for k, v := range o.Extra {
		claims[k] = v
	}
	payload, _ := json.Marshal(claims)
	enc := base64.RawURLEncoding
	switch o.Alg {
	case "none":
		return enc.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`)) + "." + enc.EncodeToString(payload) + "."
	case "HS256":
		kid := o.KeyID
		if kid == "" {
			_, kid = p.Key()
		}
		head := enc.EncodeToString([]byte(fmt.Sprintf(`{"alg":"HS256","typ":"JWT","kid":%q}`, kid))) + "." + enc.EncodeToString(payload)
		mac := hmac.New(sha256.New, o.HMACKey)
		mac.Write([]byte(head))
		return head + "." + enc.EncodeToString(mac.Sum(nil))
	}
	key, kid := p.Key()
	if o.SignWith != nil {
		key = o.SignWith
	}
	if o.KeyID != "" {
		kid = o.KeyID
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", kid))
	if err != nil {
		panic(err)
	}
	if o.KeyID == "-" {
		signer, _ = jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT"))
	}
	raw, err := jwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		panic(err)
	}
	return raw
}

func (p *Provider) serve(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/.well-known/openid-configuration":
		writeJSON(w, map[string]any{
			"issuer": p.Issuer, "authorization_endpoint": p.Issuer + "/authorize", "token_endpoint": p.Issuer + "/token",
			"jwks_uri": p.Issuer + "/jwks", "end_session_endpoint": p.Issuer + "/logout",
			"id_token_signing_alg_values_supported": []string{"RS256"}, "response_types_supported": []string{"code"},
			"code_challenge_methods_supported": []string{"S256"},
		})
	case "/jwks":
		key, kid := p.Key()
		writeJSON(w, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: kid, Algorithm: "RS256", Use: "sig"}}})
	case "/authorize":
		p.authorize(w, r)
	case "/token":
		p.token(w, r)
	case "/logout":
		target := r.URL.Query().Get("post_logout_redirect_uri")
		if target == "" {
			_, _ = w.Write([]byte("signed out"))
			return
		}
		http.Redirect(w, r, target, http.StatusFound)
	default:
		http.NotFound(w, r)
	}
}

func (p *Provider) authorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("response_type") != "code" || q.Get("client_id") != p.ClientID || q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" {
		http.Error(w, "invalid_request", http.StatusBadRequest)
		return
	}
	redirect := q.Get("redirect_uri")
	if _, err := url.Parse(redirect); err != nil || redirect == "" {
		http.Error(w, "invalid redirect_uri", http.StatusBadRequest)
		return
	}
	name := q.Get("user")
	if name == "" {
		name = q.Get("login_hint")
	}
	user, ok := p.Users[name]
	if !ok {
		// No user chosen: show the people this provider knows, as a real provider shows its sign-in page.
		names := make([]string, 0, len(p.Users))
		for n := range p.Users {
			names = append(names, n)
		}
		sort.Strings(names)
		var b strings.Builder
		b.WriteString("<!doctype html><meta charset=utf-8><title>Mock identity provider</title><h1>Mock identity provider</h1><ul>")
		for _, n := range names {
			next := url.Values(q)
			next.Set("user", n)
			fmt.Fprintf(&b, `<li><a href="/authorize?%s">%s (%s)</a></li>`, html.EscapeString(next.Encode()), html.EscapeString(p.Users[n].Name), html.EscapeString(n))
		}
		b.WriteString("</ul>")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(b.String()))
		return
	}
	var raw [18]byte
	_, _ = rand.Read(raw[:])
	code := base64.RawURLEncoding.EncodeToString(raw[:])
	p.mu.Lock()
	p.codes[code] = pending{user: user, nonce: q.Get("nonce"), challenge: q.Get("code_challenge"), redirect: redirect, clientID: q.Get("client_id"), expires: p.now().Add(time.Minute)}
	p.Approvals++
	p.mu.Unlock()
	target, _ := url.Parse(redirect)
	v := target.Query()
	v.Set("code", code)
	if s := q.Get("state"); s != "" {
		v.Set("state", s)
	}
	target.RawQuery = v.Encode()
	http.Redirect(w, r, target.String(), http.StatusFound)
}

func (p *Provider) token(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.ParseForm() != nil {
		http.Error(w, "invalid_request", http.StatusBadRequest)
		return
	}
	id, secret, basic := r.BasicAuth()
	if !basic {
		id, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	}
	if id != p.ClientID || secret != p.ClientSecret {
		writeStatus(w, http.StatusUnauthorized, map[string]any{"error": "invalid_client"})
		return
	}
	code := r.PostForm.Get("code")
	p.mu.Lock()
	entry, ok := p.codes[code]
	delete(p.codes, code) // a code works once
	p.mu.Unlock()
	if !ok || p.now().After(entry.expires) || r.PostForm.Get("redirect_uri") != entry.redirect {
		writeStatus(w, http.StatusBadRequest, map[string]any{"error": "invalid_grant"})
		return
	}
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if base64.RawURLEncoding.EncodeToString(sum[:]) != entry.challenge {
		writeStatus(w, http.StatusBadRequest, map[string]any{"error": "invalid_grant", "error_description": "PKCE check failed"})
		return
	}
	writeJSON(w, map[string]any{"token_type": "Bearer", "access_token": "mock-access", "expires_in": 300, "id_token": p.IDToken(entry.user, TokenOptions{Nonce: entry.nonce, Issuer: p.TokenIssuer})})
}

func writeJSON(w http.ResponseWriter, v any) { writeStatus(w, http.StatusOK, v) }

func writeStatus(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
