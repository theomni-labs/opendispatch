// SPDX-License-Identifier: AGPL-3.0-only

package business

import "encoding/json"

// scanExtra decodes an extra jsonb column.
func scanExtra(raw []byte) (map[string]any, error) {
	out := map[string]any{}
	if len(raw) == 0 {
		return out, nil
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}
