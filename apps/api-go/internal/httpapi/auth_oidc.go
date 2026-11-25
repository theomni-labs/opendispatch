// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/session"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// SessionCookie holds the opaque session token; TransactionCookie holds the state of one sign-in in progress.
const (
	SessionCookie     = "opendispatch_session"
	TransactionCookie = "opendispatch_oidc_tx"
	transactionTTL    = 10 * time.Minute
)

// Auth is the sign-in configuration of the api. Mode "demo" keeps the demo session cookie (dev, CI and review builds only);
// mode "oidc" accepts nothing but a session made by a real sign-in.
type Auth struct {
	Mode         string
	Registry     oidc.Registry
	Verifier     *oidc.Verifier
	Sessions     *session.Store
	Secret       []byte
	CookieSecure bool
	Client       *http.Client

	mu        sync.Mutex
	endpoints map[string]cachedEndpoints
}

type cachedEndpoints struct {
	at time.Time
	e  *oidc.Endpoints
}

var auth *Auth

// SetAuth installs the sign-in configuration. Called once, at start.
func SetAuth(a *Auth) { auth = a }

func oidcMode() bool { return auth != nil && auth.Mode == "oidc" }

func demoMode() bool { return auth != nil && auth.Mode == "demo" }

func (a *Auth) client() *http.Client {
	if a.Client != nil {
		return a.Client
	}
	return &http.Client{Timeout: 10 * time.Second}
}

func (a *Auth) endpointsOf(ctx context.Context, t oidc.Tenant) (*oidc.Endpoints, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if hit, ok := a.endpoints[t.TenantID]; ok && time.Since(hit.at) < time.Hour {
		return hit.e, nil
	}
	e, err := oidc.Discover(ctx, a.client(), t.Issuer, t.AllowInsecureHTTP)
	if err != nil {
		return nil, err
	}
	if a.endpoints == nil {
		a.endpoints = map[string]cachedEndpoints{}
	}
	a.endpoints[t.TenantID] = cachedEndpoints{at: time.Now(), e: e}
	return e, nil
}

// transaction is what a sign-in in progress remembers between the redirect out and the redirect back.
type transaction struct {
	Tenant   string `json:"t"`
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	Return   string `json:"r"`
	Locale   string `json:"l"`
	Expires  int64  `json:"e"`
}

func (a *Auth) seal(tx transaction) string {
	body, _ := json.Marshal(tx)
	payload := base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, a.Secret)
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (a *Auth) open(value string, now time.Time) (transaction, bool) {
	payload, sig, found := strings.Cut(value, ".")
	if !found {
		return transaction{}, false
	}
	given, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		return transaction{}, false
	}
	mac := hmac.New(sha256.New, a.Secret)
	mac.Write([]byte(payload))
	if subtle.ConstantTimeCompare(given, mac.Sum(nil)) != 1 {
		return transaction{}, false
	}
	body, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return transaction{}, false
	}
	var tx transaction
	if json.Unmarshal(body, &tx) != nil || now.Unix() > tx.Expires {
		return transaction{}, false
	}
	return tx, true
}

func random(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// safeReturn keeps a return address on this site: a path, never another host.
func safeReturn(v string) string {
	if !strings.HasPrefix(v, "/") || strings.HasPrefix(v, "//") || strings.HasPrefix(v, "/\\") || strings.ContainsAny(v, "\r\n") {
		return "/"
	}
	return v
}

func safeLocale(v string) string {
	if v == "ar" {
		return "ar"
	}
	return "en"
}

func (a *Auth) setCookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: a.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}

func (a *Auth) refuse(w http.ResponseWriter, r *http.Request, locale, outcome string) {
	page := "error"
	switch outcome {
	case "no_role_assigned":
		page = "no-role"
	case "refused_by_provider", "locked", "mfa_required":
		page = "refused"
	}
	target := "/" + safeLocale(locale) + "/sign-in/message/" + page
	if page == "error" {
		target += "?ref=" + url.QueryEscape("ODP-"+strings.ToUpper(random(4)))
	}
	http.Redirect(w, r, target, http.StatusSeeOther)
}

