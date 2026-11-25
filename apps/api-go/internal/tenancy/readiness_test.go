// SPDX-License-Identifier: AGPL-3.0-only

package tenancy

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestExpectedTablesFindsCreates(t *testing.T) {
	dir := t.TempDir()
	sql := "-- x\nCREATE TABLE \"zones\" (id int);\nCREATE TABLE IF NOT EXISTS cases (id int);\nALTER TABLE zones ADD x int;\n"
	if err := os.WriteFile(filepath.Join(dir, "0001_a.sql"), []byte(sql), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := ExpectedTables(dir)
	if err != nil || len(got) != 2 || got[0] != "cases" || got[1] != "zones" {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestCheckReadyLive(t *testing.T) {
	url := os.Getenv("OPENDISPATCH_TEST_APP_DATABASE_URL")
	if url == "" {
		t.Skip("OPENDISPATCH_TEST_APP_DATABASE_URL not set")
	}
	conn, err := OpenConnection(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := CheckReady(context.Background(), conn, "../../migrations"); err != nil {
		t.Fatalf("want ready: %v", err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "0001_a.sql"), []byte("CREATE TABLE \"no_such_table_xyz\" (id int);"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := CheckReady(context.Background(), conn, dir); err == nil {
		t.Fatal("want not ready for a missing table")
	}
}
