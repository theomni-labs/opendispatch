// SPDX-License-Identifier: AGPL-3.0-only

// Live: the ids filter of listCases.
package business

import (
	"context"
	"sort"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func idsOf(rows []Case) []string {
	out := make([]string, 0, len(rows))
	for _, c := range rows {
		out = append(out, c.ID)
	}
	sort.Strings(out)
	return out
}

func sortedCopy(ids []string) []string {
	out := append([]string{}, ids...)
	sort.Strings(out)
	return out
}

func TestListCasesIDs_MatchesGoAndScope(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	fx := seedSQLCases(t, ctx, conn, rc)
	unknown := datactx.NewID()
	upper := strings.ToUpper(fx.caseIDs[1])
	filters := []CaseFilter{
		{IDs: fx.caseIDs[:7]},
		{IDs: append([]string{unknown}, fx.caseIDs[10:14]...)},
		{IDs: fx.caseIDs, ZoneID: fx.zoneA},
		{IDs: fx.caseIDs[:20], Handling: "field", DateFrom: "2026-09-13"},
		{IDs: []string{upper}},
		{IDs: []string{fx.caseIDs[3], fx.caseIDs[3]}},
	}
	compareCaseLists(t, ctx, conn, rc, filters, []int{0, 3, 200}, 100, true)
	scoped := plannerCtx(rc.CustomerID, rc.UserID, []string{fx.zoneA})
	compareCaseLists(t, ctx, conn, scoped, filters, []int{4}, 100, true)

	page, err := ListCases(ctx, conn, rc, CaseFilter{IDs: fx.caseIDs[:7], Limit: 200})
	check(t, err)
	if got, want := idsOf(page.Items), sortedCopy(fx.caseIDs[:7]); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("ids page: got %v, want %v", got, want)
	}
	page, err = ListCases(ctx, conn, rc, CaseFilter{IDs: []string{unknown}})
	check(t, err)
	if len(page.Items) != 0 || page.Page.Total != 0 {
		t.Fatalf("an unknown id matched %d cases", len(page.Items))
	}
	inScope, err := ListAllCases(ctx, conn, scoped, CaseFilter{IDs: fx.caseIDs})
	check(t, err)
	for _, c := range inScope {
		if c.ZoneID != fx.zoneA {
			t.Fatalf("a planner scoped to zone A read a case in %q", c.ZoneID)
		}
	}
	if len(inScope) == 0 || len(inScope) == len(fx.caseIDs) {
		t.Fatalf("scoped ids read %d of %d cases", len(inScope), len(fx.caseIDs))
	}
}

func TestListCasesIDs_RejectsBadInput(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	tooMany := make([]string, MaxCaseIDs+1)
	for i := range tooMany {
		tooMany[i] = datactx.NewID()
	}
	for _, ids := range [][]string{{}, {""}, {"not-a-uuid"}, tooMany} {
		if _, err := ListCases(ctx, conn, rc, CaseFilter{IDs: ids}); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("ListCases ids %d: want invalid, got %v", len(ids), err)
		}
		if _, err := ListAllCases(ctx, conn, rc, CaseFilter{IDs: ids}); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("ListAllCases ids %d: want invalid, got %v", len(ids), err)
		}
	}
	if _, err := ListCases(ctx, conn, rc, CaseFilter{IDs: tooMany[:MaxCaseIDs]}); err != nil {
		t.Fatalf("200 ids: %v", err)
	}
}
