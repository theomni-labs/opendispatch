// SPDX-License-Identifier: AGPL-3.0-only

// Pure tests for remote.go: no live Postgres needed.
package business

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func resetRemoteDeps() {
	ResetForecastCoreForTest()
	ResetRemoteReviewsForTest()
}

func TestRound2_MatchesJSHalfTowardPositiveInfinity(t *testing.T) {
	if got := round2(1.236); got != 1.24 {
		t.Fatalf("got %v, want 1.24", got)
	}
	if got := round2(-1.236); got != -1.24 {
		t.Fatalf("got %v, want -1.24 (half toward +Infinity, not truncated toward zero)", got)
	}
	if got := round2(-1.234); got != -1.23 {
		t.Fatalf("got %v, want -1.23", got)
	}
}

func TestHandlingMs_DeterministicWithinRange(t *testing.T) {
	a := handlingMs("case-1")
	b := handlingMs("case-1")
	if a != b {
		t.Fatalf("got %d then %d, want the same case to hash the same", a, b)
	}
	if a < 16*60_000 || a > 47*60_000 {
		t.Fatalf("got %dms, want within [16,47] minutes", a)
	}
	if handlingMs("case-2") == a {
		t.Fatalf("got the same handling time for two different case ids (allowed but suspicious for this fixture)")
	}
}

func TestItemOf_NotYetRegisteredIsNil(t *testing.T) {
	c := Case{ID: "c1", RegisteredAt: "2026-09-20T08:00:00+03:00"}
	asOf, _ := startOfDayMs("2026-09-20")
	item, err := itemOf(c, asOf+7*3_600_000, map[string]remoteReview{})
	check(t, err)
	if item != nil {
		t.Fatalf("got %+v, want nil (registered after asOf)", item)
	}
}

