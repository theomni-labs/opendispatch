// SPDX-License-Identifier: AGPL-3.0-only

package business

import "hash/maphash"

var idSeed = maphash.MakeSeed()

// idKey: 8 bytes per case id held, not the id.
func idKey(id string) uint64 {
	return maphash.String(idSeed, id)
}
