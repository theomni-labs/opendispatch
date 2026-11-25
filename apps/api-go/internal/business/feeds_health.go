// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

// FeedState is what the ingest knows about one feed.
type FeedState struct {
	Feed           string
	Queued         int
	LastReceived   *time.Time
	LastApplied    *time.Time
	RecentRejected int
	LastErrorAt    *time.Time
	LastError      *string
}

// FeedStateSource reads ingest state; nil when feeds are off.
var FeedStateSource func(ctx context.Context, tenantID string) ([]FeedState, error)

// FeedSilentAfter is how long without an event counts as down.
var FeedSilentAfter = 15 * time.Minute

// FeedBacklog is the queue depth that counts as degraded.
const FeedBacklog = 1000

var feedOfKind = map[string]string{"case_feed": "case", "agent_feed": "agent_status"}

func iso(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := datactx.ToRiyadhISO(*t)
	return &s
}

// overlayFeedHealth replaces the stand-in health of the two inbound feeds with what the ingest saw.
func overlayFeedHealth(tenantID string, rows []Integration, now time.Time) []Integration {
	if FeedStateSource == nil {
		return rows
	}
	states, err := FeedStateSource(context.Background(), tenantID)
	if err != nil {
		return rows
	}
	by := map[string]FeedState{}
	for _, s := range states {
		by[s.Feed] = s
	}
	for i, r := range rows {
		s, ok := by[feedOfKind[r.Kind]]
		if !ok || s.LastReceived == nil || !r.IsEnabled {
			continue
		}
		switch {
		case now.Sub(*s.LastReceived) > FeedSilentAfter:
			rows[i].Health = "down"
		case s.RecentRejected > 0 || s.Queued > FeedBacklog:
			rows[i].Health = "degraded"
		default:
			rows[i].Health = "healthy"
		}
		rows[i].LastSuccessAt = iso(s.LastApplied)
		rows[i].LastErrorAt = iso(s.LastErrorAt)
		rows[i].LastErrorMessage = s.LastError
	}
	return rows
}
