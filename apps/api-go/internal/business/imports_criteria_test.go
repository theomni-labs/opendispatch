// SPDX-License-Identifier: AGPL-3.0-only

// Import: the optional rule criteria columns.
package business

import (
	"encoding/json"
	"strings"
	"testing"
)

func criteriaTable(values ...string) [][]string {
	header := append(validImportHeader(), "ClaimAmount", "AssessmentMethod", "LocationType", "CustomerPreference")
	return [][]string{header, append(validImportRow(), values...)}
}

func TestValidateFile_CriteriaColumnsAreOptionalAndChecked(t *testing.T) {
	mapping := testMapping(t)
	if r := validateFile(mapping, criteriaTable("5100", "photo", "dense_urban", "remote"), testImportRefs()); len(r.ErrorLines) != 0 || r.HeaderFailed {
		t.Fatalf("got %+v, want a clean row", r.Issues)
	}
	if r := validateFile(mapping, criteriaTable("", "", "", ""), testImportRefs()); len(r.ErrorLines) != 0 {
		t.Fatalf("got %+v, want empty criteria allowed", r.Issues)
	}
	for _, bad := range [][]string{{"-1", "", "", ""}, {"x", "", "", ""}, {"", "drone", "", ""}, {"", "", "moon", ""}, {"", "", "", "phone"}} {
		r := validateFile(mapping, criteriaTable(bad...), testImportRefs())
		if len(r.ErrorLines) != 1 {
			t.Fatalf("%v: got %+v, want the row refused", bad, r.Issues)
		}
	}
}

func TestRowCase_CriteriaGoToExtra(t *testing.T) {
	mapping := testMapping(t)
	extras := extraColumns(mapping)
	if len(extras) != 4 {
		t.Fatalf("got %d criteria columns, want 4", len(extras))
	}
	table := criteriaTable("5100", "video", "", "field")
	at := map[string]int{}
	for i, h := range table[0] {
		at[h] = i
	}
	byField := map[string]int{}
	for _, c := range mapping.Columns {
		byField[c.InternalField] = at[c.DefaultColumn]
	}
	cells := func(f string) string {
		if i, ok := byField[f]; ok {
			return strings.TrimSpace(table[1][i])
		}
		return ""
	}
	refs := testImportRefs()
	c := rowCase(cells, refs, "SYNTHETIC", extras...)
	if c == nil {
		t.Fatal("got nil, want a case")
	}
	var got map[string]any
	check(t, json.Unmarshal([]byte(c.extra), &got))
	if got["claim_value_sar"] != 5100.0 || got["damage_assessment_method"] != "video" || got["customer_preference"] != "field" || len(got) != 3 {
		t.Fatalf("got %v, want the three filled criteria", got)
	}
	if c := rowCase(cells, refs, "SYNTHETIC"); c == nil || c.extra != "" {
		t.Fatalf("no criteria columns: got %+v", c)
	}
}
