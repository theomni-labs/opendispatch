// SPDX-License-Identifier: AGPL-3.0-only

package tenancy

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

var (
	migrationName  = regexp.MustCompile(`^(\d{4})_[a-z0-9_]+\.sql$`)
	contractMarker = regexp.MustCompile(`(?m)^-- contract: \S`)
	contractish    = regexp.MustCompile(`(?is)\bDROP\s+TABLE\b|\bDROP\s+COLUMN\b|\bRENAME\b|\bALTER\b[^;]*\bDROP\b|\bALTER\s+(?:COLUMN\s+)?"?\w+"?\s+(?:SET\s+DATA\s+)?TYPE\b`)
)

// Applied files cannot be edited (checksum).
var legacyContract = map[string]string{
	"0040_holidays_name_ar_nullable.sql":               "DROP NOT NULL is safe for the previous release",
	"0041_break_rules_hours_numeric.sql":               "int to double, before any release (no tags)",
	"0042_data_quality_issues_row_number_nullable.sql": "DROP NOT NULL is safe for the previous release",
	"0043_audit_events_append_only.sql":                "uuid to text entity_id: before any release (no tags)",
}

func stripSQLComments(s string) string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		if i := strings.Index(line, "--"); i >= 0 {
			line = line[:i]
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

func lintMigration(name, body string) []string {
	var problems []string
	fields := readHeaderFields(body)
	for _, key := range []string{"needs_downtime", "non_transactional", "requires_restore_to_rollback"} {
		if v := fields[key]; v != "true" && v != "false" {
			problems = append(problems, name+": header field "+key+" must be true or false")
		}
	}
	if contractish.MatchString(stripSQLComments(body)) && !contractMarker.MatchString(body) && legacyContract[name] == "" {
		problems = append(problems, name+": DROP, RENAME, ALTER ... DROP or a column TYPE change needs a line `-- contract: <reason>`")
	}
	return problems
}

func TestMigrationFilesFollowTheConventions(t *testing.T) {
	dir := filepath.Join("..", "..", "migrations")
	names, err := listMigrationFiles(dir)
	if err != nil || len(names) == 0 {
		t.Fatalf("no migrations found in %s: %v", dir, err)
	}
	last := 0
	for _, name := range names {
		m := migrationName.FindStringSubmatch(name)
		if m == nil {
			t.Errorf("%s: name must be NNNN_description.sql (zero-padded, lower case)", name)
			continue
		}
		n, _ := strconv.Atoi(m[1])
		if n <= last {
			t.Errorf("%s: number %d is not greater than the previous %d", name, n, last)
		}
		last = n
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range lintMigration(name, string(raw)) {
			t.Error(p)
		}
	}
}

func TestLintFlagsContractStatementsWithoutMarker(t *testing.T) {
	head := "-- needs_downtime: false\n-- non_transactional: false\n-- requires_restore_to_rollback: false\n"
	for _, sql := range []string{
		`DROP TABLE "a";`, `ALTER TABLE a DROP COLUMN b;`, `ALTER TABLE a RENAME TO b;`, `ALTER TABLE a ALTER COLUMN b DROP NOT NULL;`,
		`ALTER TABLE a ALTER COLUMN b TYPE text;`, `ALTER TABLE "a" ALTER "b" SET DATA TYPE bigint USING b::bigint;`,
	} {
		if len(lintMigration("0999_x.sql", head+sql)) == 0 {
			t.Errorf("not flagged: %s", sql)
		}
		if p := lintMigration("0999_x.sql", head+"-- contract: old release gone\n"+sql); len(p) != 0 {
			t.Errorf("marker ignored for %s: %v", sql, p)
		}
	}
	if p := lintMigration("0999_x.sql", head+`-- drop table in a comment only`+"\n"+`CREATE TABLE a (id int);`); len(p) != 0 {
		t.Errorf("comment flagged: %v", p)
	}
	if p := lintMigration("0999_x.sql", head+`ALTER TYPE mood ADD VALUE 'ok'; ALTER TABLE a ADD COLUMN c text;`); len(p) != 0 {
		t.Errorf("additive change flagged: %v", p)
	}
	if len(lintMigration("0999_x.sql", "-- needs_downtime: maybe\nSELECT 1;")) == 0 {
		t.Error("bad header not flagged")
	}
}
