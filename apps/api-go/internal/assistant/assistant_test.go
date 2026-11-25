// SPDX-License-Identifier: AGPL-3.0-only

package assistant

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const fakeKey = "test-key-not-a-secret"

func TestActiveIsOffByDefault(t *testing.T) {
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "")
	p, st := Active()
	if p != nil || st.Provider != ProviderOff || st.Configured {
		t.Fatalf("want off, got %+v", st)
	}
}

func TestOpenAIWithoutURLIsNotConfigured(t *testing.T) {
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "openai")
	t.Setenv("OPENDISPATCH_ASSISTANT_MODEL", "m")
	t.Setenv("OPENDISPATCH_ASSISTANT_OPENAI_URL", "")
	p, st := Active()
	if p != nil || st.Configured || !strings.Contains(st.Reason, "OPENDISPATCH_ASSISTANT_OPENAI_URL") {
		t.Fatalf("got %+v", st)
	}
}

func TestOpenAIWithoutModelIsNotConfigured(t *testing.T) {
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "openai")
	t.Setenv("OPENDISPATCH_ASSISTANT_MODEL", "")
	t.Setenv("OPENDISPATCH_ASSISTANT_OPENAI_URL", "http://127.0.0.1:1/v1")
	p, st := Active()
	if p != nil || st.Configured || !strings.Contains(st.Reason, "OPENDISPATCH_ASSISTANT_MODEL") {
		t.Fatalf("got %+v", st)
	}
}

func TestUnknownProviderIsOff(t *testing.T) {
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "unknown-provider")
	if p, st := Active(); p != nil || st.Provider != ProviderOff {
		t.Fatalf("got %+v", st)
	}
}

func TestOllamaDefaults(t *testing.T) {
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "ollama")
	t.Setenv("OPENDISPATCH_ASSISTANT_MODEL", "")
	p, st := Active()
	if p == nil || !st.Configured || !st.Offline || p.Model() != DefaultOllamaModel {
		t.Fatalf("got %+v", st)
	}
}

func TestOpenAIRequestAndToolUse(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("authorization") != "Bearer "+fakeKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got)
		_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"Looking.","tool_calls":[{"id":"tu_1","type":"function","function":{"name":"gap_summary","arguments":"{\"zone\":\"Riyadh North\"}"}}]},"finish_reason":"tool_calls"}]}`)
	}))
	defer srv.Close()
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "openai")
	t.Setenv("OPENDISPATCH_ASSISTANT_MODEL", "local-model")
	t.Setenv("OPENDISPATCH_ASSISTANT_API_KEY", fakeKey)
	t.Setenv("OPENDISPATCH_ASSISTANT_OPENAI_URL", srv.URL+"/v1")
	p, st := Active()
	if p == nil || st.Offline {
		t.Fatalf("status %+v", st)
	}
	reply, err := p.Complete(context.Background(), Request{System: "sys", Messages: []Message{{Role: "user", Text: "hi"}}, Tools: []ToolDef{{Name: "gap_summary", Description: "d", Schema: map[string]any{"type": "object"}}}})
	if err != nil {
		t.Fatal(err)
	}
	if reply.Stop != "tool_use" || len(reply.ToolCalls) != 1 || reply.ToolCalls[0].Input["zone"] != "Riyadh North" || reply.ToolCalls[0].ID != "tu_1" {
		t.Fatalf("reply %+v", reply)
	}
	if got["model"] != "local-model" {
		t.Fatalf("body %v", got)
	}
	first := got["messages"].([]any)[0].(map[string]any)
	if first["role"] != "system" || first["content"] != "sys" {
		t.Fatalf("system %v", first)
	}
	tools := got["tools"].([]any)
	if tools[0].(map[string]any)["function"].(map[string]any)["parameters"] == nil {
		t.Fatalf("tools %v", tools)
	}
	msgs, err := openaiMessages("", []Message{reply.Message, {Role: "user", Results: []ToolResult{{CallID: "tu_1", Content: "{}"}}}})
	if err != nil || len(msgs) != 2 || msgs[0].ToolCalls[0].ID != "tu_1" || msgs[1].Role != "tool" || msgs[1].ToolCallID != "tu_1" {
		t.Fatalf("echo %+v", msgs)
	}
	_, _ = p.Complete(context.Background(), Request{Messages: []Message{{Role: "user", Text: "q"}}, JSON: true})
	if rf, _ := got["response_format"].(map[string]any); rf["type"] != "json_object" {
		t.Fatalf("json mode %v", got)
	}
}

func TestOpenAIErrorNeverCarriesTheKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"type":"invalid_request_error","message":"invalid key `+fakeKey+`"}}`)
	}))
	defer srv.Close()
	p := &openaiProvider{model: "m", key: fakeKey, base: srv.URL, timeout: 5 * time.Second}
	_, err := p.Complete(context.Background(), Request{Messages: []Message{{Role: "user", Text: "x"}}})
	if err == nil || strings.Contains(err.Error(), fakeKey) || !strings.Contains(err.Error(), "invalid_request_error") {
		t.Fatalf("err %v", err)
	}
}

