// SPDX-License-Identifier: AGPL-3.0-only

package engines_test

import (
	"compress/gzip"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
)

func TestClientGzipsOnlyAboveTheThreshold(t *testing.T) {
	srv := enginetest.New()
	defer srv.Close()
	h := engines.NewHTTP(engines.Forecaster, srv.URL)
	small := `{"a":"` + strings.Repeat("x", 1000) + `"}`
	big := `{"a":"` + strings.Repeat("abc", engines.GzipThreshold) + `"}`
	for _, body := range []string{small, big} {
		if _, err := h.Call(context.Background(), []byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	got := srv.Requests()
	if got[0].Encoding != "" || got[0].Body != small || got[0].WireBytes != len(small) {
		t.Fatalf("small request: %q, %d wire", got[0].Encoding, got[0].WireBytes)
	}
	if got[1].Encoding != "gzip" || got[1].Body != big || got[1].WireBytes >= len(big)/10 {
		t.Fatalf("big request: %q, %d wire of %d", got[1].Encoding, got[1].WireBytes, len(big))
	}
	if got[1].ContentType != "application/json" {
		t.Fatalf("content type %q", got[1].ContentType)
	}
}

func TestResponseCapAppliesToTheDecodedBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Encoding", "gzip")
		zw := gzip.NewWriter(w)
		_, _ = zw.Write([]byte(`"` + strings.Repeat("x", 5000) + `"`))
		_ = zw.Close()
	}))
	defer srv.Close()
	h := engines.NewHTTP(engines.Forecaster, srv.URL)
	h.MaxResponse = 1000
	if _, err := h.Call(context.Background(), []byte("{}")); !errors.Is(err, engines.ErrTooLarge) {
		t.Fatalf("err = %v", err)
	}
	h.MaxResponse = 10000
	if body, err := h.Call(context.Background(), []byte("{}")); err != nil || len(body) != 5002 {
		t.Fatalf("%d bytes, %v", len(body), err)
	}
}

func TestMinDrop(t *testing.T) {
	fits := func(limit int) func(int) (bool, error) {
		return func(d int) (bool, error) { return d >= limit, nil }
	}
	for _, c := range []struct{ max, limit, want int }{{9, 0, 0}, {9, 4, 4}, {9, 9, 9}} {
		got, ok, err := engines.MinDrop(c.max, fits(c.limit))
		if err != nil || !ok || got != c.want {
			t.Fatalf("%+v: %d %v %v", c, got, ok, err)
		}
	}
	if _, ok, _ := engines.MinDrop(9, fits(10)); ok {
		t.Fatal("must not fit")
	}
}
