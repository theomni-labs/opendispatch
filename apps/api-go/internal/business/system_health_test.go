// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors the admin.system_health test cases.
package business

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func resetSystemHealthDeps() {
	ResetSystemHealthForTest()
	ResetIntegrationsForTest()
	settingsstore.ResetForTest()
}

func TestListJobRuns_SeedsFiltersAndOrders(t *testing.T) {
	resetSystemHealthDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	all, err := ListJobRuns(admin, JobRunQuery{})
	check(t, err)
	if len(all.Items) != 11 {
		t.Fatalf("got %d job runs, want 11 seeded rows", len(all.Items))
	}
	for i := 1; i < len(all.Items); i++ {
		prev, cur := all.Items[i-1], all.Items[i]
		if *prev.StartedAt < *cur.StartedAt {
			t.Fatalf("not newest-first: %s before %s", *prev.StartedAt, *cur.StartedAt)
		}
	}

	failed, err := ListJobRuns(admin, JobRunQuery{Status: "failed"})
	check(t, err)
	if len(failed.Items) != 1 || failed.Items[0].Kind != "import" {
		t.Fatalf("status=failed: got %+v, want 1 import-validate row", failed.Items)
	}

	rollups, err := ListJobRuns(admin, JobRunQuery{Kind: "rollup"})
	check(t, err)
	if len(rollups.Items) != 3 {
		t.Fatalf("kind=rollup: got %d, want 3", len(rollups.Items))
	}

	ranged, err := ListJobRuns(admin, JobRunQuery{From: "2026-09-13T00:00:00+03:00", To: "2026-09-14T00:00:00+03:00"})
	check(t, err)
	for _, j := range ranged.Items {
		if *j.StartedAt < "2026-09-13T00:00:00+03:00" {
			t.Fatalf("row %s outside requested range", *j.StartedAt)
		}
	}

	second, err := ListJobRuns(admin, JobRunQuery{})
	check(t, err)
	if len(second.Items) != 11 {
		t.Fatalf("re-seeding happened: got %d rows on second call", len(second.Items))
	}
}

func TestListJobRuns_RefusesWrongRole(t *testing.T) {
	resetSystemHealthDeps()
	planner := roleCtx("t1", "u1", access.RolePlanner)
	_, err := ListJobRuns(planner, JobRunQuery{})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner: got %v, want Forbidden", err)
	}
}

func TestGetSystemHealth_OverallAndLastFailure(t *testing.T) {
	resetSystemHealthDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	healthy, err := GetSystemHealth(admin)
	check(t, err)
	if healthy.Overall != "healthy" {
		t.Fatalf("overall = %q with no integrations, want healthy", healthy.Overall)
	}
	if healthy.LastJobFailureAt == nil || *healthy.LastJobFailureAt == "" {
		t.Fatalf("last_job_failure_at should reflect the seeded failed row")
	}

	UpsertIntegrationForTest(Integration{
		BaseRecord: bd("00000000-0000-4000-8000-0000000000a1", "t1"),
		IsEnabled:  true, Health: "down", Kind: "case_feed", NameEn: "Down feed",
	})
	down, err := GetSystemHealth(admin)
	check(t, err)
	if down.Overall != "down" {
		t.Fatalf("overall = %q with a down enabled integration, want down", down.Overall)
	}
	if len(down.Feeds) != 1 || down.Feeds[0].Health != "down" {
		t.Fatalf("feeds = %+v, want the down integration listed", down.Feeds)
	}
}

func TestGetSystemHealth_UpdateAgentByInstallMode(t *testing.T) {
	resetSystemHealthDeps()
	private := roleCtx("t1", "u1", access.RoleAdministrator)
	private.InstallMode = access.InstallPrivate
	health, err := GetSystemHealth(private)
	check(t, err)
	var updateAgent *HealthComponent
	for i := range health.Components {
		if health.Components[i].Name == "update_agent" {
			updateAgent = &health.Components[i]
		}
	}
	if updateAgent == nil || updateAgent.Status != "ok" || updateAgent.Detail == nil || *updateAgent.Detail != "Stub" {
		t.Fatalf("update_agent in a private install: got %+v, want ok/Stub", updateAgent)
	}
}

func TestGetStorageStatus_FixedIllustrativeSizes(t *testing.T) {
	resetSystemHealthDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	status, err := GetStorageStatus(admin)
	check(t, err)
	const gb = 1024 * 1024 * 1024
	if status.TotalBytes != 100*gb {
		t.Fatalf("total_bytes = %d, want 100 GiB", status.TotalBytes)
	}
	var sum int64
	for _, a := range status.Areas {
		sum += a.UsedBytes
	}
	if sum != status.UsedBytes {
		t.Fatalf("used_bytes = %d, want sum of areas %d", status.UsedBytes, sum)
	}
	if len(status.Areas) != 4 {
		t.Fatalf("got %d areas, want 4", len(status.Areas))
	}
}

