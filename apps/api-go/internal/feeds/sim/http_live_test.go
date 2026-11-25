// SPDX-License-Identifier: AGPL-3.0-only

// Live: what the feed endpoints refuse.
package sim_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds"
)

func (r *rig) post(t *testing.T, path string, body []byte, mutate func(h http.Header)) *http.Response {
	t.Helper()
	stamp, sig := feeds.SignWith(r.sender.Key, time.Now(), body)
	req, _ := http.NewRequest(http.MethodPost, r.server.URL+path, bytes.NewReader(body))
	req.Header.Set("X-Feed-Key-Id", r.sender.Key.ID)
	req.Header.Set("X-Feed-Timestamp", stamp)
	req.Header.Set("X-Feed-Signature", sig)
	if mutate != nil {
		mutate(req.Header)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func oneCase(ext, zone string) []byte {
	now := time.Now().UTC().Truncate(time.Second)
	e := feeds.CaseEvent{Event: feeds.Event{IdempotencyKey: "k-" + ext, OccurredAt: now},
		Case: feeds.CasePayload{ExternalID: ext, CaseNumber: "T-" + ext, RegisteredAt: now, UpdatedAt: now, ZoneExternalID: zone, CaseTypeExternalID: "1", Handling: "field"}}
	raw, _ := json.Marshal(e)
	body, _ := json.Marshal(map[string]any{"events": []json.RawMessage{raw}})
	return body
}

func TestUnsignedAndBadlySignedRequestsAreRefused(t *testing.T) {
	r := newRig(t)
	body := oneCase("http-1", "2001")
	for name, mutate := range map[string]func(http.Header){
		"no signature": func(h http.Header) { h.Del("X-Feed-Signature") },
		"wrong signature": func(h http.Header) {
			sig := h.Get("X-Feed-Signature")
			flipped := "a"
			if sig[0] == 'a' {
				flipped = "b"
			}
			h.Set("X-Feed-Signature", flipped+sig[1:])
		},
		"unknown key": func(h http.Header) { h.Set("X-Feed-Key-Id", "nobody") },
		"old timestamp": func(h http.Header) {
			h.Set("X-Feed-Timestamp", strconv.FormatInt(time.Now().Add(-time.Hour).Unix(), 10))
		},
	} {
		if got := r.post(t, "/feeds/v1/cases", body, mutate).StatusCode; got != http.StatusUnauthorized {
			t.Errorf("%s: status %d, want 401", name, got)
		}
	}
	// A signature for one body does not pass for another.
	other := oneCase("http-2", "2001")
	stamp, sig := feeds.SignWith(r.sender.Key, time.Now(), body)
	req, _ := http.NewRequest(http.MethodPost, r.server.URL+"/feeds/v1/cases", bytes.NewReader(other))
	req.Header.Set("X-Feed-Key-Id", r.sender.Key.ID)
	req.Header.Set("X-Feed-Timestamp", stamp)
	req.Header.Set("X-Feed-Signature", sig)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a swapped body: status %d, want 401", resp.StatusCode)
	}
	var n int
	if err := r.owner.QueryRow(context.Background(), `SELECT count(*) FROM feed_events WHERE tenant_id = $1`, tenant).Scan(&n); err != nil || n != 0 {
		t.Fatalf("a refused request stored %d events (%v)", n, err)
	}
}

func TestMaintenanceAnswersBusyAndStoresNothing(t *testing.T) {
	r := newRig(t)
	r.busy = func() bool { return true }
	resp := r.post(t, "/feeds/v1/cases", oneCase("http-3", "2001"), nil)
	if resp.StatusCode != http.StatusServiceUnavailable || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("status %d, retry-after %q", resp.StatusCode, resp.Header.Get("Retry-After"))
	}
	var n int
	if err := r.owner.QueryRow(context.Background(), `SELECT count(*) FROM feed_events WHERE tenant_id = $1`, tenant).Scan(&n); err != nil || n != 0 {
		t.Fatalf("maintenance stored %d events (%v)", n, err)
	}
}

