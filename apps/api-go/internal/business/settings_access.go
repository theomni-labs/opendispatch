// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"log"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

// readSetting is for settings whose default is harmless: a store failure is logged and the default used.
func readSetting[T any](ctx context.Context, tenant, key string, fallback T) T {
	v, err := settingsstore.Get(ctx, tenant, key, fallback)
	if err != nil {
		log.Printf("settings: reading %s failed, using the default: %v", key, err)
		return fallback
	}
	return v
}

// readSettingStrict is for security settings: a store failure is an error, never a quiet default.
func readSettingStrict[T any](ctx context.Context, tenant, key string, fallback T) (T, error) {
	return settingsstore.Get(ctx, tenant, key, fallback)
}
