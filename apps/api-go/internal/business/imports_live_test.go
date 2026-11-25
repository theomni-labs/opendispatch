// SPDX-License-Identifier: AGPL-3.0-only

// Live tests for imports.go: needs both Postgres and
// a real S3-compatible store (OPENDISPATCH_S3_* env vars point at it).
package business

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importstorage"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

type importRefFixture struct{ cityID, zoneID, subZoneID, caseTypeID string }

func seedImportRefFixture(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) importRefFixture {
	t.Helper()
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RY", "name_en": "Riyadh", "external_id": "CTY1"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central", "external_id": "ZN1"})
	check(t, err)
	subZone, err := CreateSubZone(ctx, conn, rc, map[string]any{"zone_id": zone.ID, "name_en": "Downtown", "external_id": "SZ1", "latitude": 24.7, "longitude": 46.7})
	check(t, err)
	caseTypeID := datactx.NewID()
	_, err = tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO case_types (tenant_id, id, data_source, name_en, external_id) VALUES ($1,$2,'SYNTHETIC','Standard case','CT1')`, rc.CustomerID, caseTypeID)
		return struct{}{}, err
	})
	check(t, err)
	return importRefFixture{cityID: city.ID, zoneID: zone.ID, subZoneID: subZone.ID, caseTypeID: caseTypeID}
}

func importCsv(header, row []string) string {
	quote := func(cells []string) string {
		out := ""
		for i, c := range cells {
			if i > 0 {
				out += ","
			}
			out += c
		}
		return out
	}
	return quote(header) + "\r\n" + quote(row) + "\r\n"
}

func resetImportDeps() {
	ResetReplayCasesForTest()
}

func TestImportFlow_UploadValidateCompareDryRunCutover(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)

	csv := importCsv(validImportHeader(), validImportRow())
	job, err := UploadImport(ctx, conn, rc, map[string]any{"file_name": "cases.csv", "file": csv, "mapping_version": "generic_csv_v1"})
	check(t, err)
	if job.Status != "uploaded" || job.RowCount != 1 {
		t.Fatalf("got %+v, want status uploaded, 1 row", job)
	}

	validated, err := ValidateImport(ctx, conn, rc, job.ID)
	check(t, err)
	if validated.Status != "validated" || validated.ErrorCount != 0 {
		t.Fatalf("got %+v, want validated with no errors", validated)
	}

	comparison, err := CompareImport(ctx, conn, rc, job.ID)
	check(t, err)
	if comparison.NewCount != 1 || comparison.ChangedCount != 0 {
		t.Fatalf("got %+v, want 1 new, 0 changed", comparison)
	}

	dryRun, err := DryRunCutover(ctx, conn, rc, job.ID)
	check(t, err)
	if dryRun.BlockingIssueCount != 0 || dryRun.WouldInsert != 1 {
		t.Fatalf("got %+v, want no blocking issues, 1 would-insert", dryRun)
	}

	result, err := ExecuteCutover(ctx, conn, rc, job.ID)
	check(t, err)
	if !result.Applied || result.WouldInsert != 1 {
		t.Fatalf("got %+v, want applied with 1 inserted", result)
	}

	cases, err := ListCases(ctx, conn, rc, CaseFilter{})
	check(t, err)
	found := false
	for _, c := range cases.Items {
		if c.ExternalID == "EXT-1" && c.CaseNumber == "RD-260914-001" {
			found = true
		}
	}
	if !found {
		t.Fatalf("got %+v, want the cut-over case present", cases.Items)
	}
}

func TestDryRunCutover_BlocksOnOpenErrorIssues(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)

	row := validImportRow()
	row[3] = "UNKNOWN-CITY" // unknown_reference error
	csv := importCsv(validImportHeader(), row)
	job, err := UploadImport(ctx, conn, rc, map[string]any{"file_name": "bad.csv", "file": csv, "mapping_version": "generic_csv_v1"})
	check(t, err)
	validated, err := ValidateImport(ctx, conn, rc, job.ID)
	check(t, err)
	if validated.ErrorCount == 0 {
		t.Fatalf("got %+v, want at least one error", validated)
	}
	_, err = CompareImport(ctx, conn, rc, job.ID)
	check(t, err)
	dryRun, err := DryRunCutover(ctx, conn, rc, job.ID)
	check(t, err)
	if dryRun.BlockingIssueCount == 0 {
		t.Fatalf("got %+v, want blocking issues from the open error", dryRun)
	}

	_, err = ExecuteCutover(ctx, conn, rc, job.ID)
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict: cut-over requires dry_run_done status", err)
	}
}

func TestValidateImport_ConflictWhenAlreadyCutOver(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)

	csv := importCsv(validImportHeader(), validImportRow())
	job, err := UploadImport(ctx, conn, rc, map[string]any{"file_name": "cases.csv", "file": csv, "mapping_version": "generic_csv_v1"})
	check(t, err)
	_, err = ValidateImport(ctx, conn, rc, job.ID)
	check(t, err)
	_, err = CompareImport(ctx, conn, rc, job.ID)
	check(t, err)
	_, err = DryRunCutover(ctx, conn, rc, job.ID)
	check(t, err)
	_, err = ExecuteCutover(ctx, conn, rc, job.ID)
	check(t, err)

	_, err = ValidateImport(ctx, conn, rc, job.ID)
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict for a re-validate after cut-over", err)
	}
}

func TestUpdateDataQualityIssue_ChangesStatus(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)

	row := validImportRow()
	row[9] = "200" // out_of_range_coordinate error
	csv := importCsv(validImportHeader(), row)
	job, err := UploadImport(ctx, conn, rc, map[string]any{"file_name": "bad.csv", "file": csv, "mapping_version": "generic_csv_v1"})
	check(t, err)
	_, err = ValidateImport(ctx, conn, rc, job.ID)
	check(t, err)
	issues, err := ListImportIssues(ctx, conn, rc, job.ID, datactx.PageQuery{})
	check(t, err)
	if len(issues.Items) == 0 {
		t.Fatalf("got no issues, want at least the coordinate error")
	}
	target := issues.Items[0]

	updated, err := UpdateDataQualityIssue(ctx, conn, rc, target.ID, map[string]any{"status": "ignored", "note": "acceptable for the demo"})
	check(t, err)
	if updated.Status != "ignored" {
		t.Fatalf("got %+v, want status ignored", updated)
	}
}

func rowsCsv(n int, mutate func(i int, row []string)) string {
	var b strings.Builder
	b.WriteString(strings.Join(validImportHeader(), ",") + "\r\n")
	for i := 0; i < n; i++ {
		row := validImportRow()
		row[0], row[1] = fmt.Sprintf("EXT-%d", i), fmt.Sprintf("RD-260914-%06d", i)
		if mutate != nil {
			mutate(i, row)
		}
		b.WriteString(strings.Join(row, ",") + "\r\n")
	}
	return b.String()
}

func runToCutover(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, job ImportJob) (ImportComparison, CutoverResult) {
	t.Helper()
	_, err := ValidateImport(ctx, conn, rc, job.ID)
	check(t, err)
	cmp, err := CompareImport(ctx, conn, rc, job.ID)
	check(t, err)
	_, err = DryRunCutover(ctx, conn, rc, job.ID)
	check(t, err)
	res, err := ExecuteCutover(ctx, conn, rc, job.ID)
	check(t, err)
	return cmp, res
}

func caseSources(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) map[string]string {
	t.Helper()
	cases, err := allCasesLive(ctx, conn, rc.CustomerID)
	check(t, err)
	out := map[string]string{}
	for _, c := range cases {
		out[c.ExternalID] = c.DataSource
	}
	return out
}

func TestImportFlow_EveryRowArrivesPastTheOldCap(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)
	const n = 25000
	job, err := UploadImportFile(ctx, conn, rc, ImportUploadMeta{FileName: "big.csv", MappingVersion: "generic_csv_v1", DataSource: "SYNTHETIC"}, strings.NewReader(rowsCsv(n, nil)))
	check(t, err)
	validated, err := ValidateImport(ctx, conn, rc, job.ID)
	check(t, err)
	if validated.RowCount != n || validated.ErrorCount != 0 {
		t.Fatalf("validated %+v, want %d rows and no errors", validated, n)
	}
	cmp, err := CompareImport(ctx, conn, rc, job.ID)
	check(t, err)
	if cmp.IncomingCaseCount != n || cmp.NewCount != n {
		t.Fatalf("comparison %+v, want %d incoming and new", cmp, n)
	}
	_, err = DryRunCutover(ctx, conn, rc, job.ID)
	check(t, err)
	res, err := ExecuteCutover(ctx, conn, rc, job.ID)
	check(t, err)
	if res.WouldInsert != n {
		t.Fatalf("cut-over %+v, want %d inserted", res, n)
	}
	if count, err := caseCountLive(ctx, conn, rc.CustomerID); err != nil || count != n {
		t.Fatalf("cases held %d (%v), want %d", count, err, n)
	}
	if src, err := importstorage.OpenSource(ctx, rc.CustomerID, job.ID); err != nil || src != nil {
		t.Fatalf("the stored file outlived the cut-over (%v)", err)
	}
}

func TestImportFlow_LabelsEverythingByTheImportsSource(t *testing.T) {
	labelsByImportSource(t)
}

// imports ignore the install setting.
func TestImportFlow_KeepsItsOwnSourceOnACustomerLiveInstall(t *testing.T) {
	defer recordsource.SetForTest("LIVE")()
	labelsByImportSource(t)
}

func labelsByImportSource(t *testing.T) {
	t.Helper()
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)
	syn, err := UploadImportFile(ctx, conn, rc, ImportUploadMeta{FileName: "rehearsal.csv", MappingVersion: "generic_csv_v1", DataSource: "SYNTHETIC"},
		strings.NewReader(rowsCsv(3, func(i int, row []string) { row[13] = "1" })))
	check(t, err)
	if syn.DataSource != "SYNTHETIC" {
		t.Fatalf("job labelled %s", syn.DataSource)
	}
	cmp, _ := runToCutover(t, ctx, conn, rc, syn)
	if cmp.DataSource != "SYNTHETIC" {
		t.Fatalf("comparison labelled %s", cmp.DataSource)
	}
	issues, err := ListImportIssues(ctx, conn, rc, syn.ID, datactx.PageQuery{})
	check(t, err)
	if len(issues.Items) == 0 || issues.Items[0].DataSource != "SYNTHETIC" {
		t.Fatalf("issues %+v, want SYNTHETIC ones", issues.Items)
	}
	if got := caseSources(t, ctx, conn, rc); got["EXT-0"] != "SYNTHETIC" {
		t.Fatalf("case labelled %q", got["EXT-0"])
	}
	customer, err := UploadImport(ctx, conn, rc, map[string]any{"file_name": "customer.csv", "file": rowsCsv(3, nil), "mapping_version": "generic_csv_v1"})
	check(t, err)
	if customer.DataSource != "IMPORTED" {
		t.Fatalf("an upload with no label is %s, want IMPORTED", customer.DataSource)
	}
	cmp, res := runToCutover(t, ctx, conn, rc, customer)
	if cmp.ChangedCount != 3 || res.WouldUpdate != 3 || cmp.DataSource != "IMPORTED" {
		t.Fatalf("comparison %+v, cut-over %+v: the label change is a change", cmp, res)
	}
	for ext, src := range caseSources(t, ctx, conn, rc) {
		if src != "IMPORTED" {
			t.Fatalf("case %s kept %s after a IMPORTED import updated it", ext, src)
		}
	}
	if _, err := UploadImport(ctx, conn, rc, map[string]any{"file": rowsCsv(1, nil), "mapping_version": "generic_csv_v1", "data_source": "LIVE"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("LIVE upload: got %v, want Invalid", err)
	}
}

func TestImportFlow_MissingFileFailsTheJobInsteadOfReplaying(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	ReloadReplayCasesForTest()
	t.Cleanup(resetImportDeps)
	seedImportRefFixture(t, ctx, conn, rc)
	job, err := UploadImport(ctx, conn, rc, map[string]any{"file_name": "gone.csv", "file": rowsCsv(2, nil), "mapping_version": "generic_csv_v1"})
	check(t, err)
	check(t, importstorage.RemoveJob(ctx, rc.CustomerID, job.ID))
	_, err = ValidateImport(ctx, conn, rc, job.ID)
	if errCode(err) != dataerr.CodeConflict || !strings.Contains(err.Error(), "no longer in object storage") {
		t.Fatalf("got %v, want a Conflict naming the missing file", err)
	}
	after, err := GetImportJob(ctx, conn, rc, job.ID)
	check(t, err)
	if after.Status != "failed" {
		t.Fatalf("job is %s, want failed", after.Status)
	}
	if n, _ := caseCountLive(ctx, conn, rc.CustomerID); n != 0 {
		t.Fatalf("%d cases appeared", n)
	}
}

func TestImportFlow_ComparisonCountsCasesMissingFromTheFile(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)
	first, err := UploadImport(ctx, conn, rc, map[string]any{"file": rowsCsv(4, nil), "mapping_version": "generic_csv_v1", "data_source": "SYNTHETIC"})
	check(t, err)
	runToCutover(t, ctx, conn, rc, first)
	second, err := UploadImport(ctx, conn, rc, map[string]any{"file": rowsCsv(3, func(i int, row []string) {
		if i == 2 {
			row[16] = "2026-09-14T10:00:00+03:00"
		}
	}), "mapping_version": "generic_csv_v1", "data_source": "SYNTHETIC"})
	check(t, err)
	_, err = ValidateImport(ctx, conn, rc, second.ID)
	check(t, err)
	cmp, err := CompareImport(ctx, conn, rc, second.ID)
	check(t, err)
	if cmp.ExistingCaseCount != 4 || cmp.NewCount != 0 || cmp.ChangedCount != 1 || cmp.UnchangedCount != 2 || cmp.MissingFromImportCount != 1 {
		t.Fatalf("comparison %+v, want 4 held, 1 changed, 2 unchanged, 1 missing", cmp)
	}
}

func TestImportRollback_RestoresUpdatesDeletesInsertsAndRespectsLaterImports(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetImportDeps()
	seedImportRefFixture(t, ctx, conn, rc)
	first, err := UploadImport(ctx, conn, rc, map[string]any{"file": rowsCsv(3, nil), "mapping_version": "generic_csv_v1", "data_source": "SYNTHETIC"})
	check(t, err)
	runToCutover(t, ctx, conn, rc, first)
	second, err := UploadImport(ctx, conn, rc, map[string]any{"file": rowsCsv(4, func(i int, row []string) {
		if i == 0 {
			row[16] = "2026-09-14T11:00:00+03:00"
		}
	}), "mapping_version": "generic_csv_v1", "data_source": "SYNTHETIC"})
	check(t, err)
	if _, res := runToCutover(t, ctx, conn, rc, second); res.WouldInsert != 1 || res.WouldUpdate != 1 {
		t.Fatalf("second cut-over %+v, want 1 added and 1 updated", res)
	}
	planner := rc
	planner.Role = access.RolePlanner
	if _, err := RollbackImport(ctx, conn, planner, second.ID); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("a planner's roll-back: got %v, want Forbidden", err)
	}
	if _, err := RollbackImport(ctx, conn, rc, first.ID); errCode(err) != dataerr.CodeConflict || !strings.Contains(err.Error(), "roll that one back first") {
		t.Fatalf("rolling back under a later import: got %v, want a Conflict naming it", err)
	}
	undo, err := RollbackImport(ctx, conn, rc, second.ID)
	check(t, err)
	if undo.DeletedCount != 1 || undo.RestoredCount != 1 {
		t.Fatalf("roll-back %+v, want 1 removed and 1 restored", undo)
	}
	cases, err := allCasesLive(ctx, conn, rc.CustomerID)
	check(t, err)
	if len(cases) != 3 {
		t.Fatalf("%d cases after rolling back the second import, want 3", len(cases))
	}
	for _, c := range cases {
		if c.ExternalID == "EXT-0" && (c.ClosedAt == nil || !strings.HasPrefix(*c.ClosedAt, "2026-09-14T09:40")) {
			t.Fatalf("EXT-0 closed_at %v, want the first import's 09:40 back", c.ClosedAt)
		}
	}
	if _, err := RollbackImport(ctx, conn, rc, second.ID); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("a second roll-back: got %v, want Conflict", err)
	}
	undo, err = RollbackImport(ctx, conn, rc, first.ID)
	check(t, err)
	if undo.DeletedCount != 3 || undo.RestoredCount != 0 {
		t.Fatalf("roll-back %+v, want 3 removed", undo)
	}
	if n, _ := caseCountLive(ctx, conn, rc.CustomerID); n != 0 {
		t.Fatalf("%d cases left", n)
	}
	job, err := GetImportJob(ctx, conn, rc, first.ID)
	check(t, err)
	if job.Status != "rolled_back" {
		t.Fatalf("job is %s, want rolled_back", job.Status)
	}
}
