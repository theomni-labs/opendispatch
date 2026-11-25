// SPDX-License-Identifier: AGPL-3.0-only

package importutil

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var codePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`)

// reservedNames: every object's inherited names.
var reservedNames = map[string]bool{
	"__proto__": true, "constructor": true, "prototype": true,
	"tostring": true, "valueof": true, "hasownproperty": true,
	"isprototypeof": true, "propertyisenumerable": true,
	"tolocalestring": true, "undefined": true, "null": true, "nan": true,
}

// IsID mirrors isId.
func IsID(value any) bool {
	s, ok := value.(string)
	return ok && uuidPattern.MatchString(s)
}

// RequireID mirrors requireId; never echoes it.
func RequireID(id any, what string) (string, error) {
	if !IsID(id) {
		return "", dataerr.Invalid(fmt.Sprintf("%s: the id must be a UUID.", what))
	}
	return id.(string), nil
}

// RequireCode mirrors requireCode.
func RequireCode(code any, what string) (string, error) {
	s, ok := code.(string)
	if !ok || !codePattern.MatchString(s) || reservedNames[strings.ToLower(s)] {
		return "", dataerr.Invalid(fmt.Sprintf("%s: the code is not valid.", what))
	}
	return s, nil
}
