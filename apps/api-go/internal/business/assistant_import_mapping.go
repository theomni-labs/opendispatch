// SPDX-License-Identifier: AGPL-3.0-only

// Import help (1): a mapping suggestion, checked.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	// mappingSampleRows: rows read for samples
	mappingSampleRows = 20
	maxProfiledCols   = 200
	maxShapeRunes     = 20
	// smallNumber: ranges shown only below this
	smallNumber = 1000
)

// AssistantMappingColumn mirrors the contract type.
type AssistantMappingColumn struct {
	SourceColumn  string  `json:"source_column"`
	InternalField *string `json:"internal_field"`
	Confidence    string  `json:"confidence"`
	Reason        string  `json:"reason"`
	MatchedBy     string  `json:"matched_by"`
}

// AssistantMappingField mirrors the contract type.
type AssistantMappingField struct {
	InternalField string `json:"internal_field"`
	MappedColumn  string `json:"mapped_column"`
	Type          string `json:"type"`
	Required      bool   `json:"required"`
}

// AssistantMappingSuggestion: POST /assistant/import-mapping.
type AssistantMappingSuggestion struct {
	ImportID        string                   `json:"import_id"`
	BaseVersion     string                   `json:"base_version"`
	Columns         []AssistantMappingColumn `json:"columns"`
	Fields          []AssistantMappingField  `json:"fields"`
	MissingRequired []string                 `json:"missing_required"`
	Sent            string                   `json:"sent"`
	AssistantMeta
}

// personalColumn: names that may hold personal data.
var personalColumn = regexp.MustCompile(`(?i)(name|phone|mobile|tel|plate|national|iqama|mail|case|ref|vin|policy|driver|owner|customer|insured|address|id\b|id$|_id|no\b|num)`)

// columnProfile: what the model sees of a column.
type columnProfile struct {
	Name     string   `json:"name"`
	Type     string   `json:"type"`
	Filled   int      `json:"filled_of_sampled"`
	Sampled  int      `json:"sampled_rows"`
	Range    []int    `json:"range,omitempty"`
	Digits   int      `json:"digits,omitempty"`
	Samples  []string `json:"samples,omitempty"`
	Withheld bool     `json:"samples_withheld,omitempty"`
}

// valueShape: letters to a/A, digits to 9.
func valueShape(v string) string {
	var b strings.Builder
	n := 0
	for _, r := range v {
		if n >= maxShapeRunes {
			b.WriteString("…")
			break
		}
		switch {
		case unicode.IsDigit(r):
			b.WriteRune('9')
		case unicode.IsUpper(r):
			b.WriteRune('A')
		case unicode.IsLetter(r):
			b.WriteRune('a')
		default:
			b.WriteRune(r)
		}
		n++
	}
	return b.String()
}

// columnName: a header cell, masked and capped.
func columnName(h string) string {
	return truncateRunes(scrub(strings.TrimSpace(h)), maxSourceColumn)
}

// knownValues: the mapping's own allowed values.
func knownValues(m ImportMapping) map[string]bool {
	out := map[string]bool{}
	for _, c := range m.Columns {
		for _, v := range append(append([]string(nil), c.Values...), c.Allowed...) {
			out[strings.ToLower(v)] = true
		}
	}
	return out
}

