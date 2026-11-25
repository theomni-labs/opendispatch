// SPDX-License-Identifier: AGPL-3.0-only

// Package keycloakadmin: IdPs via Keycloak admin.
package keycloakadmin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Config: where Keycloak is and the service account.
type Config struct {
	BaseURL      string
	Realm        string
	ClientID     string
	ClientSecret string
}

// FromEnv reads OPENDISPATCH_KEYCLOAK_* variables.
func FromEnv(getenv func(string) string) (Config, bool) {
	c := Config{
		BaseURL:      strings.TrimSuffix(strings.TrimSpace(getenv("OPENDISPATCH_KEYCLOAK_ADMIN_URL")), "/"),
		Realm:        strings.TrimSpace(getenv("OPENDISPATCH_KEYCLOAK_REALM")),
		ClientID:     strings.TrimSpace(getenv("OPENDISPATCH_KEYCLOAK_ADMIN_CLIENT_ID")),
		ClientSecret: getenv("OPENDISPATCH_KEYCLOAK_ADMIN_CLIENT_SECRET"),
	}
	return c, c.BaseURL != "" && c.Realm != "" && c.ClientID != "" && c.ClientSecret != ""
}

// Client is safe for concurrent use.
type Client struct {
	cfg  Config
	http *http.Client
	mu   sync.Mutex
	tok  string
	exp  time.Time
}

// New makes a client; it does not call Keycloak yet.
func New(cfg Config) *Client {
	return &Client{cfg: cfg, http: &http.Client{Timeout: 20 * time.Second}}
}

// Realm the client manages.
func (c *Client) Realm() string { return c.cfg.Realm }

// Error is a refused or failed Keycloak call.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string {
	if e.Status == 0 {
		return e.Message
	}
	return fmt.Sprintf("Keycloak answered %d: %s", e.Status, e.Message)
}

// IsNotFound: Keycloak answered 404.
func IsNotFound(err error) bool {
	var e *Error
	return errors.As(err, &e) && e.Status == http.StatusNotFound
}

func (c *Client) token(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.tok != "" && time.Now().Before(c.exp) {
		return c.tok, nil
	}
	form := url.Values{"grant_type": {"client_credentials"}, "client_id": {c.cfg.ClientID}, "client_secret": {c.cfg.ClientSecret}}
	endpoint := c.cfg.BaseURL + "/realms/" + url.PathEscape(c.cfg.Realm) + "/protocol/openid-connect/token"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := c.http.Do(req)
	if err != nil {
		return "", &Error{Message: "Keycloak could not be reached."}
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))
	if res.StatusCode != http.StatusOK {
		return "", &Error{Status: res.StatusCode, Message: "the OpenDispatch service account was refused."}
	}
	var t struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &t); err != nil || t.AccessToken == "" {
		return "", &Error{Status: res.StatusCode, Message: "no access token in the answer."}
	}
	c.tok = t.AccessToken
	c.exp = time.Now().Add(time.Duration(max(t.ExpiresIn-30, 5)) * time.Second)
	return c.tok, nil
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	tok, err := c.token(ctx)
	if err != nil {
		return err
	}
	var reader io.Reader
	if in != nil {
		raw, err := json.Marshal(in)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.cfg.BaseURL+"/admin/realms/"+url.PathEscape(c.cfg.Realm)+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return &Error{Message: "Keycloak could not be reached."}
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode == http.StatusUnauthorized {
		c.mu.Lock()
		c.tok = ""
		c.mu.Unlock()
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return &Error{Status: res.StatusCode, Message: errorMessage(body)}
	}
	if out != nil && len(body) > 0 {
		return json.Unmarshal(body, out)
	}
	return nil
}

