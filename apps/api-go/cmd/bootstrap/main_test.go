// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func envOf(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestRun_RefusesAnIncompleteSetup(t *testing.T) {
	file := filepath.Join(t.TempDir(), "tenants.json")
	if err := os.WriteFile(file, []byte(`[]`), 0o600); err != nil {
		t.Fatal(err)
	}
	cases := map[string]map[string]string{
		"OPENDISPATCH_APP_DATABASE_URL":      {},
		"OPENDISPATCH_BOOTSTRAP_ADMIN_GROUP": {"OPENDISPATCH_APP_DATABASE_URL": "postgres://x@127.0.0.1:1/x"},
		"OPENDISPATCH_OIDC_TENANTS_FILE":     {"OPENDISPATCH_APP_DATABASE_URL": "postgres://x@127.0.0.1:1/x", "OPENDISPATCH_BOOTSTRAP_ADMIN_GROUP": "g"},
		"no customer":                        {"OPENDISPATCH_APP_DATABASE_URL": "postgres://x@127.0.0.1:1/x", "OPENDISPATCH_BOOTSTRAP_ADMIN_GROUP": "g", "OPENDISPATCH_OIDC_TENANTS_FILE": file},
		"OPENDISPATCH_RECORD_DATA_SOURCE":    {"OPENDISPATCH_RECORD_DATA_SOURCE": "IMPORTED", "OPENDISPATCH_APP_DATABASE_URL": "postgres://x@127.0.0.1:1/x"},
	}
	for want, env := range cases {
		err := run(context.Background(), envOf(env))
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("want an error naming %q, got %v", want, err)
		}
	}
}

func TestNamed_TagsTheConnection(t *testing.T) {
	if got := named("postgres://u@h/db"); !strings.Contains(got, "application_name=opendispatch-bootstrap") {
		t.Fatalf("got %s", got)
	}
}
