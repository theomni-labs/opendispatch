// SPDX-License-Identifier: AGPL-3.0-only

package settingsstore

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
)

// sourcesAfterWrites: every write path, then labels.
func sourcesAfterWrites(t *testing.T, tenant string) map[string]string {
	t.Helper()
	ctx := context.Background()
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(Put(ctx, tenant, "rs.put", "v"))
	check(PutMany(ctx, tenant, KV{Key: "rs.many", Value: 1}))
	_, err := Incr(ctx, tenant, "rs.incr")
	check(err)
	ok, err := Swap(ctx, tenant, "rs.swap", "", "v")
	check(err)
	if !ok {
		t.Fatal("swap on an unset key did not store")
	}
	entries, err := WithPrefix(ctx, tenant, "rs.")
	check(err)
	out := map[string]string{}
	for _, e := range entries {
		out[e.Key] = e.DataSource
	}
	if len(out) != 4 {
		t.Fatalf("got %v, want 4 keys", out)
	}
	return out
}

func TestRecordSource_MemoryFollowsTheInstall(t *testing.T) {
	for _, want := range []string{"SYNTHETIC", "LIVE"} {
		restore := recordsource.SetForTest(want)
		ResetForTest()
		for key, got := range sourcesAfterWrites(t, "t-"+want) {
			if got != want {
				t.Fatalf("%s labelled %q, want %q", key, got, want)
			}
		}
		restore()
	}
}

func TestPostgres_RecordSourceFollowsTheInstall(t *testing.T) {
	conn := livePool(t)
	UsePostgres(conn)
	for _, want := range []string{"SYNTHETIC", "LIVE"} {
		restore := recordsource.SetForTest(want)
		for key, got := range sourcesAfterWrites(t, newTenant()) {
			if got != want {
				t.Fatalf("%s labelled %q, want %q", key, got, want)
			}
		}
		restore()
	}
}
