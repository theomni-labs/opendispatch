// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
)

func withCol(header, row []string, col, value string) ([]string, []string) {
	return append(append([]string(nil), header...), col), append(append([]string(nil), row...), value)
}

func messagesOf(res importValidateResult, field string) []string {
	var out []string
	for _, i := range res.Issues {
		if i.Field != nil && *i.Field == field {
			out = append(out, i.Severity+": "+i.Message)
		}
	}
	return out
}

func TestMappingDocumentsSeverityResolutionAndCleaningRules(t *testing.T) {
	m := testMapping(t)
	found := map[string][]string{}
	for _, c := range m.Columns {
		if !c.Required && len(c.Allowed) > 0 {
			found[c.InternalField] = c.Allowed
		}
	}
	if strings.Join(found["severity"], ",") != strings.Join(caseSeverities, ",") || strings.Join(found["resolution_method"], ",") != strings.Join(caseResolutions, ",") {
		t.Fatalf("mapping allowed values %v must match the importer's", found)
	}
	if m.ServiceArea == nil || len(m.ServiceArea.Latitude) != 2 {
		t.Fatal("the mapping must define the service area")
	}
}

func TestSeverityAndResolutionAreCheckedAndKept(t *testing.T) {
	h, r := withCol(validImportHeader(), validImportRow(), "Severity", "Severe")
	h, r = withCol(h, r, "ResolutionMethod", "remote")
	res := streamValidate(t, csvOf(h, r))
	if res.Errors+res.Warnings != 0 {
		t.Fatalf("valid optional values raised %+v", res.Issues)
	}
	h2, r2 := withCol(validImportHeader(), validImportRow(), "Severity", "catastrophic")
	res = streamValidate(t, csvOf(h2, r2))
	if got := messagesOf(res, "Severity"); len(got) != 1 || !strings.HasPrefix(got[0], "warning: Severity \"catastrophic\" is not one of minor, moderate, severe") {
		t.Fatalf("got %v", got)
	}
	cells := func(name string) string {
		idx := map[string]int{}
		for i, c := range h {
			idx[c] = i
		}
		for _, c := range testMapping(t).Columns {
			if c.InternalField == name {
				return r[idx[c.DefaultColumn]]
			}
		}
		return ""
	}
	c := rowCase(cells, testImportRefs(), "IMPORTED")
	if c == nil || c.severity == nil || *c.severity != "severe" || c.resolution == nil || *c.resolution != "remote" || c.handling != "remote_inferred" {
		t.Fatalf("got %+v: an explicit remote overrides the assigned-time rule", c)
	}
}

func TestImpossibleAndOutlyingTimesAreWarnings(t *testing.T) {
	row := validImportRow()
	row[15] = "2026-09-16T10:00:00+03:00"
	row[16] = "2026-09-14T08:00:00+03:00"
	res := streamValidate(t, csvOf(validImportHeader(), row))
	if res.Errors != 0 {
		t.Fatalf("times never fail a row: %+v", res.Issues)
	}
	arr, clo := messagesOf(res, "ArrivalTime"), messagesOf(res, "ClosingTime")
	if len(arr) != 1 || !strings.Contains(arr[0], "Arrived 49 hours after registration (outlier") || len(clo) != 1 || !strings.Contains(clo[0], "Closed before") {
		t.Fatalf("arrival %v closing %v", arr, clo)
	}
	future := validImportRow()
	future[2] = "2099-01-01T09:00:00+03:00"
	future[14], future[15], future[16] = "", "", ""
	if got := messagesOf(streamValidate(t, csvOf(validImportHeader(), future)), "RegisteredTime"); len(got) != 1 || !strings.Contains(got[0], "in the future") {
		t.Fatalf("future %v", got)
	}
}

func TestAPointOutsideTheServiceAreaIsAWarning(t *testing.T) {
	row := validImportRow()
	row[9], row[10] = "51.5", "-0.12"
	// a sub-zone with no centre: only the area check
	res, err := validateRows(testMapping(t), newCsvRows(strings.NewReader(csvOf(validImportHeader(), row))), testImportRefs())
	check(t, err)
	got := issuesOfType(res, "out_of_range_coordinate")
	if res.Errors != 0 || len(got) != 1 || got[0].Severity != "warning" || !strings.Contains(got[0].Message, "outside the service area") {
		t.Fatalf("got %+v", res.Issues)
	}
}

func TestADayFarFromTheMedianIsAnOutlier(t *testing.T) {
	rows := [][]string{validImportHeader()}
	n := 0
	for d := 1; d <= 9; d++ {
		count := 12
		if d == 5 {
			count = 60
		}
		for k := 0; k < count; k++ {
			n++
			r := validImportRow()
			r[0], r[1] = fmt.Sprintf("EXT-%d", n), fmt.Sprintf("RD-2609%02d-%04d", d, n)
			r[2] = fmt.Sprintf("2026-09-%02dT09:00:00+03:00", d)
			r[14], r[15], r[16] = "", "", ""
			rows = append(rows, r)
		}
	}
	res := streamValidate(t, csvOf(rows...))
	got := messagesOf(res, "RegisteredTime")
	if len(got) != 1 || !strings.Contains(got[0], "2026-09-05 has 60 cases against a median of 12") {
		t.Fatalf("got %v", got)
	}
}

func TestQualityIssuesAreEscalatedToTheDataOwner(t *testing.T) {
	ResetNotificationsForTest()
	t.Cleanup(ReloadNotificationsForTest)
	tenant, err := fixtures.TenantID()
	check(t, err)
	rc := experimentCtx(access.RoleAdministrator)
	rc.CustomerID = tenant
	job := ImportJob{FileName: "cases.csv"}
	job.ID = "44444444-4444-4444-8444-444444444444"
	if escalateImportQuality(context.Background(), rc, job, importValidateResult{DataRows: 9}) != nil {
		t.Fatal("a clean file is not escalated")
	}
	owner := escalateImportQuality(context.Background(), rc, job, importValidateResult{DataRows: 9, Errors: 2, Warnings: 1})
	if owner == nil || *owner != access.RoleAdministrator {
		t.Fatalf("owner %v, want the administrator by default", owner)
	}
	rows := AllNotificationsForTest()
	if len(rows) != 1 || rows[0].Category != "import" || rows[0].Severity != "critical" || *rows[0].RecipientRole != "administrator" ||
		!strings.Contains(*rows[0].BodyEn, "2 errors, 1 warnings") {
		t.Fatalf("notifications %+v", rows)
	}
	if escalateImportQuality(context.Background(), rc, job, importValidateResult{HeaderFailed: true, Errors: 1}) != nil {
		t.Fatal("a failed header has its own alert")
	}
}
