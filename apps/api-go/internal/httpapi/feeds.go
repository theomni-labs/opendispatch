// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds"
)

// Feeds is the inbound feed service; nil turns the routes off.
type Feeds struct {
	Keys  *feeds.Keys
	Store *feeds.Store
	// Busy answers true while the api should refuse feeds.
	Busy func(tenantID string) bool
	Skew time.Duration
	Now  func() time.Time
}

const maxFeedBody = 4 << 20

var feedService *Feeds

// SetFeeds installs the feed service.
func SetFeeds(f *Feeds) { feedService = f }

func (f *Feeds) now() time.Time {
	if f.Now != nil {
		return f.Now()
	}
	return time.Now()
}

// RegisterFeedRoutes adds the signed feed endpoints.
func RegisterFeedRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /feeds/v1/cases", func(w http.ResponseWriter, r *http.Request) { feedService.ingest(w, r, feeds.FeedCase) })
	mux.HandleFunc("POST /feeds/v1/agent-status", func(w http.ResponseWriter, r *http.Request) { feedService.ingest(w, r, feeds.FeedAgentState) })
}

func feedError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func (f *Feeds) ingest(w http.ResponseWriter, r *http.Request, feed string) {
	if f == nil {
		feedError(w, http.StatusNotFound, "feeds_off")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxFeedBody))
	if err != nil {
		feedError(w, http.StatusRequestEntityTooLarge, "body_too_large")
		return
	}
	skew := f.Skew
	if skew == 0 {
		skew = 5 * time.Minute
	}
	key, err := f.Keys.Lookup(r.Header.Get("X-Feed-Key-Id"), f.now())
	if err == nil {
		err = key.Check(r.Header.Get("X-Feed-Timestamp"), r.Header.Get("X-Feed-Signature"), body, f.now(), skew)
	}
	if err != nil {
		feedError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if f.Busy != nil && f.Busy(key.TenantID) {
		w.Header().Set("Retry-After", "120")
		feedError(w, http.StatusServiceUnavailable, "maintenance")
		return
	}
	var req struct {
		Events []json.RawMessage `json:"events"`
	}
	if err := json.Unmarshal(body, &req); err != nil || len(req.Events) == 0 || len(req.Events) > feeds.MaxBatch {
		feedError(w, http.StatusBadRequest, "events_required")
		return
	}
	events := make([]feeds.Event, len(req.Events))
	problems := map[int]string{}
	for i, raw := range req.Events {
		var reason string
		switch feed {
		case feeds.FeedCase:
			var e feeds.CaseEvent
			if err := json.Unmarshal(raw, &e); err != nil {
				reason = "unreadable event"
			} else {
				events[i] = e.Event
				reason = e.Validate()
			}
		default:
			var e feeds.StatusEvent
			if err := json.Unmarshal(raw, &e); err != nil {
				reason = "unreadable event"
			} else {
				events[i] = e.Event
				reason = e.Validate()
			}
		}
		events[i].Raw = raw
		if reason != "" {
			problems[i] = reason
		}
	}
	res, err := f.Store.Enqueue(r.Context(), key.TenantID, key.ID, feed, events, problems)
	if err != nil {
		log.Printf("feeds: storing events failed: %v", err)
		feedError(w, http.StatusServiceUnavailable, "try_again")
		return
	}
	writeJSON(w, http.StatusAccepted, res)
}

// RunFeedProcessor drains the queue for every customer with a key until ctx ends.
func RunFeedProcessor(ctx context.Context, f *Feeds, every time.Duration, retention time.Duration) {
	lastPurge := time.Time{}
	for {
		for _, t := range f.Keys.Tenants() {
			if _, err := f.Store.Drain(ctx, t.TenantID, t.DataSource, feeds.MaxBatch); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("feeds: applying the queue failed: %v", err)
			}
			if retention > 0 && time.Since(lastPurge) > 6*time.Hour {
				if _, err := f.Store.Purge(ctx, t.TenantID, time.Now().Add(-retention)); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("feeds: purge failed: %v", err)
				}
			}
		}
		if retention > 0 && time.Since(lastPurge) > 6*time.Hour {
			lastPurge = time.Now()
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(every):
		}
	}
}