func TestBadShapeIsRefusedAtTheDoorAndBadReferenceIsKeptWithItsReason(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	bad := oneCase("http-4", "2001")
	var req map[string][]map[string]any
	_ = json.Unmarshal(bad, &req)
	// An unknown location type is refused.
	req["events"][0]["case"].(map[string]any)["location_type"] = "moon"
	body, _ := json.Marshal(req)
	resp := r.post(t, "/feeds/v1/cases", body, nil)
	var res feeds.Result
	_ = json.NewDecoder(resp.Body).Decode(&res)
	if resp.StatusCode != http.StatusAccepted || res.Accepted != 0 || len(res.Rejected) != 1 {
		t.Fatalf("a bad value: %d %+v", resp.StatusCode, res)
	}
	// Unknown zone: stored, then rejected by the processor with the reason.
	r.post(t, "/feeds/v1/cases", oneCase("http-5", "no-such-zone"), nil)
	tally := r.drainAll(t)
	if tally.Rejected != 1 {
		t.Fatalf("tally %+v", tally)
	}
	var reason string
	if err := r.owner.QueryRow(ctx, `SELECT reject_reason FROM feed_events WHERE tenant_id = $1 AND status = 'rejected'`, tenant).Scan(&reason); err != nil || reason == "" {
		t.Fatalf("reason %q (%v)", reason, err)
	}
}

func TestPurgeRemovesOldHistoryAndFinishedEventsButNotQueued(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	r.post(t, "/feeds/v1/cases", oneCase("http-6", "2001"), nil)
	r.drainAll(t)
	r.post(t, "/feeds/v1/cases", oneCase("http-7", "2001"), nil)
	if _, err := r.owner.Exec(ctx, `UPDATE feed_events SET received_at = now() - interval '40 days'`); err != nil {
		t.Fatal(err)
	}
	if _, err := r.store.Purge(ctx, tenant, time.Now().Add(-30*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	var applied, queued int
	_ = r.owner.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status <> 'queued'), count(*) FILTER (WHERE status = 'queued') FROM feed_events WHERE tenant_id = $1`, tenant).Scan(&applied, &queued)
	if applied != 0 || queued != 1 {
		t.Fatalf("after purge: %d finished, %d queued", applied, queued)
	}
	if _, err := r.owner.Exec(ctx, `DELETE FROM cases WHERE tenant_id = $1 AND external_id LIKE 'http-%'`, tenant); err != nil {
		t.Fatal(err)
	}
}

func TestAnEventTheDatabaseRefusesIsRejectedAndDoesNotBlockTheFeed(t *testing.T) {
	r := newRig(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second).Format(time.RFC3339)
	bad := `{"idempotency_key":"wedge-1","occurred_at":"` + now + `","case":{"external_id":"http-wedge-1","case_number":"T-W1","registered_at":"` + now + `","updated_at":"` + now +
		`","zone_external_id":"2001","case_type_external_id":"1","parties_involved":99999999999,"handling":"field"}}`
	good := `{"idempotency_key":"wedge-2","occurred_at":"` + now + `","case":{"external_id":"http-wedge-2","case_number":"T-W2","registered_at":"` + now + `","updated_at":"` + now +
		`","zone_external_id":"2001","case_type_external_id":"1","handling":"field"}}`
	r.post(t, "/feeds/v1/cases", []byte(`{"events":[`+bad+`,`+good+`]}`), nil)
	tally := r.drainAll(t)
	if tally.Rejected != 1 || tally.Applied != 1 {
		t.Fatalf("one bad event must not stop the good one: %+v", tally)
	}
	var reason string
	if err := r.owner.QueryRow(ctx, `SELECT reject_reason FROM feed_events WHERE tenant_id = $1 AND status = 'rejected'`, tenant).Scan(&reason); err != nil || reason == "" {
		t.Fatalf("the refusal has no reason: %q %v", reason, err)
	}
	if _, err := r.owner.Exec(ctx, `DELETE FROM cases WHERE tenant_id = $1 AND external_id LIKE 'http-wedge-%'`, tenant); err != nil {
		t.Fatal(err)
	}
}
