// SPDX-License-Identifier: AGPL-3.0-only

package importutil

import (
	"strings"
	"testing"
)

func TestRowProblemsRefuseNilWhenEmpty(t *testing.T) {
	var p RowProblems
	if err := p.Refuse("Things"); err != nil {
		t.Fatalf("Refuse() = %v, want nil", err)
	}
}

func TestRowProblemsRefuseNamesRowsAndField(t *testing.T) {
	var p RowProblems
	field := "code"
	p.Add(4, &field, "already exists.")
	p.Add(5, nil, "is required.")
	err := p.Refuse("Things")
	if err == nil {
		t.Fatalf("expected an error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "Things: 2 problems, nothing was imported.") {
		t.Errorf("message = %q, missing head", msg)
	}
	if !strings.Contains(msg, "Row 4 (code): already exists.") {
		t.Errorf("message = %q, missing row 4", msg)
	}
	if !strings.Contains(msg, "Row 5: is required.") {
		t.Errorf("message = %q, missing row 5", msg)
	}
}

func TestRowProblemsRefuseTruncatesAndCountsMore(t *testing.T) {
	var p RowProblems
	for i := 0; i < 40; i++ {
		p.Add(i+2, nil, strings.Repeat("x", 20))
	}
	err := p.Refuse("Things")
	if err == nil {
		t.Fatalf("expected an error")
	}
	if len(err.Error()) > 500 {
		t.Errorf("message is %d chars, want <= 500", len(err.Error()))
	}
	if !strings.Contains(err.Error(), "more.") {
		t.Errorf("message = %q, want a truncation notice", err.Error())
	}
}

func TestDecimalOf(t *testing.T) {
	cases := map[string]*float64{"3": f(3), "-3.5": f(-3.5), "0.1": f(0.1), "": nil, "1e5": nil, "1,000": nil, "abc": nil}
	for text, want := range cases {
		got := DecimalOf(text)
		if (got == nil) != (want == nil) || (got != nil && *got != *want) {
			t.Errorf("DecimalOf(%q) = %v, want %v", text, got, want)
		}
	}
}

func TestWholeNumberOf(t *testing.T) {
	cases := map[string]*int{"3": i(3), "0": i(0), "-3": nil, "3.5": nil, "": nil, "abc": nil}
	for text, want := range cases {
		got := WholeNumberOf(text)
		if (got == nil) != (want == nil) || (got != nil && *got != *want) {
			t.Errorf("WholeNumberOf(%q) = %v, want %v", text, got, want)
		}
	}
}

func f(v float64) *float64 { return &v }
func i(v int) *int         { return &v }