// profileColumn: type and scrubbed samples only.
func profileColumn(name string, values []string, known map[string]bool) columnProfile {
	p := columnProfile{Name: columnName(name), Sampled: len(values)}
	var filled []string
	for _, v := range values {
		if v = strings.TrimSpace(v); v != "" {
			filled = append(filled, v)
		}
	}
	p.Filled = len(filled)
	if len(filled) == 0 {
		p.Type = "empty"
		return p
	}
	isInt, isNum, isTime := true, true, true
	lo, hi := math.Inf(1), math.Inf(-1)
	digits := 0
	for _, v := range filled {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			isInt, isNum = false, false
		} else {
			lo, hi = math.Min(lo, f), math.Max(hi, f)
			if _, err := strconv.ParseInt(v, 10, 64); err != nil {
				isInt = false
			}
			digits = max(digits, len(strings.TrimLeft(strings.SplitN(v, ".", 2)[0], "-+")))
		}
		if importToIso(v) == nil {
			isTime = false
		}
	}
	withheld := personalColumn.MatchString(name)
	switch {
	case isTime:
		p.Type = "datetime"
	case isInt:
		p.Type = "integer"
	case isNum:
		p.Type = "decimal"
	default:
		p.Type = "text"
	}
	if withheld {
		p.Withheld = true
		return p
	}
	switch p.Type {
	case "integer", "decimal":
		if math.Abs(lo) < smallNumber && math.Abs(hi) < smallNumber {
			p.Range = []int{int(math.Floor(lo)), int(math.Ceil(hi))}
		} else {
			p.Digits = digits
		}
	case "datetime":
		p.Samples = []string{valueShape(filled[0])}
	default:
		p.Samples = textSamples(filled, known)
	}
	return p
}

