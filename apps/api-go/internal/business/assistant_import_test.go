// SPDX-License-Identifier: AGPL-3.0-only

// Import help with a fake provider; no network.
package business

import (
	"context"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const helpJobID = "22222222-2222-4222-8222-222222222222"

func baseMapping(t *testing.T) ImportMapping {
	t.Helper()
	all, err := loadMappings()
	if err != nil || len(all) == 0 {
		t.Fatalf("mappings: %v", err)
	}
	for _, m := range all {
		if m.MappingID == "generic_csv_v1" {
			return m
		}
	}
	t.Fatal("generic_csv_v1 missing")
	return ImportMapping{}
}

// renamedHead: synthetic file, headers renamed.
func renamedHead(t *testing.T) importFileHead {
	header := []string{"Case Ref", "Case No", "Reg Time", "CityID", "ZoneID", "SubZoneID", "Lat", "Lng", "CaseTypeID", "Parties", "Driver Name", "Mobile", "Plate"}
	rows := [][]string{
		{"900001", "RD-260906-00017", "2026-09-06 01:05:07", "1", "11", "111", "24.7136", "46.6753", "3", "2", "Ahmed Test", "0551234567", "ABC 1234"},
		{"900002", "RD-260906-00018", "2026-09-06 01:09:44", "1", "12", "121", "21.4858", "39.1925", "1", "0", "Sara Test", "0559876543", "XYZ 9876"},
	}
	return importFileHead{Job: ImportJob{FileName: "synthetic_renamed.csv", MappingVersion: "generic_csv_v1"}, Mapping: baseMapping(t), Header: header, Rows: rows}
}

func useHead(t *testing.T, head importFileHead) {
	prev := readImportHead
	readImportHead = func(context.Context, *tenancy.Connection, reqctx.RequestContext, string) (importFileHead, error) {
		return head, nil
	}
	t.Cleanup(func() { readImportHead = prev })
}

const goodMapping = `{"columns":[
 {"source_column":"Case Ref","internal_field":"external_id","confidence":"high","reason":"unique whole numbers"},
 {"source_column":"Case No","internal_field":"case_number","confidence":"high","reason":"name says case number"},
 {"source_column":"Reg Time","internal_field":"registered_at","confidence":"high","reason":"date and time"},
 {"source_column":"Lat","internal_field":"latitude","confidence":"high","reason":"range 21 to 25"},
 {"source_column":"Lng","internal_field":"longitude","confidence":"high","reason":"range 39 to 47"},
 {"source_column":"Parties","internal_field":"parties_involved","confidence":"medium","reason":"small whole numbers"},
 {"source_column":"Driver Name","internal_field":null,"confidence":"low","reason":"no field fits"}]}`

func TestImportMappingSentIsScrubbed(t *testing.T) {
	head := renamedHead(t)
	facts := mappingFacts(head.Mapping, head.Header, head.Rows, matchHeader(head.Mapping, head.Header))
	sent := string(mustJSON(t, facts))
	for _, raw := range []string{"900001", "RD-260906", "Ahmed", "Sara", "0551234567", "ABC 1234", "24.7136", "46.6753", "2026-09-06"} {
		if strings.Contains(sent, raw) {
			t.Errorf("sent contains the value %q: %s", raw, sent)
		}
	}
	for _, want := range []string{`"name":"Lat"`, `"range":[21,25]`, `"range":[39,47]`, `"9999-99-99 99:99:99"`, `"samples_withheld":true`} {
		if !strings.Contains(sent, want) {
			t.Errorf("sent lacks %s: %s", want, sent)
		}
	}
	if strings.Contains(sent, `"name":"CityID"`) {
		t.Error("exact matches are not sent to the model")
	}
}

func TestValueShapeAndProfile(t *testing.T) {
	if got := valueShape("RD-12ab"); got != "AA-99aa" {
		t.Errorf("shape %q", got)
	}
	p := profileColumn("Severity", []string{"minor", "Severe", ""}, map[string]bool{"minor": true, "severe": true})
	if p.Type != "text" || strings.Join(p.Samples, ",") != "minor,Severe" || p.Filled != 2 {
		t.Errorf("allowed values pass as is: %+v", p)
	}
	p = profileColumn("Remarks", []string{"Hit a wall"}, nil)
	if strings.Join(p.Samples, ",") != "Aaa a aaaa" {
		t.Errorf("free text is a shape: %+v", p)
	}
	p = profileColumn("Claim", []string{"125000", "9800"}, nil)
	if p.Range != nil || p.Digits != 6 {
		t.Errorf("large numbers give digits only: %+v", p)
	}
}

func TestValidateMappingAnswer(t *testing.T) {
	head := renamedHead(t)
	h := matchHeader(head.Mapping, head.Header)
	if _, err := validateMappingAnswer(goodMapping, h); err != nil {
		t.Fatalf("good answer refused: %v", err)
	}
	bad := map[string]string{
		"unknown field":  `{"columns":[{"source_column":"Lat","internal_field":"patient_id","confidence":"high","reason":"x"}]}`,
		"field twice":    `{"columns":[{"source_column":"Lat","internal_field":"latitude","confidence":"high","reason":"x"},{"source_column":"Lng","internal_field":"latitude","confidence":"high","reason":"x"}]}`,
		"unknown column": `{"columns":[{"source_column":"Nope","internal_field":"latitude","confidence":"high","reason":"x"}]}`,
		"exact column":   `{"columns":[{"source_column":"CityID","internal_field":"city_id","confidence":"high","reason":"x"}]}`,
		"unknown key":    `{"columns":[],"apply":true}`,
		"entry key":      `{"columns":[{"source_column":"Lat","internal_field":"latitude","confidence":"high","reason":"x","save":true}]}`,
		"confidence":     `{"columns":[{"source_column":"Lat","internal_field":"latitude","confidence":"sure","reason":"x"}]}`,
		"not json":       `Lat is latitude`,
	}
	for name, text := range bad {
		if _, err := validateMappingAnswer(text, h); reasonOf(err) != dataerr.ReasonAssistantInvalid {
			t.Errorf("%s: want ASSISTANT_INVALID_OUTPUT, got %v", name, err)
		}
	}
}

func TestSuggestImportMapping(t *testing.T) {
	fp := &fakeProvider{replies: []assistant.Reply{textReply(`{"columns":[{"source_column":"Lat","internal_field":"nope","confidence":"high","reason":"x"}]}`), textReply(goodMapping)}}
	setupAssistant(t, fp)
	useHead(t, renamedHead(t))
	out, err := SuggestImportMappingWithAssistant(context.Background(), nil, asstCtx(access.RoleAdministrator), map[string]any{"import_id": helpJobID, "locale": "en"})
	if err != nil {
		t.Fatalf("suggest: %v", err)
	}
	if len(fp.seen) != 2 {
		t.Errorf("one retry after a refused answer, got %d calls", len(fp.seen))
	}
	byCol := map[string]AssistantMappingColumn{}
	for _, c := range out.Columns {
		byCol[c.SourceColumn] = c
	}
	if c := byCol["CityID"]; c.MatchedBy != "exact" || *c.InternalField != "city_id" {
		t.Errorf("exact match: %+v", c)
	}
	if c := byCol["Lat"]; c.MatchedBy != "assistant" || *c.InternalField != "latitude" {
		t.Errorf("Lat: %+v", c)
	}
	if c := byCol["Plate"]; c.InternalField != nil || c.Confidence != "low" {
		t.Errorf("unanswered column: %+v", c)
	}
	if len(out.MissingRequired) != 0 || !out.Suggestion || out.Sent == "" {
		t.Errorf("missing %v, meta %+v", out.MissingRequired, out.AssistantMeta)
	}
	if ev := eventsWith("assistant.import_mapping"); len(ev) != 1 || ev[0].Outcome != "success" {
		t.Errorf("audit: %+v", ev)
	}
}

func TestSuggestImportMappingRefusals(t *testing.T) {
	fp := &fakeProvider{replies: []assistant.Reply{textReply(`nonsense`)}, repeat: true}
	setupAssistant(t, fp)
	useHead(t, renamedHead(t))
	admin := asstCtx(access.RoleAdministrator)
	body := map[string]any{"import_id": helpJobID}
	if _, err := SuggestImportMappingWithAssistant(context.Background(), nil, admin, body); reasonOf(err) != dataerr.ReasonAssistantInvalid {
		t.Errorf("twice invalid: %v", err)
	}
	if ev := eventsWith("assistant.import_mapping"); len(ev) != 1 || ev[0].Outcome != "rejected" {
		t.Errorf("audit rejected: %+v", ev)
	}
	if _, err := SuggestImportMappingWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), body); ruleErrCode(err) != dataerr.CodeForbidden {
		t.Errorf("planner: %v", err)
	}
	head := renamedHead(t)
	head.Header = []string{"RecordID", "CaseNumber"}
	useHead(t, head)
	if _, err := SuggestImportMappingWithAssistant(context.Background(), nil, admin, body); ruleErrCode(err) != dataerr.CodeConflict {
		t.Errorf("matching header: %v", err)
	}
}

