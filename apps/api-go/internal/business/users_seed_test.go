// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
)

func TestSeedUsersFromFixtures(t *testing.T) {
	ResetUsersForTest()
	if err := SeedUsersFromFixtures(); err != nil {
		t.Fatalf("seed: %v", err)
	}
	users := usersOrLog(context.Background(), "")
	if len(users) != 13 {
		t.Fatalf("got %d users, want 13", len(users))
	}
	var found bool
	for _, u := range users {
		if u.Email == "nadia.al.ghalani@demo.example" {
			found = true
			if u.DisplayName != "Nadia Al-Ghalani" {
				t.Fatalf("display_name not decoded: %q", u.DisplayName)
			}
			if u.AssignedRole != "administrator" {
				t.Fatalf("assigned_role not decoded: %q", u.AssignedRole)
			}
			if u.Status != "active" {
				t.Fatalf("status not decoded: %q", u.Status)
			}
		}
	}
	if !found {
		t.Fatal("the known fixture user was not found")
	}
}
