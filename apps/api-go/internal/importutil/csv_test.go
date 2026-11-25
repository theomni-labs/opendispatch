// SPDX-License-Identifier: AGPL-3.0-only

package importutil

import (
	"reflect"
	"regexp"
	"testing"
)

func TestParseCsvQuotingEscapesAndLineEnds(t *testing.T) {
	text := string(rune(0xFEFF)) + "a,b,c\r\n1,\"x, y\",\"say \"\"hi\"\"\"\r\n\"line\nbreak\",2,3\n"
	got := ParseCsv(text)
	want := [][]string{
		{"a", "b", "c"},
		{"1", "x, y", `say "hi"`},
		{"line\nbreak", "2", "3"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseCsv() = %#v, want %#v", got, want)
	}
}

func TestParseCsvSkipsBlankRows(t *testing.T) {
	got := ParseCsv("a,b\n\n , \n1,\n")
	want := [][]string{{"a", "b"}, {"1", ""}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseCsv() = %#v, want %#v", got, want)
	}
}

type col string

const (
	colCode   col = "code"
	colNameEn col = "name_en"
	colNameAr col = "name_ar"
)

func testColumns() Columns[col] {
	return Columns[col]{Required: []col{colCode, colNameEn}, Optional: []col{colNameAr}}
}

func TestReadCsvTableCellsByNameAndRowNumber(t *testing.T) {
	table, err := ReadCsvTable("Code, Name_En ,name_ar\nA,Alpha,\n\nB,\"Beta, two\",بيتا\n", testColumns(), "Things", ReadCsvTableOptions{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(table) != 2 || table[0].Row != 2 || table[1].Row != 3 {
		t.Fatalf("rows = %#v", table)
	}
	if !reflect.DeepEqual(table[0].Cells, map[col]string{colCode: "A", colNameEn: "Alpha", colNameAr: ""}) {
		t.Fatalf("row 0 cells = %#v", table[0].Cells)
	}
	if !reflect.DeepEqual(table[1].Cells, map[col]string{colCode: "B", colNameEn: "Beta, two", colNameAr: "بيتا"}) {
		t.Fatalf("row 1 cells = %#v", table[1].Cells)
	}
}

func TestReadCsvTableOptionalColumnMayBeMissing(t *testing.T) {
	table, err := ReadCsvTable("code,name_en\nA,Alpha\n", testColumns(), "Things", ReadCsvTableOptions{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !reflect.DeepEqual(table[0].Cells, map[col]string{colCode: "A", colNameEn: "Alpha", colNameAr: ""}) {
		t.Fatalf("cells = %#v", table[0].Cells)
	}
}

func TestReadCsvTableRefusesBadInput(t *testing.T) {
	cases := []struct {
		text    string
		pattern string
	}{
		{"code\nA\n", "name_en"},
		{"code,name_en,colour\nA,B,red\n", "colour"},
		{"code,name_en,code\nA,B,C\n", "twice"},
		{"code,name_en\nA,B,C\n", `(?i)row 2.*3 cells.*2`},
		{"code,name_en\nA\n", `(?i)row 2.*1 cell.*2`},
		{"", "(?i)empty"},
		{"code,name_en\n", "(?i)no rows"},
	}
	for _, c := range cases {
		_, err := ReadCsvTable(c.text, testColumns(), "Things", ReadCsvTableOptions{})
		if err == nil {
			t.Errorf("text %q: expected an error", c.text)
			continue
		}
		if ok, _ := regexp.MatchString(c.pattern, err.Error()); !ok {
			t.Errorf("text %q: error %q does not match %q", c.text, err.Error(), c.pattern)
		}
	}
}

func TestReadCsvTableCapsRowCount(t *testing.T) {
	rows := ""
	for i := 0; i < 6; i++ {
		rows += csvRowLine(i)
	}
	text := "code,name_en\n" + rows
	if _, err := ReadCsvTable(text, testColumns(), "Things", ReadCsvTableOptions{MaxRows: 5}); err == nil {
		t.Fatalf("expected an error for 6 rows with MaxRows 5")
	} else if ok, _ := regexp.MatchString("at most 5 rows", err.Error()); !ok {
		t.Fatalf("error %q does not mention the cap", err.Error())
	}
	table, err := ReadCsvTable(text, testColumns(), "Things", ReadCsvTableOptions{MaxRows: 6})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(table) != 6 {
		t.Fatalf("len(table) = %d, want 6", len(table))
	}
}

func csvRowLine(i int) string {
	letters := "0123456789"
	return "C" + string(letters[i]) + ",N" + string(letters[i]) + "\n"
}