func TestOllamaToolCallsAndJSONMode(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got)
		_, _ = io.WriteString(w, `{"model":"q","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"forecast_summary","arguments":{"date":"2026-09-14"}}}]},"done_reason":"stop"}`)
	}))
	defer srv.Close()
	p := &ollamaProvider{model: "q", base: srv.URL, timeout: 5 * time.Second}
	reply, err := p.Complete(context.Background(), Request{System: "s", Messages: []Message{{Role: "user", Text: "q"}}, Tools: []ToolDef{{Name: "forecast_summary", Schema: map[string]any{"type": "object"}}}})
	if err != nil || reply.Stop != "tool_use" || reply.ToolCalls[0].Input["date"] != "2026-09-14" {
		t.Fatalf("reply %+v err %v", reply, err)
	}
	if got["stream"] != false || got["tools"] == nil || got["format"] != nil {
		t.Fatalf("body %v", got)
	}
	_, _ = p.Complete(context.Background(), Request{Messages: []Message{{Role: "user", Text: "q"}}, JSON: true})
	if got["format"] != "json" {
		t.Fatalf("json mode %v", got)
	}
	msgs := ollamaMessages("", []Message{{Role: "user", Results: []ToolResult{{Name: "forecast_summary", Content: "{}"}}, Text: CapNote}})
	if len(msgs) != 2 || msgs[0].Role != "tool" || msgs[1].Role != "user" {
		t.Fatalf("msgs %+v", msgs)
	}
}

// loopFake: always asks for one more tool.
type loopFake struct{ calls int }

func (f *loopFake) Name() string  { return "fake" }
func (f *loopFake) Model() string { return "fake-1" }
func (f *loopFake) Complete(_ context.Context, _ Request) (Reply, error) {
	f.calls++
	tc := []ToolCall{{ID: "a", Name: "t", Input: map[string]any{}}, {ID: "b", Name: "t", Input: map[string]any{}}}
	return Reply{ToolCalls: tc, Stop: "tool_use", Message: Message{Role: "assistant", ToolCalls: tc}}, nil
}

func TestRunToolsStopsAtTheCap(t *testing.T) {
	f := &loopFake{}
	ran := 0
	res, err := RunTools(context.Background(), f, Request{Messages: []Message{{Role: "user", Text: "q"}}}, 5, func(ToolCall) (string, bool) {
		ran++
		return "{}", false
	})
	if err != nil {
		t.Fatal(err)
	}
	if ran != 5 || len(res.Calls) != 5 || !res.Capped || res.Final.Stop != "capped" || f.calls > 4 {
		t.Fatalf("ran %d calls %d capped %v stop %q rounds %d", ran, len(res.Calls), res.Capped, res.Final.Stop, f.calls)
	}
}
