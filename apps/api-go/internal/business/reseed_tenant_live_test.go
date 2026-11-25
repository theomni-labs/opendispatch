// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestTestReseedsTouchOnlyTheFixtureTenant(t *testing.T) {
	openConn(t)
	owner, ctx := ownerPool(t), context.Background()
	fixtureTenant, err := fixtures.TenantID()
	check(t, err)
	other := freshTenant()
	_, err = owner.Exec(ctx, `INSERT INTO cities (tenant_id, data_source, name_en) VALUES ($1, 'SYNTHETIC', 'Other city')`, other)
	check(t, err)
	for _, tenant := range []string{other, fixtureTenant} {
		_, err = owner.Exec(ctx, `INSERT INTO engine_answers (tenant_id, data_source, engine, scope_key, body) VALUES ($1, 'SYNTHETIC', 'simulator', 'reseed-test', '{}')`, tenant)
		check(t, err)
	}
	UsePostgresEngineAnswers(&tenancy.Connection{Pool: owner})
	t.Cleanup(UseMemoryEngineAnswers)
	conn := &tenancy.Connection{Pool: owner}
	check(t, ReseedLocationsForTest(ctx, conn))
	check(t, ReseedEngineAnswersForTest(ctx, conn))

	count := func(q, tenant string) int {
		var n int
		check(t, owner.QueryRow(ctx, q, tenant).Scan(&n))
		return n
	}
	if n := count(`SELECT count(*) FROM cities WHERE tenant_id = $1::uuid`, other); n != 1 {
		t.Fatalf("got %d cities for the other tenant, want its row untouched", n)
	}
	if n := count(`SELECT count(*) FROM engine_answers WHERE tenant_id = $1::uuid`, other); n != 1 {
		t.Fatalf("got %d answers for the other tenant, want its row untouched", n)
	}
	if n := count(`SELECT count(*) FROM engine_answers WHERE tenant_id = $1::uuid`, fixtureTenant); n != 0 {
		t.Fatalf("got %d answers for the fixture tenant, want them cleared", n)
	}
}
