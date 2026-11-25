// SPDX-License-Identifier: AGPL-3.0-only

package business

import "testing"

func TestCustomerShortNamesDefault(t *testing.T) {
	t.Setenv("OPENDISPATCH_CUSTOMER_SHORT_NAME", "")
	t.Setenv("OPENDISPATCH_CUSTOMER_SHORT_NAME_AR", "")
	if en, ar := customerShortNames(); en != "operator" || ar != "المشغّل" {
		t.Fatalf("default: got %q %q", en, ar)
	}
	if got := mappingName("generic_csv_v1"); got != "Operator case extract v1" {
		t.Fatalf("mapping name: got %q", got)
	}
}

func TestCustomerShortNamesNeutral(t *testing.T) {
	t.Setenv("OPENDISPATCH_CUSTOMER_SHORT_NAME", "Operator")
	t.Setenv("OPENDISPATCH_CUSTOMER_SHORT_NAME_AR", "المشغّل")
	if en, ar := customerShortNames(); en != "Operator" || ar != "المشغّل" {
		t.Fatalf("neutral: got %q %q", en, ar)
	}
	if got := mappingName("generic_csv_v1"); got != "Operator case extract v1" {
		t.Fatalf("mapping name: got %q", got)
	}
}

func TestCustomerShortNamesArabicFallsBack(t *testing.T) {
	t.Setenv("OPENDISPATCH_CUSTOMER_SHORT_NAME", "Operator")
	t.Setenv("OPENDISPATCH_CUSTOMER_SHORT_NAME_AR", "")
	if ar := customerAr(); ar != "Operator" {
		t.Fatalf("arabic fallback: got %q", ar)
	}
}
