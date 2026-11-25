// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"log"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// KeyDataOwnerRole: who data-quality issues go to.
const KeyDataOwnerRole = "imports.data_owner_role"

// dataOwnerRole: the setting, else administrator.
func dataOwnerRole(ctx context.Context, tenant string) access.Role {
	r := readSetting(ctx, tenant, KeyDataOwnerRole, string(access.RoleAdministrator))
	if !access.IsRole(r) {
		return access.RoleAdministrator
	}
	return access.Role(r)
}

// escalateImportQuality: one alert per file.
func escalateImportQuality(ctx context.Context, rc reqctx.RequestContext, job ImportJob, res importValidateResult) *access.Role {
	if res.HeaderFailed || res.Errors+res.Warnings == 0 {
		return nil
	}
	owner := dataOwnerRole(ctx, rc.CustomerID)
	severity := "warning"
	if res.Errors > 0 {
		severity = "critical"
	}
	body := fmt.Sprintf("%s: %d rows, %d errors, %d warnings. Rows with errors are not imported; check the issue log.", job.FileName, res.DataRows, res.Errors, res.Warnings)
	n := notifyRole(ctx, rc, owner, "import", severity, RaisedNotification{TitleEn: "Data quality issues in an import", BodyEn: strPtr(truncateStr(body, 500)),
		LinkPath: strPtr("/admin/data-import-quality")})
	id := job.ID
	if _, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: "import.quality_escalated", EntityType: "import_job", EntityID: &id, ActorType: "system", Outcome: "success",
		SummaryEn: fmt.Sprintf("Data-quality issues in %s escalated to the data owner (%s).", job.FileName, owner),
		Detail:    map[string]any{"data_owner_role": string(owner), "severity": severity, "error_count": res.Errors, "warning_count": res.Warnings, "notification_id": n.ID}}, "", ""); err != nil {
		log.Printf("imports: audit import.quality_escalated failed: %v", err)
	}
	return &owner
}
