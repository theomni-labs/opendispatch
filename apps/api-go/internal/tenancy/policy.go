// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors policy.ts; for parity-checking only.
package tenancy

import (
	"fmt"
	"regexp"
	"strings"
)

var identifierPattern = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)

// InvalidIdentifierError mirrors policy.ts.
type InvalidIdentifierError struct {
	Identifier string
}

func (e *InvalidIdentifierError) Error() string {
	return fmt.Sprintf("%q is not a safe SQL identifier (lowercase, digits, underscore, not starting with a digit).", e.Identifier)
}

func quoteIdent(identifier string) (string, error) {
	if !identifierPattern.MatchString(identifier) {
		return "", &InvalidIdentifierError{identifier}
	}
	return `"` + identifier + `"`, nil
}

// Splits a bare or schema-qualified identifier part.
func quoteQualifiedIdent(table string) (string, error) {
	parts := strings.Split(table, ".")
	quoted := make([]string, len(parts))
	for i, p := range parts {
		q, err := quoteIdent(p)
		if err != nil {
			return "", err
		}
		quoted[i] = q
	}
	return strings.Join(quoted, "."), nil
}

// TenantIsolationSQL mirrors policy.ts's helper.
func TenantIsolationSQL(table string) (string, error) {
	ident, err := quoteQualifiedIdent(table)
	if err != nil {
		return "", err
	}
	check := `tenant_id = current_setting('app.tenant_id')::uuid`
	return strings.Join([]string{
		fmt.Sprintf("ALTER TABLE %s ENABLE ROW LEVEL SECURITY;", ident),
		fmt.Sprintf("ALTER TABLE %s FORCE ROW LEVEL SECURITY;", ident),
		fmt.Sprintf("CREATE POLICY tenant_isolation ON %s USING (%s) WITH CHECK (%s);", ident, check, check),
	}, "\n"), nil
}
