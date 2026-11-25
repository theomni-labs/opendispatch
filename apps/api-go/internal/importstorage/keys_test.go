// SPDX-License-Identifier: AGPL-3.0-only

package importstorage

import (
	"errors"
	"testing"
)

func TestKeysHaveNoBuiltInDefault(t *testing.T) {
	for _, mode := range []string{"demo", "oidc"} {
		t.Setenv("OPENDISPATCH_AUTH_MODE", mode)
		t.Setenv("OPENDISPATCH_S3_ACCESS_KEY", "")
		t.Setenv("OPENDISPATCH_S3_SECRET_KEY", "")
		if a, s, err := Keys(); !errors.Is(err, ErrNotConfigured) || a != "" || s != "" {
			t.Fatalf("%s: want ErrNotConfigured and no keys, got %q %q %v", mode, a, s, err)
		}
	}
}

func TestKeysRefusedWhenOneIsMissing(t *testing.T) {
	t.Setenv("OPENDISPATCH_S3_ACCESS_KEY", "k")
	t.Setenv("OPENDISPATCH_S3_SECRET_KEY", "")
	if _, _, err := Keys(); err == nil {
		t.Fatal("want an error with a missing secret")
	}
}

func TestKeysUseTheEnvironment(t *testing.T) {
	t.Setenv("OPENDISPATCH_S3_ACCESS_KEY", "k")
	t.Setenv("OPENDISPATCH_S3_SECRET_KEY", "s")
	a, s, err := Keys()
	if err != nil || a != "k" || s != "s" {
		t.Fatalf("got %q %q %v", a, s, err)
	}
}

func TestObjectKeysStartWithTheCustomer(t *testing.T) {
	t.Setenv("OPENDISPATCH_S3_BUCKET", "b")
	if got := SourceRef("t1", "j1"); got != "s3://b/t1/j1.source.csv" {
		t.Fatalf("got %q", got)
	}
	if objectKey("t1", "j1", KindErrors) != "t1/j1.errors.json" {
		t.Fatal("errors key has no customer prefix")
	}
}
