// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds/sim"
)

// board reads the Live Dispatch Board as a supervisor.
type board struct {
	api    string
	zones  []string
	agents map[string]string
	client *http.Client
	cookie string
}

func newBoard(api, fixtures string, agents map[string]string) (*board, error) {
	raw, err := os.ReadFile(filepath.Join(fixtures, "locations", "zones.json"))
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	b := &board{api: strings.TrimRight(api, "/"), agents: agents, client: &http.Client{}}
	for _, r := range rows {
		b.zones = append(b.zones, r.ID)
	}
	return b, nil
}

var errSignedOut = errors.New("feedsim: signed out")

func (b *board) signIn(ctx context.Context) error {
	body, _ := json.Marshal(map[string]any{"assigned_role": "dispatch_supervisor", "install_mode": "private", "zone_ids": b.zones})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.api+"/auth/demo/sign-in", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	for _, c := range resp.Cookies() {
		if c.Name == "opendispatch_session" {
			b.cookie = c.Name + "=" + c.Value
			return nil
		}
	}
	return fmt.Errorf("feedsim: the demo sign-in answered %d with no session", resp.StatusCode)
}

type liveCase struct {
	CaseNumber       string          `json:"case_number"`
	State            string          `json:"state"`
	AssignmentSource *string         `json:"assignment_source"`
	AssignedAgentID  *string         `json:"assigned_agent_id"`
	Recommendation   json.RawMessage `json:"recommendation"`
}

func (b *board) page(ctx context.Context, state, cursor string) ([]liveCase, string, error) {
	q := url.Values{"limit": {"200"}, "state": {state}}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, b.api+"/live/cases?"+q.Encode(), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Cookie", b.cookie)
	resp, err := b.client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, "", errSignedOut
	}
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("feedsim: /live/cases answered %d", resp.StatusCode)
	}
	var out struct {
		Items []liveCase `json:"items"`
		Page  struct {
			NextCursor *string `json:"next_cursor"`
		} `json:"page"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, "", err
	}
	next := ""
	if out.Page.NextCursor != nil {
		next = *out.Page.NextCursor
	}
	return out.Items, next, nil
}

// Read lists the live demo cases by state.
func (b *board) Read(ctx context.Context) (map[string]sim.Decision, error) {
	if b.cookie == "" {
		if err := b.signIn(ctx); err != nil {
			return nil, err
		}
	}
	out := map[string]sim.Decision{}
	for _, state := range []string{"waiting", "recommended", "assigned", "overridden"} {
		cursor := ""
		for {
			items, next, err := b.page(ctx, state, cursor)
			if errors.Is(err, errSignedOut) {
				b.cookie = ""
			}
			if err != nil {
				return nil, err
			}
			for _, c := range items {
				if !strings.Contains(c.CaseNumber, "-LIVE-") {
					continue
				}
				d := sim.Decision{State: c.State, Recommended: len(c.Recommendation) > 0 && string(c.Recommendation) != "null"}
				if c.AssignmentSource != nil {
					d.Source = *c.AssignmentSource
				}
				if c.AssignedAgentID != nil {
					d.AgentCode = b.agents[*c.AssignedAgentID]
				}
				out[c.CaseNumber] = d
			}
			if next == "" {
				break
			}
			cursor = next
		}
	}
	return out, nil
}
