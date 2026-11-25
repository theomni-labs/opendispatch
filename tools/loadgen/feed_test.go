// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPostSignsLikeTheApi(t *testing.T) {
	secret := []byte(strings.Repeat("k", 32))
	var got struct {
		Events []caseEvent `json:"events"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		m := hmac.New(sha256.New, secret)
		m.Write([]byte(r.Header.Get("X-Feed-Timestamp") + "."))
		m.Write(body)
		if r.Header.Get("X-Feed-Key-Id") != "lg" || !hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(r.Header.Get("X-Feed-Signature"))) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.Unmarshal(body, &got)
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"accepted":1,"duplicates":0,"rejected":[]}`))
	}))
	defer srv.Close()
	f := &Feed{Base: srv.URL, KeyID: "lg", Secret: secret, Client: srv.Client()}
	c := Case{ExternalID: "LG-x-1", CaseNumber: "LG-x-1", Handling: "field"}
	code, err := f.Post(context.Background(), "/feeds/v1/cases", []caseEvent{{Key: "k1", OccurredAt: time.Now(), Case: c}})
	if err != nil || code != http.StatusAccepted {
		t.Fatalf("code %d, err %v", code, err)
	}
	if len(got.Events) != 1 || got.Events[0].Case.ExternalID != "LG-x-1" {
		t.Fatalf("server got %+v", got)
	}
}

func TestCaseLifecycle(t *testing.T) {
	refs, err := LoadRefs(filepath.Join("..", "..", "fixtures"))
	if err != nil {
		t.Fatal(err)
	}
	rng := rand.New(rand.NewPCG(1, 2))
	now := time.Now()
	c := NewCase(refs, rng, "r", 7, now, 1)
	if c.Handling != "field" || c.ExternalID != "LG-r-000007" || c.AssignedAt != nil {
		t.Fatalf("new case %+v", c)
	}
	c = c.Advance(1, refs, rng, now.Add(time.Second))
	if c.Agent == nil || c.AssignedAt == nil || !c.UpdatedAt.After(now) {
		t.Fatalf("assigned case %+v", c)
	}
	c = c.Advance(2, refs, rng, now.Add(2*time.Second))
	c = c.Advance(3, refs, rng, now.Add(3*time.Second))
	if c.ArrivedAt == nil || c.ClosedAt == nil {
		t.Fatalf("closed case %+v", c)
	}
}

func TestPercentile(t *testing.T) {
	var d []time.Duration
	for i := 1; i <= 100; i++ {
		d = append(d, time.Duration(i)*time.Millisecond)
	}
	for p, want := range map[float64]time.Duration{50: 50 * time.Millisecond, 95: 95 * time.Millisecond, 99: 99 * time.Millisecond, 100: 100 * time.Millisecond} {
		if got := Percentile(d, p); got != want {
			t.Errorf("p%v = %v, want %v", p, got, want)
		}
	}
	if Percentile(nil, 50) != 0 {
		t.Error("empty input")
	}
}
