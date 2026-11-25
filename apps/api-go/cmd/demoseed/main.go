// SPDX-License-Identifier: AGPL-3.0-only

// Command demoseed: sample rule, waiting spots.
package main

import (
	"context"
	"fmt"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/demoguard"
	"net/url"
	"os"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func main() {
	if os.Getenv("OPENDISPATCH_DEMO") != "1" {
		fail("refusing: set OPENDISPATCH_DEMO=1 to seed the demo")
	}
	dsn := os.Getenv("OPENDISPATCH_APP_DATABASE_URL")
	if err := checkDemoURL(dsn); err != nil {
		fail("%v", err)
	}
	tenant := os.Getenv("OPENDISPATCH_TENANT_ID")
	if tenant == "" {
		fail("OPENDISPATCH_TENANT_ID is required")
	}
	if err := recordsource.Load(os.Getenv); err != nil {
		fail("%v", err)
	}
	if recordsource.Get() != "SYNTHETIC" {
		fail("refusing: records here would be %s, the sample is synthetic only", recordsource.Get())
	}
	ctx := context.Background()
	conn, err := tenancy.OpenConnection(ctx, dsn)
	if err != nil {
		fail("open application connection: %v", err)
	}
	defer conn.Close()
	business.UsePostgresStores(conn)
	res, err := business.SeedDemoDispatch(ctx, tenant)
	if err != nil {
		fail("%v", err)
	}
	fmt.Printf("Demo seed: sample rule %s %s, waiting spots %s (synthetic only, audited)\n",
		business.DemoSampleRuleCode, pick(res.RuleCreated, "approved", "already there"), pick(res.RepositionEnabled, "switched on", "already on"))
}

func pick(b bool, yes, no string) string {
	if b {
		return yes
	}
	return no
}

// fail: a line the demo scripts look for.
func fail(format string, args ...any) {
	fmt.Printf("Demo seed FAILED: "+format+"\n", args...)
	os.Exit(1)
}

// checkDemoURL: a local demo database only.
func checkDemoURL(dsn string) error {
	if dsn == "" {
		return fmt.Errorf("OPENDISPATCH_APP_DATABASE_URL is not set")
	}
	u, err := url.Parse(dsn)
	if err != nil {
		return fmt.Errorf("database url: %w", err)
	}
	if db := strings.TrimPrefix(u.Path, "/"); !strings.Contains(db, "demo") {
		return fmt.Errorf("refusing: database %q is not a demo database", db)
	}
	if h := u.Hostname(); !demoguard.LocalHost(h) {
		return fmt.Errorf("refusing: host %q is not local", h)
	}
	return nil
}
