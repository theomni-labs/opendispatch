// SPDX-License-Identifier: AGPL-3.0-only

// First-run job: Administrator group rule.
package main

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"os"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// appName: tag in pg_stat_activity.
const appName = "opendispatch-bootstrap"

func main() {
	if err := run(context.Background(), os.Getenv); err != nil {
		log.Fatalf("bootstrap: %v", err)
	}
}

// run: application role only, never owner.
func run(ctx context.Context, getenv func(string) string) error {
	if err := recordsource.Load(getenv); err != nil {
		return err
	}
	appURL := getenv("OPENDISPATCH_APP_DATABASE_URL")
	if appURL == "" {
		return fmt.Errorf("OPENDISPATCH_APP_DATABASE_URL is required (application role)")
	}
	group := getenv("OPENDISPATCH_BOOTSTRAP_ADMIN_GROUP")
	if group == "" {
		return fmt.Errorf("OPENDISPATCH_BOOTSTRAP_ADMIN_GROUP is required")
	}
	file := getenv("OPENDISPATCH_OIDC_TENANTS_FILE")
	if file == "" {
		return fmt.Errorf("OPENDISPATCH_OIDC_TENANTS_FILE is required")
	}
	registry, err := oidc.LoadTenantsFile(file)
	if err != nil {
		return fmt.Errorf("oidc tenants: %w", err)
	}
	tenants := registry.Tenants()
	if len(tenants) == 0 {
		return fmt.Errorf("oidc tenants: the file lists no customer")
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	app, err := tenancy.OpenConnection(ctx, named(appURL))
	if err != nil {
		return fmt.Errorf("open application connection: %w", err)
	}
	defer app.Close()
	auditlog.UseStore(auditlog.PgStore{Conn: app})
	business.UsePostgresRoleMappings(app)
	settingsstore.UsePostgres(app)
	for _, t := range tenants {
		res, err := business.BootstrapAdministratorRule(ctx, t.TenantID, access.InstallMode(t.InstallMode), group)
		if err != nil {
			return fmt.Errorf("customer %s: %w", t.TenantID, err)
		}
		log.Printf("bootstrap: customer %s: %s", t.TenantID, describe(res, group))
	}
	return nil
}

func describe(res business.BootstrapResult, group string) string {
	switch res.Outcome {
	case business.BootstrapCreated:
		return fmt.Sprintf("group rule %s -> administrator created (audited)", group)
	case business.BootstrapAlreadyDone:
		return "bootstrapped before, left as it is"
	default:
		return "group rules already exist, nothing written"
	}
}

// named adds application_name to a URL.
func named(raw string) string {
	if u, err := url.Parse(raw); err == nil && (u.Scheme == "postgres" || u.Scheme == "postgresql") {
		q := u.Query()
		q.Set("application_name", appName)
		u.RawQuery = q.Encode()
		return u.String()
	}
	return raw + " application_name=" + appName
}
