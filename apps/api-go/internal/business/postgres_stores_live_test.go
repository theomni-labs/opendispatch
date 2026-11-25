// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func useMemoryStores() {
	auditlog.UseStore(auditlog.MemoryStore())
	settingsstore.UseMemory()
	for _, f := range []func(){UseMemoryUsers, UseMemoryRules, UseMemoryRoleMappings, UseMemoryOverrides, UseMemoryScenarios, UseMemorySimulations,
		UseMemoryNotifications, UseMemoryIntegrations, UseMemoryModelVersions, UseMemoryAPIWebhooks, UseMemoryRemoteReviews, UseMemorySystemHealth,
		UseMemorySecurityCompliance, UseMemoryIdentityProviders, UseMemoryPrayerTimes, UseMemoryForecast, UseMemoryRollups, UseMemoryStandby, UseMemoryEngineAnswers} {
		f()
	}
}

// Worker audit rows must land in Postgres.
func TestUsePostgresStoresPutsTheAuditLogInPostgres(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	UsePostgresStores(conn)
	t.Cleanup(useMemoryStores)
	marker := "postgres-stores-" + datactx.NewID()
	_, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: "test.stores", EntityType: "thing", ActorType: "system", SummaryEn: marker}, "", "")
	check(t, err)
	useMemoryStores()
	got, err := auditlog.PgStore{Conn: conn}.List(context.Background(), tenantID)
	check(t, err)
	for _, e := range got {
		if e.SummaryEn == marker {
			return
		}
	}
	t.Fatalf("want the audit event in Postgres, got %d events without it", len(got))
}
