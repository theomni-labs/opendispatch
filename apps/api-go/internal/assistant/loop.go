// SPDX-License-Identifier: AGPL-3.0-only

// The tool-use loop, capped.
package assistant

import "context"

// Executed: one tool call that ran.
type Executed struct {
	Name    string         `json:"name"`
	Input   map[string]any `json:"input"`
	IsError bool           `json:"is_error"`
}

// LoopResult: the final answer and every call made.
type LoopResult struct {
	Final  Reply
	Calls  []Executed
	Capped bool
	Rounds int
}

// CapNote: the tool result once the cap is hit.
const CapNote = "Lookup limit reached. Answer now from what you have, without more lookups."

// RunTools: ask, run tools, repeat, at most maxCalls.
func RunTools(ctx context.Context, p Provider, req Request, maxCalls int, run func(ToolCall) (string, bool)) (LoopResult, error) {
	var out LoopResult
	msgs := append([]Message(nil), req.Messages...)
	for {
		out.Rounds++
		r := req
		r.Messages = msgs
		reply, err := p.Complete(ctx, r)
		if err != nil {
			return out, err
		}
		if len(reply.ToolCalls) == 0 {
			out.Final = reply
			return out, nil
		}
		// After the cap: one more round, then stop
		if out.Capped {
			out.Final = Reply{Stop: "capped"}
			return out, nil
		}
		msgs = append(msgs, reply.Message)
		results := make([]ToolResult, 0, len(reply.ToolCalls))
		for _, call := range reply.ToolCalls {
			if len(out.Calls) >= maxCalls {
				out.Capped = true
				results = append(results, ToolResult{CallID: call.ID, Name: call.Name, Content: CapNote, IsError: true})
				continue
			}
			content, isErr := run(call)
			out.Calls = append(out.Calls, Executed{Name: call.Name, Input: call.Input, IsError: isErr})
			results = append(results, ToolResult{CallID: call.ID, Name: call.Name, Content: content, IsError: isErr})
		}
		next := Message{Role: "user", Results: results}
		if len(out.Calls) >= maxCalls {
			out.Capped = true
			next.Text = CapNote
		}
		msgs = append(msgs, next)
	}
}
