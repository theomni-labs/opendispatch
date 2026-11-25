// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// Refs: SYNTHETIC fixture codes a feed may name.
type Refs struct {
	ZoneIDs   []string            // internal ids, for sign-in
	Zones     []string            // external ids
	CaseTypes []string            // external ids
	Agents    map[string][]string // zone external id to field codes
	AllCodes  []string
}

func readJSON(path string, v any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

// LoadRefs reads zones, case types and agents.
func LoadRefs(fixtures string) (*Refs, error) {
	var zones []struct {
		ID         string `json:"id"`
		ExternalID string `json:"external_id"`
	}
	var types []struct {
		ExternalID string `json:"external_id"`
	}
	var people []struct {
		Code, Kind string
		HomeZoneID string `json:"home_zone_id"`
		IsActive   bool   `json:"is_active"`
	}
	if err := readJSON(filepath.Join(fixtures, "locations", "zones.json"), &zones); err != nil {
		return nil, err
	}
	if err := readJSON(filepath.Join(fixtures, "reference", "case_types.json"), &types); err != nil {
		return nil, err
	}
	if err := readJSON(filepath.Join(fixtures, "people", "agents.json"), &people); err != nil {
		return nil, err
	}
	r := &Refs{Agents: map[string][]string{}}
	ext := map[string]string{}
	for _, z := range zones {
		if z.ExternalID != "" {
			r.ZoneIDs = append(r.ZoneIDs, z.ID)
			r.Zones = append(r.Zones, z.ExternalID)
			ext[z.ID] = z.ExternalID
		}
	}
	for _, t := range types {
		if t.ExternalID != "" {
			r.CaseTypes = append(r.CaseTypes, t.ExternalID)
		}
	}
	for _, p := range people {
		if p.Kind == "field" && p.IsActive && ext[p.HomeZoneID] != "" {
			r.Agents[ext[p.HomeZoneID]] = append(r.Agents[ext[p.HomeZoneID]], p.Code)
			r.AllCodes = append(r.AllCodes, p.Code)
		}
	}
	if len(r.Zones) == 0 || len(r.CaseTypes) == 0 || len(r.AllCodes) == 0 {
		return nil, fmt.Errorf("%s: no zones, case types or field agents", fixtures)
	}
	return r, nil
}

// Case is the feed's case payload.
type Case struct {
	ExternalID   string     `json:"external_id"`
	CaseNumber   string     `json:"case_number"`
	RegisteredAt time.Time  `json:"registered_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	Zone         string     `json:"zone_external_id"`
	CaseType     string     `json:"case_type_external_id"`
	Parties      int        `json:"parties_involved"`
	AssignedAt   *time.Time `json:"assigned_at"`
	ArrivedAt    *time.Time `json:"arrived_at"`
	ClosedAt     *time.Time `json:"closed_at"`
	Agent        *string    `json:"agent_code"`
	Handling     string     `json:"handling"`
}

type caseEvent struct {
	Key        string    `json:"idempotency_key"`
	OccurredAt time.Time `json:"occurred_at"`
	Case       Case      `json:"case"`
}

type statusEvent struct {
	Key        string    `json:"idempotency_key"`
	OccurredAt time.Time `json:"occurred_at"`
	Agent      string    `json:"agent_code"`
	Status     string    `json:"status"`
}

// NewCase invents one SYNTHETIC case.
func NewCase(r *Refs, rng *rand.Rand, run string, n int, now time.Time, fieldShare float64) Case {
	zone := r.Zones[rng.IntN(len(r.Zones))]
	h := "remote_inferred"
	if rng.Float64() < fieldShare {
		h = "field"
	}
	id := fmt.Sprintf("LG-%s-%06d", run, n)
	return Case{ExternalID: id, CaseNumber: id, RegisteredAt: now, UpdatedAt: now, Zone: zone,
		CaseType: r.CaseTypes[rng.IntN(len(r.CaseTypes))], Parties: 1 + rng.IntN(3), Handling: h}
}

// Advance: step 1 assign, 2 arrive, 3 close.
func (c Case) Advance(step int, r *Refs, rng *rand.Rand, now time.Time) Case {
	t := now
	c.UpdatedAt = now
	switch step {
	case 1:
		codes := r.Agents[c.Zone]
		if len(codes) == 0 {
			codes = r.AllCodes
		}
		code := codes[rng.IntN(len(codes))]
		c.Agent, c.AssignedAt = &code, &t
	case 2:
		c.ArrivedAt = &t
	case 3:
		c.ClosedAt = &t
	}
	return c
}

// Feed posts signed events to the api's feeds.
type Feed struct {
	Base   string
	KeyID  string
	Secret []byte
	Client *http.Client
}

func sign(secret []byte, ts string, body []byte) string {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(ts))
	m.Write([]byte("."))
	m.Write(body)
	return hex.EncodeToString(m.Sum(nil))
}

// Post sends one batch; returns the status code.
func (f *Feed) Post(ctx context.Context, path string, events any) (int, error) {
	body, err := json.Marshal(map[string]any{"events": events})
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, f.Base+path, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Feed-Key-Id", f.KeyID)
	req.Header.Set("X-Feed-Timestamp", ts)
	req.Header.Set("X-Feed-Signature", sign(f.Secret, ts, body))
	resp, err := f.Client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	var res struct {
		Rejected []json.RawMessage `json:"rejected"`
	}
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusAccepted && json.Unmarshal(raw, &res) == nil && len(res.Rejected) > 0 {
		return resp.StatusCode, fmt.Errorf("%d events rejected: %s", len(res.Rejected), raw)
	}
	return resp.StatusCode, nil
}