func TestCheckRenames(t *testing.T) {
	m := baseMapping(t)
	ok := []renamedColumn{{"Lat", "latitude"}, {"Lng", "longitude"}}
	if err := checkRenames(m, ok); err != nil {
		t.Errorf("good renames: %v", err)
	}
	for name, r := range map[string][]renamedColumn{
		"unknown field": {{"X", "patient"}},
		"field twice":   {{"A", "latitude"}, {"B", "latitude"}},
		"column twice":  {{"Lat", "latitude"}, {"Lat", "longitude"}},
		"clash":         {{"Longitude", "latitude"}},
	} {
		if err := checkRenames(m, r); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if _, err := parseMappingCreate(map[string]any{"version": "Bad Name", "base_version": "generic_csv_v1", "columns": []any{}}); err == nil {
		t.Error("bad version accepted")
	}
	c, err := parseMappingCreate(map[string]any{"version": "generic_csv_v2", "base_version": "generic_csv_v1", "assisted": true,
		"columns": []any{map[string]any{"source_column": " Lat ", "internal_field": "latitude"}}})
	if err != nil || c.Columns[0].SourceColumn != "Lat" || !c.Assisted {
		t.Errorf("parse: %+v %v", c, err)
	}
	d := deriveMapping(m, "generic_csv_v2", c.Columns)
	if d.MappingID != "generic_csv_v2" || m.Columns[9].DefaultColumn != "Latitude" {
		t.Error("derive must not change the base")
	}
}

func issue(t, sev, field string, row int, msg string) DataQualityIssue {
	i := DataQualityIssue{IssueType: t, Severity: sev, Message: msg}
	if field != "" {
		i.Field = &field
	}
	if row > 0 {
		i.RowNumber = &row
	}
	return i
}

func badRows() []DataQualityIssue {
	var out []DataQualityIssue
	for r := 12; r <= 40; r++ {
		out = append(out, issue("other", "warning", "Latitude", r, "Latitude 46.7, Longitude 24.7 is 2300 km from sub-zone 111 (North): swapped or empty coordinates? The case keeps them."))
	}
	out = append(out, issue("other", "warning", "Latitude", 0, "250 rows in all like row 12 (Latitude 46.7 ...) Only the first 100 are listed."))
	out = append(out, issue("unknown_reference", "error", "ZoneID", 402, "ZoneID 2099 is not in the locations or case types: add it in Admin, or correct the row."))
	out = append(out, issue("duplicate_external_id", "warning", "RecordID", 511, `RecordID 900001 is also on row 3; one row per RecordID is imported.`))
	return out
}

func TestIssueGroupsAndMasking(t *testing.T) {
	g := issueGroups(badRows())
	if len(g) != 3 || g[0].IssueType != "unknown_reference" {
		t.Fatalf("groups: %+v", g)
	}
	if g[1].Count != 250 || g[1].Rows != "12-40" {
		t.Errorf("capped group: %+v", g[1])
	}
	facts := string(mustJSON(t, issueFacts(ImportJob{RowCount: 640, ErrorCount: 1, WarningCount: 251, IssueCount: 252}, nil, g, "en")))
	if got := maskMessage(`RecordID SYN-BD-0 is also on row 3; Latitude 46.7, "x" ok.`); got != `RecordID # is also on row #; Latitude #, "…" ok.` {
		t.Errorf("mask: %q", got)
	}
	for _, raw := range []string{"2099", "900001", "46.7", "24.7", "2300"} {
		if strings.Contains(facts, raw) {
			t.Errorf("facts contain the value %q", raw)
		}
	}
	if rowRanges([]int{1, 2, 3, 5, 9, 10}) != "1-3, 5, 9-10" {
		t.Error("row ranges")
	}
}

func useIssues(t *testing.T, issues []DataQualityIssue) {
	prev := readImportIssues
	readImportIssues = func(context.Context, *tenancy.Connection, reqctx.RequestContext, string) (ImportJob, []DataQualityIssue, error) {
		return ImportJob{FileName: "bad.csv", MappingVersion: "generic_csv_v1", RowCount: 640, ErrorCount: 1, WarningCount: 251, IssueCount: 252}, issues, nil
	}
	t.Cleanup(func() { readImportIssues = prev })
}

const goodIssues = `{"summary":"The file has 1 error and 251 warnings. Rows 12-40 have Latitude far from their sub-zone: latitude and longitude may be swapped.",
"fixes":["Latitude, rows 12-40: check whether latitude and longitude are swapped.","ZoneID, row 402: use a known zone."],
"owner_note":"Please check rows 12-40 (coordinates) and row 402 (ZoneID).","cleaning_rules":["If latitude is above 33 and longitude below 33, flag the row as swapped."]}`

func TestExplainImportIssuesChecked(t *testing.T) {
	fp := &fakeProvider{replies: []assistant.Reply{textReply(goodIssues)}}
	setupAssistant(t, fp)
	useIssues(t, badRows())
	out, err := ExplainImportIssuesWithAssistant(context.Background(), nil, asstCtx(access.RoleAdministrator), map[string]any{"import_id": helpJobID, "locale": "ar"})
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	if out.Fallback || len(out.Fixes) != 2 || len(out.CleaningRules) != 1 || out.OwnerNote == "" {
		t.Errorf("answer: %+v", out)
	}
	if !strings.Contains(fp.seen[0].System, "Arabic") {
		t.Error("asked in Arabic")
	}
}

func TestExplainImportIssuesGuardFallback(t *testing.T) {
	fp := &fakeProvider{replies: []assistant.Reply{textReply(`{"summary":"About 300 rows are bad.","fixes":[],"owner_note":"x","cleaning_rules":[]}`)}, repeat: true}
	setupAssistant(t, fp)
	useIssues(t, badRows())
	out, err := ExplainImportIssuesWithAssistant(context.Background(), nil, asstCtx(access.RoleAdministrator), map[string]any{"import_id": helpJobID})
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	if !out.Fallback || len(fp.seen) != 2 || !strings.Contains(out.Text, "250") || strings.Contains(out.Text, "300") {
		t.Errorf("fallback: %+v", out)
	}
	ev := eventsWith("assistant.import_issues")
	if len(ev) != 1 || ev[0].Detail["answer_path"] != explainPathFallback {
		t.Errorf("audit: %+v", ev)
	}
	useIssues(t, nil)
	if _, err := ExplainImportIssuesWithAssistant(context.Background(), nil, asstCtx(access.RoleAdministrator), map[string]any{"import_id": helpJobID}); ruleErrCode(err) != dataerr.CodeConflict {
		t.Errorf("no issues: %v", err)
	}
	if _, err := ExplainImportIssuesWithAssistant(context.Background(), nil, asstCtx(access.RolePlanner), map[string]any{"import_id": helpJobID}); ruleErrCode(err) != dataerr.CodeForbidden {
		t.Errorf("planner: %v", err)
	}
}
