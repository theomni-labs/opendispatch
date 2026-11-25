// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
	"time"
)

func TestFeedHealthOverlay(t *testing.T) {
	now := time.Now()
	recent, old := now.Add(-time.Minute), now.Add(-time.Hour)
	rows := func() []Integration {
		return []Integration{{Kind: "case_feed", IsEnabled: true, Health: "unknown"}, {Kind: "agent_feed", IsEnabled: true, Health: "unknown"}, {Kind: "weather_feed", IsEnabled: true, Health: "healthy"}}
	}
	t.Cleanup(func() { FeedStateSource = nil })

	FeedStateSource = nil
	if got := overlayFeedHealth("t", rows(), now); got[0].Health != "unknown" {
		t.Fatal("with feeds off the stand-in health stays")
	}
	FeedStateSource = func(context.Context, string) ([]FeedState, error) {
		return []FeedState{{Feed: "case", LastReceived: &recent, LastApplied: &recent}, {Feed: "agent_status", LastReceived: &old}}, nil
	}
	got := overlayFeedHealth("t", rows(), now)
	if got[0].Health != "healthy" || got[0].LastSuccessAt == nil {
		t.Fatalf("a feed heard from a minute ago is healthy: %+v", got[0])
	}
	if got[1].Health != "down" {
		t.Fatalf("a feed silent for an hour is down: %+v", got[1])
	}
	if got[2].Health != "healthy" {
		t.Fatal("other kinds are left alone")
	}
	FeedStateSource = func(context.Context, string) ([]FeedState, error) {
		return []FeedState{{Feed: "case", LastReceived: &recent, RecentRejected: 2}}, nil
	}
	if got := overlayFeedHealth("t", rows(), now); got[0].Health != "degraded" {
		t.Fatalf("recent refusals degrade a feed: %+v", got[0])
	}
	FeedStateSource = func(context.Context, string) ([]FeedState, error) { return []FeedState{{Feed: "case"}}, nil }
	if got := overlayFeedHealth("t", rows(), now); got[0].Health != "unknown" {
		t.Fatal("a feed never heard from keeps its stand-in health")
	}
}
