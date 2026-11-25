// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors sql-split.test.ts, 1:1.
package tenancy

import (
	"reflect"
	"testing"
)

func assertSplit(t *testing.T, in string, want []string) {
	t.Helper()
	got := SplitStatements(in)
	if len(got) == 0 && len(want) == 0 {
		return
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("SplitStatements(%q) = %#v, want %#v", in, got, want)
	}
}

func TestSplitStatements_TwoPlainStatements(t *testing.T) {
	assertSplit(t, "CREATE TABLE a (id int); CREATE TABLE b (id int);",
		[]string{"CREATE TABLE a (id int)", "CREATE TABLE b (id int)"})
}

func TestSplitStatements_NoTrailingSemicolon(t *testing.T) {
	assertSplit(t, "SELECT 1", []string{"SELECT 1"})
}

func TestSplitStatements_IgnoresEmptyStatementFromTrailingSemicolon(t *testing.T) {
	assertSplit(t, "SELECT 1;", []string{"SELECT 1"})
	assertSplit(t, "SELECT 1;   ", []string{"SELECT 1"})
}

func TestSplitStatements_DropsMigrationHeaderComments(t *testing.T) {
	content := "-- needs_downtime: false\n-- non_transactional: true\n-- requires_restore_to_rollback: false\nCREATE INDEX CONCURRENTLY idx ON t (c);"
	assertSplit(t, content, []string{"CREATE INDEX CONCURRENTLY idx ON t (c)"})
}

func TestSplitStatements_IgnoresSemicolonInSingleQuotedString(t *testing.T) {
	assertSplit(t, `INSERT INTO t (name) VALUES ('a;b');`, []string{`INSERT INTO t (name) VALUES ('a;b')`})
}

func TestSplitStatements_DoubledSingleQuoteIsEscaped(t *testing.T) {
	assertSplit(t, `INSERT INTO t (name) VALUES ('it''s; fine');`, []string{`INSERT INTO t (name) VALUES ('it''s; fine')`})
}

func TestSplitStatements_IgnoresSemicolonInDoubleQuotedIdentifier(t *testing.T) {
	assertSplit(t, `SELECT 1 AS "weird;name";`, []string{`SELECT 1 AS "weird;name"`})
}

func TestSplitStatements_IgnoresSemicolonInDollarQuotedString(t *testing.T) {
	assertSplit(t,
		`CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;`,
		[]string{`CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql`})
	assertSplit(t,
		`CREATE FUNCTION f() RETURNS int AS $body$ SELECT 1; $body$ LANGUAGE sql;`,
		[]string{`CREATE FUNCTION f() RETURNS int AS $body$ SELECT 1; $body$ LANGUAGE sql`})
}

func TestSplitStatements_IgnoresSemicolonInLineComment(t *testing.T) {
	content := "SELECT 1 -- a comment with a ; in it\nFROM t;"
	assertSplit(t, content, []string{"SELECT 1 FROM t"})
}

func TestSplitStatements_IgnoresSemicolonInBlockComment(t *testing.T) {
	assertSplit(t, `SELECT 1 /* a ; comment */ FROM t;`, []string{"SELECT 1  FROM t"})
}

func TestSplitStatements_EmptyArrayForCommentsOnlyFile(t *testing.T) {
	assertSplit(t, "-- needs_downtime: false\n-- non_transactional: false\n", []string{})
}

func TestSplitStatements_EmptyArrayForEmptyFile(t *testing.T) {
	assertSplit(t, "", []string{})
}
