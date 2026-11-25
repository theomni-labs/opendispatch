// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"fmt"
	"regexp"
	"strings"
)

// Shaping: headerless files, null words, keys.

var templateField = regexp.MustCompile(`\{([a-z_]+)\}`)

// headerless: the file has no header row.
func (m ImportMapping) headerless() bool {
	return m.Source.HeaderRow != nil && !*m.Source.HeaderRow
}

// needsShaping: rows go through shapedRows.
func (m ImportMapping) needsShaping() bool {
	if m.headerless() || len(m.Source.NullValues) > 0 {
		return true
	}
	for _, c := range m.Columns {
		if c.Compose != "" || c.IfEmpty != "" {
			return true
		}
	}
	return false
}

// checkShape: positions and templates are sound.
func (m ImportMapping) checkShape() error {
	seen := map[string]bool{}
	for _, c := range m.Columns {
		if m.headerless() && (c.Position == nil || *c.Position < 0) {
			return fmt.Errorf("mapping %s: %s needs a position (no header row)", m.MappingID, c.DefaultColumn)
		}
		if seen[c.DefaultColumn] {
			return fmt.Errorf("mapping %s: column %s is named twice", m.MappingID, c.DefaultColumn)
		}
		seen[c.DefaultColumn] = true
	}
	known := map[string]bool{}
	for _, c := range m.Columns {
		known[c.InternalField] = true
		for _, t := range []string{c.Compose, c.IfEmpty} {
			for _, f := range templateField.FindAllStringSubmatch(t, -1) {
				if !known[f[1]] {
					return fmt.Errorf("mapping %s: %s refers to %s, not an earlier field", m.MappingID, c.InternalField, f[1])
				}
			}
		}
	}
	return nil
}

// fillTemplate: "" when a part is empty.
func fillTemplate(t string, values map[string]string) string {
	empty := false
	out := templateField.ReplaceAllStringFunc(t, func(s string) string {
		v := values[s[1:len(s)-1]]
		empty = empty || v == ""
		return v
	})
	if empty {
		return ""
	}
	return out
}

// shapedRows: cells in the mapping's column order.
type shapedRows struct {
	inner   importRows
	mapping ImportMapping
	nulls   map[string]bool
	// at: source index per mapping column
	at []int
}

func newShapedRows(m ImportMapping, inner importRows) *shapedRows {
	s := &shapedRows{inner: inner, mapping: m, nulls: map[string]bool{}, at: make([]int, len(m.Columns))}
	for _, n := range m.Source.NullValues {
		s.nulls[n] = true
	}
	return s
}

// Header: the mapping's names; reads a real one.
func (s *shapedRows) Header() ([]string, error) {
	names := make([]string, 0, len(s.mapping.Columns))
	if s.mapping.headerless() {
		for i, c := range s.mapping.Columns {
			s.at[i] = *c.Position
			names = append(names, c.DefaultColumn)
		}
		return names, nil
	}
	header, err := s.inner.Header()
	if err != nil {
		return nil, err
	}
	index := map[string]int{}
	for i, h := range header {
		index[strings.TrimSpace(h)] = i
	}
	for i, c := range s.mapping.Columns {
		s.at[i] = -1
		if at, ok := index[c.DefaultColumn]; ok {
			s.at[i] = at
			names = append(names, c.DefaultColumn)
		} else {
			names = append(names, "")
		}
	}
	return names, nil
}

func (s *shapedRows) Next() (importRow, error) {
	r, err := s.inner.Next()
	if err != nil {
		return r, err
	}
	values := make(map[string]string, len(s.mapping.Columns))
	cells := make([]string, len(s.mapping.Columns))
	for i, c := range s.mapping.Columns {
		raw := ""
		if at := s.at[i]; at >= 0 && at < len(r.Cells) {
			raw = strings.TrimSpace(r.Cells[at])
		}
		if s.nulls[raw] {
			raw = ""
		}
		values[c.InternalField] = raw
		v := raw
		switch {
		case raw != "" && c.Compose != "":
			v = fillTemplate(c.Compose, values)
		case raw == "" && c.IfEmpty != "":
			v = fillTemplate(c.IfEmpty, values)
		}
		values[c.InternalField] = v
		cells[i] = v
	}
	return importRow{Line: r.Line, Cells: cells}, nil
}

func (s *shapedRows) Blank() (int, int) { return s.inner.Blank() }

// shapeRows wraps rows when the mapping needs it.
func shapeRows(m ImportMapping, rows importRows) (importRows, error) {
	if !m.needsShaping() {
		return rows, nil
	}
	if err := m.checkShape(); err != nil {
		return nil, err
	}
	return newShapedRows(m, rows), nil
}

var _ importRows = (*shapedRows)(nil)