func TestBackupStatus_DefaultThenRoundTrip(t *testing.T) {
	resetSystemHealthDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	def, err := GetBackupStatus(admin)
	check(t, err)
	if def.LastConfirmedAt != "2026-08-30T02:00:00+03:00" || def.Source != "customer_reported" {
		t.Fatalf("default backup status = %+v, want the TS literal default", def)
	}

	confirmed, err := ConfirmBackup(admin, map[string]any{"note": "Verified with IT."})
	check(t, err)
	if confirmed.ConfirmedByUserID == nil || *confirmed.ConfirmedByUserID != "u1" {
		t.Fatalf("confirmed_by_user_id = %v, want u1", confirmed.ConfirmedByUserID)
	}
	if confirmed.Note == nil || *confirmed.Note != "Verified with IT." {
		t.Fatalf("note = %v, want the confirmation note", confirmed.Note)
	}

	again, err := GetBackupStatus(admin)
	check(t, err)
	if again.LastConfirmedAt != confirmed.LastConfirmedAt {
		t.Fatalf("stored status not round-tripped: %+v vs %+v", again, confirmed)
	}
}

func TestDiagnosticsBundle_CreateAndDownloadValidZip(t *testing.T) {
	resetSystemHealthDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	bundle, err := CreateDiagnosticsBundle(admin)
	check(t, err)
	if bundle.SizeBytes <= 0 || !bundle.PersonalDataRemoved {
		t.Fatalf("bundle = %+v, want a positive size and personal_data_removed", bundle)
	}

	download, err := DownloadDiagnosticsBundle(admin, bundle.ID)
	check(t, err)
	if download.ContentType != "application/zip" {
		t.Fatalf("content_type = %q, want application/zip", download.ContentType)
	}

	raw, err := base64.StdEncoding.DecodeString(download.ContentBase64)
	check(t, err)
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	check(t, err)

	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
		if f.Name == "settings.json" || f.Name == "health.json" {
			rc, err := f.Open()
			check(t, err)
			content, err := io.ReadAll(rc)
			check(t, err)
			rc.Close()
			var parsed map[string]any
			if err := json.Unmarshal(content, &parsed); err != nil {
				t.Fatalf("%s is not valid JSON: %v", f.Name, err)
			}
		}
	}
	for _, want := range []string{"README.txt", "settings.json", "health.json", "jobs.json"} {
		if !names[want] {
			t.Fatalf("zip missing %q, got %v", want, names)
		}
	}
	if len(names) != 4 {
		t.Fatalf("zip has %d files, want exactly 4", len(names))
	}
}

func TestDownloadDiagnosticsBundle_RequiresExistingBundle(t *testing.T) {
	resetSystemHealthDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	_, err := DownloadDiagnosticsBundle(admin, "00000000-0000-4000-8000-000000000099")
	if errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("unknown bundle: got %v, want NotFound", err)
	}
}

func TestGetLiveness_OkVersion(t *testing.T) {
	resetSystemHealthDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	live, err := GetLiveness(admin)
	check(t, err)
	if live.Status != "ok" || live.Version == "" {
		t.Fatalf("liveness = %+v, want ok with a version", live)
	}
}

func TestGetReadiness_ReflectsIntegrationHealth(t *testing.T) {
	resetSystemHealthDeps()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	ok, err := GetReadiness(admin)
	check(t, err)
	if ok.Status != "ok" {
		t.Fatalf("readiness with no integrations = %+v, want ok", ok)
	}

	UpsertIntegrationForTest(Integration{
		BaseRecord: bd("00000000-0000-4000-8000-0000000000a2", "t1"),
		IsEnabled:  true, Health: "degraded", Kind: "case_feed", NameEn: "Slow feed",
	})
	degraded, err := GetReadiness(admin)
	check(t, err)
	if degraded.Status != "degraded" {
		t.Fatalf("readiness with a degraded feed = %+v, want degraded", degraded)
	}
}

func TestGetLiveness_RefusesOutsideRoleInstallMode(t *testing.T) {
	resetSystemHealthDeps()
	approver := roleCtx("t1", "u1", access.RoleChangeApprover)
	approver.InstallMode = access.InstallShared
	_, err := GetLiveness(approver)
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("change approver outside its install modes: got %v, want Forbidden", err)
	}
}
