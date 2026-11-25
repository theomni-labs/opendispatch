// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors migration-header.ts exactly.
package tenancy

import (
	"fmt"
	"regexp"
	"strings"
)

// MigrationHeader mirrors migration-header.ts.
type MigrationHeader struct {
	NeedsDowntime             bool
	NonTransactional          bool
	RequiresRestoreToRollback bool
	Reason                    string // empty when absent
}

// MigrationHeaderError mirrors MigrationHeaderError.
type MigrationHeaderError struct {
	FileName string
	Msg      string
}

func (e *MigrationHeaderError) Error() string {
	return fmt.Sprintf("%s: %s", e.FileName, e.Msg)
}

var headerLine = regexp.MustCompile(`^--\s*([a-z_]+):\s*(.*)$`)

func readHeaderFields(content string) map[string]string {
	fields := map[string]string{}
	for _, rawLine := range strings.Split(content, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue // blank lines inside the header block are allowed
		}
		m := headerLine.FindStringSubmatch(line)
		if m == nil {
			break // the header ends at the first non-header line
		}
		fields[m[1]] = strings.TrimSpace(m[2])
	}
	return fields
}

func requireBoolean(fields map[string]string, key, fileName string) (bool, error) {
	raw, ok := fields[key]
	if !ok {
		return false, &MigrationHeaderError{fileName, fmt.Sprintf("missing required header field %q", key)}
	}
	switch raw {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, &MigrationHeaderError{fileName, fmt.Sprintf("header field %q must be \"true\" or \"false\", got %q", key, raw)}
	}
}

// ParseMigrationHeader mirrors the TS version.
func ParseMigrationHeader(content, fileName string) (MigrationHeader, error) {
	fields := readHeaderFields(content)
	needsDowntime, err := requireBoolean(fields, "needs_downtime", fileName)
	if err != nil {
		return MigrationHeader{}, err
	}
	nonTransactional, err := requireBoolean(fields, "non_transactional", fileName)
	if err != nil {
		return MigrationHeader{}, err
	}
	requiresRestore, err := requireBoolean(fields, "requires_restore_to_rollback", fileName)
	if err != nil {
		return MigrationHeader{}, err
	}
	reason := fields["reason"]
	if requiresRestore && reason == "" {
		return MigrationHeader{}, &MigrationHeaderError{fileName, "requires_restore_to_rollback is true but has no reason"}
	}
	return MigrationHeader{
		NeedsDowntime:             needsDowntime,
		NonTransactional:          nonTransactional,
		RequiresRestoreToRollback: requiresRestore,
		Reason:                    reason,
	}, nil
}
