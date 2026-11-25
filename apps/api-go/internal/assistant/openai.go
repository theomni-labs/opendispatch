// SPDX-License-Identifier: AGPL-3.0-only

// OpenAI-compatible /chat/completions: any server that speaks that API
// (vLLM, llama.cpp server, LocalAI, a hosted gateway).
package assistant

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type openaiProvider struct {
	model, key, base string
	vision           bool
	timeout          time.Duration
}

func (p *openaiProvider) Name() string  { return ProviderOpenAI }
func (p *openaiProvider) Model() string { return p.model }
func (p *openaiProvider) Vision() bool  { return p.vision }

type openaiFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type openaiToolCall struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Function openaiFunction `json:"function"`
}

type openaiMessage struct {
	Role       string           `json:"role"`
	Content    any              `json:"content"`
	ToolCalls  []openaiToolCall `json:"tool_calls,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
}

func openaiMessages(system string, msgs []Message) ([]openaiMessage, error) {
	var out []openaiMessage
	if system != "" {
		out = append(out, openaiMessage{Role: "system", Content: system})
	}
	for _, m := range msgs {
		for _, r := range m.Results {
			out = append(out, openaiMessage{Role: "tool", Content: r.Content, ToolCallID: r.CallID})
		}
		if len(m.Results) > 0 && m.Text == "" && len(m.Images) == 0 {
			continue
		}
		om := openaiMessage{Role: m.Role, Content: m.Text}
		if len(m.Images) > 0 {
			parts := make([]map[string]any, 0, len(m.Images)+1)
			for _, img := range m.Images {
				url := "data:" + img.MediaType + ";base64," + base64.StdEncoding.EncodeToString(img.Data)
				parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": url}})
			}
			if m.Text != "" {
				parts = append(parts, map[string]any{"type": "text", "text": m.Text})
			}
			om.Content = parts
		}
		for _, c := range m.ToolCalls {
			args, err := json.Marshal(c.Input)
			if err != nil {
				return nil, fmt.Errorf("encode tool arguments: %w", err)
			}
			om.ToolCalls = append(om.ToolCalls, openaiToolCall{ID: c.ID, Type: "function", Function: openaiFunction{Name: c.Name, Arguments: string(args)}})
		}
		out = append(out, om)
	}
	return out, nil
}

func (p *openaiProvider) Complete(ctx context.Context, req Request) (Reply, error) {
	msgs, err := openaiMessages(req.System, req.Messages)
	if err != nil {
		return Reply{}, err
	}
	body := map[string]any{"model": p.model, "messages": msgs, "temperature": 0}
	if req.MaxTokens > 0 {
		body["max_tokens"] = req.MaxTokens
	}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, len(req.Tools))
		for i, t := range req.Tools {
			tools[i] = map[string]any{"type": "function", "function": map[string]any{"name": t.Name, "description": t.Description, "parameters": t.Schema}}
		}
		body["tools"] = tools
	} else if req.JSON {
		body["response_format"] = map[string]any{"type": "json_object"}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return Reply{}, fmt.Errorf("encode request: %w", err)
	}
	cctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(cctx, http.MethodPost, p.base+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return Reply{}, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("content-type", "application/json")
	if p.key != "" {
		httpReq.Header.Set("authorization", "Bearer "+p.key)
	}
	res, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return Reply{}, &ProviderError{Msg: "Could not reach the model server."}
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return Reply{}, &ProviderError{Msg: "Could not read the model server answer."}
	}
	if res.StatusCode != http.StatusOK {
		var e struct {
			Error struct {
				Type string `json:"type"`
				Code any    `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		return Reply{}, &ProviderError{Msg: fmt.Sprintf("The model server answered %d (%s).", res.StatusCode, shorten(e.Error.Type, 60))}
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content   *string          `json:"content"`
				ToolCalls []openaiToolCall `json:"tool_calls"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return Reply{}, &ProviderError{Msg: "The model server answer was not JSON."}
	}
	if len(parsed.Choices) == 0 {
		return Reply{}, &ProviderError{Msg: "The model server answer had no choices."}
	}
	choice := parsed.Choices[0]
	var calls []ToolCall
	for i, c := range choice.Message.ToolCalls {
		input := map[string]any{}
		if strings.TrimSpace(c.Function.Arguments) != "" {
			_ = json.Unmarshal([]byte(c.Function.Arguments), &input)
		}
		id := c.ID
		if id == "" {
			id = fmt.Sprintf("call_%d", i+1)
		}
		calls = append(calls, ToolCall{ID: id, Name: c.Function.Name, Input: input})
	}
	stop := "end"
	switch {
	case len(calls) > 0 || choice.FinishReason == "tool_calls":
		stop = "tool_use"
	case choice.FinishReason == "length":
		stop = "max_tokens"
	case choice.FinishReason == "content_filter":
		stop = "refusal"
	}
	text := ""
	if choice.Message.Content != nil {
		text = strings.TrimSpace(*choice.Message.Content)
	}
	reply := Reply{Text: text, ToolCalls: calls, Stop: stop}
	reply.Message = Message{Role: "assistant", Text: text, ToolCalls: calls}
	return reply, nil
}
