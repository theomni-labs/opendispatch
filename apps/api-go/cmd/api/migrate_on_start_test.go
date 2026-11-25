// SPDX-License-Identifier: AGPL-3.0-only

package main

import "testing"

func TestMigrateOnStartDefaultsOnAndRefusesBadValues(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	cases := []struct {
		mode string
		env  map[string]string
		want bool
		err  bool
	}{
		{"oidc", map[string]string{}, true, false},
		{"oidc", map[string]string{"OPENDISPATCH_MIGRATE_ON_START": "1"}, true, false},
		{"oidc", map[string]string{"OPENDISPATCH_MIGRATE_ON_START": "0"}, false, false},
		{"oidc", map[string]string{"OPENDISPATCH_MIGRATE_ON_START": "false"}, false, false},
		{"oidc", map[string]string{"OPENDISPATCH_MIGRATE_ON_START": "no"}, false, true},
		{"demo", map[string]string{"OPENDISPATCH_MIGRATE_ON_START": "0", "OPENDISPATCH_TEST_ROUTES": "1"}, false, true},
		{"demo", map[string]string{"OPENDISPATCH_MIGRATE_ON_START": "0"}, false, false},
	}
	for _, c := range cases {
		got, err := migrateOnStart(c.mode, env(c.env))
		if (err != nil) != c.err || (err == nil && got != c.want) {
			t.Fatalf("%s %v: got %v, %v", c.mode, c.env, got, err)
		}
	}
}
