// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"strings"
	"testing"
)

func mappingNamed(t *testing.T, id string) ImportMapping {
	t.Helper()
	mappings, err := loadMappings()
	check(t, err)
	for _, m := range mappings {
		if m.MappingID == id {
			return m
		}
	}
	t.Fatalf("%s mapping not found", id)
	return ImportMapping{}
}

// headerlessMapping: generic_csv_v1 read by position, for a made-up
// export without a header row. Keys are composed from the city, empty
// zones and sub-zones get a default key, and NULL means empty.
func headerlessMapping(t *testing.T) ImportMapping {
	t.Helper()
	m := mappingNamed(t, "generic_csv_v1")
	m.MappingID = "headerless_test"
	no := false
	m.Source.HeaderRow = &no
	m.Source.NullValues = []string{"NULL"}
	positions := map[string]int{
		"external_id": 0, "case_number": 1, "registered_at": 3, "city_id": 4, "cities.name_en": 13,
		"zone_id": 5, "zones.name_en": 16, "sub_zone_id": 6, "sub_zones.name_en": 19,
		"latitude": 7, "longitude": 8, "case_type_id": 9, "case_types.name_en": 21,
		"parties_involved": 10, "assigned_at": 11,
	}
	var cols []MappingColumn
	for _, c := range m.Columns {
		at, ok := positions[c.InternalField]
		if !ok {
			continue
		}
		c.Position = &at
		switch c.InternalField {
		case "zone_id":
			c.Compose, c.IfEmpty = "{city_id}-{zone_id}", "{city_id}-nozone"
		case "sub_zone_id":
			c.Compose, c.IfEmpty = "{zone_id}-{sub_zone_id}", "{zone_id}-unassigned"
		case "latitude", "longitude":
			c.Required = false
		}
		cols = append(cols, c)
	}
	if len(cols) != len(positions) {
		t.Fatalf("generic_csv_v1 lacks a field the test places: %d of %d", len(cols), len(positions))
	}
	m.Columns = cols
	return m
}

// v2Line: a made-up row in the headerless layout.
func v2Line(id, zone, sub, lat, assigned string) string {
	cells := []string{id, "RD" + id, "RD", "2026-09-14 09:00:05.123", "7", zone, sub, lat, "46.7", "1", "2", assigned,
		"7", "Riyadh", zone, "7", "Zone A", sub, zone, "Sub A", "1", "Standard case"}
	return strings.Join(cells, ",") + "\r\n"
}

func v2Refs() importReferences {
	return importReferences{
		Cities:    map[string]importReferenceRow{"7": {ID: "c7", NameEn: "Riyadh"}},
		Zones:     map[string]importReferenceRow{"7-3": {ID: "z3", NameEn: "Zone A"}, "7-nozone": {ID: "zn", NameEn: "No zone"}},
		SubZones:  map[string]importReferenceRow{"7-3-41": {ID: "s41", NameEn: "Sub A"}, "7-3-unassigned": {ID: "su", NameEn: "Unassigned"}, "7-nozone-unassigned": {ID: "snu", NameEn: "Unassigned"}},
		CaseTypes: map[string]importReferenceRow{"1": {ID: "ct1", NameEn: "Standard case"}},
	}
}

func TestShapedRows_HeaderlessKeysNullsAndPositions(t *testing.T) {
	m := headerlessMapping(t)
	if !m.headerless() {
		t.Fatal("the test mapping must be headerless")
	}
	text := v2Line("101", "3", "41", "24.7", "2026-09-14 09:04:00") + v2Line("102", "3", "NULL", "NULL", "NULL") + v2Line("103", "NULL", "NULL", "24.7", "2026-09-14 09:04:00")
	rows, err := shapeRows(m, newCsvRows(strings.NewReader(text)))
	check(t, err)
	header, err := rows.Header()
	check(t, err)
	col := map[string]int{}
	for i, h := range header {
		col[m.Columns[i].InternalField] = i
		if h != m.Columns[i].DefaultColumn {
			t.Fatalf("header %d is %q, want %q", i, h, m.Columns[i].DefaultColumn)
		}
	}
	want := []struct {
		line           int
		zone, sub, lat string
		assigned       string
	}{
		{1, "7-3", "7-3-41", "24.7", "2026-09-14 09:04:00"},
		{2, "7-3", "7-3-unassigned", "", ""},
		{3, "7-nozone", "7-nozone-unassigned", "24.7", "2026-09-14 09:04:00"},
	}
	for _, w := range want {
		r, err := rows.Next()
		check(t, err)
		got := func(f string) string { return r.Cells[col[f]] }
		if r.Line != w.line || got("zone_id") != w.zone || got("sub_zone_id") != w.sub || got("latitude") != w.lat || got("assigned_at") != w.assigned {
			t.Fatalf("line %d: zone %q sub %q lat %q assigned %q; want %+v", r.Line, got("zone_id"), got("sub_zone_id"), got("latitude"), got("assigned_at"), w)
		}
		if got("city_id") != "7" || got("registered_at") != "2026-09-14 09:00:05.123" || got("parties_involved") != "2" {
			t.Fatalf("line %d: positions read the wrong columns: %v", r.Line, r.Cells)
		}
	}
}

