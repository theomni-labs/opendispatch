// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// UsePostgresStores: all stores on Postgres.
func UsePostgresStores(app *tenancy.Connection) {
	auditlog.UseStore(auditlog.PgStore{Conn: app})
	UsePostgresUsers(app)
	UsePostgresRules(app)
	UsePostgresRoleMappings(app)
	settingsstore.UsePostgres(app)
	UsePostgresOverrides(app)
	UsePostgresScenarios(app)
	UsePostgresSimulations(app)
	UsePostgresNotifications(app)
	UsePostgresIntegrations(app)
	UsePostgresModelVersions(app)
	UsePostgresAPIWebhooks(app)
	UsePostgresRemoteReviews(app)
	UsePostgresSystemHealth(app)
	UsePostgresSecurityCompliance(app)
	UsePostgresIdentityProviders(app)
	UsePostgresPrayerTimes(app)
	UsePostgresForecast(app)
	UsePostgresRollups(app)
	UsePostgresStandby(app)
	UsePostgresEngineAnswers(app)
	UsePostgresExperiments(app)
}
