// SPDX-License-Identifier: AGPL-3.0-only

// Assistant answers as plain text, never Markdown.
package business

import (
	"regexp"
	"strings"
)

// plainRule: instruction added to every free-text prompt.
const plainRule = "Write plain text only, never Markdown: no asterisks or underscores for emphasis, no # headings, no tables, no code. " +
	"For a list, put each item on its own line starting with \"- \"."

var (
	mdHeading   = regexp.MustCompile(`^#{1,6}\s+`)
	mdBullet    = regexp.MustCompile(`^(\s*)[*+•]\s+`)
	mdTableRule = regexp.MustCompile(`^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$`)
	mdQuote     = regexp.MustCompile(`^>\s?`)
	mdStrong    = regexp.MustCompile(`(\*\*|__)(.+?)(\*\*|__)`)
	mdEmphasis  = regexp.MustCompile(`(^|[^\w*])\*([^*\n]+?)\*`)
	mdBlankRuns = regexp.MustCompile(`\n{3,}`)
)

// plainText: strips Markdown from a model answer.
func plainText(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	lines := strings.Split(s, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		t := strings.TrimRight(line, " \t")
		if strings.HasPrefix(strings.TrimSpace(t), "```") || mdTableRule.MatchString(t) && strings.Contains(t, "-") {
			continue
		}
		t = mdHeading.ReplaceAllString(strings.TrimLeft(t, " "), "")
		t = mdQuote.ReplaceAllString(t, "")
		t = mdBullet.ReplaceAllString(t, "- ")
		if strings.HasPrefix(t, "|") && strings.HasSuffix(t, "|") {
			cells := strings.Split(strings.Trim(t, "|"), "|")
			for i := range cells {
				cells[i] = strings.TrimSpace(cells[i])
			}
			t = strings.Join(cells, ", ")
		}
		t = mdStrong.ReplaceAllString(t, "$2")
		t = mdEmphasis.ReplaceAllString(t, "$1$2")
		t = strings.ReplaceAll(t, "**", "")
		t = strings.ReplaceAll(t, "`", "")
		out = append(out, t)
	}
	return strings.TrimSpace(mdBlankRuns.ReplaceAllString(strings.Join(out, "\n"), "\n\n"))
}
