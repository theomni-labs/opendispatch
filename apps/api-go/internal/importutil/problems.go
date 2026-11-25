// SPDX-License-Identifier: AGPL-3.0-only

package importutil

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

// RowProblem is one thing wrong with one row.
type RowProblem struct {
	Row int
	// Field: nil when not one column.
	Field   *string
	Message string
}

// RowProblems: an all-or-nothing import's problems.
type RowProblems struct {
	list []RowProblem
}

// Add mirrors RowProblems.add.
func (p *RowProblems) Add(row int, field *string, message string) {
	p.list = append(p.list, RowProblem{Row: row, Field: field, Message: message})
}

// Count mirrors the count getter.
func (p *RowProblems) Count() int { return len(p.list) }

// Refuse mirrors refuse (500-char budget).
func (p *RowProblems) Refuse(what string) error {
	if len(p.list) == 0 {
		return nil
	}
	problemWord := "problems"
	if len(p.list) == 1 {
		problemWord = "problem"
	}
	head := fmt.Sprintf("%s: %d %s, nothing was imported.", what, len(p.list), problemWord)
	budget := 500 - len(head) - 24
	used := 0
	var shown []string
	for _, problem := range p.list {
		field := ""
		if problem.Field != nil {
			field = fmt.Sprintf(" (%s)", *problem.Field)
		}
		text := fmt.Sprintf(" Row %d%s: %s", problem.Row, field, problem.Message)
		if used+len(text) > budget {
			break
		}
		shown = append(shown, text)
		used += len(text)
	}
	more := len(p.list) - len(shown)
	msg := head + strings.Join(shown, "")
	if more > 0 {
		msg += fmt.Sprintf(" And %d more.", more)
	}
	return dataerr.Invalid(msg)
}

var decimalPattern = regexp.MustCompile(`^-?\d+(\.\d+)?$`)
var wholeNumberPattern = regexp.MustCompile(`^\d+$`)

// DecimalOf mirrors decimalOf.
func DecimalOf(text string) *float64 {
	if !decimalPattern.MatchString(text) {
		return nil
	}
	v, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return nil
	}
	return &v
}

// WholeNumberOf mirrors wholeNumberOf.
func WholeNumberOf(text string) *int {
	if !wholeNumberPattern.MatchString(text) {
		return nil
	}
	v, err := strconv.Atoi(text)
	if err != nil {
		return nil
	}
	return &v
}
