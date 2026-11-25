// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"bufio"
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// maxListedPerKind: listed per type and field.
const maxListedPerKind = 100

// farFromSubZoneKm: a point this far is suspect.
const farFromSubZoneKm = 100

// Outlier rules; cases are kept.
const (
	maxArrivalHours  = 24
	maxClosingDays   = 30
	dayOutlierFactor = 3.0
	minOutlierDays   = 7
	minMedianPerDay  = 10
)

var caseNumberPattern = regexp.MustCompile(`^[A-Z]{2}[A-Za-z0-9-]+$`)

// importRow: one data row and its file line.
type importRow struct {
	Line  int
	Cells []string
}

// importRows yields the rows of an uploaded file.
type importRows interface {
	Header() ([]string, error)
	// Next returns io.EOF after the last row.
	Next() (importRow, error)
	// Blank: empty lines skipped, and the first.
	Blank() (int, int)
}

// csvRows streams a CSV file (BOM, CRLF, quotes).
type csvRows struct {
	r                *csv.Reader
	prevEnd          int
	blank, firstBlnk int
}

func newCsvRows(src io.Reader) *csvRows {
	br := bufio.NewReaderSize(src, 1<<20)
	if b, err := br.Peek(3); err == nil && bytes.Equal(b, []byte("\xef\xbb\xbf")) {
		_, _ = br.Discard(3)
	}
	r := csv.NewReader(br)
	r.FieldsPerRecord, r.LazyQuotes, r.ReuseRecord = -1, true, true
	return &csvRows{r: r}
}

func hasContent(cells []string) bool {
	for _, c := range cells {
		if strings.TrimSpace(c) != "" {
			return true
		}
	}
	return false
}

func (c *csvRows) noteGap(line int) {
	if gap := line - c.prevEnd - 1; gap > 0 {
		if c.blank == 0 {
			c.firstBlnk = c.prevEnd + 1
		}
		c.blank += gap
	}
}

func (c *csvRows) Next() (importRow, error) {
	for {
		rec, err := c.r.Read()
		if err != nil {
			var pe *csv.ParseError
			if errors.As(err, &pe) {
				c.noteGap(pe.StartLine)
				c.prevEnd = pe.Line
				return importRow{Line: pe.StartLine}, fmt.Errorf("line %d could not be read as CSV: %w", pe.StartLine, pe.Err)
			}
			return importRow{}, err
		}
		line, _ := c.r.FieldPos(0)
		end, _ := c.r.FieldPos(len(rec) - 1)
		c.noteGap(line)
		c.prevEnd = end
		if !hasContent(rec) {
			c.noteGap(end + 1)
			c.blank++
			if c.blank == 1 {
				c.firstBlnk = line
			}
			continue
		}
		return importRow{Line: line, Cells: append([]string(nil), rec...)}, nil
	}
}

func (c *csvRows) Header() ([]string, error) {
	row, err := c.Next()
	if err != nil {
		return nil, err
	}
	return row.Cells, nil
}

func (c *csvRows) Blank() (int, int) { return c.blank, c.firstBlnk }

// tableRows: an already-parsed table (legacy).
type tableRows struct {
	table [][]string
	i     int
}

func (t *tableRows) Header() ([]string, error) {
	if len(t.table) == 0 {
		return nil, io.EOF
	}
	t.i = 1
	return t.table[0], nil
}

func (t *tableRows) Next() (importRow, error) {
	if t.i >= len(t.table) {
		return importRow{}, io.EOF
	}
	t.i++
	return importRow{Line: t.i, Cells: t.table[t.i-1]}, nil
}

func (t *tableRows) Blank() (int, int) { return 0, 0 }

// importValidateResult: issues and row outcomes.
type importValidateResult struct {
	Issues       []importIssueSpec
	HeaderFailed bool
	DataRows     int
	ErrorLines   []int
	Errors       int
	Warnings     int
	Infos        int
}

type issueKind struct{ issueType, field string }

// importValidator checks one file, row by row.
type importValidator struct {
	mapping  ImportMapping
	refs     importReferences
	index    map[string]int
	nameID   map[string]*MappingColumn
	seen     map[uint64]int32
	res      importValidateResult
	perKind  map[issueKind]int
	kindSeen []issueKind
	kindSev  map[issueKind]string
	kindEx   map[issueKind]importIssueSpec
	// perDay: rows per registration day
	perDay map[string]int
	now    time.Time
}