// RegisterAuthRoutes adds the sign-in routes. They exist only in oidc mode; in demo mode the demo switcher signs people in.
func RegisterAuthRoutes(mux *http.ServeMux, conn *tenancy.Connection) {
	mux.HandleFunc("GET /auth/login", func(w http.ResponseWriter, r *http.Request) {
		if !oidcMode() {
			http.NotFound(w, r)
			return
		}
		auth.login(w, r)
	})
	mux.HandleFunc("GET /auth/callback", func(w http.ResponseWriter, r *http.Request) {
		if !oidcMode() {
			http.NotFound(w, r)
			return
		}
		auth.callback(w, r, conn)
	})
	mux.HandleFunc("POST /auth/emergency", func(w http.ResponseWriter, r *http.Request) {
		if !oidcMode() {
			http.NotFound(w, r)
			return
		}
		auth.emergency(w, r)
	})
	mux.HandleFunc("POST /auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if !oidcMode() {
			http.NotFound(w, r)
			return
		}
		auth.logout(w, r)
	})
}

func (a *Auth) login(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	locale := safeLocale(q.Get("locale"))
	tenants := a.Registry.Tenants()
	var tenant oidc.Tenant
	switch {
	case q.Get("tenant") != "":
		t, ok := a.Registry.ByTenantID(q.Get("tenant"))
		if !ok {
			a.refuse(w, r, locale, "refused_by_provider")
			return
		}
		tenant = t
	case len(tenants) == 1:
		tenant = tenants[0]
	default:
		a.refuse(w, r, locale, "error")
		return
	}
	endpoints, err := a.endpointsOf(r.Context(), tenant)
	if err != nil {
		log.Printf("auth: discovery for %s failed: %v", tenant.Issuer, err)
		a.refuse(w, r, locale, "error")
		return
	}
	tx := transaction{Tenant: tenant.TenantID, State: random(24), Nonce: random(24), Verifier: random(32), Return: safeReturn(q.Get("return_to")), Locale: locale, Expires: time.Now().Add(transactionTTL).Unix()}
	challenge := sha256.Sum256([]byte(tx.Verifier))
	params := url.Values{
		"response_type": {"code"}, "client_id": {tenant.ClientID}, "redirect_uri": {tenant.RedirectURI}, "scope": {scopesFor(tenant)},
		"state": {tx.State}, "nonce": {tx.Nonce}, "code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])}, "code_challenge_method": {"S256"},
		"ui_locales": {locale},
	}
	if hint := q.Get("login_hint"); hint != "" {
		params.Set("login_hint", hint)
	}
	if user := q.Get("user"); user != "" && tenant.AllowInsecureHTTP {
		params.Set("user", user) // only the mock provider understands it
	}
	a.setCookie(w, TransactionCookie, a.seal(tx), int(transactionTTL.Seconds()))
	target := endpoints.AuthorizationEndpoint
	sep := "?"
	if strings.Contains(target, "?") {
		sep = "&"
	}
	http.Redirect(w, r, target+sep+params.Encode(), http.StatusSeeOther)
}

