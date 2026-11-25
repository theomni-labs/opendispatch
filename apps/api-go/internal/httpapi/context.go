// SPDX-License-Identifier: AGPL-3.0-only

// Request-scoped tenant id, set by TenantContext.
package httpapi

import "context"

func setTenantID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, tenantIDKey{}, id)
}

func getTenantID(ctx context.Context) string {
	id, _ := ctx.Value(tenantIDKey{}).(string)
	return id
}
