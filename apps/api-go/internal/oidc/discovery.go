// SPDX-License-Identifier: AGPL-3.0-only

package oidc

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Endpoints is what an issuer publishes at /.well-known/openid-configuration.
type Endpoints struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	JWKSURI               string `json:"jwks_uri"`
	EndSessionEndpoint    string `json:"end_session_endpoint"`
}

// Discover reads the issuer's configuration and checks it names the issuer it was asked for (a mix-up attack answers with
// another issuer's document). Plain http is refused unless allowInsecure is set, which only tests and a local mock use.
func Discover(ctx context.Context, client *http.Client, issuer string, allowInsecure bool) (*Endpoints, error) {
	u, err := url.Parse(issuer)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("oidc: %q is not an issuer url", issuer)
	}
	if u.Scheme != "https" && !(allowInsecure && u.Scheme == "http") {
		return nil, fmt.Errorf("oidc: the issuer %q must use https", issuer)
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(issuer, "/")+"/.well-known/openid-configuration", nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oidc: discovery failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc: discovery answered %d", resp.StatusCode)
	}
	var doc Endpoints
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBody)).Decode(&doc); err != nil {
		return nil, fmt.Errorf("oidc: reading the discovery document: %w", err)
	}
	if doc.Issuer != issuer {
		return nil, fmt.Errorf("oidc: the issuer asked for is %q but the document says %q", issuer, doc.Issuer)
	}
	if doc.AuthorizationEndpoint == "" || doc.TokenEndpoint == "" || doc.JWKSURI == "" {
		return nil, fmt.Errorf("oidc: the discovery document lacks an endpoint")
	}
	return &doc, nil
}