func TestValidateRows_HeaderlessFileValidatesEveryLine(t *testing.T) {
	m := headerlessMapping(t)
	text := v2Line("101", "3", "41", "24.7", "2026-09-14 09:04:00") + v2Line("102", "3", "NULL", "NULL", "NULL") +
		v2Line("103", "NULL", "NULL", "24.7", "2026-09-14 09:04:00") + v2Line("104", "9", "41", "24.7", "NULL")
	rows, err := shapeRows(m, newCsvRows(strings.NewReader(text)))
	check(t, err)
	res, err := validateRows(m, rows, v2Refs())
	check(t, err)
	if res.HeaderFailed || res.DataRows != 4 {
		t.Fatalf("header failed %t, %d rows; want 4 rows from line 1", res.HeaderFailed, res.DataRows)
	}
	if res.Errors != 2 || len(res.ErrorLines) != 1 || res.ErrorLines[0] != 4 {
		t.Fatalf("errors %d on lines %v; want unknown zone and sub-zone on line 4 only (issues %+v)", res.Errors, res.ErrorLines, res.Issues)
	}
	for _, i := range issuesOfType(res, "missing_required_field") {
		t.Fatalf("an empty optional or defaulted value was reported missing: %+v", i)
	}
}

func TestRowCase_HeaderlessEmptyAssignedIsRemoteInferred(t *testing.T) {
	m := headerlessMapping(t)
	rows, err := shapeRows(m, newCsvRows(strings.NewReader(v2Line("102", "3", "NULL", "NULL", "NULL"))))
	check(t, err)
	header, _ := rows.Header()
	r, err := rows.Next()
	check(t, err)
	at := map[string]int{}
	for i, h := range header {
		at[m.Columns[i].InternalField] = i
		_ = h
	}
	c := rowCase(func(f string) string {
		if i, ok := at[f]; ok {
			return r.Cells[i]
		}
		return ""
	}, v2Refs(), "IMPORTED")
	if c == nil || c.handling != "remote_inferred" || c.subZoneID != "su" || c.zoneID != "z3" || c.dataSource != "IMPORTED" {
		t.Fatalf("got %+v; want remote_inferred in the unassigned sub-zone, IMPORTED", c)
	}
}

func TestShapedRows_HeaderModeReadsNullWord(t *testing.T) {
	m := testMapping(t)
	m.Source.NullValues = []string{"NULL"}
	row := validImportRow()
	row[14] = "NULL"
	rows, err := shapeRows(m, newCsvRows(strings.NewReader(csvOf(validImportHeader(), row))))
	check(t, err)
	res, err := validateRows(m, rows, testImportRefs())
	check(t, err)
	if res.HeaderFailed || res.Errors != 0 || res.DataRows != 1 {
		t.Fatalf("got %+v; want one clean row", res)
	}
}

func TestCheckShape_RefusesBadMappings(t *testing.T) {
	no := false
	pos := 0
	bad := []ImportMapping{
		{MappingID: "nopos", Columns: []MappingColumn{{DefaultColumn: "A", InternalField: "external_id"}}},
		{MappingID: "forward", Columns: []MappingColumn{{DefaultColumn: "A", InternalField: "zone_id", Position: &pos, Compose: "{city_id}-{zone_id}"}, {DefaultColumn: "B", InternalField: "city_id", Position: &pos}}},
		{MappingID: "twice", Columns: []MappingColumn{{DefaultColumn: "A", InternalField: "zone_id", Position: &pos}, {DefaultColumn: "A", InternalField: "city_id", Position: &pos}}},
	}
	for _, m := range bad {
		m.Source.HeaderRow = &no
		if m.checkShape() == nil {
			t.Errorf("%s: accepted, want refused", m.MappingID)
		}
	}
	if fillTemplate("{a}-{b}", map[string]string{"a": "1"}) != "" {
		t.Error("a template with an empty part must give empty")
	}
}

// One unnest per chunk: no per-row lookup.
func TestApplyCTE_CarriesExtraInTheSameUnnest(t *testing.T) {
	if !strings.Contains(applyCTE, "$22::jsonb[]") || !strings.Contains(applyCTE, "extra_in") {
		t.Fatal("applyCTE must unnest the extra column with the rows")
	}
}
