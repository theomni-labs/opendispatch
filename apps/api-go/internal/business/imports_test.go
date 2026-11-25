// SPDX-License-Identifier: AGPL-3.0-only

// Pure tests for validateFile/importToIso, against
// the real config/mappings/generic_csv_v1.json.
package business

import "testing"

func testMapping(t *testing.T) ImportMapping {
	t.Helper()
	mappings, err := loadMappings()
	check(t, err)
	for _, m := range mappings {
		if m.MappingID == "generic_csv_v1" {
			return m
		}
	}
	t.Fatal("generic_csv_v1 mapping not found")
	return ImportMapping{}
}

func testImportRefs() importReferences {
	return importReferences{
		Cities:    map[string]importReferenceRow{"CTY1": {ID: "c1", NameEn: "Riyadh"}},
		Zones:     map[string]importReferenceRow{"ZN1": {ID: "z1", NameEn: "Central"}},
		SubZones:  map[string]importReferenceRow{"SZ1": {ID: "sz1", NameEn: "Downtown"}},
		CaseTypes: map[string]importReferenceRow{"CT1": {ID: "ct1", NameEn: "Standard case"}},
	}
}

// A full, valid data row matching generic_csv_v1's
// header order exactly.
func validImportHeader() []string {
	return []string{
		"RecordID", "CaseNumber", "RegisteredTime", "CityID", "CityNameEn", "ZoneID", "ZoneNameEn",
		"SubZoneID", "SubZoneNameEn", "Latitude", "Longitude", "CaseTypeID", "CaseTypeNameEn",
		"PartyCount", "AssignedTime", "ArrivalTime", "ClosingTime",
	}
}

func validImportRow() []string {
	return []string{
		"EXT-1", "RD-260914-001", "2026-09-14T09:00:00+03:00", "CTY1", "Riyadh", "ZN1", "Central",
		"SZ1", "Downtown", "24.7", "46.7", "CT1", "Standard case",
		"2", "2026-09-14T09:05:00+03:00", "2026-09-14T09:20:00+03:00", "2026-09-14T09:40:00+03:00",
	}
}

func TestImportToIso_ParsesBothFormats(t *testing.T) {
	if importToIso("2026-09-14T09:00:00+03:00") == nil {
		t.Fatalf("got nil, want a parsed offset-format time")
	}
	if importToIso("2026-09-14 09:00:00") == nil {
		t.Fatalf("got nil, want a parsed space-format time")
	}
	if importToIso("2026-09-14 09:00") == nil {
		t.Fatalf("got nil, want a parsed space-format time with no seconds")
	}
	if importToIso("not a time") != nil {
		t.Fatalf("got non-nil, want nil for garbage input")
	}
}

func TestValidateFile_ValidRowProducesNoErrors(t *testing.T) {
	mapping := testMapping(t)
	table := [][]string{validImportHeader(), validImportRow()}
	result := validateFile(mapping, table, testImportRefs())
	if result.HeaderFailed {
		t.Fatalf("got header failed, want a clean pass")
	}
	for _, i := range result.Issues {
		if i.Severity == "error" {
			t.Fatalf("got error %+v, want no errors for a fully valid row", i)
		}
	}
	if result.DataRows != 1 || len(result.ErrorLines) != 0 {
		t.Fatalf("got %+v, want one row without errors", result)
	}
}

func TestValidateFile_MissingRequiredColumnFailsHeader(t *testing.T) {
	mapping := testMapping(t)
	header := validImportHeader()[1:] // drop RecordID
	table := [][]string{header, validImportRow()[1:]}
	result := validateFile(mapping, table, testImportRefs())
	if !result.HeaderFailed {
		t.Fatalf("got headerFailed=false, want true with a required column missing")
	}
	found := false
	for _, i := range result.Issues {
		if i.IssueType == "missing_required_field" && i.Severity == "error" {
			found = true
		}
	}
	if !found {
		t.Fatalf("got %+v, want a missing_required_field error", result.Issues)
	}
}

func TestValidateFile_UnknownReference(t *testing.T) {
	mapping := testMapping(t)
	row := validImportRow()
	row[3] = "UNKNOWN-CITY"
	table := [][]string{validImportHeader(), row}
	result := validateFile(mapping, table, testImportRefs())
	found := false
	for _, i := range result.Issues {
		if i.IssueType == "unknown_reference" && i.Severity == "error" {
			found = true
		}
	}
	if !found {
		t.Fatalf("got %+v, want an unknown_reference error", result.Issues)
	}
}

func TestValidateFile_DuplicateExternalId(t *testing.T) {
	mapping := testMapping(t)
	table := [][]string{validImportHeader(), validImportRow(), validImportRow()}
	result := validateFile(mapping, table, testImportRefs())
	found := false
	for _, i := range result.Issues {
		if i.IssueType == "duplicate_external_id" && i.Severity == "warning" {
			found = true
		}
	}
	if !found {
		t.Fatalf("got %+v, want a duplicate_external_id warning on the second row", result.Issues)
	}
}

func TestValidateFile_OutOfRangeCoordinate(t *testing.T) {
	mapping := testMapping(t)
	row := validImportRow()
	row[9] = "200" // latitude out of -90..90
	table := [][]string{validImportHeader(), row}
	result := validateFile(mapping, table, testImportRefs())
	found := false
	for _, i := range result.Issues {
		if i.IssueType == "out_of_range_coordinate" {
			found = true
		}
	}
	if !found {
		t.Fatalf("got %+v, want an out_of_range_coordinate error", result.Issues)
	}
}

func TestValidateFile_AssignedBeforeRegistered(t *testing.T) {
	mapping := testMapping(t)
	row := validImportRow()
	row[2] = "2026-09-14T09:10:00+03:00"  // registered
	row[14] = "2026-09-14T09:00:00+03:00" // assigned, before registered
	table := [][]string{validImportHeader(), row}
	result := validateFile(mapping, table, testImportRefs())
	found := false
	for _, i := range result.Issues {
		if i.IssueType == "assigned_before_registered" && i.Severity == "warning" {
			found = true
		}
	}
	if !found {
		t.Fatalf("got %+v, want an assigned_before_registered warning", result.Issues)
	}
}

func TestValidateFile_UnusualPartiesCount(t *testing.T) {
	mapping := testMapping(t)
	row := validImportRow()
	row[13] = "1"
	table := [][]string{validImportHeader(), row}
	result := validateFile(mapping, table, testImportRefs())
	found := false
	for _, i := range result.Issues {
		if i.IssueType == "unusual_parties_count" && i.Severity == "warning" {
			found = true
		}
	}
	if !found {
		t.Fatalf("got %+v, want an unusual_parties_count warning for 1 party", result.Issues)
	}
}

func TestValidateFile_InconsistentNameCase(t *testing.T) {
	mapping := testMapping(t)
	row := validImportRow()
	row[4] = "riyadh" // differs from the reference's "Riyadh" only in capitals
	table := [][]string{validImportHeader(), row}
	result := validateFile(mapping, table, testImportRefs())
	found := false
	for _, i := range result.Issues {
		if i.IssueType == "inconsistent_name_case" && i.Severity == "info" {
			found = true
		}
	}
	if !found {
		t.Fatalf("got %+v, want an inconsistent_name_case info", result.Issues)
	}
}

func TestValidateFile_NoDataRowsFailsHeader(t *testing.T) {
	mapping := testMapping(t)
	table := [][]string{validImportHeader()}
	result := validateFile(mapping, table, testImportRefs())
	if !result.HeaderFailed {
		t.Fatalf("got headerFailed=false, want true with no data rows")
	}
}