func (a *Auth) callback(w http.ResponseWriter, r *http.Request, conn *tenancy.Connection) {
	cookie, err := r.Cookie(TransactionCookie)
	a.setCookie(w, TransactionCookie, "", -1)
	if err != nil {
		a.refuse(w, r, "en", "error")
		return
	}
	tx, ok := a.open(cookie.Value, time.Now())
	if !ok {
		a.refuse(w, r, "en", "error")
		return
	}
	q := r.URL.Query()
	if q.Get("error") != "" {
		log.Printf("auth: the provider answered %s: %s", q.Get("error"), q.Get("error_description"))
		a.refuse(w, r, tx.Locale, "refused_by_provider")
		return
	}
	if subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(tx.State)) != 1 || q.Get("code") == "" {
		a.refuse(w, r, tx.Locale, "error")
		return
	}
	tenant, ok := a.Registry.ByTenantID(tx.Tenant)
	if !ok {
		a.refuse(w, r, tx.Locale, "error")
		return
	}
	idToken, err := a.exchange(r.Context(), tenant, q.Get("code"), tx.Verifier)
	if err != nil {
		log.Printf("auth: code exchange with %s failed: %v", tenant.Issuer, err)
		a.refuse(w, r, tx.Locale, "error")
		return
	}
	claims, verified, err := a.Verifier.Verify(r.Context(), idToken, tx.Nonce)
	if err != nil {
		log.Printf("auth: a token from %s was refused: %v", tenant.Issuer, err)
		a.refuse(w, r, tx.Locale, "refused_by_provider")
		return
	}
	if verified.TenantID != tenant.TenantID {
		log.Printf("auth: the token's customer %s is not the one the sign-in began for", verified.TenantID)
		a.refuse(w, r, tx.Locale, "refused_by_provider")
		return
	}
	if other := a.sessionTenant(r); other != "" && other != tenant.TenantID {
		log.Printf("auth: a sign-in for %s met a live session of %s", tenant.TenantID, other)
		a.refuse(w, r, tx.Locale, "refused_by_provider")
		return
	}
	pre := reqctx.PreSessionContext{CustomerID: tenant.TenantID, InstallMode: access.InstallMode(tenant.InstallMode)}
	result, err := business.SignInOIDC(pre, business.OIDCIdentity{
		Subject: claims.Subject, Email: claims.Email, EmailVerified: claims.EmailVerified, Name: claims.Name, Groups: claims.Groups,
		MFA: hasSecondFactor(claims), ProviderID: tenant.ProviderID,
	})
	if err != nil {
		log.Printf("auth: sign-in decision failed: %v", err)
		a.refuse(w, r, tx.Locale, "error")
		return
	}
	if result.Outcome != "signed_in" || result.UserID == nil {
		a.refuse(w, r, tx.Locale, result.Outcome)
		return
	}
	token, sess, err := a.Sessions.Create(r.Context(), tenant.TenantID, *result.UserID)
	if err != nil {
		log.Printf("auth: starting a session failed: %v", err)
		a.refuse(w, r, tx.Locale, "error")
		return
	}
	a.setCookie(w, SessionCookie, token, int(time.Until(sess.AbsoluteExpiresAt).Seconds()))
	http.Redirect(w, r, tx.Return, http.StatusSeeOther)
}

// scopesFor asks Keycloak for the customer's org.
func scopesFor(t oidc.Tenant) string {
	scopes := append([]string(nil), t.Scopes...)
	if t.Organization == "" {
		return strings.Join(scopes, " ")
	}
	for _, s := range scopes {
		if s == oidc.OrganizationClaim || strings.HasPrefix(s, oidc.OrganizationClaim+":") {
			return strings.Join(scopes, " ")
		}
	}
	return strings.Join(append(scopes, oidc.OrganizationClaim+":"+t.Organization), " ")
}

// sessionTenant: a live session's customer; fails closed.
func (a *Auth) sessionTenant(r *http.Request) string {
	cookie, err := r.Cookie(SessionCookie)
	if err != nil {
		return ""
	}
	sess, err := a.Sessions.Lookup(r.Context(), cookie.Value)
	if err != nil {
		return "unknown"
	}
	if sess == nil {
		return ""
	}
	return sess.TenantID
}

