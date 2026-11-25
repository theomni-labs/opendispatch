// SPDX-License-Identifier: AGPL-3.0-only

// Package enginetest is a mock engine server.
package enginetest

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"time"
)

type Kind int

const (
	Answer Kind = iota
	Slow
	Hang
	Status500
	InvalidJSON
	Oversized
)

// Behavior is what the server does per request
type Behavior struct {
	Kind  Kind
	Delay time.Duration
	Body  string
	Size  int
}

const DefaultBody = `{"ok":true}`

// Server follows a script and records requests
type Server struct {
	*httptest.Server

	mu       sync.Mutex
	script   []Behavior
	requests []Request
	release  chan struct{}
}

// Request is what the server saw.
type Request struct {
	Path        string
	ContentType string
	Encoding    string
	Body        string
	// WireBytes is the size on the wire
	WireBytes int
}

// New starts a server that answers with DefaultBody.
func New() *Server {
	s := &Server{script: []Behavior{{Kind: Answer}}, release: make(chan struct{})}
	s.Server = httptest.NewServer(http.HandlerFunc(s.handle))
	return s
}

// Script sets behaviors in order; last repeats
func (s *Server) Script(b ...Behavior) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.script = b
}

// Requests returns a copy of what was seen
func (s *Server) Requests() []Request {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Request(nil), s.requests...)
}

// Close frees hung handlers, then stops
func (s *Server) Close() {
	close(s.release)
	s.Server.Close()
}

func (s *Server) next(r Request) Behavior {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := len(s.requests)
	s.requests = append(s.requests, r)
	if n >= len(s.script) {
		n = len(s.script) - 1
	}
	return s.script[n]
}

func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	wire := len(raw)
	if r.Header.Get("Content-Encoding") == "gzip" {
		zr, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			http.Error(w, "bad gzip", http.StatusBadRequest)
			return
		}
		if raw, err = io.ReadAll(zr); err != nil {
			http.Error(w, "bad gzip", http.StatusBadRequest)
			return
		}
	}
	b := s.next(Request{Path: r.URL.Path, ContentType: r.Header.Get("Content-Type"), Encoding: r.Header.Get("Content-Encoding"), Body: string(raw), WireBytes: wire})
	body := b.Body
	if body == "" {
		body = DefaultBody
	}
	switch b.Kind {
	case Hang:
		select {
		case <-r.Context().Done():
		case <-s.release:
		}
		return
	case Slow:
		select {
		case <-time.After(b.Delay):
		case <-r.Context().Done():
			return
		case <-s.release:
			return
		}
	case Status500:
		http.Error(w, "boom", http.StatusInternalServerError)
		return
	case InvalidJSON:
		body = `{"ok": tru`
	case Oversized:
		body = `"` + strings.Repeat("x", b.Size) + `"`
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(body))
}