// errorMessage keeps Keycloak's short reason only.
func errorMessage(body []byte) string {
	var e struct {
		ErrorMessage     string `json:"errorMessage"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	_ = json.Unmarshal(body, &e)
	msg := e.ErrorMessage
	if msg == "" {
		msg = e.ErrorDescription
	}
	if msg == "" {
		msg = e.Error
	}
	if msg == "" {
		msg = "no reason given."
	}
	if len(msg) > 200 {
		msg = msg[:200]
	}
	return msg
}

// IdentityProvider: Keycloak's representation.
type IdentityProvider struct {
	Alias                     string            `json:"alias"`
	DisplayName               string            `json:"displayName,omitempty"`
	ProviderID                string            `json:"providerId"`
	Enabled                   bool              `json:"enabled"`
	TrustEmail                bool              `json:"trustEmail"`
	StoreToken                bool              `json:"storeToken"`
	FirstBrokerLoginFlowAlias string            `json:"firstBrokerLoginFlowAlias,omitempty"`
	Config                    map[string]string `json:"config"`
}

// Mapper: an identity provider mapper.
type Mapper struct {
	ID                     string            `json:"id,omitempty"`
	Name                   string            `json:"name"`
	IdentityProviderAlias  string            `json:"identityProviderAlias"`
	IdentityProviderMapper string            `json:"identityProviderMapper"`
	Config                 map[string]string `json:"config"`
}

func idpPath(alias string) string { return "/identity-provider/instances/" + url.PathEscape(alias) }

// GetIdentityProvider: nil when Keycloak has none.
func (c *Client) GetIdentityProvider(ctx context.Context, alias string) (*IdentityProvider, error) {
	var out IdentityProvider
	if err := c.do(ctx, http.MethodGet, idpPath(alias), nil, &out); err != nil {
		if IsNotFound(err) {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// CreateIdentityProvider adds one.
func (c *Client) CreateIdentityProvider(ctx context.Context, p IdentityProvider) error {
	return c.do(ctx, http.MethodPost, "/identity-provider/instances", p, nil)
}

// UpdateIdentityProvider replaces one.
func (c *Client) UpdateIdentityProvider(ctx context.Context, p IdentityProvider) error {
	return c.do(ctx, http.MethodPut, idpPath(p.Alias), p, nil)
}

// DeleteIdentityProvider: missing is not an error.
func (c *Client) DeleteIdentityProvider(ctx context.Context, alias string) error {
	if err := c.do(ctx, http.MethodDelete, idpPath(alias), nil, nil); err != nil && !IsNotFound(err) {
		return err
	}
	return nil
}

// ImportConfig: Keycloak fetches metadata.
func (c *Client) ImportConfig(ctx context.Context, providerID, fromURL string) (map[string]string, error) {
	out := map[string]any{}
	if err := c.do(ctx, http.MethodPost, "/identity-provider/import-config", map[string]string{"providerId": providerID, "fromUrl": fromURL}, &out); err != nil {
		return nil, err
	}
	cfg := make(map[string]string, len(out))
	for k, v := range out {
		switch t := v.(type) {
		case string:
			cfg[k] = t
		case bool, float64:
			cfg[k] = fmt.Sprint(t)
		}
	}
	return cfg, nil
}

// Mappers of one identity provider.
func (c *Client) Mappers(ctx context.Context, alias string) ([]Mapper, error) {
	var out []Mapper
	err := c.do(ctx, http.MethodGet, idpPath(alias)+"/mappers", nil, &out)
	return out, err
}

// CreateMapper adds a mapper.
func (c *Client) CreateMapper(ctx context.Context, alias string, m Mapper) error {
	return c.do(ctx, http.MethodPost, idpPath(alias)+"/mappers", m, nil)
}

// UpdateMapper replaces a mapper by id.
func (c *Client) UpdateMapper(ctx context.Context, alias string, m Mapper) error {
	return c.do(ctx, http.MethodPut, idpPath(alias)+"/mappers/"+url.PathEscape(m.ID), m, nil)
}

// DeleteMapper removes a mapper by id.
func (c *Client) DeleteMapper(ctx context.Context, alias, id string) error {
	return c.do(ctx, http.MethodDelete, idpPath(alias)+"/mappers/"+url.PathEscape(id), nil, nil)
}
