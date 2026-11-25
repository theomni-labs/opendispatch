// SPDX-License-Identifier: AGPL-3.0-only

package importutil

import (
	"errors"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

const testUUID = "3fa89d67-3189-4d62-bed3-2916a8c19b72"

func TestRequireIDReturnsUUIDUnchanged(t *testing.T) {
	if got, err := RequireID(testUUID, "City"); err != nil || got != testUUID {
		t.Fatalf("RequireID(lower) = %q, %v", got, err)
	}
	upper := strings.ToUpper(testUUID)
	if got, err := RequireID(upper, "City"); err != nil || got != upper {
		t.Fatalf("RequireID(upper) = %q, %v", got, err)
	}
	if !IsID(testUUID) {
		t.Fatalf("IsID(testUUID) = false")
	}
}

func TestRequireIDRefusesBadStrings(t *testing.T) {
	bad := []string{
		"toString", "__proto__", "constructor", "prototype", "hasOwnProperty", "valueOf",
		"", " ", "not-a-uuid", testUUID + " ", " " + testUUID, testUUID + "\n", testUUID + "0",
		strings.ReplaceAll(testUUID, "-", ""), "../../etc/passwd", strings.Repeat("a", 10000),
	}
	for _, id := range bad {
		_, err := RequireID(id, "City")
		if err == nil {
			t.Errorf("id %q: expected an error", id)
			continue
		}
		var de *dataerr.DataError
		if !errors.As(err, &de) {
			t.Errorf("id %q: error is not a *dataerr.DataError", id)
			continue
		}
		if de.Code != dataerr.CodeInvalid {
			t.Errorf("id %q: code = %q, want invalid", id, de.Code)
		}
		if de.Message != "City: the id must be a UUID." {
			t.Errorf("id %q: message = %q", id, de.Message)
		}
		if IsID(id) {
			t.Errorf("id %q: IsID = true", id)
		}
	}
}

func TestRequireIDRefusesNonStrings(t *testing.T) {
	bad := []any{123, 0, nil, map[string]any{}, []any{}, []any{testUUID}, true}
	for _, id := range bad {
		if _, err := RequireID(id, "Roster"); err == nil {
			t.Errorf("value %#v: expected an error", id)
		}
	}
}

func TestRequireCodeAccepts(t *testing.T) {
	good := []string{"RULE-001", "RULE-003A", "a", "abc_1.2:3-4", strings.Repeat("A", 128)}
	for _, code := range good {
		if got, err := RequireCode(code, "Rule"); err != nil || got != code {
			t.Errorf("RequireCode(%q) = %q, %v", code, got, err)
		}
	}
}

func TestRequireCodeRefuses(t *testing.T) {
	bad := []any{
		"", "-x", "_x", "__proto__", "constructor", "Constructor", "prototype",
		"toString", "valueOf", "hasOwnProperty", "undefined", "a b", "a/b",
		strings.Repeat("A", 129), 5, nil, map[string]any{},
	}
	for _, code := range bad {
		if _, err := RequireCode(code, "Rule"); err == nil {
			t.Errorf("code %#v: expected an error", code)
		}
	}
}
