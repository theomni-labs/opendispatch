// SPDX-License-Identifier: AGPL-3.0-only

// Pure tests for cases.go's filter logic.
package business

import (
	"testing"
	"time"
)

func TestCaseWhere_RiyadhDayBoundsAndHandling(t *testing.T) {
	if where, args := caseWhere(CaseFilter{ZoneID: "z1", DateFrom: "bad"}); where != "" || args != nil {
		t.Fatalf("got %q %v, want no SQL filter", where, args)
	}
	where, args := caseWhere(CaseFilter{DateFrom: "2026-09-14", DateTo: "2026-09-14", Handling: "field"})
	if where != " WHERE registered_at >= $1 AND registered_at < $2 AND handling = $3" || len(args) != 3 {
		t.Fatalf("got %q %v", where, args)
	}
	from, to := args[0].(time.Time), args[1].(time.Time)
	if from.UTC().Format(time.RFC3339) != "2026-09-13T21:00:00Z" || to.Sub(from) != 24*time.Hour {
		t.Fatalf("bounds %v %v, want one Riyadh day", from, to)
	}
}

func TestMatchesCaseFilter_FieldsAllMustMatch(t *testing.T) {
	c := Case{ZoneID: "z1", SubZoneID: "sz1", CityID: "c1", DataSource: "SYNTHETIC", Handling: "field", CaseTypeID: "ct1", CaseNumber: "RD-1", ExternalID: "EXT-1", RegisteredAt: "2026-09-14T10:00:00+03:00"}
	if !matchesCaseFilter(c, CaseFilter{}) {
		t.Fatalf("got false, want true with no filter")
	}
	if matchesCaseFilter(c, CaseFilter{ZoneID: "other"}) {
		t.Fatalf("got true, want false: zone_id mismatch")
	}
	if !matchesCaseFilter(c, CaseFilter{ZoneID: "z1", Handling: "field", DataSource: "SYNTHETIC"}) {
		t.Fatalf("got false, want true: every given field matches")
	}
}

func TestMatchesCaseFilter_DateRange(t *testing.T) {
	c := Case{RegisteredAt: "2026-09-14T10:00:00+03:00"}
	if !matchesCaseFilter(c, CaseFilter{DateFrom: "2026-09-14", DateTo: "2026-09-14"}) {
		t.Fatalf("got false, want true: within range")
	}
	if matchesCaseFilter(c, CaseFilter{DateFrom: "2026-09-15"}) {
		t.Fatalf("got true, want false: before date_from")
	}
}

func TestMatchesCaseFilter_TextSearch(t *testing.T) {
	c := Case{CaseNumber: "RD-260914-001", ExternalID: "CUSTOMER-99"}
	if !matchesCaseFilter(c, CaseFilter{Q: "260914"}) {
		t.Fatalf("got false, want true: case_number match")
	}
	if !matchesCaseFilter(c, CaseFilter{Q: "customer-99"}) {
		t.Fatalf("got false, want true: external_id match, case-insensitive")
	}
	if matchesCaseFilter(c, CaseFilter{Q: "nope"}) {
		t.Fatalf("got true, want false: no match")
	}
}