// textSamples: allowed values as is, else shapes.
func textSamples(filled []string, known map[string]bool) []string {
	allKnown := true
	for _, v := range filled {
		allKnown = allKnown && known[strings.ToLower(v)]
	}
	seen := map[string]bool{}
	var out []string
	for _, v := range filled {
		s := valueShape(v)
		if allKnown {
			s = v
		}
		if !seen[s] && len(out) < 3 {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// headerMatch: the file header against a mapping.
type headerMatch struct {
	Exact     map[string]string
	Unknown   []string
	Unmatched []MappingColumn
}

func matchHeader(m ImportMapping, header []string) headerMatch {
	h := headerMatch{Exact: map[string]string{}}
	byName := map[string]MappingColumn{}
	for _, c := range m.Columns {
		byName[c.DefaultColumn] = c
	}
	used := map[string]bool{}
	for _, raw := range header {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		if c, ok := byName[name]; ok && !used[c.InternalField] {
			h.Exact[name] = c.InternalField
			used[c.InternalField] = true
			continue
		}
		h.Unknown = append(h.Unknown, name)
	}
	for _, c := range m.Columns {
		if !used[c.InternalField] {
			h.Unmatched = append(h.Unmatched, c)
		}
	}
	return h
}

// mappingFacts: the summary the model sees.
func mappingFacts(m ImportMapping, header []string, rows [][]string, h headerMatch) map[string]any {
	known := knownValues(m)
	at := map[string]int{}
	for i, raw := range header {
		at[strings.TrimSpace(raw)] = i
	}
	cols := []columnProfile{}
	for _, name := range h.Unknown {
		if len(cols) >= maxProfiledCols {
			break
		}
		values := make([]string, 0, len(rows))
		for _, r := range rows {
			if i := at[name]; i < len(r) {
				values = append(values, r[i])
			}
		}
		cols = append(cols, profileColumn(name, values, known))
	}
	fields := []map[string]any{}
	for _, c := range h.Unmatched {
		f := map[string]any{"internal_field": c.InternalField, "usual_column": c.DefaultColumn, "type": c.Type, "required": c.Required}
		if len(c.Range) == 2 {
			f["range"] = c.Range
		}
		if v := append(append([]string(nil), c.Values...), c.Allowed...); len(v) > 0 {
			f["allowed"] = v
		}
		fields = append(fields, f)
	}
	return map[string]any{"mapping": m.MappingID, "file_columns": cols, "fields_without_a_column": fields}
}

const mappingSystem = "You match the columns of an uploaded accident case extract (CSV) to the internal fields of an import mapping, for OpenDispatch at Customer (Saudi Arabia). " +
	"You see only column names, a guessed type, the share of filled cells, whole-number ranges and value shapes (letters as a or A, digits as 9); some columns hide their samples. " +
	"Saudi latitudes are about 16 to 33 and longitudes about 34 to 56, so a range tells them apart. Datetime columns hold times; use the name to tell which time. " +
	"Use only the file columns and the internal fields given. Each internal field at most once. A column that fits no field gets null. " +
	"Answer with one JSON object and nothing else: {\"columns\":[{\"source_column\":\"<file column, exactly>\",\"internal_field\":\"<field>\" or null,\"confidence\":\"high\"|\"medium\"|\"low\",\"reason\":\"<at most 15 words>\"}]}, " +
	"one entry per file column. Write each reason in %s, never quoting a value."

// mappingInvalid: the refusal for a bad answer.
func mappingInvalid(format string, args ...any) error {
	return dataerr.Invalid("The assistant's mapping did not pass the mapping checks: " + fmt.Sprintf(format, args...)).WithReason(dataerr.ReasonAssistantInvalid)
}

var confidences = []string{"high", "medium", "low"}

// validateMappingAnswer: strict, like the rule draft.
func validateMappingAnswer(text string, h headerMatch) ([]AssistantMappingColumn, error) {
	obj, ok := extractJSON(text)
	if !ok {
		return nil, mappingInvalid("the answer was not one JSON object.")
	}
	for k := range obj {
		if k != "columns" {
			return nil, mappingInvalid("unknown key %q.", truncateRunes(k, 40))
		}
	}
	list, ok := obj["columns"].([]any)
	if !ok || len(list) > len(h.Unknown) {
		return nil, mappingInvalid("columns must be a list of at most %d entries.", len(h.Unknown))
	}
	fields := map[string]bool{}
	for _, c := range h.Unmatched {
		fields[c.InternalField] = true
	}
	cols := map[string]bool{}
	for _, c := range h.Unknown {
		cols[c] = true
	}
	seenCol, seenField := map[string]bool{}, map[string]bool{}
	out := []AssistantMappingColumn{}
	for _, item := range list {
		e, ok := item.(map[string]any)
		if !ok {
			return nil, mappingInvalid("each entry must be an object.")
		}
		for k := range e {
			if !stringInList(k, []string{"source_column", "internal_field", "confidence", "reason"}) {
				return nil, mappingInvalid("an entry has the unknown key %q.", truncateRunes(k, 40))
			}
		}
		src, _ := e["source_column"].(string)
		if !cols[src] {
			return nil, mappingInvalid("%q is not a column of the file.", truncateRunes(src, 80))
		}
		if seenCol[src] {
			return nil, mappingInvalid("%q is listed twice.", src)
		}
		seenCol[src] = true
		var field *string
		switch v := e["internal_field"].(type) {
		case nil:
		case string:
			if !fields[v] {
				return nil, mappingInvalid("%q is not a field without a column.", truncateRunes(v, 64))
			}
			if seenField[v] {
				return nil, mappingInvalid("%s is suggested for two columns.", v)
			}
			seenField[v] = true
			f := v
			field = &f
		default:
			return nil, mappingInvalid("internal_field must be text or null.")
		}
		conf, _ := e["confidence"].(string)
		if !stringInList(conf, confidences) {
			return nil, mappingInvalid("confidence must be high, medium or low.")
		}
		reason, _ := e["reason"].(string)
		reason = truncateRunes(strings.TrimSpace(scrub(plainText(reason))), 200)
		out = append(out, AssistantMappingColumn{SourceColumn: src, InternalField: field, Confidence: conf, Reason: reason, MatchedBy: "assistant"})
	}
	return out, nil
}

var mappingText = map[string][2]string{
	"exact":   {"Same name as the mapping", "الاسم نفسه في ربط الأعمدة"},
	"skipped": {"No suggestion", "لا اقتراح"},
}

// mergeSuggestion: exact matches, then the model's.
func mergeSuggestion(m ImportMapping, header []string, h headerMatch, suggested []AssistantMappingColumn, locale string) ([]AssistantMappingColumn, []string) {
	bySrc := map[string]AssistantMappingColumn{}
	for _, s := range suggested {
		bySrc[s.SourceColumn] = s
	}
	out := []AssistantMappingColumn{}
	mapped := map[string]bool{}
	for _, raw := range header {
		name := strings.TrimSpace(raw)
		if f, ok := h.Exact[name]; ok {
			field := f
			out = append(out, AssistantMappingColumn{SourceColumn: name, InternalField: &field, Confidence: "high", Reason: tr(mappingText["exact"], locale), MatchedBy: "exact"})
			mapped[f] = true
			continue
		}
		if name == "" {
			continue
		}
		s, ok := bySrc[name]
		if !ok {
			s = AssistantMappingColumn{SourceColumn: name, Confidence: "low", Reason: tr(mappingText["skipped"], locale), MatchedBy: "assistant"}
		}
		if s.InternalField != nil {
			mapped[*s.InternalField] = true
		}
		out = append(out, s)
	}
	missing := []string{}
	for _, c := range m.Columns {
		if c.Required && !mapped[c.InternalField] {
			missing = append(missing, c.InternalField)
		}
	}
	return out, missing
}

func mappingFields(m ImportMapping) []AssistantMappingField {
	out := make([]AssistantMappingField, 0, len(m.Columns))
	for _, c := range m.Columns {
		out = append(out, AssistantMappingField{InternalField: c.InternalField, MappedColumn: c.DefaultColumn, Type: c.Type, Required: c.Required})
	}
	return out
}

// importFileHead: a job's mapping, header and rows.
type importFileHead struct {
	Job     ImportJob
	Mapping ImportMapping
	Header  []string
	Rows    [][]string
}

// readImportHead: header and the first rows only.
var readImportHead = func(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (importFileHead, error) {
	job, err := importJobFor(ctx, conn, rc, id)
	if err != nil {
		return importFileHead{}, err
	}
	if job.StorageRef == nil {
		return importFileHead{}, dataerr.Invalid("This import has no stored file to read.")
	}
	mapping, err := mappingFor(ctx, conn, rc.CustomerID, job.MappingVersion)
	if err != nil {
		return importFileHead{}, err
	}
	if mapping == nil {
		return importFileHead{}, dataerr.NotFound("Mapping not found.")
	}
	rows, closeRows, err := openJobRows(ctx, rc, job, *mapping)
	if err != nil {
		return importFileHead{}, err
	}
	if rows == nil {
		return importFileHead{}, failMissingFile(ctx, conn, rc, job)
	}
	defer closeRows()
	header, err := rows.Header()
	if err != nil {
		return importFileHead{}, dataerr.Invalid("The file has no header row.")
	}
	head := importFileHead{Job: job, Mapping: *mapping, Header: append([]string(nil), header...)}
	for len(head.Rows) < mappingSampleRows {
		r, err := rows.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}
		head.Rows = append(head.Rows, r.Cells)
	}
	return head, nil
}

// SuggestImportMappingWithAssistant: a suggestion only.
func SuggestImportMappingWithAssistant(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (AssistantMappingSuggestion, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminDataImportQuality, access.AccessEdit); err != nil {
		_ = auditAssistant(rc, "assistant.import_mapping", "denied", "Mapping suggestion refused.", nil)
		return AssistantMappingSuggestion{}, err
	}
	o, err := datactx.Object(body, "Import help request", []string{"import_id", "locale"})
	if err != nil {
		return AssistantMappingSuggestion{}, err
	}
	id, _ := o["import_id"].(string)
	if _, err := importutil.RequireID(id, "Import job"); err != nil {
		return AssistantMappingSuggestion{}, err
	}
	locale := localeOf(o)
	head, err := readImportHead(ctx, conn, rc, id)
	if err != nil {
		return AssistantMappingSuggestion{}, err
	}
	h := matchHeader(head.Mapping, head.Header)
	if len(h.Unknown) == 0 {
		return AssistantMappingSuggestion{}, dataerr.Conflict(fmt.Sprintf("The file's header already matches mapping %s.", head.Mapping.MappingID))
	}
	p, err := activeProvider()
	if err != nil {
		return AssistantMappingSuggestion{}, err
	}
	facts := mappingFacts(head.Mapping, head.Header, head.Rows, h)
	sentBytes, err := json.Marshal(facts)
	if err != nil {
		return AssistantMappingSuggestion{}, err
	}
	sent := string(sentBytes)
	started := time.Now()
	req := assistant.Request{
		System:    fmt.Sprintf(mappingSystem, explainLanguage(locale)),
		Messages:  []assistant.Message{{Role: "user", Text: "Match these columns.\nFacts: " + sent}},
		MaxTokens: 2048,
	}
	detail := map[string]any{"import_id": id, "base_version": head.Mapping.MappingID, "locale": locale, "provider": p.Name(), "model": p.Model(),
		"sent_chars": len(sent), "unknown_columns": len(h.Unknown), "fields_without_column": len(h.Unmatched)}
	reply, callErr := p.Complete(ctx, req)
	if callErr != nil {
		return AssistantMappingSuggestion{}, failAssistant(rc, "assistant.import_mapping", "Mapping suggestion: the assistant did not answer.", p, started, detail, callErr)
	}
	suggested, verr := validateMappingAnswer(reply.Text, h)
	if verr != nil {
		detail["first_invalid"] = verr.Error()
		req.Messages = append(req.Messages, assistant.Message{Role: "assistant", Text: reply.Text},
			assistant.Message{Role: "user", Text: verr.Error() + " Answer again with the JSON object only."})
		again, againErr := p.Complete(ctx, req)
		if againErr != nil {
			return AssistantMappingSuggestion{}, failAssistant(rc, "assistant.import_mapping", "Mapping suggestion: the assistant did not answer.", p, started, detail, againErr)
		}
		suggested, verr = validateMappingAnswer(again.Text, h)
	}
	meta := metaOf(p, started)
	meta.DataSource = head.Job.DataSource
	detail["duration_ms"] = meta.DurationMs
	if verr != nil {
		detail["error"] = verr.Error()
		if aerr := auditAssistant(rc, "assistant.import_mapping", "rejected", "Mapping suggestion refused by the checks.", detail); aerr != nil {
			return AssistantMappingSuggestion{}, aerr
		}
		return AssistantMappingSuggestion{}, verr
	}
	cols, missing := mergeSuggestion(head.Mapping, head.Header, h, suggested, locale)
	n := 0
	for _, s := range suggested {
		if s.InternalField != nil {
			n++
		}
	}
	detail["suggested"], detail["missing_required"] = n, missing
	if aerr := auditAssistant(rc, "assistant.import_mapping", "success", fmt.Sprintf("Mapping suggested for import %s (%d columns).", head.Job.FileName, n), detail); aerr != nil {
		return AssistantMappingSuggestion{}, aerr
	}
	return AssistantMappingSuggestion{ImportID: id, BaseVersion: head.Mapping.MappingID, Columns: cols, Fields: mappingFields(head.Mapping),
		MissingRequired: missing, Sent: sent, AssistantMeta: meta}, nil
}

// failAssistant: audits a provider failure.
func failAssistant(rc reqctx.RequestContext, action, summary string, p assistant.Provider, started time.Time, detail map[string]any, callErr error) error {
	err := providerFailure(callErr)
	detail["duration_ms"], detail["error"] = metaOf(p, started).DurationMs, err.Error()
	if aerr := auditAssistant(rc, action, "failure", summary, detail); aerr != nil {
		return aerr
	}
	return err
}
