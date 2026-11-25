// SPDX-License-Identifier: AGPL-3.0-only

// Ollama /api/chat: an open-weight model, offline.
package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type ollamaProvider struct {
	model, base string
	timeout     time.Duration
}

func (p *ollamaProvider) Name() string  { return ProviderOllama }
func (p *ollamaProvider) Model() string { return p.model }

type ollamaCall struct {
	Function struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	} `json:"function"`
}

type ollamaMessage struct {
	Role      string       `json:"role"`
	Content   string       `json:"content"`
	ToolCalls []ollamaCall `json:"tool_calls,omitempty"`
	ToolName  string       `json:"tool_name,omitempty"`
}

func ollamaMessages(system string, msgs []Message) []ollamaMessage {
	var out []ollamaMessage
	if system != "" {
		out = append(out, ollamaMessage{Role: "system", Content: system})
	}
	for _, m := range msgs {
		for _, r := range m.Results {
			out = append(out, ollamaMessage{Role: "tool", Content: r.Content, ToolName: r.Name})
		}
		if len(m.Results) > 0 && m.Text == "" {
			continue
		}
		om := ollamaMessage{Role: m.Role, Content: m.Text}
		for _, c := range m.ToolCalls {
			var oc ollamaCall
			oc.Function.Name, oc.Function.Arguments = c.Name, c.Input
			om.ToolCalls = append(om.ToolCalls, oc)
		}
		out = append(out, om)
	}
	return out
}

func (p *ollamaProvider) Complete(ctx context.Context, req Request) (Reply, error) {
	body := map[string]any{
		"model":    p.model,
		"messages": ollamaMessages(req.System, req.Messages),
		"stream":   false,
		"options":  map[string]any{"temperature": 0},
	}
	if req.MaxTokens > 0 {
		body["options"].(map[string]any)["num_predict"] = req.MaxTokens
	}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, len(req.Tools))
		for i, t := range req.Tools {
			tools[i] = map[string]any{"type": "function", "function": map[string]any{"name": t.Name, "description": t.Description, "parameters": t.Schema}}
		}
		body["tools"] = tools
	} else if req.JSON {
		body["format"] = "json"
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return Reply{}, err
	}
	cctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(cctx, http.MethodPost, p.base+"/api/chat", bytes.NewReader(payload))
	if err != nil {
		return Reply{}, err
	}
	httpReq.Header.Set("content-type", "application/json")
	res, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return Reply{}, &ProviderError{Msg: "Could not reach the Ollama server."}
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return Reply{}, &ProviderError{Msg: "Could not read the Ollama answer."}
	}
	if res.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		return Reply{}, &ProviderError{Msg: fmt.Sprintf("The Ollama server answered %d (%s).", res.StatusCode, shorten(e.Error, 120))}
	}
	var parsed struct {
		Message    ollamaMessage `json:"message"`
		DoneReason string        `json:"done_reason"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return Reply{}, &ProviderError{Msg: "The Ollama answer was not JSON."}
	}
	var calls []ToolCall
	for i, c := range parsed.Message.ToolCalls {
		input := c.Function.Arguments
		if input == nil {
			input = map[string]any{}
		}
		calls = append(calls, ToolCall{ID: fmt.Sprintf("call_%d", i+1), Name: c.Function.Name, Input: input})
	}
	stop := "end"
	if len(calls) > 0 {
		stop = "tool_use"
	} else if parsed.DoneReason == "length" {
		stop = "max_tokens"
	}
	text := strings.TrimSpace(parsed.Message.Content)
	reply := Reply{Text: text, ToolCalls: calls, Stop: stop}
	reply.Message = Message{Role: "assistant", Text: text, ToolCalls: calls}
	return reply, nil
}
