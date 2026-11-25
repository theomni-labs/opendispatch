// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"strings"
	"testing"
)

func TestImportKeepsSeverityAndResolutionAndEscalatesIssues(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	ResetNotificationsForTest()
	t.Cleanup(ReloadNotificationsForTest)
	seedImportRefFixture(t, ctx, conn, rc)

	header := append(validImportHeader(), "Severity", "ResolutionMethod")
	good := append(validImportRow(), "Moderate", "remote")
	bad := validImportRow()
	bad[0], bad[1], bad[9] = "EXT-2", "RD-260914-002", "91"
	bad = append(bad, "unheard", "")
	csv := strings.Join([]string{strings.Join(header, ","), strings.Join(good, ","), strings.Join(bad, ",")}, "\r\n") + "\r\n"
	job, err := UploadImport(ctx, conn, rc, map[string]any{"file_name": "severity.csv", "file": csv, "mapping_version": "generic_csv_v1"})
	check(t, err)
	validated, err := ValidateImport(ctx, conn, rc, job.ID)
	check(t, err)
	if validated.ErrorCount != 1 || validated.WarningCount != 1 {
		t.Fatalf("got %+v, want the bad latitude and the unknown severity", validated)
	}
	rows, err := allNotifications(ctx, rc.CustomerID)
	check(t, err)
	escalated := 0
	for _, n := range rows {
		if n.TitleEn == "Data quality issues in an import" && n.Severity == "critical" && n.Category == "import" {
			escalated++
		}
	}
	if escalated != 1 {
		t.Fatalf("%d escalations, want one to the data owner", escalated)
	}
	if got := auditSummaries(t, engineWorld{tenantID: rc.CustomerID}, "import.quality"); len(got) != 1 || !strings.Contains(got[0], "escalated to the data owner (administrator)") {
		t.Fatalf("audit %v", got)
	}
	issues, err := issuesOf(ctx, conn, rc.CustomerID, &job.ID)
	check(t, err)
	for _, i := range issues {
		if i.Severity == "error" {
			_, err := UpdateDataQualityIssue(ctx, conn, rc, i.ID, map[string]any{"status": "ignored"})
			check(t, err)
		}
	}
	_, err = CompareImport(ctx, conn, rc, job.ID)
	check(t, err)
	if dry, err := DryRunCutover(ctx, conn, rc, job.ID); err != nil || dry.BlockingIssueCount != 0 {
		t.Fatalf("dry run %+v %v", dry, err)
	}
	result, err := ExecuteCutover(ctx, conn, rc, job.ID)
	check(t, err)
	if !result.Applied || result.WouldInsert != 1 {
		t.Fatalf("got %+v, want the good row only", result)
	}
	cases, err := ListCases(ctx, conn, rc, CaseFilter{})
	check(t, err)
	for _, c := range cases.Items {
		if c.ExternalID != "EXT-1" {
			continue
		}
		if c.Severity == nil || *c.Severity != "moderate" || c.Handling != "remote_inferred" || c.Extra["resolution_method"] != "remote" {
			t.Fatalf("case %+v: want severity moderate, explicit remote", c)
		}
		return
	}
	t.Fatal("the good row was not imported")
}
