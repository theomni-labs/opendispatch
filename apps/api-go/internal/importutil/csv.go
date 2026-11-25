// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors csv.ts, import-problems.ts, ids.ts.
package importutil

import (
	"fmt"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

// ParseCsv mirrors parseCsv: RFC 4180, BOM, CRLF/LF.
func ParseCsv(text string) [][]string {
	source := strings.TrimPrefix(text, string(rune(0xFEFF)))
	runes := []rune(source)
	var rows [][]string
	var row []string
	var cell strings.Builder
	quoted := false

	rowHasContent := func(r []string) bool {
		for _, c := range r {
			if strings.TrimSpace(c) != "" {
				return true
			}
		}
		return false
	}
	flushCell := func() {
		row = append(row, cell.String())
		cell.Reset()
	}

	for i := 0; i < len(runes); i++ {
		ch := runes[i]
		switch {
		case quoted:
			if ch == '"' {
				if i+1 < len(runes) && runes[i+1] == '"' {
					cell.WriteRune('"')
					i++
				} else {
					quoted = false
				}
			} else {
				cell.WriteRune(ch)
			}
		case ch == '"':
			quoted = true
		case ch == ',':
			flushCell()
		case ch == '\n' || ch == '\r':
			if ch == '\r' && i+1 < len(runes) && runes[i+1] == '\n' {
				i++
			}
			flushCell()
			if rowHasContent(row) {
				rows = append(rows, row)
			}
			row = nil
		default:
			cell.WriteRune(ch)
		}
	}
	flushCell()
	if rowHasContent(row) {
		rows = append(rows, row)
	}
	return rows
}

// CsvRow is one data row ReadCsvTable returns.
type CsvRow[K comparable] struct {
	// Row: spreadsheet row number (header is row 1).
	Row int
	// Cells: column -> value; optional missing = "".
	Cells map[K]string
}

// Columns: the accepted required/optional names.
type Columns[K ~string] struct {
	Required []K
	Optional []K
}

// ReadCsvTableOptions: MaxRows 0 -> default 5000.
type ReadCsvTableOptions struct {
	MaxRows int
}

// ReadCsvTable mirrors readCsvTable.
func ReadCsvTable[K ~string](text string, columns Columns[K], what string, options ReadCsvTableOptions) ([]CsvRow[K], error) {
	table := ParseCsv(text)
	if len(table) == 0 {
		return nil, dataerr.Invalid(fmt.Sprintf("%s: the file is empty. It needs a header row.", what))
	}
	header := table[0]

	known := map[string]bool{}
	knownList := make([]string, 0, len(columns.Required)+len(columns.Optional))
	for _, k := range columns.Required {
		known[string(k)] = true
		knownList = append(knownList, string(k))
	}
	for _, k := range columns.Optional {
		known[string(k)] = true
		knownList = append(knownList, string(k))
	}

	names := make([]string, len(header))
	for i, h := range header {
		names[i] = strings.ToLower(strings.TrimSpace(h))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if !known[name] {
			short := name
			if len(short) > 40 {
				short = short[:40]
			}
			return nil, dataerr.Invalid(fmt.Sprintf("%s: the column %q is not one of %s.", what, short, strings.Join(knownList, ", ")))
		}
		if seen[name] {
			return nil, dataerr.Invalid(fmt.Sprintf("%s: the column %q appears twice.", what, name))
		}
		seen[name] = true
	}
	var missing []string
	for _, r := range columns.Required {
		if !seen[string(r)] {
			missing = append(missing, string(r))
		}
	}
	if len(missing) > 0 {
		return nil, dataerr.Invalid(fmt.Sprintf("%s: the header has no %s column.", what, strings.Join(missing, ", ")))
	}

	dataRows := table[1:]
	if len(dataRows) == 0 {
		return nil, dataerr.Invalid(fmt.Sprintf("%s: the file has a header but no rows.", what))
	}
	maxRows := options.MaxRows
	if maxRows == 0 {
		maxRows = 5000
	}
	if len(dataRows) > maxRows {
		return nil, dataerr.Invalid(fmt.Sprintf("%s: the file has %d rows; at most %d rows can be imported at once.", what, len(dataRows), maxRows))
	}

	out := make([]CsvRow[K], len(dataRows))
	for index, cells := range dataRows {
		row := index + 2
		if len(cells) != len(names) {
			cellWord := "cells"
			if len(cells) == 1 {
				cellWord = "cell"
			}
			return nil, dataerr.Invalid(fmt.Sprintf("%s: row %d has %d %s, the header has %d.", what, row, len(cells), cellWord, len(names)))
		}
		byName := make(map[K]string, len(knownList))
		for _, k := range columns.Required {
			byName[k] = ""
		}
		for _, k := range columns.Optional {
			byName[k] = ""
		}
		for pos, name := range names {
			byName[K(name)] = cells[pos]
		}
		out[index] = CsvRow[K]{Row: row, Cells: byName}
	}
	return out, nil
}
