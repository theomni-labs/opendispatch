// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"fmt"
	"strings"
	"testing"
)

func refsWithCentre() importReferences {
	r := testImportRefs()
	r.SubZones["SZ1"] = importReferenceRow{ID: "sz1", NameEn: "Downtown", Lat: 24.7, Lon: 46.7, HasCentre: true}
	return r
}

func csvOf(rows ...[]string) string {
	var b strings.Builder
	b.WriteString("\xef\xbb\xbf")
	for _, r := range rows {
		b.WriteString(strings.Join(r, ",") + "\r\n")
	}
	return b.String()
}

func streamValidate(t *testing.T, text string) importValidateResult {
	t.Helper()
	res, err := validateRows(testMapping(t), newCsvRows(strings.NewReader(text)), refsWithCentre())
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func issuesOfType(res importValidateResult, issueType string) []importIssueSpec {
	var out []importIssueSpec
	for _, i := range res.Issues {
		if i.IssueType == issueType {
			out = append(out, i)
		}
	}
	return out
}

func TestImportToIso_AcceptsFractionsAndISOWithoutOffset(t *testing.T) {
	for in, want := range map[string]string{
		"2026-09-14 09:00:05.123":   "2026-09-14T09:00:05.123+03:00",
		"2026-09-14T09:00:05":       "2026-09-14T09:00:05+03:00",
		"2026-09-14T06:00:05Z":      "2026-09-14T06:00:05Z",
		"2026-09-14T09:00:05+03:00": "2026-09-14T09:00:05+03:00",
	} {
		if got := importToIso(in); got == nil || *got != want {
			t.Errorf("%q: got %v, want %s", in, got, want)
		}
	}
	for _, bad := range []string{"14/09/2026 09:00", "2026-9-14 09:00:00", "2026-09-14", "2026-09-14 25:00:00"} {
		if got := importToIso(bad); got != nil {
			t.Errorf("%q: got %s, want nil", bad, *got)
		}
	}
}

func TestStreamValidate_RowNumbersAreFileLinesAndBlankLinesAreReported(t *testing.T) {
	row2 := validImportRow()
	row2[0], row2[9] = "EXT-2", "200"
	text := csvOf(validImportHeader(), validImportRow()) + "\r\n\r\n" + csvOf(row2)[3:]
	res := streamValidate(t, text)
	if res.DataRows != 2 || len(res.ErrorLines) != 1 || res.ErrorLines[0] != 5 {
		t.Fatalf("got %d rows, error lines %v; want 2 rows, error on line 5", res.DataRows, res.ErrorLines)
	}
	oor := issuesOfType(res, "out_of_range_coordinate")
	if len(oor) != 1 || *oor[0].RowNumber != 5 {
		t.Fatalf("out of range issue %+v, want row 5", oor)
	}
	var blank *importIssueSpec
	for i := range res.Issues {
		if strings.Contains(res.Issues[i].Message, "empty lines were skipped") {
			blank = &res.Issues[i]
		}
	}
	if blank == nil || blank.Severity != "info" || *blank.RowNumber != 3 || !strings.HasPrefix(blank.Message, "2 empty") {
		t.Fatalf("blank-line note %+v, want 2 lines from line 3", blank)
	}
}

func TestStreamValidate_CapsListedIssuesButCountsAll(t *testing.T) {
	rows := [][]string{validImportHeader()}
	for i := 0; i < maxListedPerKind+50; i++ {
		r := validImportRow()
		r[0], r[4] = fmt.Sprintf("EXT-%d", i), "RIYADH"
		rows = append(rows, r)
	}
	res := streamValidate(t, csvOf(rows...))
	listed := issuesOfType(res, "inconsistent_name_case")
	if res.Infos != maxListedPerKind+50 || len(listed) != maxListedPerKind+1 {
		t.Fatalf("infos %d, listed %d; want %d counted, %d listed plus a summary", res.Infos, len(listed), maxListedPerKind+50, maxListedPerKind)
	}
	summary := listed[len(listed)-1]
	if summary.RowNumber != nil || !strings.Contains(summary.Message, fmt.Sprintf("%d rows in all like row 2 (CityNameEn \"RIYADH\" differs", maxListedPerKind+50)) {
		t.Fatalf("summary %+v", summary)
	}
}

func TestStreamValidate_CatchesWhatTheCutOverWouldOtherwiseDropOrMislabel(t *testing.T) {
	noAssigned := validImportRow()
	noAssigned[0], noAssigned[14] = "EXT-2", ""
	swapped := validImportRow()
	swapped[0], swapped[9], swapped[10] = "EXT-3", "46.7", "24.7"
	zero := validImportRow()
	zero[0], zero[9], zero[10] = "EXT-4", "0", "0"
	badNumber := validImportRow()
	badNumber[0], badNumber[1] = "EXT-5", "1234"
	badTime := validImportRow()
	badTime[0], badTime[2] = "EXT-6", "14/09/2026 09:00"
	res := streamValidate(t, csvOf(validImportHeader(), validImportRow(), noAssigned, swapped, zero, badNumber, badTime, validImportRow()))
	want := map[int]string{
		3: "the case counts as remote (inferred)",
		4: "km from sub-zone SZ1",
		5: "km from sub-zone SZ1",
		6: "does not start with a two-letter city code",
		7: `"14/09/2026 09:00" is not a date and time`,
		8: "is also on row 2",
	}
	for line, text := range want {
		found := false
		for _, i := range res.Issues {
			if i.RowNumber != nil && *i.RowNumber == line && strings.Contains(i.Message, text) {
				found = true
			}
		}
		if !found {
			t.Errorf("line %d: no issue saying %q in %+v", line, text, res.Issues)
		}
	}
	if fmt.Sprint(res.ErrorLines) != "[6 7]" {
		t.Errorf("error lines %v, want [6 7]", res.ErrorLines)
	}
}

func TestPartiesCountTooLargeIsAnErrorNotATruncation(t *testing.T) {
	row := validImportRow()
	row[13] = "4294967298"
	res := streamValidate(t, csvOf(validImportHeader(), row))
	if res.Errors != 1 {
		t.Fatalf("got %+v; want one error for a party count past int32", res)
	}
	found := false
	for _, is := range res.Issues {
		found = found || (is.Severity == "error" && strings.Contains(is.Message, "too large"))
	}
	if !found {
		t.Fatalf("issues %+v; want a too-large error", res.Issues)
	}
}

func TestPartiesCount(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want int32
		ok   bool
	}{
		{"", 0, true}, {"0", 0, true}, {"3", 3, true}, {"2147483647", 2147483647, true},
		{"2147483648", 0, false}, {"4294967298", 0, false}, {"-1", 0, false}, {"two", 0, false},
	} {
		got, ok := partiesCount(tc.raw)
		if got != tc.want || ok != tc.ok {
			t.Errorf("partiesCount(%q) = %d, %t; want %d, %t", tc.raw, got, ok, tc.want, tc.ok)
		}
	}
}