func newImportValidator(mapping ImportMapping, refs importReferences) *importValidator {
	v := &importValidator{mapping: mapping, refs: refs, seen: map[uint64]int32{}, perKind: map[issueKind]int{},
		kindSev: map[issueKind]string{}, kindEx: map[issueKind]importIssueSpec{}, nameID: map[string]*MappingColumn{},
		perDay: map[string]int{}, now: time.Now()}
	for i := range mapping.Columns {
		c := &mapping.Columns[i]
		if !strings.Contains(c.InternalField, ".") {
			continue
		}
		kind := strings.SplitN(c.InternalField, ".", 2)[0]
		for j := range mapping.Columns {
			if strings.HasPrefix(mapping.Columns[j].References, kind+".") {
				v.nameID[c.DefaultColumn] = &mapping.Columns[j]
				break
			}
		}
	}
	return v
}

func (v *importValidator) raise(line *int, field, issueType, severity, message string) {
	switch severity {
	case "error":
		v.res.Errors++
	case "warning":
		v.res.Warnings++
	default:
		v.res.Infos++
	}
	k := issueKind{issueType, field}
	if v.perKind[k] == 0 {
		v.kindSeen = append(v.kindSeen, k)
		v.kindSev[k] = severity
		v.kindEx[k] = importIssueSpec{RowNumber: line, Message: message}
	}
	v.perKind[k]++
	if v.perKind[k] > maxListedPerKind {
		return
	}
	v.res.Issues = append(v.res.Issues, importIssueSpec{RowNumber: line, Field: strPtrOrNil(field), IssueType: issueType, Severity: severity, Message: message})
}

// header checks the columns; false: stop.
func (v *importValidator) header(cells []string) bool {
	v.index = map[string]int{}
	for i, h := range cells {
		v.index[strings.TrimSpace(h)] = i
	}
	ok := true
	for _, c := range v.mapping.Columns {
		if _, has := v.index[c.DefaultColumn]; c.Required && !has {
			v.raise(nil, c.DefaultColumn, "missing_required_field", "error", fmt.Sprintf("Column %s is missing from the header row.", c.DefaultColumn))
			ok = false
		}
	}
	return ok
}

func (v *importValidator) cell(cells []string, column string) string {
	if at, ok := v.index[column]; ok && at < len(cells) {
		return strings.TrimSpace(cells[at])
	}
	return ""
}

