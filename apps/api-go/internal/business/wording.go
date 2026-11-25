// SPDX-License-Identifier: AGPL-3.0-only

// Customer short name in server-made text.
package business

import (
	"os"
	"strings"
)

// The default when the install names no operator.
const (
	defaultCustomerShortEn = "operator"
	defaultCustomerShortAr = "المشغّل"
)

// customerShortNames: env, Arabic falls back to English.
func customerShortNames() (string, string) {
	en := strings.TrimSpace(os.Getenv("OPENDISPATCH_CUSTOMER_SHORT_NAME"))
	ar := strings.TrimSpace(os.Getenv("OPENDISPATCH_CUSTOMER_SHORT_NAME_AR"))
	if en == "" {
		en = defaultCustomerShortEn
		if ar == "" {
			ar = defaultCustomerShortAr
		}
	}
	if ar == "" {
		ar = en
	}
	return en, ar
}

// customerEn: the English short name.
func customerEn() string {
	en, _ := customerShortNames()
	return en
}

// customerEnTitle: the English short name at the start of a sentence.
func customerEnTitle() string {
	en := customerEn()
	if en == "" {
		return en
	}
	return strings.ToUpper(en[:1]) + en[1:]
}

// customerAr: the Arabic short name.
func customerAr() string {
	_, ar := customerShortNames()
	return ar
}

// mappingName: generic_csv_v1 is "<name> case extract v1".
func mappingName(id string) string {
	version := id
	if at := strings.LastIndex(id, "_"); at >= 0 && strings.HasPrefix(id[at+1:], "v") {
		version = id[at+1:]
	}
	return customerEnTitle() + " case extract " + version
}
