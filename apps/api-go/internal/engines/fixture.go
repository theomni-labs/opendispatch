// SPDX-License-Identifier: AGPL-3.0-only

package engines

import "context"

// Fixture answers every call with one document
type Fixture struct {
	Response []byte
}

func (f Fixture) Call(ctx context.Context, _ []byte) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	out := make([]byte, len(f.Response))
	copy(out, f.Response)
	return out, nil
}
