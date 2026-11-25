// SPDX-License-Identifier: AGPL-3.0-only

// Live: one date's roster lines, filtered in SQL.
package business

import (
	"context"
	"reflect"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
)

func TestRosterAssignmentsOnDateMatchTheFilteredWholeList(t *testing.T) {
	conn := openConn(t)
	ctx := context.Background()
	tenant, err := fixtures.TenantID()
	check(t, err)
	all, err := allRosterAssignments(ctx, conn, tenant)
	check(t, err)
	if len(all) == 0 {
		t.Skip("the fixture tenant is not seeded")
	}
	dates := map[string]bool{"2000-01-01": true}
	for _, a := range all {
		dates[a.RosterDate] = true
	}
	for date := range dates {
		var want []RosterAssignment
		for _, a := range all {
			if a.RosterDate == date {
				want = append(want, a)
			}
		}
		got, err := rosterAssignmentsOnDate(ctx, conn, tenant, date)
		check(t, err)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: got %d lines, want %d in the same order", date, len(got), len(want))
		}
	}
}
