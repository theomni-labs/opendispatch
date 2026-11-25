// SPDX-License-Identifier: AGPL-3.0-only

// Splits SQL; mirrors sql-split.ts exactly.
package tenancy

import (
	"regexp"
	"strings"
)

var dollarTag = regexp.MustCompile(`^\$([a-zA-Z_][a-zA-Z0-9_]*)?\$`)

// SplitStatements mirrors sql-split.ts.
func SplitStatements(sqlText string) []string {
	r := []rune(sqlText)
	n := len(r)
	statements := make([]string, 0)
	var current strings.Builder

	push := func() {
		trimmed := strings.TrimSpace(current.String())
		if trimmed != "" {
			statements = append(statements, trimmed)
		}
		current.Reset()
	}

	i := 0
	for i < n {
		c := r[i]
		var next rune
		if i+1 < n {
			next = r[i+1]
		}

		if c == '-' && next == '-' {
			end := indexOfRune(r, '\n', i)
			if end == -1 {
				i = n
			} else {
				i = end + 1
			}
			continue
		}
		if c == '/' && next == '*' {
			end := indexOfString(r, "*/", i+2)
			if end == -1 {
				i = n
			} else {
				i = end + 2
			}
			continue
		}
		if c == '\'' || c == '"' {
			quote := c
			start := i
			i++
			for i < n {
				if r[i] == quote && i+1 < n && r[i+1] == quote {
					i += 2
					continue
				}
				if r[i] == quote {
					i++
					break
				}
				i++
			}
			current.WriteString(string(r[start:i]))
			continue
		}
		if c == '$' {
			loc := dollarTag.FindStringIndex(string(r[i:]))
			if loc != nil {
				tag := string(r[i:])[loc[0]:loc[1]]
				closeIndex := indexOfString(r, tag, i+len([]rune(tag)))
				var end int
				if closeIndex == -1 {
					end = n
				} else {
					end = closeIndex + len([]rune(tag))
				}
				current.WriteString(string(r[i:end]))
				i = end
				continue
			}
		}
		if c == ';' {
			push()
			i++
			continue
		}
		current.WriteRune(c)
		i++
	}
	push()
	return statements
}

func indexOfRune(r []rune, target rune, from int) int {
	for i := from; i < len(r); i++ {
		if r[i] == target {
			return i
		}
	}
	return -1
}

func indexOfString(r []rune, target string, from int) int {
	t := []rune(target)
	if len(t) == 0 {
		return from
	}
	for i := from; i+len(t) <= len(r); i++ {
		match := true
		for j := range t {
			if r[i+j] != t[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}