func TestItemOf_WaitingWhenNothingStartedYet(t *testing.T) {
	c := Case{ID: "c1", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-20T06:00:00+03:00", DataSource: "SYNTHETIC"}
	dayStart, err := startOfDayMs("2026-09-20")
	check(t, err)
	item, err := itemOf(c, dayStart+7*3_600_000, map[string]remoteReview{})
	check(t, err)
	if item == nil || item.Status != "waiting" || item.AssignedReviewerID != nil {
		t.Fatalf("got %+v, want waiting with no reviewer", item)
	}
}

func TestItemOf_InReviewThenDoneFromRawCaseFields(t *testing.T) {
	started := "2026-09-20T07:00:00+03:00"
	closed := "2026-09-20T07:40:00+03:00"
	c := Case{ID: "c1", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-20T06:00:00+03:00", RemoteReviewAt: &started, ClosedAt: &closed, DataSource: "SYNTHETIC"}
	dayStart, err := startOfDayMs("2026-09-20")
	check(t, err)

	beforeReview, err := itemOf(c, dayStart+6*3_600_000+30*60_000, map[string]remoteReview{})
	check(t, err)
	if beforeReview.Status != "waiting" {
		t.Fatalf("got %s, want waiting before remote_review_at", beforeReview.Status)
	}

	duringReview, err := itemOf(c, dayStart+7*3_600_000+10*60_000, map[string]remoteReview{})
	check(t, err)
	if duringReview.Status != "in_review" {
		t.Fatalf("got %s, want in_review after remote_review_at, before closed_at", duringReview.Status)
	}

	afterClose, err := itemOf(c, dayStart+8*3_600_000, map[string]remoteReview{})
	check(t, err)
	if afterClose.Status != "done" || afterClose.ReviewFinishedAt == nil || *afterClose.ReviewFinishedAt != closed {
		t.Fatalf("got %+v, want done with review_finished_at = closed_at", afterClose)
	}
}

func TestItemOf_StoredReviewTransitionsToDone(t *testing.T) {
	c := Case{ID: "case-fixed-hash", CaseNumber: "RD-1", ZoneID: "z1", RegisteredAt: "2026-09-20T06:00:00+03:00", DataSource: "SYNTHETIC"}
	startedAt := "2026-09-20T07:00:00+03:00"
	stored := map[string]remoteReview{c.ID: {CaseID: c.ID, ReviewerID: "sur-1", ReviewStartedAt: startedAt}}
	startT, err := startOfDayMs("2026-09-20")
	check(t, err)
	startMs := startT + 7*3_600_000
	handling := handlingMs(c.ID)

	mid, err := itemOf(c, startMs+handling/2, stored)
	check(t, err)
	if mid.Status != "in_review" || mid.AssignedReviewerID == nil || *mid.AssignedReviewerID != "sur-1" {
		t.Fatalf("got %+v, want in_review assigned to sur-1", mid)
	}

	done, err := itemOf(c, startMs+handling+60_000, stored)
	check(t, err)
	if done.Status != "done" || done.ReviewFinishedAt == nil {
		t.Fatalf("got %+v, want done once handling time has elapsed", done)
	}
}

func TestQueueItems_SortsByStatusThenRegisteredAt(t *testing.T) {
	resetRemoteDeps()
	rc, _ := adminCtx(t)
	SeedCasesForTest([]Case{
		{ID: "b", CaseNumber: "RD-2", ZoneID: "z1", Handling: "remote_inferred", RegisteredAt: "2026-09-20T05:00:00+03:00", DataSource: "SYNTHETIC"},
		{ID: "a", CaseNumber: "RD-1", ZoneID: "z1", Handling: "remote_inferred", RegisteredAt: "2026-09-20T04:00:00+03:00", DataSource: "SYNTHETIC"},
	})
	queue, err := queueItems(context.Background(), rc)
	check(t, err)
	if queue == nil || len(queue.Items) != 2 {
		t.Fatalf("got %+v, want 2 queued items", queue)
	}
	if queue.Items[0].CaseID != "a" || queue.Items[1].CaseID != "b" {
		t.Fatalf("got %v, want a (earlier registered_at) before b", queue.Items)
	}
}

func TestQueueItems_ExcludesOtherHandlingAndOtherDays(t *testing.T) {
	resetRemoteDeps()
	rc, _ := adminCtx(t)
	SeedCasesForTest([]Case{
		{ID: "field-case", CaseNumber: "RD-1", ZoneID: "z1", Handling: "field", RegisteredAt: "2026-09-20T05:00:00+03:00", DataSource: "SYNTHETIC"},
		{ID: "old-case", CaseNumber: "RD-2", ZoneID: "z1", Handling: "remote_inferred", RegisteredAt: "2026-09-19T05:00:00+03:00", DataSource: "SYNTHETIC"},
		{ID: "queue-case", CaseNumber: "RD-3", ZoneID: "z1", Handling: "remote_inferred", RegisteredAt: "2026-09-20T05:00:00+03:00", DataSource: "SYNTHETIC"},
	})
	queue, err := queueItems(context.Background(), rc)
	check(t, err)
	if queue == nil || len(queue.Items) != 1 || queue.Items[0].CaseID != "queue-case" {
		t.Fatalf("got %+v, want only the latest day's remote_inferred case", queue)
	}
}

func TestListRemoteQueue_AccessGating(t *testing.T) {
	resetRemoteDeps()
	_, tenantID := adminCtx(t)
	dispatcher := roleCtx(tenantID, "u1", access.RoleDispatcher)
	if _, err := ListRemoteQueue(dispatcher, RemoteQueueQuery{}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden for Dispatcher (AccessNone)", err)
	}
	viewer := roleCtx(tenantID, "u2", access.RoleViewerAuditor)
	if _, err := ListRemoteQueue(viewer, RemoteQueueQuery{}); err != nil {
		t.Fatalf("got %v, want no error for Viewer/Auditor (AccessView)", err)
	}
}

func TestListRemoteQueue_RejectsBadStatus(t *testing.T) {
	resetRemoteDeps()
	rc, _ := adminCtx(t)
	if _, err := ListRemoteQueue(rc, RemoteQueueQuery{Status: "bogus"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid for an unknown status", err)
	}
}

func TestGetRemoteQueueClock_NilWithNoQueueDay(t *testing.T) {
	resetRemoteDeps()
	// Case has a committed fixture that resetRemoteDeps'
	// reset would otherwise lazily reseed; force
	// genuinely empty (no remote_inferred case) here.
	forecastMu.Lock()
	forecastSeeded = true
	forecastMu.Unlock()
	rc, _ := adminCtx(t)
	clock, err := GetRemoteQueueClock(rc)
	check(t, err)
	if clock != nil {
		t.Fatalf("got %+v, want nil with no remote_inferred case", clock)
	}
}

func TestGetRemoteQueueClock_ReflectsQueueDay(t *testing.T) {
	resetRemoteDeps()
	rc, _ := adminCtx(t)
	SeedCasesForTest([]Case{{ID: "a", CaseNumber: "RD-1", ZoneID: "z1", Handling: "remote_inferred", RegisteredAt: "2026-09-20T05:00:00+03:00", DataSource: "SYNTHETIC"}})
	clock, err := GetRemoteQueueClock(rc)
	check(t, err)
	if clock == nil || clock.Date != "2026-09-20" {
		t.Fatalf("got %+v, want date 2026-09-20", clock)
	}
}

func TestRemoteJSON_SnakeCaseAndNullReviewer(t *testing.T) {
	raw, err := json.Marshal(RemoteQueueItem{CaseID: "c", Status: "waiting"})
	check(t, err)
	var m map[string]any
	check(t, json.Unmarshal(raw, &m))
	for _, k := range []string{"case_id", "case_number", "zone_id", "registered_at", "status", "assigned_reviewer_id", "review_started_at", "review_finished_at", "data_source"} {
		if _, ok := m[k]; !ok {
			t.Fatalf("got %s, want key %s", raw, k)
		}
	}
	if m["assigned_reviewer_id"] != nil {
		t.Fatalf("got %v, want null reviewer", m["assigned_reviewer_id"])
	}
}

func TestReplayStored_ReadsSnakeCaseSetting(t *testing.T) {
	settingsstore.ResetForTest()
	_ = settingsstore.Put(context.Background(), "", "dispatch.replay", map[string]any{"status": "paused", "replay_at": "2026-09-12T09:30:00+03:00", "speed": 1.0, "anchor_wall_ms": nil})
	got, _ := settingsstore.Get(context.Background(), "", "dispatch.replay", replayStored{})
	if got.Status != "paused" || got.ReplayAt != "2026-09-12T09:30:00+03:00" {
		t.Fatalf("got %+v, want the stored snake_case fields", got)
	}
}

func TestAllRemoteZoneRows_LazySeedFromFixtures(t *testing.T) {
	ReloadRemoteZonesForTest()
	rows := allRemoteZoneRows()
	if len(rows) == 0 || rows[0].Code == "" {
		t.Fatalf("got %+v, want fixture zones with codes", rows)
	}
	ResetRemoteZonesForTest()
	if n := len(allRemoteZoneRows()); n != 0 {
		t.Fatalf("got %d rows, want 0 after reset", n)
	}
	ReloadRemoteZonesForTest()
}
