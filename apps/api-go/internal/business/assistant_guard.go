// SPDX-License-Identifier: AGPL-3.0-only

// The number guard, shared by every summary.
package business

import (
	"context"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
)

// guarded: the text shown and how it was reached.
type guarded struct {
	Text     string
	Path     string
	FirstBad []string
	RetryBad []string
	Retried  bool
}

// guardedAnswer: check, retry once, fallback.
func guardedAnswer(ctx context.Context, p assistant.Provider, req assistant.Request, allowed []float64, fallback func() string) (guarded, error) {
	reply, err := p.Complete(ctx, req)
	text := plainText(reply.Text)
	if err == nil && text == "" {
		err = &assistant.ProviderError{Msg: "The assistant gave an empty answer."}
	}
	if err != nil {
		return guarded{}, err
	}
	g := guarded{Text: text, Path: explainPathChecked, FirstBad: unknownNumbers(text, allowed)}
	if len(g.FirstBad) == 0 {
		return g, nil
	}
	g.Retried, g.Path = true, explainPathRetried
	req.Messages = append(req.Messages, assistant.Message{Role: "assistant", Text: reply.Text}, assistant.Message{Role: "user", Text: retryNote(g.FirstBad)})
	again, againErr := p.Complete(ctx, req)
	g.Text = plainText(again.Text)
	if againErr != nil || g.Text == "" {
		g.RetryBad = []string{"(no answer)"}
	} else {
		g.RetryBad = unknownNumbers(g.Text, allowed)
	}
	if len(g.RetryBad) > 0 {
		g.Path, g.Text = explainPathFallback, fallback()
	}
	return g, nil
}
