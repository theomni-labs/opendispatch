// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors migration-header.test.ts, 1:1.
package tenancy

import (
	"strings"
	"testing"
)

func TestParseMigrationHeader_WellFormed(t *testing.T) {
	content := strings.Join([]string{
		"-- needs_downtime: false",
		"-- non_transactional: false",
		"-- requires_restore_to_rollback: false",
		"",
		"CREATE TABLE t ();",
	}, "\n")
	h, err := ParseMigrationHeader(content, "0001_t.sql")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if h.NeedsDowntime || h.NonTransactional || h.RequiresRestoreToRollback || h.Reason != "" {
		t.Errorf("got %+v, want all false / empty reason", h)
	}
}

func TestParseMigrationHeader_RequiresReasonWhenRestoreTrue(t *testing.T) {
	content := strings.Join([]string{
		"-- needs_downtime: false",
		"-- non_transactional: false",
		"-- requires_restore_to_rollback: true",
		"-- reason: dropping the column needs a full rewrite",
		"ALTER TABLE t DROP COLUMN c;",
	}, "\n")
	h, err := ParseMigrationHeader(content, "0002_t.sql")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !h.RequiresRestoreToRollback || h.Reason != "dropping the column needs a full rewrite" {
		t.Errorf("got %+v", h)
	}
}

func TestParseMigrationHeader_RejectsRestoreTrueWithNoReason(t *testing.T) {
	content := strings.Join([]string{
		"-- needs_downtime: false",
		"-- non_transactional: false",
		"-- requires_restore_to_rollback: true",
		"ALTER TABLE t DROP COLUMN c;",
	}, "\n")
	_, err := ParseMigrationHeader(content, "0003_t.sql")
	if err == nil || !strings.Contains(err.Error(), "reason") {
		t.Fatalf("want an error mentioning \"reason\", got %v", err)
	}
}

func TestParseMigrationHeader_RejectsRestoreTrueWithBlankReason(t *testing.T) {
	content := strings.Join([]string{
		"-- needs_downtime: false",
		"-- non_transactional: false",
		"-- requires_restore_to_rollback: true",
		"-- reason: ",
		"ALTER TABLE t DROP COLUMN c;",
	}, "\n")
	if _, err := ParseMigrationHeader(content, "0004_t.sql"); err == nil {
		t.Fatal("want an error for a blank reason")
	}
}

func TestParseMigrationHeader_RejectsMissingField(t *testing.T) {
	all := map[string]string{"needs_downtime": "false", "non_transactional": "false", "requires_restore_to_rollback": "false"}
	for _, missing := range []string{"needs_downtime", "non_transactional", "requires_restore_to_rollback"} {
		t.Run(missing, func(t *testing.T) {
			fields := map[string]string{}
			for k, v := range all {
				if k != missing {
					fields[k] = v
				}
			}
			var lines []string
			for k, v := range fields {
				lines = append(lines, "-- "+k+": "+v)
			}
			_, err := ParseMigrationHeader(strings.Join(lines, "\n"), "0005_t.sql")
			if err == nil || !strings.Contains(err.Error(), missing) {
				t.Fatalf("want an error mentioning %q, got %v", missing, err)
			}
		})
	}
}

func TestParseMigrationHeader_RejectsNonBooleanValue(t *testing.T) {
	content := strings.Join([]string{
		"-- needs_downtime: yes",
		"-- non_transactional: false",
		"-- requires_restore_to_rollback: false",
	}, "\n")
	_, err := ParseMigrationHeader(content, "0006_t.sql")
	if err == nil || !strings.Contains(err.Error(), `must be "true" or "false"`) {
		t.Fatalf("got %v", err)
	}
}

func TestParseMigrationHeader_StopsAtFirstNonHeaderLine(t *testing.T) {
	// Line 3 is SQL; the real field on line 4 is unseen.
	content := strings.Join([]string{
		"-- needs_downtime: false",
		"-- non_transactional: false",
		"SELECT 1; -- requires_restore_to_rollback: false is not a header line here",
		"-- requires_restore_to_rollback: false",
	}, "\n")
	_, err := ParseMigrationHeader(content, "0007_t.sql")
	if err == nil || !strings.Contains(err.Error(), "requires_restore_to_rollback") {
		t.Fatalf("got %v", err)
	}
}

func TestParseMigrationHeader_AllowsBlankLinesInHeaderBlock(t *testing.T) {
	content := strings.Join([]string{
		"-- needs_downtime: false",
		"",
		"-- non_transactional: false",
		"-- requires_restore_to_rollback: false",
		"",
		"CREATE TABLE t ();",
	}, "\n")
	h, err := ParseMigrationHeader(content, "0008_t.sql")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if h.NeedsDowntime != false {
		t.Errorf("NeedsDowntime = %v, want false", h.NeedsDowntime)
	}
}

func TestParseMigrationHeader_ErrorMessagesNameTheFile(t *testing.T) {
	_, err := ParseMigrationHeader("", "weird.sql")
	if err == nil || !strings.Contains(err.Error(), "weird.sql") {
		t.Fatalf("got %v", err)
	}
}
