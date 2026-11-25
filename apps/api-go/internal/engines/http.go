// SPDX-License-Identifier: AGPL-3.0-only

package engines

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// 8 MiB cap on an engine answer
const DefaultMaxResponse = 8 << 20

// decoded forecast answer: 160 MiB, about 1 GB to parse
const ForecasterMaxResponse = 160 << 20

// HTTP posts JSON to BaseURL/v1/<name>.
type HTTP struct {
	Name        Name
	BaseURL     string
	Client      *http.Client
	MaxResponse int64
	// Route: extra path, /v1/<name>/<route>
	Route string
}

func NewHTTP(name Name, baseURL string) *HTTP {
	limit := int64(DefaultMaxResponse)
	if name == Forecaster {
		limit = ForecasterMaxResponse
	}
	return &HTTP{Name: name, BaseURL: baseURL, Client: &http.Client{}, MaxResponse: limit}
}

func (h *HTTP) url() string {
	u := strings.TrimRight(h.BaseURL, "/") + "/v1/" + string(h.Name)
	if h.Route != "" {
		u += "/" + h.Route
	}
	return u
}

// Call keeps bodies out of errors and logs.
func (h *HTTP) Call(ctx context.Context, request []byte) ([]byte, error) {
	payload, gzipped := request, false
	if len(request) > GzipThreshold {
		z, err := Gzip(request)
		if err != nil {
			return nil, fmt.Errorf("engine %s: compress request: %w", h.Name, err)
		}
		payload, gzipped = z, true
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.url(), bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("engine %s: build request: %w", h.Name, err)
	}
	if gzipped {
		req.Header.Set("Content-Encoding", "gzip")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	client := h.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctxErr(ctx)
		}
		return nil, fmt.Errorf("engine %s: send: %w", h.Name, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("%w: engine %s status %d", ErrStatus, h.Name, resp.StatusCode)
	}
	limit := h.MaxResponse
	if limit <= 0 {
		limit = DefaultMaxResponse
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctxErr(ctx)
		}
		return nil, fmt.Errorf("engine %s: read: %w", h.Name, err)
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("%w: engine %s", ErrTooLarge, h.Name)
	}
	return body, nil
}

func ctxErr(ctx context.Context) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return ErrTimeout
	}
	return ctx.Err()
}
