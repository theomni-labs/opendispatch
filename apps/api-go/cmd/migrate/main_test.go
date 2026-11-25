// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"strings"
	"testing"
	"time"
)

func TestNamedTagsTheOwnerConnection(t *testing.T) {
	got := named("postgres://opendispatch_owner@db:5432/opendispatch?sslmode=require")
	if !strings.Contains(got, "application_name=opendispatch-migrate") || !strings.Contains(got, "sslmode=require") {
		t.Fatalf("got %q", got)
	}
	if got := named("host=db user=opendispatch_owner"); !strings.HasSuffix(got, " application_name=opendispatch-migrate") {
		t.Fatalf("keyword form: got %q", got)
	}
}

func TestTimeoutDefaultsToThirtyMinutes(t *testing.T) {
	t.Setenv("OPENDISPATCH_MIGRATE_TIMEOUT_SECONDS", "")
	if timeout() != 30*time.Minute {
		t.Fatal("default")
	}
	t.Setenv("OPENDISPATCH_MIGRATE_TIMEOUT_SECONDS", "90")
	if timeout() != 90*time.Second {
		t.Fatal("override")
	}
	t.Setenv("OPENDISPATCH_MIGRATE_TIMEOUT_SECONDS", "-5")
	if timeout() != 30*time.Minute {
		t.Fatal("negative")
	}
}
