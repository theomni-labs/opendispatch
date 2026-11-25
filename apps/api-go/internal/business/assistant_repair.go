// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"errors"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
)

// refusedByModel: the model said it cannot; no repair.
type refusedByModel struct{ error }

func (r refusedByModel) Unwrap() error { return r.error }

// completeChecked: one repair turn after a failed check.
func completeChecked(ctx context.Context, p assistant.Provider, req assistant.Request, check func(string) error) (attempts int, callErr, checkErr error) {
	reply, err := p.Complete(ctx, req)
	if err != nil {
		return 1, err, nil
	}
	checkErr = check(reply.Text)
	var refused refusedByModel
	if checkErr == nil {
		return 1, nil, nil
	}
	if errors.As(checkErr, &refused) {
		return 1, nil, refused.error
	}
	turn := reply.Message
	if turn.Role == "" {
		turn = assistant.Message{Role: "assistant", Text: reply.Text}
	}
	req.Messages = append(append([]assistant.Message{}, req.Messages...), turn, assistant.Message{
		Role: "user",
		Text: "Your answer did not pass the checks: " + checkErr.Error() + " Answer again with ONE corrected JSON object that follows every rule.",
	})
	reply, err = p.Complete(ctx, req)
	if err != nil {
		return 2, err, nil
	}
	checkErr = check(reply.Text)
	if errors.As(checkErr, &refused) {
		return 2, nil, refused.error
	}
	return 2, nil, checkErr
}
