// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"bufio"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
)

func testFields() *backtest.CaseMix {
	f, err := backtest.NewCaseMix(map[string]string{backtest.TypeCustomer: "ct-customer", backtest.TypePolice: "ct-police", backtest.TypeUnlisted: "ct-unlisted"})
	if err != nil {
		panic(err)
	}
	return f
}

// contractCaseRequired: Case's non-null required fields.
func contractCaseRequired(t *testing.T) []string {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	f, err := os.Open(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "contracts", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	in, inProps := false, false
	var required []string
	props := map[string]string{}
	last := ""
	for sc.Scan() {
		line := sc.Text()
		if line == "    Case:" {
			in = true
			continue
		}
		if !in {
			continue
		}
		if strings.HasPrefix(line, "    ") && !strings.HasPrefix(line, "     ") {
			break
		}
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "required: [") && required == nil {
			for _, p := range strings.Split(strings.Trim(strings.TrimPrefix(trim, "required:"), " []"), ",") {
				required = append(required, strings.TrimSpace(p))
			}
			continue
		}
		if trim == "properties:" {
			inProps = true
			continue
		}
		if inProps && strings.HasPrefix(line, "             ") && last != "" {
			props[last] += " " + trim
		} else if inProps && strings.HasPrefix(line, "            ") {
			name, rest, _ := strings.Cut(trim, ":")
			props[name], last = rest, name
		}
	}
	if len(required) < 10 {
		t.Fatalf("read %d required Case fields from the contract", len(required))
	}
	var out []string
	for _, r := range required {
		def, ok := props[r]
		if !ok {
			t.Fatalf("no property line for %s", r)
		}
		if strings.Contains(def, "Nullable") || strings.Contains(def, "null") {
			continue
		}
		out = append(out, r)
	}
	return out
}

func TestRequiredColumnsMatchContract(t *testing.T) {
	want := strings.Join(contractCaseRequired(t), ",")
	if got := strings.Join(requiredColumns, ","); got != want {
		t.Fatalf("requiredColumns %s, contract %s", got, want)
	}
}

func TestEveryRequiredCaseColumnIsFilled(t *testing.T) {
	start := time.Date(2026, 1, 1, 8, 0, 0, 0, riyadh)
	res := &backtest.LongResult{Dataset: &backtest.Dataset{Intervals: []backtest.HistoryRecord{
		{SubZoneID: "s1", Start: start, Total: 400, Field: 230},
		{SubZoneID: "s1", Start: start.Add(24 * time.Hour), Total: 400, Field: 230},
	}}}
	places := backtest.NewPlaces(map[string][2]float64{"s1": {24.7, 46.7}})
	src := newPlacedSource(newRowSource(res, "t", map[string]string{"s1": "z1"}, map[string]string{"z1": "c1"}, testFields(), 1), places, 1)
	cols := copyColumns()
	index := map[string]int{}
	for i, c := range cols {
		index[c] = i
	}
	ids := map[any]bool{}
	types := map[string]map[any]int{"field": {}, "remote_inferred": {}}
	two, n := 0, 0
	for src.Next() {
		row, _ := src.Values()
		if len(row) != len(cols) {
			t.Fatalf("row has %d values, %d columns", len(row), len(cols))
		}
		for _, c := range requiredColumns {
			i, ok := index[c]
			if !ok {
				t.Fatalf("COPY does not write %s", c)
			}
			if row[i] == nil {
				t.Fatalf("%s is NULL in %v", c, row)
			}
		}
		ext := row[index["external_id"]].(string)
		if !strings.HasPrefix(ext, "SYN-") || ids[ext] {
			t.Fatalf("external_id %q not SYN- or not unique", ext)
		}
		ids[ext] = true
		types[row[index["handling"]].(string)][row[index["case_type_id"]]]++
		if row[index["parties_involved"]] == 2 {
			two++
		}
		n++
	}
	if types["remote_inferred"]["ct-unlisted"] != 0 {
		t.Fatal("Unlisted cases are all field cases")
	}
	if types["field"]["ct-unlisted"] == 0 || types["field"]["ct-police"]+types["remote_inferred"]["ct-police"] == 0 {
		t.Fatalf("type mix %v", types)
	}
	if share := float64(two) / float64(n); share < 0.88 || share > 0.98 {
		t.Fatalf("two-party share %.3f", share)
	}
}

func TestNewCaseFieldsNeedsTheTypes(t *testing.T) {
	if _, err := backtest.NewCaseMix(map[string]string{backtest.TypeCustomer: "a"}); err == nil {
		t.Fatal("missing case types should be refused")
	}
}