// row checks one data row.
func (v *importValidator) row(r importRow) {
	v.res.DataRows++
	line := r.Line
	ln := &line
	before := v.res.Errors
	values := map[string]string{}
	for _, c := range v.mapping.Columns {
		raw := v.cell(r.Cells, c.DefaultColumn)
		values[c.InternalField] = raw
		if raw == "" {
			if c.Required {
				label := importLabels[c.InternalField]
				if label == "" {
					label = c.DefaultColumn
				}
				v.raise(ln, c.DefaultColumn, "missing_required_field", "error", fmt.Sprintf("%s is empty.", label))
			}
			continue
		}
		switch {
		case len(c.Allowed) > 0:
			if knownValue(raw, c.Allowed) == nil {
				v.raise(ln, c.DefaultColumn, "other", "warning", fmt.Sprintf("%s %q is not one of %s: the case is imported without it.", c.DefaultColumn, raw, strings.Join(c.Allowed, ", ")))
			}
		case c.References != "":
			if target := importReferenceFor(v.refs, c.References); target != nil {
				if _, ok := target[raw]; !ok {
					v.raise(ln, c.DefaultColumn, "unknown_reference", "error", fmt.Sprintf("%s %s is not in the locations or case types: add it in Admin, or correct the row.", c.DefaultColumn, raw))
				}
			}
		case strings.Contains(c.InternalField, "."):
			if idc := v.nameID[c.DefaultColumn]; idc != nil {
				if ref, ok := importReferenceFor(v.refs, idc.References)[v.cell(r.Cells, idc.DefaultColumn)]; ok && ref.NameEn != raw && strings.EqualFold(ref.NameEn, raw) {
					v.raise(ln, c.DefaultColumn, "inconsistent_name_case", "info", fmt.Sprintf("%s %q differs from %q only in capitals; ids are used, so nothing changes.", c.DefaultColumn, raw, ref.NameEn))
				}
			}
		case c.Type == "enum":
			if !containsStr(c.Values, raw) {
				v.raise(ln, c.DefaultColumn, "other", "error", fmt.Sprintf("%s %q is not one of %s.", c.DefaultColumn, raw, strings.Join(c.Values, ", ")))
			}
		case c.Type == "number":
			n, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				v.raise(ln, c.DefaultColumn, "other", "error", fmt.Sprintf("%s %q is not a number.", c.DefaultColumn, raw))
			} else if c.Minimum != nil && n < *c.Minimum {
				v.raise(ln, c.DefaultColumn, "other", "error", fmt.Sprintf("%s %s is below %v.", c.DefaultColumn, raw, *c.Minimum))
			} else if len(c.Range) == 2 && (n < c.Range[0] || n > c.Range[1]) {
				v.raise(ln, c.DefaultColumn, "out_of_range_coordinate", "error", fmt.Sprintf("%s %s is outside %v to %v.", c.DefaultColumn, raw, c.Range[0], c.Range[1]))
			}
		case c.Type == "datetime":
			if importToIso(raw) == nil {
				v.raise(ln, c.DefaultColumn, "other", "error", fmt.Sprintf("%s %q is not a date and time: use YYYY-MM-DD HH:MM:SS (Riyadh time) or ISO 8601.", c.DefaultColumn, raw))
			}
		case c.Type == "integer":
			n, err := strconv.Atoi(raw)
			minimum := 0.0
			if c.Minimum != nil {
				minimum = *c.Minimum
			}
			if err != nil || float64(n) < minimum {
				v.raise(ln, c.DefaultColumn, "other", "error", fmt.Sprintf("%s %q is not a whole number of %v or more.", c.DefaultColumn, raw, minimum))
			} else if c.InternalField == "parties_involved" && n <= 1 {
				party := "parties"
				if n == 1 {
					party = "party"
				}
				v.raise(ln, c.DefaultColumn, "unusual_parties_count", "warning", fmt.Sprintf("Only %d %s involved.", n, party))
			}
		}
	}
	if n := values["case_number"]; n != "" && !caseNumberPattern.MatchString(n) {
		v.raise(ln, "CaseNumber", "other", "error", fmt.Sprintf("CaseNumber %q does not start with a two-letter city code.", n))
	}
	if id := values["external_id"]; id != "" {
		if first, dup := v.seen[idKey(id)]; dup {
			v.raise(ln, "RecordID", "duplicate_external_id", "warning", fmt.Sprintf("RecordID %s is also on row %d; one row per RecordID is imported (the first without errors).", id, first))
		} else {
			v.seen[idKey(id)] = int32(line)
		}
	}
	registered, assigned := importToIso(values["registered_at"]), importToIso(values["assigned_at"])
	if registered != nil && assigned != nil {
		rt, err1 := time.Parse(time.RFC3339Nano, *registered)
		at, err2 := time.Parse(time.RFC3339Nano, *assigned)
		if err1 == nil && err2 == nil && at.Before(rt) {
			minutes := max(int(rt.Sub(at).Minutes()), 1)
			v.raise(ln, "AssignedTime", "assigned_before_registered", "warning", fmt.Sprintf("Assigned %d minutes before it was registered.", minutes))
		}
	}
	if values["assigned_at"] == "" && values["arrived_at"] != "" {
		v.raise(ln, "AssignedTime", "other", "warning", "AssignedTime is empty but ArrivalTime is set: the case counts as remote (inferred).")
	}
	v.checkTimes(ln, values)
	v.checkPlace(ln, values)
	if v.res.Errors > before {
		v.res.ErrorLines = append(v.res.ErrorLines, line)
	}
}

// checkTimes: impossible or outlying times.
func (v *importValidator) checkTimes(ln *int, values map[string]string) {
	at := func(field string) *time.Time { return parseIso(importToIso(values[field])) }
	reg := at("registered_at")
	if reg == nil {
		return
	}
	v.perDay[reg.In(riyadhZone).Format("2006-01-02")]++
	if reg.After(v.now.Add(24 * time.Hour)) {
		v.raise(ln, "RegisteredTime", "other", "warning", fmt.Sprintf("Registered %s, in the future.", reg.In(riyadhZone).Format("2006-01-02 15:04")))
	}
	if arr := at("arrived_at"); arr != nil {
		if arr.Before(*reg) {
			v.raise(ln, "ArrivalTime", "other", "warning", "Arrived before the case was registered.")
		} else if h := arr.Sub(*reg).Hours(); h > maxArrivalHours {
			v.raise(ln, "ArrivalTime", "other", "warning", fmt.Sprintf("Arrived %.0f hours after registration (outlier: over %d).", h, maxArrivalHours))
		}
	}
	if clo := at("closed_at"); clo != nil {
		if clo.Before(*reg) {
			v.raise(ln, "ClosingTime", "other", "warning", "Closed before the case was registered.")
		} else if d := clo.Sub(*reg).Hours() / 24; d > maxClosingDays {
			v.raise(ln, "ClosingTime", "other", "warning", fmt.Sprintf("Closed %.0f days after registration (outlier: over %d).", d, maxClosingDays))
		}
	}
}

