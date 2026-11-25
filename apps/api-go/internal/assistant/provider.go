// SPDX-License-Identifier: AGPL-3.0-only

// Package assistant: one interface, two providers: a local Ollama server
// or any OpenAI-compatible endpoint.
// Off by default; the key stays in the api process.
package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Provider names, as OPENDISPATCH_ASSISTANT_PROVIDER takes them.
const (
	ProviderOff    = "off"
	ProviderOpenAI = "openai"
	ProviderOllama = "ollama"
)

// Defaults when the env leaves a value unset.
const (
	DefaultOllamaModel = "qwen2.5:7b-instruct"
	DefaultOllamaURL   = "http://127.0.0.1:11434"
)

// ToolDef: a read-only tool the model may call.
type ToolDef struct {
	Name        string
	Description string
	Schema      map[string]any
}

// ToolCall: one call the model asked for.
type ToolCall struct {
	ID    string
	Name  string
	Input map[string]any
}

// ToolResult: what a tool returned, as text.
type ToolResult struct {
	CallID  string
	Name    string
	Content string
	IsError bool
}

// Image: one picture sent with a user turn.
type Image struct {
	MediaType string
	Data      []byte
}

// SeesImages: true when the provider reads images.
func SeesImages(p Provider) bool {
	if v, ok := p.(interface{ Vision() bool }); ok {
		return v.Vision()
	}
	return false
}

// Message: one turn of the conversation.
type Message struct {
	Role      string // "user" or "assistant"
	Text      string
	Images    []Image
	ToolCalls []ToolCall
	Results   []ToolResult
	// raw: the provider's own turn, echoed as is
	raw json.RawMessage
}

// Request: one call to the model.
type Request struct {
	System    string
	Messages  []Message
	Tools     []ToolDef
	MaxTokens int
	// JSON: the answer must be one JSON object
	JSON bool
}

// Reply: the model's turn.
type Reply struct {
	Text      string
	ToolCalls []ToolCall
	// Stop: end, tool_use, max_tokens or refusal
	Stop    string
	Message Message
}

// Provider: ollama, openai, or a test fake.
type Provider interface {
	Name() string
	Model() string
	Complete(ctx context.Context, req Request) (Reply, error)
}

// Status: what GET /assistant/status reports.
type Status struct {
	Provider   string `json:"provider"`
	Model      string `json:"model"`
	Configured bool   `json:"configured"`
	// Offline: nothing leaves the install
	Offline bool `json:"offline"`
	// Reason: why it is off; never a secret
	Reason string `json:"reason,omitempty"`
}

// ErrNotConfigured: the provider is off or lacks a key.
var ErrNotConfigured = errors.New("assistant not configured")

// ProviderError: the model call failed; safe to show.
type ProviderError struct{ Msg string }

func (e *ProviderError) Error() string { return e.Msg }

var (
	overrideMu sync.Mutex
	override   Provider
)

// Override: tests use a fake; nil restores env.
func Override(p Provider) {
	overrideMu.Lock()
	override = p
	overrideMu.Unlock()
}

// Active: the provider the env names, and why.
func Active() (Provider, Status) {
	overrideMu.Lock()
	p := override
	overrideMu.Unlock()
	if p != nil {
		return p, Status{Provider: p.Name(), Model: p.Model(), Configured: true, Offline: p.Name() != ProviderOpenAI}
	}
	return fromEnv()
}

func fromEnv() (Provider, Status) {
	name := strings.ToLower(strings.TrimSpace(os.Getenv("OPENDISPATCH_ASSISTANT_PROVIDER")))
	model := strings.TrimSpace(os.Getenv("OPENDISPATCH_ASSISTANT_MODEL"))
	timeout := envSeconds("OPENDISPATCH_ASSISTANT_TIMEOUT_SECONDS", 0)
	switch name {
	case ProviderOpenAI:
		st := Status{Provider: name, Model: model}
		base := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENDISPATCH_ASSISTANT_OPENAI_URL")), "/")
		if base == "" {
			st.Reason = "OPENDISPATCH_ASSISTANT_OPENAI_URL is not set."
			return nil, st
		}
		if model == "" {
			st.Reason = "OPENDISPATCH_ASSISTANT_MODEL is not set."
			return nil, st
		}
		if timeout == 0 {
			timeout = 120 * time.Second
		}
		vision := strings.EqualFold(strings.TrimSpace(os.Getenv("OPENDISPATCH_ASSISTANT_VISION")), "true")
		st.Configured = true
		return &openaiProvider{model: model, key: os.Getenv("OPENDISPATCH_ASSISTANT_API_KEY"), base: base, timeout: timeout, vision: vision}, st
	case ProviderOllama:
		if model == "" {
			model = DefaultOllamaModel
		}
		base := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENDISPATCH_ASSISTANT_OLLAMA_URL")), "/")
		if base == "" {
			base = DefaultOllamaURL
		}
		if timeout == 0 {
			timeout = 240 * time.Second
		}
		return &ollamaProvider{model: model, base: base, timeout: timeout}, Status{Provider: name, Model: model, Configured: true, Offline: true}
	case "", ProviderOff:
		return nil, Status{Provider: ProviderOff, Reason: "OPENDISPATCH_ASSISTANT_PROVIDER is off."}
	default:
		return nil, Status{Provider: ProviderOff, Reason: "OPENDISPATCH_ASSISTANT_PROVIDER must be off, ollama or openai."}
	}
}

func envSeconds(key string, fallback time.Duration) time.Duration {
	n, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || n <= 0 || n > 900 {
		return fallback
	}
	return time.Duration(n) * time.Second
}

// shorten: an error body, cut to a safe length.
func shorten(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return s[:n]
	}
	return s
}