func (a *Auth) exchange(ctx context.Context, t oidc.Tenant, code, verifier string) (string, error) {
	endpoints, err := a.endpointsOf(ctx, t)
	if err != nil {
		return "", err
	}
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {t.RedirectURI}, "client_id": {t.ClientID}, "code_verifier": {verifier}}
	if t.ClientSecret != "" {
		form.Set("client_secret", t.ClientSecret)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoints.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := a.client().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", &exchangeError{status: resp.StatusCode}
	}
	var out struct {
		IDToken string `json:"id_token"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.IDToken == "" {
		return "", &exchangeError{status: resp.StatusCode}
	}
	return out.IDToken, nil
}

type exchangeError struct{ status int }

func (e *exchangeError) Error() string { return "the token endpoint did not give an ID token" }

// hasSecondFactor reads the claims a provider uses to say a second factor was used.
func hasSecondFactor(c *oidc.Claims) bool {
	for _, m := range c.AMR {
		switch strings.ToLower(m) {
		case "mfa", "otp", "hwk", "swk", "sms", "fpt":
			return true
		}
	}
	return strings.Contains(strings.ToLower(c.ACR), "mfa")
}

// emergency signs in the local emergency administrator (password, then authenticator code): the one person who is not sent to
// an identity provider, so the install can be reached when the provider cannot.
func (a *Auth) emergency(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeBody(w, r)
	if !ok {
		return
	}
	tenants := a.Registry.Tenants()
	var tenant oidc.Tenant
	if id, _ := body["tenant"].(string); id != "" {
		t, found := a.Registry.ByTenantID(id)
		if !found {
			writeJSONError(w, http.StatusBadRequest, "Unknown customer.")
			return
		}
		tenant = t
	} else if len(tenants) == 1 {
		tenant = tenants[0]
	} else {
		writeJSONError(w, http.StatusBadRequest, "Which customer? Give tenant.")
		return
	}
	delete(body, "tenant")
	pre := reqctx.PreSessionContext{CustomerID: tenant.TenantID, InstallMode: access.InstallMode(tenant.InstallMode)}
	result, err := business.EmergencyAdminSignIn(pre, body)
	if err != nil {
		writeBusinessError(w, err)
		return
	}
	if result.Outcome == "signed_in" && result.UserID != nil {
		token, sess, err := a.Sessions.Create(r.Context(), tenant.TenantID, *result.UserID)
		if err != nil {
			log.Printf("auth: starting an emergency session failed: %v", err)
			writeJSONError(w, http.StatusInternalServerError, "Could not start a session.")
			return
		}
		a.setCookie(w, SessionCookie, token, int(time.Until(sess.AbsoluteExpiresAt).Seconds()))
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *Auth) logout(w http.ResponseWriter, r *http.Request) {
	redirect := "/"
	if cookie, err := r.Cookie(SessionCookie); err == nil {
		if sess, _ := a.Sessions.Lookup(r.Context(), cookie.Value); sess != nil {
			if tenant, ok := a.Registry.ByTenantID(sess.TenantID); ok {
				if e, err := a.endpointsOf(r.Context(), tenant); err == nil {
					if target, ok := endSessionURL(e, tenant, r.URL.Query().Get("locale")); ok {
						redirect = target
					}
				}
			}
		}
		if err := a.Sessions.Revoke(r.Context(), cookie.Value); err != nil {
			log.Printf("auth: ending a session failed: %v", err)
		}
	}
	a.setCookie(w, SessionCookie, "", -1)
	writeJSON(w, http.StatusOK, map[string]string{"redirect": redirect})
}

// endSessionURL: logout page in their language
func endSessionURL(e *oidc.Endpoints, tenant oidc.Tenant, locale string) (string, bool) {
	if e.EndSessionEndpoint == "" {
		return "", false
	}
	base, err := url.Parse(tenant.RedirectURI)
	if err != nil {
		return "", false
	}
	locale = safeLocale(locale)
	v := url.Values{"client_id": {tenant.ClientID}, "post_logout_redirect_uri": {base.Scheme + "://" + base.Host + "/" + locale + "/signed-out"}, "ui_locales": {locale}}
	return e.EndSessionEndpoint + "?" + v.Encode(), true
}