// checkDays: a day far from the median day.
func (v *importValidator) checkDays() {
	if len(v.perDay) < minOutlierDays {
		return
	}
	days := make([]string, 0, len(v.perDay))
	counts := make([]int, 0, len(v.perDay))
	for d, n := range v.perDay {
		days = append(days, d)
		counts = append(counts, n)
	}
	sort.Ints(counts)
	sort.Strings(days)
	median := counts[len(counts)/2]
	if median < minMedianPerDay {
		return
	}
	// first and last days are often partial
	for _, d := range days[1 : len(days)-1] {
		n := v.perDay[d]
		if float64(n) > dayOutlierFactor*float64(median) || float64(n) < float64(median)/dayOutlierFactor {
			v.raise(nil, "RegisteredTime", "other", "warning", fmt.Sprintf("%s has %d cases against a median of %d a day: a missing or doubled extract? (outlier)", d, n, median))
		}
	}
}

// checkPlace: a point far from its sub-zone.
func (v *importValidator) checkPlace(ln *int, values map[string]string) {
	lat, err1 := strconv.ParseFloat(values["latitude"], 64)
	lon, err2 := strconv.ParseFloat(values["longitude"], 64)
	if err1 != nil || err2 != nil || math.Abs(lat) > 90 || math.Abs(lon) > 180 {
		return
	}
	if sub, ok := v.refs.SubZones[values["sub_zone_id"]]; ok && sub.HasCentre {
		if km := distanceKm(lat, lon, sub.Lat, sub.Lon); km > farFromSubZoneKm {
			v.raise(ln, "Latitude", "other", "warning", fmt.Sprintf("Latitude %s, Longitude %s is %.0f km from sub-zone %s (%s): swapped or empty coordinates? The case keeps them.",
				values["latitude"], values["longitude"], km, values["sub_zone_id"], sub.NameEn))
			return
		}
	}
	if a := v.mapping.ServiceArea; a != nil && len(a.Latitude) == 2 && len(a.Longitude) == 2 &&
		(lat < a.Latitude[0] || lat > a.Latitude[1] || lon < a.Longitude[0] || lon > a.Longitude[1]) {
		v.raise(ln, "Latitude", "out_of_range_coordinate", "warning", fmt.Sprintf("Latitude %s, Longitude %s is outside the service area: the case keeps them.", values["latitude"], values["longitude"]))
	}
}

func distanceKm(lat1, lon1, lat2, lon2 float64) float64 {
	rad := math.Pi / 180
	dLat, dLon := (lat2-lat1)*rad, (lon2-lon1)*rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 6371 * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// finish adds the summaries of capped kinds.
func (v *importValidator) finish(rows importRows) importValidateResult {
	v.checkDays()
	if n, first := rows.Blank(); n > 0 {
		f := first
		word := "lines were"
		if n == 1 {
			word = "line was"
		}
		v.raise(&f, "", "other", "info", fmt.Sprintf("%d empty %s skipped (the first is line %d).", n, word, first))
	}
	sort.SliceStable(v.kindSeen, func(a, b int) bool {
		return bySeverityOrder[v.kindSev[v.kindSeen[a]]] < bySeverityOrder[v.kindSev[v.kindSeen[b]]]
	})
	for _, k := range v.kindSeen {
		if n := v.perKind[k]; n > maxListedPerKind {
			ex, like := v.kindEx[k], ""
			if ex.RowNumber != nil {
				like = fmt.Sprintf(" like row %d", *ex.RowNumber)
			}
			v.res.Issues = append(v.res.Issues, importIssueSpec{Field: strPtrOrNil(k.field), IssueType: k.issueType, Severity: v.kindSev[k],
				Message: fmt.Sprintf("%d rows in all%s (%s) Only the first %d are listed.", n, like, strings.TrimSuffix(ex.Message, "."), maxListedPerKind)})
		}
	}
	return v.res
}

// validateRows: the whole file, streamed.
func validateRows(mapping ImportMapping, rows importRows, refs importReferences) (importValidateResult, error) {
	v := newImportValidator(mapping, refs)
	header, err := rows.Header()
	if err == io.EOF {
		v.raise(nil, "", "other", "error", "The file is empty: it needs a header row.")
		v.res.HeaderFailed = true
		return v.res, nil
	}
	if err != nil {
		return importValidateResult{}, err
	}
	if !v.header(header) {
		v.res.HeaderFailed = true
		return v.res, nil
	}
	for {
		r, err := rows.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			if r.Line == 0 {
				return importValidateResult{}, err
			}
			line := r.Line
			v.res.DataRows++
			v.raise(&line, "", "other", "error", err.Error())
			v.res.ErrorLines = append(v.res.ErrorLines, line)
			continue
		}
		v.row(r)
	}
	if v.res.DataRows == 0 {
		v.raise(nil, "", "other", "error", "The file has a header row and no data rows.")
		v.res.HeaderFailed = true
	}
	return v.finish(rows), nil
}

// validateFile: pure, for an in-memory table.
func validateFile(mapping ImportMapping, table [][]string, refs importReferences) importValidateResult {
	res, _ := validateRows(mapping, &tableRows{table: table}, refs)
	return res
}
